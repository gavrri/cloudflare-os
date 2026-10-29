import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from '../../../../packages/gatekeeper-scheduler/node_modules/jsdom/lib/api.js';

const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
function example(overrides={}) {
  const events=[];
  const stub={listCompanies:async()=>({items:[{id:'co1',name:'Demo Company',version:2},{id:'co2',name:'Demo Alias',version:4}]}),listLimits:async()=>({items:[]}),listCandidates:async()=>({items:[{id:'c1',companyName:'Demo Company',offer:'demo',motion:'direct',contactAllowed:'yes',version:3}]}),listEvents:async()=>events,recordEvent:async()=>({status:'pending',actionId:42}),getMetrics:async()=>({currency:'JPY',revenue:'1500.00',payment:null,mrr:'100.00',forecast:null,activeCompanies:1,activeContracts:1,newContracts:1,cancellations:null,coverage:'unverified'}),...overrides};
  const oldCandidates=stub.listCandidates,oldEvents=stub.listEvents; stub.listCandidates=async cursor=>{const p=await oldCandidates(cursor);return {...p,nextCursor:p.nextCursor??null}};stub.listEvents=async(id,cursor)=>{const p=await oldEvents(id,cursor);return Array.isArray(p)?{items:p,nextCursor:null}:p};
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{runScripts:'outside-only',url:'http://local.test/'});
  dom.window.gadget=stub;
  return {dom,events,run:()=>dom.window.eval(`(async()=>{${source}\n})()`)};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('demo scope, unknown values, separate totals and candidate search',async()=>{
  const {dom,run}=example();await run();const doc=dom.window.document;
  assert.match(doc.body.textContent,/デモデータ（実績ではありません）/);assert.match(doc.body.textContent,/1500\.00/);assert.match(doc.body.textContent,/未確認/);assert.match(doc.body.textContent,/MRR/);
  const q=doc.querySelector('#search');q.value='missing';q.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.match(doc.querySelector('#candidateList').textContent,/候補がありません/);
  dom.window.close();
});
test('approval request remains pending, and rereads history without claiming a send',async()=>{
  let submitted;const {dom,run}=example({recordEvent:async(id,input,requestId)=>{submitted={id,input,requestId};return {status:'pending',actionId:42}}});await run();const doc=dom.window.document;
  doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#record').click();
  doc.querySelector('#sourceUrl').value='https://example.com/evidence';doc.querySelector('#sourceRef').value='demo-001';
  doc.querySelector('#submitEvent').click();await tick();await tick();
  assert.equal(submitted.id,'c1');assert.equal(submitted.input.evidence.sourceRef,'demo-001');assert.ok(submitted.requestId);assert.match(doc.body.textContent,/承認待ち/);assert.doesNotMatch(doc.body.textContent,/承認済みの記録を読み直しました/);
  dom.window.close();
});
test('malicious labels render as text and missing session fails closed',async()=>{
  const {dom,run}=example({listCandidates:async()=>({items:[{id:'c1',companyName:'<img src=x onerror=alert(1)>',offer:'demo',motion:'direct'}]})});await run();assert.equal(dom.window.document.querySelector('img'),null);assert.match(dom.window.document.body.textContent,/<img/);dom.window.close();
  const failure=example({listCandidates:async()=>{throw new Error('接続がありません')}});await failure.run();assert.match(failure.dom.window.document.body.textContent,/接続がありません/);failure.dom.window.close();
});
test('scope changes are reflected in the metric request and unknown amounts are not charted as zero',async()=>{
  const calls=[];const {dom,run}=example({getMetrics:async(scope)=>{calls.push({...scope});return {currency:scope.currency,revenue:null,payment:null,mrr:null,forecast:null,activeCompanies:null,activeContracts:null,newContracts:null,cancellations:null,coverage:'unverified'}}});await run();const doc=dom.window.document;
  const offer=doc.querySelector('#offer');offer.value='demo';offer.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();await tick();
  const dataset=doc.querySelector('#dataset');dataset.value='actual';dataset.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();await tick();
  assert.equal(calls.at(-1).offer,'demo');assert.equal(calls.at(-1).dataset,'actual');assert.match(doc.body.textContent,/実データ/);assert.match(doc.body.textContent,/各月は未確認です。0として描きません/);dom.window.close();
});
test('an ambiguous write response never claims approval or persistence',async()=>{
  const {dom,run}=example({recordEvent:async()=>({status:'unknown'})});await run();const doc=dom.window.document;
  doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#record').click();doc.querySelector('#sourceUrl').value='https://example.com/evidence';doc.querySelector('#sourceRef').value='test';doc.querySelector('#submitEvent').click();await tick();await tick();
  assert.match(doc.body.textContent,/承認依頼の結果を確認できません/);assert.doesNotMatch(doc.body.textContent,/承認済みの記録/);dom.window.close();
});
test('click validates required evidence before requesting approval',async()=>{
  let calls=0;const {dom,run}=example({recordEvent:async()=>{calls++;return {status:'pending',actionId:42}}});await run();const doc=dom.window.document;
  doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#record').click();doc.querySelector('#submitEvent').click();await tick();
  assert.equal(calls,0);assert.equal(doc.querySelector('#submitEvent').type,'button');dom.window.close();
});

