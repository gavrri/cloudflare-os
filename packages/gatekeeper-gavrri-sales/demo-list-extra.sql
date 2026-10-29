-- Optional local-only fabricated records. Run after 0001, 0002 and local-owner.sql.
-- IDs are deliberately reserved for this fixture; rerunning does not alter existing rows.
INSERT INTO companies(id,name) SELECT 'sample-list-a','架空：青空制作' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-a');
INSERT INTO companies(id,name) SELECT 'sample-list-b','架空：星空企画' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-b');
INSERT INTO companies(id,name) SELECT 'sample-list-c','架空：虹色商会' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-c');
INSERT INTO companies(id,name) SELECT 'sample-list-d','架空：月光研究室' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-d');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed,next_action,next_date)
 SELECT 'sample-list-a1','sample-list-a','架空Offer A','partner','active','yes','架空の返信を確認','2026-10-29' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-a1');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-a2','sample-list-a','架空Offer B','partner','active','unknown' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-a2');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-b1','sample-list-b','架空Offer A','partner','hold','unknown' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-b1');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-c1','sample-list-c','架空Offer B','direct','future','unknown' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-c1');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-d1','sample-list-d','架空Offer A','direct','excluded','no' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-d1');
INSERT INTO limits(id,offer,start_date,end_date,max_contacts)
 SELECT 'sample-list-limit','架空Offer A','2026-10-29','2026-11-04',5 WHERE NOT EXISTS(SELECT 1 FROM limits WHERE id='sample-list-limit');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e1','sample-list-a1','sent','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-sent","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空の送信記録','sample-list-e1' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e1');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e2','sample-list-a1','human_reply','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-reply","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空の人による返信','sample-list-e2' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e2');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e3','sample-list-d1','refused','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-refused","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空の会社全体の拒否','sample-list-e3' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e3');
INSERT INTO companies(id,name) SELECT 'sample-list-e','架空：風見工房' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-e');
INSERT INTO companies(id,name) SELECT 'sample-list-f','架空：水玉デザイン' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-f');
INSERT INTO companies(id,name) SELECT 'sample-list-g','架空：森の企画室' WHERE NOT EXISTS(SELECT 1 FROM companies WHERE id='sample-list-g');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-e1c','sample-list-e','架空Offer A','direct','active','yes' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-e1c');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-f1c','sample-list-f','架空Offer A','direct','active','yes' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-f1c');
INSERT INTO candidates(id,company_id,offer,motion,registry_status,contact_allowed)
 SELECT 'sample-list-g1c','sample-list-g','架空Offer A','direct','active','unknown' WHERE NOT EXISTS(SELECT 1 FROM candidates WHERE id='sample-list-g1c');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e4','sample-list-e1c','form_accepted','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-form","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空のフォーム受付','sample-list-e4' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e4');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e5','sample-list-f1c','unknown','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-unknown","recordedOn":"2026-10-29","confirmation":"unconfirmed"}','架空の受付不明','sample-list-e5' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e5');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e6','sample-list-g1c','skipped','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-skipped","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空の今回スキップ','sample-list-e6' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e6');
INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id)
 SELECT 'sample-list-e7','sample-list-e1c','automatic_reply','2026-10-29','{"sourceUrl":"https://example.com/","sourceRef":"sample-auto-reply","recordedOn":"2026-10-29","confirmation":"confirmed"}','架空の自動返信','sample-list-e7' WHERE NOT EXISTS(SELECT 1 FROM events WHERE id='sample-list-e7');
