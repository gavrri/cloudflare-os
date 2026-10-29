import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {linkCompany} from '../src/core.mjs';

function existingDatabase(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 sql.exec(`INSERT INTO companies(id,name) VALUES('root','Demo Root'),('old','Demo Alias'),('next','Another Alias'),('third','Third Alias');
 INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed) VALUES('c','root','offer-a','direct','active','yes');
 INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id) VALUES('event','c','refused','2026-10-29','{}','legacy','event-request');
 INSERT INTO company_aliases(id,company_id,name,request_id) VALUES('old','root','Demo Alias','legacy-link');`);
 const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)??null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}}}}}};
 return {sql,db};
}
test('0002 preserves prior alias, company, and contact history without backfill',async()=>{
 const {sql,db}=existingDatabase();const before={company:sql.prepare('SELECT * FROM companies ORDER BY id').all(),alias:sql.prepare('SELECT id,company_id,name,request_id FROM company_aliases').all(),events:sql.prepare('SELECT * FROM events').all()};
 sql.exec(readFileSync(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8'));
 assert.deepEqual(sql.prepare('SELECT * FROM companies ORDER BY id').all(),before.company);assert.deepEqual(sql.prepare('SELECT id,company_id,name,request_id FROM company_aliases').all(),before.alias);assert.deepEqual(sql.prepare('SELECT * FROM events').all(),before.events);assert.equal(sql.prepare("SELECT expected_version FROM company_aliases WHERE id='old'").get().expected_version,null);
 const linked=await linkCompany(db,'next','root',1,'new-link');assert.equal(linked.expected_version,1);assert.equal(sql.prepare("SELECT version FROM companies WHERE id='root'").get().version,2);
 assert.deepEqual(await linkCompany(db,'next','root',1,'new-link'),linked);await assert.rejects(linkCompany(db,'third','root',1,'another'),/stale/);await assert.rejects(linkCompany(db,'third','root',2,'new-link'),/reused/);
 assert.throws(()=>sql.exec('DELETE FROM company_aliases'),/append only/);assert.deepEqual(sql.prepare('SELECT * FROM events').all(),before.events);
});
test('racing links to the same company require a current version',async()=>{
 const {sql,db}=existingDatabase();sql.exec(readFileSync(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8'));
 const result=await Promise.allSettled([linkCompany(db,'next','root',1,'one'),linkCompany(db,'third','root',1,'two')]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);assert.equal(sql.prepare("SELECT version FROM companies WHERE id='root'").get().version,2);
});