test('refresh clears stale pending message without asserting approval from history alone',async()=>{
  const {dom,run}=example();await run();const doc=dom.window.document;
  doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#record').click();doc.querySelector('#sourceUrl').value='https://example.com/evidence';doc.querySelector('#sourceRef').value='demo';doc.querySelector('#submitEvent').click();await tick();await tick();
  assert.match(doc.body.textContent,/承認待ち/);doc.querySelector('#refresh').click();await tick();await tick();
  assert.doesNotMatch(doc.body.textContent,/承認待ち（受付番号/);assert.match(doc.body.textContent,/履歴を更新しました。依頼の承認状態は承認一覧で確認/);dom.window.close();
});
test('company and financial proposals remain pending and use demo scope',async()=>{
  const calls=[];const {dom,run}=example({proposeCompany:async(...args)=>{calls.push(args);return {status:'pending',actionId:1}},proposeAmount:async(...args)=>{calls.push(args);return {status:'pending',actionId:2}}});await run();const doc=dom.window.document;
  doc.querySelector('#addCompany').click();doc.querySelector('#entry-name').value='Synthetic';doc.querySelector('#submitEntry').click();await tick();assert.equal(calls[0][0],'Synthetic');assert.match(doc.body.textContent,/承認待ち/);
  doc.querySelector('#addAmount').click();for(const [key,value] of Object.entries({companyId:'co1',offer:'demo',amount:'1200',occurredOn:'2026-01-01',periodStart:'2026-01-01',periodEnd:'2026-01-31',sourceUrl:'https://example.com',sourceRef:'sample',recordedOn:'2026-01-01'}))doc.querySelector('#entryForm [name='+key+']').value=value;
  doc.querySelector('#submitEntry').click();await tick();assert.equal(calls[1][0].dataset,'demo');assert.equal(calls[1][0].kind,'revenue');assert.equal(calls[1][0].evidence.confirmation,'unconfirmed');dom.window.close();
});
test('limits, separated trend scales and built-in preview show no import control',async()=>{
 const {dom,run}=example({listLimits:async()=>({items:[{offer:'demo',startDate:'2000-01-01',endDate:'2099-12-31',maxContacts:5,used:2}]}),previewDemoRegistry:async()=>({total:1,rows:[{company:'Synthetic',offer:'demo',motion:'direct',registryId:'D1',registryStatus:'active',conflicts:['duplicate'],companyCandidates:[]}]})});await run();const doc=dom.window.document;
 assert.match(doc.body.textContent,/実績 2 \/ 上限 5 件/);assert.match(doc.body.textContent,/月次の売上・入金/);assert.match(doc.body.textContent,/MRR の推移/);doc.querySelector('#previewDemo').click();await tick();assert.match(doc.querySelector('#detail').textContent,/duplicate/);assert.equal(doc.querySelector('input[type=file]'),null);dom.window.close();
});

