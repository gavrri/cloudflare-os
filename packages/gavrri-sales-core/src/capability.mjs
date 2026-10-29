/** @typedef {{sourceUrl:string,sourceRef:string,recordedOn:string,confirmation:'confirmed'|'unconfirmed'}} Evidence */
/** @typedef {{kind:string,occurredOn:string,note:string,evidence:Evidence}} EventInput */
/** @typedef {{companyId:string,offer:string,dataset:'actual'|'demo',currency:string,amount:string,evidence:Evidence}} FinancialInput */
/** @typedef {FinancialInput & {kind:string,occurredOn:string,periodStart:string,periodEnd:string}} AmountInput */
/** @typedef {FinancialInput & {cadence:'monthly'|'annual',paidFrom:string,paidUntil?:string|null,pauseFrom?:string|null,pauseUntil?:string|null,supersedes?:string|null}} ContractInput */
/** @typedef {({kind:'company',name:string,requestId:string}|{kind:'candidate',companyId:string,offer:string,motion:string,registryId:string|null,requestId:string}|{kind:'permission',id:string,allowed:string,evidence:Evidence,version:number,requestId:string}|{kind:'amount',input:AmountInput,requestId:string}|{kind:'contract',input:ContractInput,requestId:string}|{kind:'event',id:string,input:EventInput,requestId:string}|{kind:'nextAction',id:string,action:string|null,dueOn:string|null,version:number,requestId:string})} Action */
/** @typedef {{canAccess:(scope:string,mode:'read'|'write')=>Promise<boolean>}} Access */
/** @typedef {{authorizeObservation:(description:{title:string,description:string})=>Promise<void>,submitAction:(id:number,description:{title:string,description:string,implementsRevert:boolean,awaitDecision:boolean})=>Promise<void>}} Queue */
/** @typedef {{put:(scope:string,action:Action)=>Promise<number>,get:(scope:string,id:number)=>Promise<Action|null>,remove:(scope:string,id:number)=>Promise<void>}} Pending */
/** @typedef {{scope:string,db:D1Database,access:Access,queue:Queue,pending:Pending}} CapabilityOptions */
// Local authorization/approval primitives for a future OS Gatekeeper adapter.
// A caller must never construct these from user-supplied identities or scopes.
import { getCandidate, recordEvent, setNextAction, createCompany, createCandidate, setContactPermission, recordAmount, recordContract } from './core.mjs';

/** @param {CapabilityOptions} options */
export function createLocalCapability({ scope, db, access, queue, pending }) {
  if (!scope || !db || !access || !queue || !pending) throw new Error('missing trusted capability');
  /** @param {'read'|'write'} mode */
  async function requireAccess(mode) {
    if (!await access.canAccess(scope,mode)) throw new Error('access denied');
    const bound=await db.prepare("SELECT value FROM portfolio_scope WHERE id='scope'").bind().first();
    if (!bound || bound.value!==scope) throw new Error('scope mismatch');
  }
  /** @param {string} title */
  async function observe(title) {
    await requireAccess('read');
    await queue.authorizeObservation({title,description:'Read a scoped sales record.'});
  }
  /** @param {Action} action */
  async function submit(action) {
    await requireAccess('write');
    const id=await pending.put(scope,action);
    try {
      await queue.submitAction(id,{title:'Record sales data',description:'Apply a scoped sales record.',implementsRevert:false,awaitDecision:true});
    } catch(error) {await pending.remove(scope,id);throw error}
    return id;
  }
  const session=Object.freeze({
    /** @param {string} name @param {string} requestId */
    async createCompany(name,requestId) {return submit({kind:'company',name,requestId})},
    /** @param {string} companyId @param {string} offer @param {string} motion @param {string|null} registryId @param {string} requestId */
    async createCandidate(companyId,offer,motion,registryId,requestId) {return submit({kind:'candidate',companyId,offer,motion,registryId,requestId})},
    /** @param {string} id @param {string} allowed @param {Evidence} evidence @param {number} version @param {string} requestId */
    async setContactPermission(id,allowed,evidence,version,requestId) {return submit({kind:'permission',id,allowed,evidence,version,requestId})},
    /** @param {AmountInput} input @param {string} requestId */
    async recordAmount(input,requestId) {return submit({kind:'amount',input,requestId})},
    /** @param {ContractInput} input @param {string} requestId */
    async recordContract(input,requestId) {return submit({kind:'contract',input,requestId})},
    /** @param {string} id */
    async getCandidate(id) {await observe('Read sales candidate'); return getCandidate(db,id)},
    /** @param {string} id @param {EventInput} input @param {string} requestId */
    async recordEvent(id,input,requestId) {return submit({kind:'event',id,input,requestId})},
    /** @param {string} id @param {string|null} action @param {string|null} dueOn @param {number} version @param {string} requestId */
    async setNextAction(id,action,dueOn,version,requestId) {return submit({kind:'nextAction',id,action,dueOn,version,requestId})},
  });
  const host=Object.freeze({
    /** @param {Access} verifier */
    async addObserver(verifier) {await requireAccess('read');if (!await verifier.canAccess(scope,'read')) throw new Error('observer denied')},
    /** @param {number} id */
    async applyAction(id) {
      await requireAccess('write');
      const action=await pending.get(scope,id);if(!action)throw new Error('unknown action');
      let result;
      if(action.kind==='company') result=await createCompany(db,action.name,action.requestId);
      else if(action.kind==='candidate') result=await createCandidate(db,action.companyId,action.offer,action.motion,action.registryId,action.requestId);
      else if(action.kind==='permission') result=await setContactPermission(db,action.id,action.allowed,action.evidence,action.version,action.requestId);
      else if(action.kind==='amount') result=await recordAmount(db,action.input,action.requestId);
      else if(action.kind==='contract') result=await recordContract(db,action.input,action.requestId);
      else if(action.kind==='event') result=await recordEvent(db,action.id,action.input,action.requestId);
      else if(action.kind==='nextAction') result=await setNextAction(db,action.id,action.action,action.dueOn,action.version,action.requestId);
      else throw new Error('unknown action');
      await pending.remove(scope,id);return result;
    },
    /** @param {number} id */
    async rejectAction(id) {await pending.remove(scope,id)},
  });
  return {session,host};
}
