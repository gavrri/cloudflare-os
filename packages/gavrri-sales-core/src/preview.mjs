/** @typedef {{id:string,name:string,canonical_id:string}} CompanyRow */
/** @typedef {{id:string,company_id:string,registry_id:string|null,offer:string,motion:string}} CandidateRow */
/** @typedef {{line:number, registryId:string, company:string, offer:string, motion:string, registryStatus:string, executionId:string, companyId:string|null, companyCandidates:CompanyRow[], conflicts:string[], notes:string[]}} RegistryPreviewRow */

/** Normalize only for matching suggestions; never use this to join company identities. @param {string} value */
function normalize(value) { return value.normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase('en-US'); }

/** Parse bounded CSV, including quoted commas, newlines and escaped quotes. @param {string} text */
function parseCsv(text) {
  if (typeof text !== 'string' || text.length > 2_000_000 || text.includes('\0')) throw new Error('invalid CSV size or content');
  /** @type {string[][]} */ const rows=[];
  /** @type {string[]} */ let row=[];
  let field='', quoted=false, afterQuote=false;
  const value=text.replace(/^\uFEFF/,'');
  for(let i=0;i<value.length;i++) {
    const char=value[i];
    if(quoted) {
      if(char==='"') { if(value[i+1]==='"'){field+='"';i++} else {quoted=false;afterQuote=true} }
      else field+=char;
      continue;
    }
    if(afterQuote && char!==',' && char!=='\r' && char!=='\n')throw new Error('invalid CSV quote');
    if(char==='"') {if(field || afterQuote)throw new Error('invalid CSV quote');quoted=true;continue}
    if(char===',' || char==='\r' || char==='\n') {
      row.push(field);field='';afterQuote=false;
      if(char!==',') {if(char==='\r' && value[i+1]==='\n')i++;rows.push(row);row=[];if(rows.length>10_001)throw new Error('too many CSV rows')}
      continue;
    }
    field+=char;
  }
  if(quoted)throw new Error('unterminated CSV quote');
  if(field || row.length || afterQuote){row.push(field);rows.push(row)}
  return rows;
}

/**
 * Preview master-prospect-registry records against a portfolio without modifying it.
 * Exact or similar names are suggestions only; company IDs never follow from a name or domain.
 * The caller must authorize the observation before returning the result.
 * @param {D1Database} db
 * @param {string} csv
 * @returns {Promise<{rows:RegistryPreviewRow[], total:number}>}
 */
export async function previewRegistry(db,csv) {
  const raw=parseCsv(csv);
  if(!raw.length)throw new Error('empty CSV');
  const header=raw[0].map(x=>x.trim());
  const required=['registry_id','company','offer','motion','registry_status'];
  if(new Set(header).size!==header.length || required.some(x=>!header.includes(x)))throw new Error('invalid registry header');
  const index=Object.fromEntries(header.map((key,i)=>[key,i]));
  /** @type {CompanyRow[]} */
  const companies=/** @type {CompanyRow[]} */ ((await db.prepare('SELECT c.id,c.name,COALESCE(a.company_id,c.id) AS canonical_id FROM companies c LEFT JOIN company_aliases a ON a.id=c.id').bind().all()).results);
  /** @type {CandidateRow[]} */
  const candidates=/** @type {CandidateRow[]} */ ((await db.prepare('SELECT id,company_id,registry_id,offer,motion FROM candidates').bind().all()).results);
  const canonical=new Map(companies.map(c=>[c.id,c.canonical_id]));
  const byRegistry=new Set(candidates.map(c=>c.registry_id).filter(Boolean));
  const inputIds=new Set();
  const inputKeys=new Set();
  /** @type {RegistryPreviewRow[]} */ const result=[];
  for(let rowIndex=1;rowIndex<raw.length;rowIndex++) {
    const rawRow=raw[rowIndex];if(rawRow.every(x=>!x.trim()))continue;
    if(rawRow.length!==header.length)throw new Error(`invalid column count at row ${rowIndex+1}`);
    const get=/** @param {string} key */ key=>(rawRow[index[key]] || '').trim();
    const registryId=get('registry_id'), company=get('company'), offer=get('offer'), motion=get('motion'), registryStatus=get('registry_status'), executionId=get('execution_id');
    const suppliedCompany=get('company_id');
    if(!registryId||!company||!offer||!motion||!['active','hold','future','excluded'].includes(registryStatus))throw new Error(`invalid registry row ${rowIndex+1}`);
    const normalized=normalize(company), matches=companies.filter(c=>normalize(c.name)===normalized);
    const suggestions=companies.filter(c=>{const n=normalize(c.name);return n&&normalized&&(n.includes(normalized)||normalized.includes(n))});
    const companyId=suppliedCompany ? canonical.get(suppliedCompany) || null : null;
    /** @type {string[]} */ const conflicts=[];
    /** @type {string[]} */ const notes=[];
    if(byRegistry.has(registryId))conflicts.push('registry_id_exists');
    if(inputIds.has(registryId))conflicts.push('registry_id_repeated');
    inputIds.add(registryId);
    if(suppliedCompany && !companyId)conflicts.push('company_id_unknown');
    if(companyId && !companies.some(c=>c.canonical_id===companyId && normalize(c.name)===normalized))notes.push('company_name_differs_from_linked_identity');
    const possibleIds=companyId?[companyId]:[...new Set(matches.map(c=>c.canonical_id))];
    if(!companyId && matches.length)notes.push('company_identity_requires_review');
    if(!companyId && new Set(possibleIds).size>1)notes.push('ambiguous_company_identity');
    if(candidates.some(c=>possibleIds.includes(canonical.get(c.company_id) || c.company_id)&&normalize(c.offer)===normalize(offer)&&normalize(c.motion)===normalize(motion)))conflicts.push('company_offer_motion_exists');
    const key=JSON.stringify([companyId||`name:${normalized}`,normalize(offer),normalize(motion)]);
    if(inputKeys.has(key))conflicts.push('company_offer_motion_repeated');
    inputKeys.add(key);
    result.push({line:rowIndex+1,registryId,company,offer,motion,registryStatus,executionId,companyId,companyCandidates:suggestions,conflicts,notes});
  }
  return {rows:result,total:result.length};
}