test('permission proposal carries evidence and candidate version',async()=>{
 let args;const {dom,run}=example({proposePermission:async(...values)=>{args=values;return {status:'pending',actionId:9}}});await run();const doc=dom.window.document;doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#permission').click();const form=doc.querySelector('#entryForm');for(const [key,value] of Object.entries({allowed:'yes',sourceUrl:'https://example.com',sourceRef:'permission-proof',recordedOn:'2026-01-01'}))form.querySelector('[name='+key+']').value=value;form.querySelector('#submitEntry').click();await tick();assert.equal(args[0],'c1');assert.equal(args[1],'yes');assert.equal(args[2].sourceRef,'permission-proof');assert.equal(args[3],3);assert.match(doc.body.textContent,/承認待ち/);dom.window.close();
});
test('failed actual scope cannot display stale demo data',async()=>{
 const {dom,run}=example({getMetrics:async scope=>{if(scope.dataset==='actual')throw new Error('access denied');return {currency:'JPY',revenue:'918273',payment:null,mrr:null}}});await run();const doc=dom.window.document;assert.match(doc.body.textContent,/918273/);const dataset=doc.querySelector('#dataset');dataset.value='actual';dataset.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.doesNotMatch(doc.body.textContent,/Demo Company|918273/);await tick();await tick();assert.match(doc.body.textContent,/access denied/);assert.match(doc.body.textContent,/実データ/);assert.doesNotMatch(doc.body.textContent,/Demo Company|918273/);dom.window.close();
});
test('late response from earlier scope cannot replace current scope',async()=>{
 let release;const delayed=new Promise(resolve=>{release=resolve});let delayActual=true;
 const {dom,run}=example({getMetrics:async scope=>{if(scope.dataset==='actual'&&delayActual){await delayed;return {revenue:'999999'}}return {revenue:'123456',payment:null,mrr:null}}});await run();const doc=dom.window.document;let select=doc.querySelector('#dataset');select.value='actual';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();select=doc.querySelector('#dataset');select.value='demo';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();await tick();delayActual=false;release();await tick();await tick();assert.match(doc.body.textContent,/デモデータ/);assert.match(doc.body.textContent,/123456/);assert.doesNotMatch(doc.body.textContent,/999999/);dom.window.close();
});

