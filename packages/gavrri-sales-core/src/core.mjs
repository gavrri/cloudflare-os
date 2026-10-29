/** @typedef {{sourceUrl:string, sourceRef:string, recordedOn:string, confirmation:'confirmed'|'unconfirmed'}} Evidence */
/** @typedef {{kind:string, occurredOn:string, note:string, evidence:Evidence}} EventInput */
/** @typedef {{companyId:string, offer:string, dataset:'actual'|'demo', currency:string, amount:string, evidence:Evidence}} FinancialInput */
/** @typedef {FinancialInput & {kind:string, occurredOn:string, periodStart:string, periodEnd:string}} AmountInput */
/** @typedef {FinancialInput & {cadence:'monthly'|'annual', paidFrom:string, paidUntil?:string|null, pauseFrom?:string|null, pauseUntil?:string|null, supersedes?:string|null}} ContractInput */
/** @typedef {Record<string, string | number | null>} Row */
// Core functions operate on an explicitly supplied D1 binding. They expose no public HTTP route.
const CONTACTS = new Set(['sent', 'form_accepted', 'unknown']);
const KINDS = new Set([...CONTACTS, 'automatic_reply', 'human_reply', 'refused', 'skipped', 'meeting', 'introduced', 'note']);
/** @param {string} value */
function requireDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('invalid date');
  return value;
}
/** @param {string} value @param {string} name */
function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`invalid ${name}`);
  return value.trim();
}
/** @param {Evidence} evidence */
function evidenceString(evidence) {
  if (!evidence || !['confirmed', 'unconfirmed'].includes(evidence.confirmation)) throw new Error('invalid confirmation');
  const url = new URL(required(evidence.sourceUrl, 'evidence URL'));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid evidence URL');
  return JSON.stringify({ sourceUrl: url.href, sourceRef: required(evidence.sourceRef, 'source ref'), recordedOn: requireDate(evidence.recordedOn), confirmation: evidence.confirmation });
}
/** @param {Row} old @param {string} candidateId @param {EventInput} input @param {string} evidence */
function sameEvent(old, candidateId, input, evidence) {
  return old.candidate_id === candidateId && old.kind === input.kind && old.occurred_on === input.occurredOn && old.evidence === evidence && old.note === input.note;
}
/** @param {D1Database} db @param {string} candidateId @param {EventInput} input @param {string} requestId */
export async function recordEvent(db, candidateId, input, requestId) {
  required(candidateId, 'candidate'); required(requestId, 'request ID');
  if (!input || !KINDS.has(input.kind) || typeof input.note !== 'string' || input.note.length > 2000) throw new Error('invalid event');
  requireDate(input.occurredOn); const evidence = evidenceString(input.evidence);
  const find = () => /** @type {Promise<Row | null>} */ (db.prepare('SELECT * FROM events WHERE request_id = ?').bind(requestId).first());
  let old = await find();
  if (old) { if (!sameEvent(old, candidateId, input, evidence)) throw new Error('request ID reused'); return old; }
  try {
    await db.prepare('INSERT INTO events(id,candidate_id,kind,occurred_on,evidence,note,request_id) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),candidateId,input.kind,input.occurredOn,evidence,input.note,requestId).run();
  } catch (error) {
    old = await find();
    if (old && sameEvent(old,candidateId,input,evidence)) return old;
    if (old) throw new Error('request ID reused', { cause: error });
    throw error;
  }
  return find();
}
/** @param {D1Database} db @param {string} id */
export async function getCandidate(db, id) {
  return db.prepare('SELECT * FROM candidates WHERE id=?').bind(required(id,'candidate')).first();
}
/** @param {D1Database} db @param {string} id @param {string|null} action @param {string|null} dueOn @param {number} version @param {string} requestId */
export async function setNextAction(db, id, action, dueOn, version, requestId) {
  required(id,'candidate'); required(requestId,'request ID');
  if (action !== null && (typeof action !== 'string' || action.length > 2000)) throw new Error('invalid action');
  if (dueOn !== null) requireDate(dueOn);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid version');
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare('SELECT a.*,r.candidate_json FROM action_changes a JOIN action_results r ON r.request_id=a.request_id WHERE a.request_id=?').bind(requestId).first());
  /** @param {Row} row */
  const same=row=>row.candidate_id===id && row.action===action && row.due_on===dueOn && row.expected_version===version;
  let old=await find();
  if (old) {if (!same(old)) throw new Error('request ID reused');return JSON.parse(/** @type {string} */ (old.candidate_json))}
  try {
    await db.prepare('INSERT INTO action_changes(request_id,candidate_id,action,due_on,expected_version,created_at) VALUES(?,?,?,?,?,?)').bind(requestId,id,action,dueOn,version,new Date().toISOString()).run();
  } catch (error) {
    old=await find();
    if (old && same(old)) return JSON.parse(/** @type {string} */ (old.candidate_json));
    if (old) throw new Error('request ID reused', { cause: error });
    throw error;
  }
  old=await find();
  if (!old) throw new Error('action result missing');
  return JSON.parse(/** @type {string} */ (old.candidate_json));
}
export { requireDate, evidenceString };

