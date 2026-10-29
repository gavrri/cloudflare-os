import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,existsSync } from 'node:fs';
const root=new URL('../',import.meta.url);
function db(){const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../gavrri-sales-core/migrations/0001.sql',root),'utf8'));d.exec(readFileSync(new URL('local-owner.sql',root),'utf8'));return d}
test('local demo config is not auto-discovered as deployable',()=>{assert.equal(existsSync(new URL('wrangler.jsonc',root)),false);const c=JSON.parse(readFileSync(new URL('wrangler.local.jsonc',root),'utf8'));assert.equal(c.vars.LOCAL_SALES_DEMO,'true');assert.equal(c.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000000')});
test('owner is claimed only once and is immutable',()=>{const d=db();d.prepare("INSERT OR IGNORE INTO sales_local_owner(id,account_id) VALUES('owner',?)").run('alice');d.prepare("INSERT OR IGNORE INTO sales_local_owner(id,account_id) VALUES('owner',?)").run('bob');assert.equal(d.prepare('SELECT account_id FROM sales_local_owner').get().account_id,'alice');assert.throws(()=>d.exec("UPDATE sales_local_owner SET account_id='bob'"),/immutable/)});
test('pending request IDs are unique per scope and retain final state',()=>{const d=db();const q=d.prepare("INSERT OR IGNORE INTO sales_submissions(scope,request_id,payload,state) VALUES('demo',?,?,'pending')");assert.equal(q.run('r','{}').changes,1);assert.equal(q.run('r','{}').changes,0);d.exec("UPDATE sales_submissions SET state='applied' WHERE request_id='r'");assert.equal(d.prepare("SELECT state FROM sales_submissions WHERE request_id='r'").get().state,'applied')});