test('next action uses candidate version; explicit alias links selected stable IDs',async()=>{
 const calls=[];const {dom,run}=example({proposeNextAction:async(...args)=>{calls.push(args);return {status:'pending',actionId:10}},proposeLinkAlias:async(...args)=>{calls.push(args);return {status:'pending',actionId:11}}});await run();const doc=dom.window.document;doc.querySelector('[data-candidate]').click();await tick();doc.querySelector('#nextAction').click();doc.querySelector('#nextText').value='Follow up';doc.querySelector('#submitEntry').click();await tick();assert.equal(calls[0][0],'c1');assert.equal(calls[0][3],3);assert.match(doc.body.textContent,/承認待ち/);doc.querySelector('#linkAlias').click();assert.match(doc.querySelector('#detail').textContent,/すべての商品/);assert.match(doc.querySelector('#detail').textContent,/Demo Company \(co1\)/);doc.querySelector('#aliasCompany').value='co2';doc.querySelector('#targetCompany').value='co1';doc.querySelector('#submitEntry').click();await tick();assert.equal(calls[1][0],'co2');assert.equal(calls[1][1],'co1');assert.equal(calls[1][2],2);dom.window.close();
});
test('status list derives available history and supports filtering, sorting and returning',async()=>{
 const items=[{id:'b',companyName:'Beta',offer:'B',motion:'direct',contactAllowed:'unknown',nextAction:'Call',nextActionDate:'2026-11-05',version:1,registryStatus:'hold',companyRefused:true},{id:'a',companyName:'Alpha',offer:'A',motion:'partner',contactAllowed:'yes',nextAction:'Reply',nextActionDate:'2026-10-31',version:1}];
 const {dom,run}=example({listCandidates:async()=>({items}),listEvents:async id=>id==='a'?[{kind:'human_reply',occurredOn:'2026-10-25'}]:[]});await run();const doc=dom.window.document;assert.match(doc.querySelector('#candidateList').textContent,/人間返信/);assert.match(doc.querySelector('#candidateList').textContent,/会社全体の拒否: 記録あり/);assert.match(doc.body.textContent,/全ページ/);const sort=doc.querySelector('#listSort');sort.value='due';sort.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.match(doc.querySelector('[data-candidate]').textContent,/Alpha/);const filter=doc.querySelector('#statusFilter');filter.value='unknown';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-candidate]').length,1);doc.querySelector('[data-candidate]').click();await tick();assert.match(doc.querySelector('#detail').textContent,/Beta/);doc.querySelector('#backToList').click();assert.equal(doc.querySelector('#detail').hidden,true);assert.equal(doc.querySelector('#listPanel').hidden,false);assert.equal(doc.querySelector('#statusFilter').value,'unknown');dom.window.close();
});
test('inaccessible history is unconfirmed rather than inferred',async()=>{
 const {dom,run}=example({listEvents:async()=>{throw new Error('denied')}});await run();const text=dom.window.document.querySelector('#candidateList').textContent;assert.match(text,/履歴上の最終接触: 未確認/);assert.match(text,/返信: 未確認/);dom.window.close();
});
test('list and dashboard tabs, offer, stage, due and contact sorting respect as-of',async()=>{
 const items=[{id:'a',companyName:'Alpha',offer:'A',motion:'direct',contactAllowed:'yes',registryStatus:'hold',nextAction:'Follow up',nextActionDate:'2026-01-04'}, {id:'b',companyName:'Beta',offer:'B',motion:'partner',contactAllowed:'unknown',registryStatus:'active',nextAction:'Contact',nextActionDate:'2026-01-15'}];
 const {dom,run}=example({listCandidates:async()=>({items}),listEvents:async id=>id==='a'?[{kind:'sent',occurredOn:'2026-01-02'},{kind:'human_reply',occurredOn:'2026-02-01'}]:[{kind:'sent',occurredOn:'2026-01-03'}]});await run();const doc=dom.window.document;assert.equal(doc.querySelector('#dashboardPanel').hidden,true);doc.querySelector('#tabDashboard').click();assert.equal(doc.querySelector('#dashboardPanel').hidden,false);const date=doc.querySelector('#asOf');date.value='2026-01-10';date.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();await tick();doc.querySelector('#tabList').click();assert.equal(doc.querySelector('#dashboardPanel').hidden,true);assert.doesNotMatch(doc.querySelector('#candidateList').textContent,/人間返信/);let sort=doc.querySelector('#listSort');sort.value='contact';sort.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.match(doc.querySelector('[data-candidate]').textContent,/Beta/);let filter=doc.querySelector('#dueFilter');filter.value='due';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-candidate]').length,1);assert.match(doc.querySelector('[data-candidate]').textContent,/Alpha/);filter=doc.querySelector('#registryFilter');filter.value='active';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-candidate]').length,0);filter=doc.querySelector('#registryFilter');filter.value='hold';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));filter=doc.querySelector('#listOffer');filter.value='A';filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-candidate]').length,1);dom.window.close();
});
test('different event types on the same day do not imply a sequence',async()=>{
 const {dom,run}=example({listEvents:async()=>[{kind:'sent',occurredOn:'2026-01-01'},{kind:'human_reply',occurredOn:'2026-01-01'}]});await run();const list=dom.window.document.querySelector('#candidateList').textContent;assert.match(list,/履歴上の段階: 同日複数記録・順序未確認/);assert.match(list,/返信: 人間返信/);assert.doesNotMatch(list,/履歴上の段階: 送信済み/);dom.window.close();
});
test('permission and contact holds are distinct and overdue requires action plus past due date',async()=>{
 const items=[{id:'u',companyName:'Unknown',offer:'A',motion:'direct',contactAllowed:'yes',nextAction:'Review',nextActionDate:'2025-01-01'},{id:'s',companyName:'Skipped',offer:'A',motion:'direct',contactAllowed:'yes',nextAction:'Review',nextActionDate:null},{id:'r',companyName:'Refused',offer:'A',motion:'direct',contactAllowed:'yes',companyRefused:true},{id:'x',companyName:'Inaccessible',offer:'A',motion:'direct',contactAllowed:'yes'}];
 const {dom,run}=example({listCandidates:async()=>({items}),listEvents:async id=>{if(id==='x')throw new Error('denied');return id==='u'?[{kind:'unknown',occurredOn:'2025-01-01'}]:id==='s'?[{kind:'skipped',occurredOn:'2025-01-01'}]:[]}});await run();const doc=dom.window.document;const text=id=>doc.querySelector(`[data-candidate="${id}"]`).textContent;assert.match(text('u'),/連絡許可: 可/);assert.match(text('u'),/受付不明・再接触停止/);assert.match(text('u'),/期限超過/);assert.match(text('s'),/今回スキップ・再接触停止/);assert.doesNotMatch(text('s'),/期限超過/);assert.match(text('r'),/会社全体の拒否/);assert.match(text('x'),/停止可否 未確認/);dom.window.close();
});
test('multiple pages cover 101 candidates and histories and fail closed on interrupted pages',async()=>{
 const candidates=Array.from({length:101},(_,i)=>({id:`c${i}`,companyName:`Company ${String(i).padStart(3,'0')}`,offer:'demo',motion:'direct',contactAllowed:'yes',registryStatus:'active'}));
 const history=Array.from({length:101},(_,i)=>({kind:i===100?'human_reply':'sent',occurredOn:i===100?'2026-01-02':'2025-01-01'}));
 const {dom,run}=example({listCandidates:async cursor=>cursor?{items:candidates.slice(100),nextCursor:null}:{items:candidates.slice(0,100),nextCursor:'next'},listEvents:async(id,cursor)=>cursor?{items:history.slice(100),nextCursor:null}:{items:history.slice(0,100),nextCursor:'next'}});await run();const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('[data-candidate]').length,101);assert.match(doc.querySelector('[data-candidate]').textContent,/返信: 人間返信/);const q=doc.querySelector('#search');q.value='Company 100';q.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(doc.querySelectorAll('[data-candidate]').length,1);dom.window.close();
 const failure=example({listCandidates:async cursor=>{if(cursor)throw Error('page failed');return {items:candidates.slice(0,100),nextCursor:'next'}}});await failure.run();assert.match(failure.dom.window.document.body.textContent,/page failed/);assert.equal(failure.dom.window.document.querySelectorAll('[data-candidate]').length,0);failure.dom.window.close();
 const partial=example({listEvents:async(id,cursor)=>{if(cursor)throw Error('page failed');return {items:history.slice(0,100),nextCursor:'next'}}});await partial.run();assert.match(partial.dom.window.document.querySelector('#candidateList').textContent,/全履歴未確認/);assert.doesNotMatch(partial.dom.window.document.querySelector('#candidateList').textContent,/返信: 人間返信/);partial.dom.window.close();
});
test('company overview is a semantic comparison table with accessible details',async()=>{
 const {dom,run}=example({listEvents:async()=>[{kind:'unknown',occurredOn:'2026-01-01'}]});await run();const doc=dom.window.document;const table=doc.querySelector('table.salesTable');assert.ok(table);assert.deepEqual(Array.from(table.querySelectorAll('thead th'),e=>e.textContent),['企業名','商材','営業状況・停止','返信','最終接触日','次の対応','期限']);const row=table.querySelector('tbody tr');assert.equal(row.querySelectorAll('td').length,7);assert.match(row.textContent,/受付不明・再接触停止/);row.querySelector('button').click();await tick();assert.match(doc.querySelector('#detail').textContent,/Demo Company/);doc.querySelector('#backToList').click();assert.equal(doc.querySelector('#detail').hidden,true);assert.equal(doc.querySelector('#listPanel').hidden,false);dom.window.close();
});
test('list occupies its own screen and returning from detail preserves controls',async()=>{
 const items=[{id:'a',companyName:'Alpha',offer:'A',motion:'direct',contactAllowed:'yes',registryStatus:'active'},{id:'b',companyName:'Beta',offer:'B',motion:'direct',contactAllowed:'no',registryStatus:'hold'}];const {dom,run}=example({listCandidates:async()=>({items})});await run();const doc=dom.window.document;
 assert.equal(doc.querySelector('#listPanel').hidden,false);assert.equal(doc.querySelector('#detail').closest('section').hidden,true);
 const search=doc.querySelector('#search');search.value='Alpha';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));const offer=doc.querySelector('#listOffer');offer.value='A';offer.dispatchEvent(new dom.window.Event('change',{bubbles:true}));const sort=doc.querySelector('#listSort');sort.value='contact';sort.dispatchEvent(new dom.window.Event('change',{bubbles:true}));doc.querySelector('.companyButton').click();await tick();assert.equal(doc.querySelector('#listPanel').hidden,true);assert.equal(doc.querySelector('#detail').hidden,false);assert.equal(doc.querySelector('#detail').closest('section').hidden,false);doc.querySelector('#backToList').click();assert.equal(doc.querySelector('#listPanel').hidden,false);assert.equal(doc.querySelector('#detail').closest('section').hidden,true);assert.equal(doc.querySelector('#search').value,'Alpha');assert.equal(doc.querySelector('#listOffer').value,'A');assert.equal(doc.querySelector('#listSort').value,'contact');assert.equal(doc.querySelectorAll('[data-candidate]').length,1);dom.window.close();
});
