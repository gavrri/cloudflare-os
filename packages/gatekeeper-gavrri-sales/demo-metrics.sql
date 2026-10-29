-- Synthetic data for local verification only. No actual sales, contracts, or personal details.
INSERT INTO contracts(id,company_id,offer,dataset,currency,amount_minor,cadence,paid_from,source_ref,source_url,recorded_on,confirmation,request_id)
VALUES('demo-contract','demo-company','weibeo-partner','demo','JPY',1200000,'annual','2026-10-01','demo-contract','https://example.com/evidence','2026-10-29','confirmed','demo-contract');
INSERT INTO amounts(id,company_id,offer,dataset,currency,kind,amount_minor,occurred_on,period_start,period_end,source_ref,source_url,recorded_on,confirmation,request_id)
VALUES('demo-revenue','demo-company','weibeo-partner','demo','JPY','revenue',1500000,'2026-10-20','2026-10-01','2026-10-31','demo-revenue','https://example.com/evidence','2026-10-29','confirmed','demo-revenue'),
('demo-payment','demo-company','weibeo-partner','demo','JPY','payment',1200000,'2026-10-21','2026-10-01','2026-10-31','demo-payment','https://example.com/evidence','2026-10-29','confirmed','demo-payment');