/** Explicitly links an existing company ID as an alias of another root; no fuzzy match. */
/** @param {D1Database} db @param {string} sourceId @param {string} targetId @param {number} expectedVersion @param {string} requestId */
export async function linkCompany(db, sourceId, targetId, expectedVersion, requestId) {
  required(sourceId,'source company'); required(targetId,'target company'); required(requestId,'request ID');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('invalid version');
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare('SELECT * FROM company_aliases WHERE request_id=?').bind(requestId).first());
  /** @param {Row} r */
  const same=r=>r.id===sourceId && r.company_id===targetId && r.expected_version===expectedVersion;
  let old=await find();if(old){if(!same(old))throw new Error('request ID reused');return old}
  try {
    const result=await db.prepare('INSERT INTO company_aliases(id,company_id,name,request_id,expected_version) SELECT id,?,name,?,? FROM companies WHERE id=?').bind(targetId,requestId,expectedVersion,sourceId).run();
    if(result.meta.changes!==1) throw new Error('source company missing');
  } catch(error) {
    old=await find();if(old&&same(old))return old;
    if(old)throw new Error('request ID reused',{cause:error});throw error;
  }
  return find();
}

/** Create a company after the caller is authorized by the Gatekeeper. */
/** @param {D1Database} db @param {string} name @param {string} requestId */
export async function createCompany(db, name, requestId) {
  name=required(name,'company');requestId=required(requestId,'request ID');
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare('SELECT * FROM companies WHERE request_id=?').bind(requestId).first());
  let old=await find();if(old){if(old.name!==name)throw new Error('request ID reused');return old}
  try{await db.prepare('INSERT INTO companies(id,name,request_id) VALUES(?,?,?)').bind(crypto.randomUUID(),name,requestId).run()}
  catch(error){old=await find();if(old&&old.name===name)return old;if(old)throw new Error('request ID reused',{cause:error});throw error}
  return find();
}
/** Create an offer-and-motion candidate after authorization. */
/** @param {D1Database} db @param {string} companyId @param {string} offer @param {string} motion @param {string|null} registryId @param {string} requestId */
export async function createCandidate(db, companyId, offer, motion, registryId, requestId) {
  required(companyId,'company');offer=required(offer,'offer');motion=required(motion,'motion');requestId=required(requestId,'request ID');
  if (registryId!==null) registryId=required(registryId,'registry ID');
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare('SELECT * FROM candidates WHERE request_id=?').bind(requestId).first());
  /** @param {Row} r */
  const same=r=>r.company_id===companyId&&r.offer===offer&&r.motion===motion&&r.registry_id===registryId;
  let old=await find();if(old){if(!same(old))throw new Error('request ID reused');return old}
  try{await db.prepare("INSERT INTO candidates(id,company_id,offer,motion,registry_id,registry_status,request_id) VALUES(?,?,?,?,?,'active',?)").bind(crypto.randomUUID(),companyId,offer,motion,registryId,requestId).run()}
  catch(error){old=await find();if(old&&same(old))return old;if(old)throw new Error('request ID reused',{cause:error});throw error}
  return find();
}

