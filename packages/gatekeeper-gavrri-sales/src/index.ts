import { WorkerEntrypoint, DurableObject, RpcTarget, RpcStub } from 'cloudflare:workers';
import { validateRpc, skipRpcValidation } from 'capnweb-validate';
import type { Gatekeeper, GatekeeperUser, GatekeeperUserVerifier, ApprovalQueue, ResourceDescription, VendorDescription, SupportedResource, ResourceConfiguratorFrame, GatekeeperConnectCallback, GatekeeperConnectOptions, AccountDescription } from '@gadgets/workshop-shared/gatekeeper';
import { metrics } from '@gadgets/gavrri-sales-core/metrics';
import { createPager } from './paging.mjs';
import { candidateQuery } from './candidate-query.mjs';
import { previewRegistry } from '@gadgets/gavrri-sales-core/preview';
import { evidenceString, recordEvent as persistEvent, createCompany, createCandidate, recordAmount, recordContract, setContactPermission, setNextAction, linkCompany, requireDate } from '@gadgets/gavrri-sales-core/core';
import TYPES from './types.txt';
import CONFIGURATOR_HTML from './generated/sales-configurator-ui.txt';
import type { SalesConfiguratorRpc } from './configurator/sales-configurator-types.js';
import type { SalesSession, Candidate, ContactEvent, EventInput, MetricScope, MetricResult, AmountInput, ContractInput, Proposal, RegistryPreview, Evidence } from './types.js';

