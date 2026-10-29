CREATE TABLE sales_local_owner(id TEXT PRIMARY KEY CHECK(id='owner'), account_id TEXT NOT NULL);
CREATE TRIGGER local_owner_no_update BEFORE UPDATE ON sales_local_owner BEGIN SELECT RAISE(ABORT,'owner immutable'); END;
CREATE TRIGGER local_owner_no_delete BEFORE DELETE ON sales_local_owner BEGIN SELECT RAISE(ABORT,'owner immutable'); END;
INSERT INTO portfolio_scope(id,value) VALUES('scope','demo');
INSERT INTO companies(id,name) VALUES('demo-company','サンプル制作会社');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed) VALUES('demo-candidate','demo-company','weibeo-partner','reseller','active','yes');
INSERT INTO limits(id,offer,start_date,end_date,max_contacts) VALUES('demo-limit','weibeo-partner','2026-10-29','2026-11-04',5);
CREATE TABLE sales_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','applied','rejected')), UNIQUE(scope,request_id));
