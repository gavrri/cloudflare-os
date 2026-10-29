import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from '../../gatekeeper-scheduler/node_modules/miniflare/dist/src/index.js';
import { createPendingStore } from '../src/pending.mjs';
import { previewRegistry } from '../src/preview.mjs';
import { recordEvent, setNextAction, linkCompany } from '../src/core.mjs';

test('local D1 persists and rejects duplicate, refusal, unknown and stale writes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'gavrri-d1-'));
  const make=()=>new Miniflare({modules:true, script:'export default { fetch(){return new Response("local test only")} }', compatibilityDate:'2026-08-08',d1Databases:{SALES_DB:'local-sales-test'},resourcePersistencePath:dir});
  let mf;
  try {
    mf=make();let db=await mf.getD1Database('SALES_DB');
    const source=await readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8');
    const statements=source.match(/(?:PRAGMA|CREATE TABLE|CREATE TRIGGER)[\s\S]*?;(?=\s*(?:CREATE|PRAGMA|$))/g);
    assert.ok(statements);await db.batch(statements.map(s=>db.prepare(s)));
    const migration=await readFile(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8');
    const additions=migration.match(/(?:ALTER TABLE|CREATE TRIGGER)[\s\S]*?;(?=\s*(?:ALTER|CREATE|$))/g);
    assert.ok(additions);await db.batch(additions.map(s=>db.prepare(s)));
    await db.batch([db.prepare("INSERT INTO companies(id,name) VALUES('co','Demo')"),db.prepare("INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed) VALUES('c','co','a','direct','active','yes'),('b','co','b','direct','active','yes')"),db.prepare("INSERT INTO limits(id,offer,start_date,end_date,max_contacts) VALUES('l','a','2026-10-29','2026-11-04',5),('m','b','2026-10-29','2026-11-04',5)")]);
    const before=await db.prepare('SELECT COUNT(*) AS n FROM candidates').first();
    const preview=await previewRegistry(db,'registry_id,company,offer,motion,registry_status\nDEMO-01,Demo,a,direct,active\n');
    assert.ok(preview.rows[0].conflicts.includes('company_offer_motion_exists'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM candidates').first()).n,before.n);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,0);
    const e={kind:'unknown',occurredOn:'2026-10-29',note:'',evidence:{sourceUrl:'https://example.com/',sourceRef:'demo',recordedOn:'2026-10-29',confirmation:'confirmed'}};
    const [a,b]=await Promise.all([recordEvent(db,'c',e,'request-1'),recordEvent(db,'c',e,'request-1')]);assert.equal(a.id,b.id);
    await assert.rejects(recordEvent(db,'c',{...e,kind:'sent'},'request-2'));
    await recordEvent(db,'c',{...e,kind:'refused'},'request-3');await assert.rejects(recordEvent(db,'b',{...e,kind:'sent'},'request-4'));
    await setNextAction(db,'b','review',null,1,'change-1');await assert.rejects(setNextAction(db,'b','other',null,1,'change-2'));
    const pending=createPendingStore(db);const id=await pending.put('demo',{kind:'example'});assert.equal(await pending.get('other',id),null);await mf.dispose();mf=make();db=await mf.getD1Database('SALES_DB');assert.equal((await createPendingStore(db).get('demo',id)).kind,'example');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,2);
    assert.equal((await db.prepare("SELECT version FROM candidates WHERE id='b'").first()).version,2);
  } finally {if(mf)await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

test('old local D1 migrates without rewriting legacy history and serializes new links',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gavrri-migration-'));
 const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("local test only")} }',compatibilityDate:'2026-08-08',d1Databases:{SALES_DB:'local-migration-test'},resourcePersistencePath:dir});
 try{
  const db=await mf.getD1Database('SALES_DB');
  const source=await readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8');
  const statements=source.match(/(?:PRAGMA|CREATE TABLE|CREATE TRIGGER)[\s\S]*?;(?=\s*(?:CREATE|PRAGMA|$))/g);assert.ok(statements);await db.batch(statements.map(s=>db.prepare(s)));
  await db.batch([db.prepare("INSERT INTO companies(id,name) VALUES('root','Demo'),('old','Alias'),('next','Next'),('third','Third')"),db.prepare("INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed) VALUES('c','root','a','direct','active','yes')"),db.prepare("INSERT INTO company_aliases(id,company_id,name,request_id) VALUES('old','root','Alias','old-link')"),db.prepare("INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id) VALUES('e','c','refused','2026-10-29','{}','legacy','old-event')")]);
  const prior=await db.prepare('SELECT id,candidate_id,kind,occurred_on,evidence,note,request_id FROM events').all();
  const migration=await readFile(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8');const additions=migration.match(/(?:ALTER TABLE|CREATE TRIGGER)[\s\S]*?;(?=\s*(?:ALTER|CREATE|$))/g);assert.ok(additions);await db.batch(additions.map(s=>db.prepare(s)));
  assert.deepEqual((await db.prepare('SELECT id,candidate_id,kind,occurred_on,evidence,note,request_id FROM events').all()).results,prior.results);
  assert.equal((await db.prepare("SELECT expected_version FROM company_aliases WHERE id='old'").first()).expected_version,null);
  assert.equal((await db.prepare("SELECT version FROM companies WHERE id='root'").first()).version,1);
  const results=await Promise.allSettled([linkCompany(db,'next','root',1,'link-a'),linkCompany(db,'third','root',1,'link-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await db.prepare("SELECT version FROM companies WHERE id='root'").first()).version,2);
  assert.deepEqual((await db.prepare('SELECT id,candidate_id,kind,occurred_on,evidence,note,request_id FROM events').all()).results,prior.results);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true})}
});