type Props={accountId:string};
type SalesVerifierApi=GatekeeperUserVerifier & {hasAccess(accountId:string):Promise<boolean>};
const RESOURCE:SupportedResource={urlPattern:'sales://local-demo',title:'営業デモ',description:'Local synthetic sales portfolio.'};
const ICON={url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'};
function checkLocal(env:Cloudflare.Env) { if(env.LOCAL_SALES_DEMO!=='true') throw new Error('Local demo only'); }
async function ownerAccess(env:Cloudflare.Env, accountId:string):Promise<boolean>{
  checkLocal(env);
  const owner=await env.SALES_DB.prepare("SELECT account_id FROM sales_local_owner WHERE id='owner'").first<{account_id:string}>();
  return owner?.account_id===accountId;
}
type SerializedEvent={candidateId:string;input:EventInput;requestId:string};
type NewAction={operation:'nextAction';candidateId:string;action:string|null;dueOn:string|null;expectedVersion:number;requestId:string}|{operation:'alias';aliasCompanyId:string;targetCompanyId:string;expectedVersion:number;requestId:string}|{operation:'permission';candidateId:string;allowed:'yes'|'no'|'unknown';evidence:Evidence;version:number;requestId:string}|{operation:'company';name:string;requestId:string}|{operation:'candidate';companyId:string;offer:string;motion:string;registryId:string|null;requestId:string}|{operation:'amount';input:AmountInput;requestId:string}|{operation:'contract';input:ContractInput;requestId:string};
type Submission={id:number;payload:string;state:'pending'|'applied'|'rejected'};
type Serial = <T>(operation:()=>Promise<T>)=>Promise<T>;

@validateRpc()
class SalesSessionImpl extends RpcTarget implements SalesSession {
  private readonly pager=createPager();
  constructor(private readonly env:Cloudflare.Env,private readonly accountId:string,private readonly queue:RpcStub<ApprovalQueue>,private readonly serial:Serial){super()}
  [Symbol.dispose](){this.queue[Symbol.dispose]()}
  private async observe(title:string){
    if(!await ownerAccess(this.env,this.accountId))throw new Error('access denied');
    const scope=await this.env.SALES_DB.prepare("SELECT value FROM portfolio_scope WHERE id='scope'").first<{value:string}>();
    if(scope?.value!=='demo')throw new Error('scope mismatch');
    await this.queue.authorizeObservation({title,description:'Read local synthetic sales records.'});
  }
  async listCandidates(cursor:string|null=null):Promise<{items:Candidate[];nextCursor:string|null}>{
    await this.observe('Read sales candidates');
    if(cursor==='')throw new Error('invalid cursor');
    const high=cursor?0:(await this.env.SALES_DB.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM candidates').first<{n:number}>())?.n??0;
    const position=cursor?this.pager.resolve(cursor,'candidates',this.accountId):this.pager.start('candidates',this.accountId,high);
    const rows=await this.env.SALES_DB.prepare(candidateQuery).bind(position.last,position.high).all<{page_rowid:number;id:string;company_id:string;offer:string;motion:string;contact_allowed:string;registry_status:'active'|'hold'|'future'|'excluded';company_refused:number;next_action:string|null;next_date:string|null;version:number;name:string}>();
    return {items:rows.results.map(r=>({id:r.id,companyId:r.company_id,companyName:r.name,offer:r.offer,motion:r.motion,contactAllowed:r.contact_allowed,registryStatus:r.registry_status,companyRefused:r.company_refused===1,nextAction:r.next_action,nextActionDate:r.next_date,version:r.version})),nextCursor:rows.results.length===100?this.pager.next(position,rows.results[99].page_rowid):null};
  }
  async listEvents(candidateId:string,cursor:string|null=null):Promise<{items:ContactEvent[];nextCursor:string|null}>{
    await this.observe('Read contact events');
    if(!candidateId || candidateId.length>200 || cursor==='')throw new Error('invalid candidate or cursor');
    const target=this.accountId+'\0'+candidateId;
    const high=cursor?0:(await this.env.SALES_DB.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM events WHERE candidate_id=?').bind(candidateId).first<{n:number}>())?.n??0;
    const position=cursor?this.pager.resolve(cursor,'events',target):this.pager.start('events',target,high);
    const rows=await this.env.SALES_DB.prepare('SELECT rowid AS page_rowid,id,candidate_id,kind,occurred_on,note,evidence FROM events WHERE candidate_id=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT 100').bind(candidateId,position.last,position.high).all<{page_rowid:number;id:string;candidate_id:string;kind:string;occurred_on:string;note:string;evidence:string}>();
    return {items:rows.results.map(r=>({id:r.id,candidateId:r.candidate_id,kind:r.kind,occurredOn:r.occurred_on,note:r.note,evidence:JSON.parse(r.evidence)})),nextCursor:rows.results.length===100?this.pager.next(position,rows.results[99].page_rowid):null};
  }
  async recordEvent(candidateId:string,input:EventInput,requestId:string):Promise<{status:'pending'|'applied'|'rejected';actionId:number}>{
    if(!candidateId || candidateId.length>200 || !requestId || requestId.length>200 || input.note.length>2000)throw new Error('Invalid event');
    const evidence=JSON.parse(evidenceString(input.evidence)) as EventInput['evidence'];
    await this.observe('Read candidate before proposing a contact record');
    const candidate=await this.env.SALES_DB.prepare('SELECT co.name,c.offer FROM candidates c JOIN companies co ON co.id=c.company_id WHERE c.id=?').bind(candidateId).first<{name:string;offer:string}>();
    if(!candidate)throw new Error('Candidate not found');
    const normalized:SerializedEvent={candidateId,input:{kind:input.kind,occurredOn:input.occurredOn,note:input.note,evidence},requestId};
    const payload=JSON.stringify(normalized);
    const summary=JSON.stringify({company:candidate.name,offer:candidate.offer,...normalized},null,2).replaceAll('`','\\u0060');
    return this.serial(async()=>{
      if(!await ownerAccess(this.env,this.accountId))throw new Error('access denied');
      const insert=await this.env.SALES_DB.prepare("INSERT OR IGNORE INTO sales_submissions(scope,request_id,payload,state) VALUES('demo',?,?,'pending')").bind(requestId,payload).run();
      const row=await this.env.SALES_DB.prepare("SELECT id,payload,state FROM sales_submissions WHERE scope='demo' AND request_id=?").bind(requestId).first<Submission>();
      if(!row || row.payload!==payload)throw new Error('request ID reused');
      if(insert.meta.changes===0)return {status:row.state,actionId:row.id};
      try {
        await this.queue.submitAction(row.id,{title:'営業履歴の記録（デモ）',description:'以下のデモ履歴を保存します。外部送信は行いません。\n\n```json\n'+summary+'\n```',implementsRevert:false,awaitDecision:true});
      } catch(error) {
        await this.env.SALES_DB.prepare("DELETE FROM sales_submissions WHERE id=? AND state='pending'").bind(row.id).run();
        throw error;
      }
      return {status:'pending',actionId:row.id};
    });
  }
  async previewDemoRegistry():Promise<RegistryPreview>{
    await this.observe('Preview synthetic registry');
    const csv='registry_id,company,offer,motion,registry_status,execution_id\nDEMO-001,架空企業サンプル,Weibeo,partner,hold,';
    return previewRegistry(this.env.SALES_DB,csv);
  }
  async listCompanies():Promise<{items:{id:string;name:string;version:number;canonicalId:string}[]}>{
    await this.observe('Read companies');
    const rows=await this.env.SALES_DB.prepare('SELECT c.id,c.name,c.version,COALESCE(a.company_id,c.id) AS canonical_id FROM companies c LEFT JOIN company_aliases a ON a.id=c.id ORDER BY c.name LIMIT 100').all<{id:string;name:string;version:number;canonical_id:string}>();
    return {items:rows.results.map(r=>({id:r.id,name:r.name,version:r.version,canonicalId:r.canonical_id}))};
  }
  async listLimits():Promise<{items:{offer:string;startDate:string;endDate:string;maxContacts:number;used:number}[]}>{
    await this.observe('Read campaign limits');
    const rows=await this.env.SALES_DB.prepare("SELECT p.offer,p.start_date,p.end_date,p.max_contacts,(SELECT COUNT(*) FROM events e JOIN candidates c ON c.id=e.candidate_id WHERE c.offer=p.offer AND e.kind IN ('sent','form_accepted','unknown') AND e.occurred_on BETWEEN p.start_date AND p.end_date) AS used FROM limits p ORDER BY p.start_date").all<{offer:string;start_date:string;end_date:string;max_contacts:number;used:number}>();
    return {items:rows.results.map(r=>({offer:r.offer,startDate:r.start_date,endDate:r.end_date,maxContacts:r.max_contacts,used:r.used}))};
  }
  async getPeriodLimit(offer:string,day:string):Promise<{start:string;end:string;limit:number;observed:number}|null>{
    requireDate(day);
    const {items}=await this.listLimits();
    const row=items.find(r=>r.offer===offer&&r.startDate<=day&&day<=r.endDate);
    return row?{start:row.startDate,end:row.endDate,limit:row.maxContacts,observed:row.used}:null;
  }
  private async propose(action:NewAction):Promise<Proposal>{
    if(!action.requestId || action.requestId.length>200)throw new Error('invalid request ID');
    await this.observe('Propose sales record');
    if((action.operation==='contract'||action.operation==='amount')){
      if(action.input.dataset!=='demo')throw new Error('scope mismatch');
      evidenceString(action.input.evidence);
    }
    if(action.operation==='permission')evidenceString(action.evidence);
    const payload=JSON.stringify(action);
    if(payload.length>10000)throw new Error('input too large');
    let summary=payload.replaceAll('`','\\u0060');
    if(action.operation==='alias'){
      const source=await this.env.SALES_DB.prepare('SELECT name FROM companies WHERE id=?').bind(action.aliasCompanyId).first<{name:string}>();
      const target=await this.env.SALES_DB.prepare('SELECT name FROM companies WHERE id=?').bind(action.targetCompanyId).first<{name:string}>();
      if(!source||!target)throw new Error('company not found');
      summary=JSON.stringify({alias:{id:action.aliasCompanyId,name:source.name},target:{id:action.targetCompanyId,name:target.name},expectedVersion:action.expectedVersion},null,2).replaceAll('`','\\u0060');
    }
    return this.serial(async()=>{
      if(!await ownerAccess(this.env,this.accountId))throw new Error('access denied');
      const insert=await this.env.SALES_DB.prepare("INSERT OR IGNORE INTO sales_submissions(scope,request_id,payload,state) VALUES('demo',?,?,'pending')").bind(action.requestId,payload).run();
      const row=await this.env.SALES_DB.prepare("SELECT id,payload,state FROM sales_submissions WHERE scope='demo' AND request_id=?").bind(action.requestId).first<Submission>();
      if(!row || row.payload!==payload)throw new Error('request ID reused');
      if(insert.meta.changes===0)return {status:row.state,actionId:row.id};
      try {await this.queue.submitAction(row.id,{title:'営業データの記録（デモ）',description:'承認後にローカルのデモデータを保存します。外部送信はありません。'+(action.operation==='alias'?' 両社の拒否は関連付け後、全 Offer に適用されます。':'')+'\n\n```json\n'+summary+'\n```',implementsRevert:false,awaitDecision:true});}
      catch(error){await this.env.SALES_DB.prepare("DELETE FROM sales_submissions WHERE id=? AND state='pending'").bind(row.id).run();throw error}
      return {status:'pending',actionId:row.id};
    });
  }
  async proposeNextAction(candidateId:string,action:string|null,dueOn:string|null,expectedVersion:number,requestId:string):Promise<Proposal>{return this.propose({operation:'nextAction',candidateId,action,dueOn,expectedVersion,requestId})}
  async proposeLinkAlias(aliasCompanyId:string,targetCompanyId:string,expectedVersion:number,requestId:string):Promise<Proposal>{return this.propose({operation:'alias',aliasCompanyId,targetCompanyId,expectedVersion,requestId})}
  async proposePermission(candidateId:string,allowed:'yes'|'no'|'unknown',evidence:Evidence,version:number,requestId:string):Promise<Proposal>{return this.propose({operation:'permission',candidateId,allowed,evidence,version,requestId})}
  async proposeCompany(name:string,requestId:string):Promise<Proposal>{return this.propose({operation:'company',name,requestId})}
  async proposeCandidate(companyId:string,offer:string,motion:string,registryId:string|null,requestId:string):Promise<Proposal>{return this.propose({operation:'candidate',companyId,offer,motion,registryId,requestId})}
  async proposeContract(input:ContractInput,requestId:string):Promise<Proposal>{return this.propose({operation:'contract',input,requestId})}
  async proposeAmount(input:AmountInput,requestId:string):Promise<Proposal>{return this.propose({operation:'amount',input,requestId})}
  async getMetrics(scope:MetricScope):Promise<MetricResult>{
    await this.observe('Read sales metrics');
    if(scope.dataset!=='demo') throw new Error('Local demo only');
    const result=await metrics(this.env.SALES_DB,scope);
    return {...result,coverage:'unverified'};
  }
}
@validateRpc()
export class SalesGatekeeper extends DurableObject<Cloudflare.Env,Props> implements Gatekeeper<SalesSession>{
  private chain:Promise<void>=Promise.resolve();
  private serial:Serial=<T>(operation:()=>Promise<T>)=>{const result=this.chain.then(operation);this.chain=result.then(()=>{},()=>{});return result};
  async describe():Promise<ResourceDescription>{checkLocal(this.env);return {url:'sales://local-demo',title:'営業デモ',snippet:'Local synthetic sales data only.',suggestedBindingName:'SALES',tsType:'SalesSession'}}
  async getTypeScriptTypes():Promise<string>{return TYPES}
  async getAutoApprovableActions(){return []}
  async startSession(q:RpcStub<ApprovalQueue>):Promise<SalesSession>{if(!await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');return new SalesSessionImpl(this.env,this.ctx.props.accountId,q.dup(),this.serial)}
  async addObserver(_id:string,user:Fetcher<GatekeeperUserVerifier>):Promise<void>{
    if(!await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');
    const verifier=user as unknown as Fetcher<SalesVerifierApi>;
    if(!await verifier.hasAccess(this.ctx.props.accountId))throw new Error('observer denied');
  }
  async removeObserver(_id:string):Promise<void>{}
  async applyAction(id:number):Promise<void>{
    await this.serial(async()=>{
      if(!await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');
      const row=await this.env.SALES_DB.prepare("SELECT id,payload,state FROM sales_submissions WHERE id=? AND scope='demo'").bind(id).first<Submission>();
      if(!row || row.state==='rejected')throw new Error('unknown action');
      if(row.state==='applied')return;
      const action=JSON.parse(row.payload) as NewAction|SerializedEvent;
      if('operation' in action){
        switch(action.operation){
          case 'nextAction':await setNextAction(this.env.SALES_DB,action.candidateId,action.action,action.dueOn,action.expectedVersion,action.requestId);break;
          case 'alias':await linkCompany(this.env.SALES_DB,action.aliasCompanyId,action.targetCompanyId,action.expectedVersion,action.requestId);break;
          case 'permission':await setContactPermission(this.env.SALES_DB,action.candidateId,action.allowed,action.evidence,action.version,action.requestId);break;
          case 'company':await createCompany(this.env.SALES_DB,action.name,action.requestId);break;
          case 'candidate':await createCandidate(this.env.SALES_DB,action.companyId,action.offer,action.motion,action.registryId,action.requestId);break;
          case 'amount':if(action.input.dataset!=='demo')throw new Error('scope mismatch');await recordAmount(this.env.SALES_DB,action.input,action.requestId);break;
          case 'contract':if(action.input.dataset!=='demo')throw new Error('scope mismatch');await recordContract(this.env.SALES_DB,action.input,action.requestId);break;
          default:throw new Error('unsupported action');
        }
      }else await persistEvent(this.env.SALES_DB,action.candidateId,action.input,action.requestId);
      await this.env.SALES_DB.prepare("UPDATE sales_submissions SET state='applied' WHERE id=? AND scope='demo' AND state='pending'").bind(id).run();
    });
  }
  async rejectAction(id:number):Promise<void>{
    await this.serial(async()=>{if(!await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');await this.env.SALES_DB.prepare("UPDATE sales_submissions SET state='rejected' WHERE id=? AND scope='demo' AND state='pending'").bind(id).run()});
  }
  async revertAction(_id:number):Promise<void>{throw new Error('Revert not supported')}
}
@validateRpc()
export class SalesVerifier extends WorkerEntrypoint<Cloudflare.Env,Props> implements GatekeeperUserVerifier {
  async hasAccess(accountId:string):Promise<boolean>{return this.ctx.props.accountId===accountId && await ownerAccess(this.env,accountId)}
}
@validateRpc()
class SalesConfigurator extends RpcTarget implements SalesConfiguratorRpc {
  async resourceUrl():Promise<string>{return RESOURCE.urlPattern}
}
@validateRpc()
export class SalesAccount extends WorkerEntrypoint<Cloudflare.Env,Props> implements GatekeeperUser {
  async describe():Promise<AccountDescription>{checkLocal(this.env);return {displayName:'営業デモ',avatar:ICON,singleton:{tsType:'SalesSession'}}}
  async getSingletonGatekeeperClass():Promise<DurableObjectClass<Gatekeeper<SalesSession>>>{return this.ctx.exports.SalesGatekeeper({props:this.ctx.props})}
  async getSupportedResources():Promise<SupportedResource[]>{return [RESOURCE]}
  async getGatekeeperClassFor(url:string):Promise<{class:DurableObjectClass<Gatekeeper<SalesSession>>;resource:SupportedResource}>{if(url!=='sales://local-demo'||!await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');return {class:this.ctx.exports.SalesGatekeeper({props:this.ctx.props}),resource:RESOURCE}}
  async startResourceConfigurator(pattern:string):Promise<ResourceConfiguratorFrame>{
    if(pattern!==RESOURCE.urlPattern || !await ownerAccess(this.env,this.ctx.props.accountId))throw new Error('access denied');
    return {iframeHtml:CONFIGURATOR_HTML,ui:new RpcStub(new SalesConfigurator())};
  }
  async ensureResources(_patterns:string[]):Promise<{url?:string}>{return {}}
  async revoke():Promise<void>{throw new Error('Local demo account cannot be revoked here')}
  reconnect():Promise<{url:string}>{throw new Error('No reconnect')}
  commitReconnect(_id:string):Promise<void>{throw new Error('No reconnect')}
  async getAuthenticatedEmail():Promise<string|null>{return null}
  @skipRpcValidation() async getVerifier():Promise<Fetcher<GatekeeperUserVerifier>>{return this.ctx.exports.SalesVerifier({props:this.ctx.props})}
}
@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env>{
  async describe():Promise<VendorDescription>{checkLocal(this.env);return {displayName:'営業デモ',url:'https://example.com/',tagline:'Local synthetic data',description:'Local development only.',autoProvisionsAccount:true,providesAuth:false}}
  @skipRpcValidation() async createAccount():Promise<Fetcher<GatekeeperUser>>{
    checkLocal(this.env);const accountId=crypto.randomUUID();
    await this.env.SALES_DB.prepare("INSERT OR IGNORE INTO sales_local_owner(id,account_id) VALUES('owner',?)").bind(accountId).run();
    if(!await ownerAccess(this.env,accountId))throw new Error('Local demo already belongs to another account');
    return this.ctx.exports.SalesAccount({props:{accountId}});
  }
  connectAccount(_callback:Fetcher<GatekeeperConnectCallback>,_options?:GatekeeperConnectOptions):Promise<{url:string}>{throw new Error('No connect flow')}
  async getSupportedResources():Promise<SupportedResource[]>{return [RESOURCE]}
  async getTypeScriptTypes():Promise<string>{return TYPES}
}

/** No public API surface; the Workshop uses only service capabilities. */
export default { fetch(): Response { return new Response('Not found',{status:404}); } };
