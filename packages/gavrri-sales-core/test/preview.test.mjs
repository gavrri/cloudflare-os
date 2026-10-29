import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {previewRegistry} from '../src/preview.mjs';

function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_company_alias_version.sql',import.meta.url),'utf8'));
 sql.exec("INSERT INTO companies(id,name) VALUES('co','架空会社'),('co2','別名社'),('other','架空会社別法人'); INSERT INTO company_aliases(id,company_id,name,request_id,expected_version) VALUES('co2','co','別名社','link',1); INSERT INTO candidates(id,company_id,registry_id,offer,motion,registry_status,contact_allowed) VALUES('c','co','WEIBEO-WB001','weibeo-partner','reseller','active','unknown')");
 const db={prepare(query){return {bind(){return {async all(){return {results:sql.prepare(query).all()}}}}}}};return {sql,db};
}
const header='registry_id,company,offer,motion,registry_status,execution_id,company_id\n';
const snapshot=sql=>JSON.stringify(['companies','company_aliases','candidates','events','contracts','amounts','action_changes','permission_changes'].map(table=>sql.prepare(`SELECT * FROM ${table}`).all()));
test('registry conflicts, cross-offer and explicit stable company IDs are distinct',async()=>{
 const {db,sql}=setup();const before=snapshot(sql);const csv=header+[
  'WEIBEO-WB001,架空会社,weibeo-partner,reseller,active,,',
  'DEMO-02,架空会社,other,direct,active,,',
  'DEMO-03,別名社,weibeo-partner,reseller,hold,,co2',
  'DEMO-04,架空会社,new,direct,future,,invalid',
  'DEMO-02,架空会社,other,direct,excluded,,',
  'DEMO-05,別名社,other,reseller,active,,co2',
 ].join('\n');
 const result=await previewRegistry(db,csv);assert.equal(result.total,6);
 assert.ok(result.rows[0].conflicts.includes('registry_id_exists'));assert.ok(result.rows[0].conflicts.includes('company_offer_motion_exists'));assert.equal(result.rows[0].companyId,null);assert.ok(result.rows[0].notes.includes('company_identity_requires_review'));
 assert.deepEqual(result.rows[1].conflicts,[]);assert.ok(result.rows[2].conflicts.includes('company_offer_motion_exists'));assert.equal(result.rows[2].companyId,'co');
 assert.ok(result.rows[3].conflicts.includes('company_id_unknown'));assert.ok(result.rows[4].conflicts.includes('registry_id_repeated'));assert.ok(result.rows[4].conflicts.includes('company_offer_motion_repeated'));assert.deepEqual(result.rows[5].conflicts,[]);
 assert.equal(snapshot(sql),before);assert.deepEqual(await previewRegistry(db,csv),result);assert.equal(snapshot(sql),before);
});
test('unlinked equal names are review candidates; names or domains never auto-link',async()=>{
 const {db,sql}=setup();sql.exec("INSERT INTO companies(id,name) VALUES('co3','架空会社')");const before=snapshot(sql);
 const {rows}=await previewRegistry(db,header+'DEMO-06,架空会社,different,direct,active,,');assert.equal(rows[0].companyId,null);assert.ok(rows[0].notes.includes('ambiguous_company_identity'));assert.equal(new Set(rows[0].companyCandidates.map(x=>x.canonical_id)).size,3);assert.equal(snapshot(sql),before);
});
test('quoted values, absent execution ID and status never imply contact',async()=>{
 const {db}=setup();const {rows}=await previewRegistry(db,header+'DEMO-07,"架空,会社",weibeo-partner,reseller,active,,');assert.equal(rows[0].company,'架空,会社');assert.equal(rows[0].registryStatus,'active');assert.equal(rows[0].executionId,'');assert.equal(rows[0].companyId,null);
});
test('malformed CSV and unknown headers fail without writing',async()=>{
 const {db,sql}=setup(), before=snapshot(sql);for(const csv of ['', 'company,status\na,b','registry_id,company,offer,motion,registry_status\na,"unfinished'])await assert.rejects(previewRegistry(db,csv));assert.equal(snapshot(sql),before);
});
test('explicitly distinct company IDs allow the same name and offer without auto-merging',async()=>{
 const {db,sql}=setup();sql.exec("INSERT INTO companies(id,name) VALUES('co3','架空会社')");
 const {rows}=await previewRegistry(db,header+'DEMO-08,架空会社,weibeo-partner,reseller,active,,co3');
 assert.equal(rows[0].companyId,'co3');assert.ok(!rows[0].conflicts.includes('company_offer_motion_exists'));
});