/** Record an evidenced contact-permission decision against an expected version. */
/** @param {D1Database} db @param {string} id @param {string} allowed @param {Evidence} evidence @param {number} version @param {string} requestId */
export async function setContactPermission(db, id, allowed, evidence, version, requestId) {
  required(id,'candidate'); required(requestId,'request ID');
  if(!['yes','no','unknown'].includes(allowed)||!Number.isSafeInteger(version)||version<1)throw new Error('invalid permission');
  const details=evidenceString(evidence);
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare('SELECT * FROM permission_changes WHERE request_id=?').bind(requestId).first());
  /** @param {Row} r */
  const same=r=>r.candidate_id===id&&r.allowed===allowed&&r.evidence===details&&r.expected_version===version;
  let old=await find();if(old){if(!same(old))throw new Error('request ID reused');return old}
  try{await db.prepare('INSERT INTO permission_changes(request_id,candidate_id,allowed,evidence,expected_version) VALUES(?,?,?,?,?)').bind(requestId,id,allowed,details,version).run()}
  catch(error){old=await find();if(old&&same(old))return old;if(old)throw new Error('request ID reused',{cause:error});throw error}
  return find();
}

/** @param {string} value */
function amountMinor(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) throw new Error('invalid amount');
  const [whole, fractional=''] = value.split('.');
  const valueMinor=BigInt(whole)*100n+BigInt(fractional.padEnd(2,'0'));
  if(valueMinor>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount too large');
  return Number(valueMinor);
}
/** @param {FinancialInput} input */
function financialFields(input) {
  if(!input || !['actual','demo'].includes(input.dataset) || !/^[A-Z]{3}$/.test(input.currency))throw new Error('invalid financial scope');
  const ev=JSON.parse(evidenceString(input.evidence));
  return {company_id:required(input.companyId,'company'),offer:required(input.offer,'offer'),dataset:input.dataset,currency:input.currency,amount_minor:amountMinor(input.amount),source_ref:ev.sourceRef,source_url:ev.sourceUrl,recorded_on:ev.recordedOn,confirmation:ev.confirmation};
}
/** @param {D1Database} db @param {"amounts"|"contracts"} table @param {Row} fields @param {string} requestId */
async function insertFinancial(db,table,fields,requestId) {
  required(requestId,'request ID');
  const find=()=> /** @type {Promise<Row | null>} */ (db.prepare(`SELECT * FROM ${table} WHERE request_id=?`).bind(requestId).first());
  /** @param {Row} row */
  const same=row=>Object.entries(fields).every(([key,value])=>row[key]===value);
  let old=await find();if(old){if(!same(old))throw new Error('request ID reused');return old}
  const names=Object.keys(fields), params=Object.values(fields);
  const sql=`INSERT INTO ${table}(id,${names.join(',')},request_id) VALUES(${Array(names.length+2).fill('?').join(',')})`;
  try{await db.prepare(sql).bind(crypto.randomUUID(),...params,requestId).run()}
  catch(error){old=await find();if(old&&same(old))return old;if(old)throw new Error('request ID reused',{cause:error});throw error}
  return find();
}
/** Record a confirmed or unconfirmed amount with an immutable evidence reference. */
/** @param {D1Database} db @param {AmountInput} input @param {string} requestId */
export async function recordAmount(db,input,requestId) {
  const fields=financialFields(input);
  const kinds=['revenue','payment','revenue_refund','payment_refund','revenue_cancel','payment_cancel','forecast'];
  if(!kinds.includes(input.kind))throw new Error('invalid amount kind');
  const occurred_on=requireDate(input.occurredOn),period_start=requireDate(input.periodStart),period_end=requireDate(input.periodEnd);
  if(period_end<period_start)throw new Error('invalid period');
  return insertFinancial(db,'amounts',{...fields,kind:input.kind,occurred_on,period_start,period_end},requestId);
}
/** Record a paid contract or immutable revision with exclusive end and pause dates. */
/** @param {D1Database} db @param {ContractInput} input @param {string} requestId */
export async function recordContract(db,input,requestId) {
  const fields=financialFields(input);
  if(fields.amount_minor<=0||!['monthly','annual'].includes(input.cadence))throw new Error('invalid paid contract');
  const paid_from=requireDate(input.paidFrom),paid_until=input.paidUntil?requireDate(input.paidUntil):null;
  const pause_from=input.pauseFrom?requireDate(input.pauseFrom):null,pause_until=input.pauseUntil?requireDate(input.pauseUntil):null;
  if((paid_until&&paid_until<=paid_from)||Boolean(pause_from)!==Boolean(pause_until)||(pause_from&&pause_until&&pause_until<=pause_from))throw new Error('invalid contract dates');
  return insertFinancial(db,'contracts',{...fields,cadence:input.cadence,paid_from,paid_until,pause_from,pause_until,supersedes:input.supersedes||null},requestId);
}
