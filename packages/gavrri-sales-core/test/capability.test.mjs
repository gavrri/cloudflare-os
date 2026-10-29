import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createLocalCapability } from '../src/capability.mjs';
function setup(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8'));sql.exec("INSERT INTO portfolio_scope(id,value) VALUES('scope','demo'); INSERT INTO companies(id,name) VALUES('co','Demo'); INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed) VALUES('c','co','a','direct','active','yes'); INSERT INTO limits(id,offer,start_date,end_date,max_contacts) VALUES('l','a','2026-10-29','2026-11-04',5)");
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null; },
    async run() { const r=sql.prepare(query).run(...args); return {meta:{changes:Number(r.changes)}}; },
  }; } }; } };
  let seq=0;const items=new Map(), observations=[],actions=[];
  const pending={async put(scope,a){const id=++seq;items.set(id,{scope,a});return id},async get(scope,id){const x=items.get(id);return x?.scope===scope?x.a:null},async remove(scope,id){if(items.get(id)?.scope===scope)items.delete(id)}};
  const queue={async authorizeObservation(x){observations.push(x)},async submitAction(id,x){actions.push({id,x})}};
  const access={async canAccess(scope,mode){return scope==='demo'&&['read','write'].includes(mode)}};
  return {sql,db,items,observations,actions,access,queue,pending};
}
const event={kind:'sent',occurredOn:'2026-10-29',note:'',evidence:{sourceUrl:'https://example.com/',sourceRef:'demo',recordedOn:'2026-10-29',confirmation:'confirmed'}};
test('reads require scoped access and observation authorization',async()=>{const x=setup();let a=createLocalCapability({...x,scope:'demo'});assert.equal((await a.session.getCandidate('c')).id,'c');assert.equal(x.observations.length,1);let b=createLocalCapability({...x,scope:'other'});await assert.rejects(b.session.getCandidate('c'),/access denied/);await assert.rejects(b.session.recordEvent('c',event,'r'),/access denied/)});
test('observer denied without same-scope permission',async()=>{const x=setup(), a=createLocalCapability({...x,scope:'demo'});await a.host.addObserver({canAccess:async(s,m)=>s==='demo'&&m==='read'});await assert.rejects(a.host.addObserver({canAccess:async()=>false}),/observer denied/)});
test('writes stay pending until host applies and reject removes them',async()=>{const x=setup(), a=createLocalCapability({...x,scope:'demo'});const id=await a.session.recordEvent('c',event,'r');assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);assert.equal(x.actions[0].x.awaitDecision,true);await a.host.applyAction(id);assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,1);const next=await a.session.setNextAction('c','hello',null,1,'next');await a.host.rejectAction(next);await assert.rejects(a.host.applyAction(next),/unknown action/)});

test('a granted but differently bound database is rejected',async()=>{const x=setup();const a=createLocalCapability({...x,scope:'other',access:{canAccess:async()=>true}});await assert.rejects(a.session.getCandidate('c'),/scope mismatch/);await assert.rejects(a.host.addObserver({canAccess:async()=>true}),/scope mismatch/)});
test('revoked access blocks applying a previously proposed write',async()=>{const x=setup();let allowed=true;const access={canAccess:async(scope)=>allowed&&scope==='demo'};const a=createLocalCapability({...x,scope:'demo',access});const id=await a.session.recordEvent('c',event,'r');allowed=false;await assert.rejects(a.host.applyAction(id),/access denied/);assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0)});
test('queue failure cannot leave a pending action',async()=>{const x=setup();const queue={...x.queue,submitAction:async()=>{throw new Error('queue unavailable')}};const a=createLocalCapability({...x,scope:'demo',queue});await assert.rejects(a.session.recordEvent('c',event,'r'),/queue unavailable/);assert.equal(x.items.size,0);assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0)});
