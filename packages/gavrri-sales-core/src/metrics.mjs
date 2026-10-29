/** @typedef {{dataset:'actual'|'demo', currency:string, month:string, asOf:string, offer:string|null}} MetricScope */
/** @typedef {{paid_from:string, paid_until:string|null, pause_from:string|null, pause_until:string|null, amount_minor:number, cadence:'monthly'|'annual', canonical_company:string}} ContractRow */
/** @typedef {{kind:string, amount_minor:number}} AmountRow */
// Values are integer minor units; monthly totals are rounded after aggregating annual contracts.
/** @param {bigint} minor */
function text(minor) {
  const sign=minor<0n?'-':''; const n=minor<0n?-minor:minor;
  return `${sign}${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
/** @param {bigint} n */
function roundTwelve(n) { return (n+6n)/12n; }
/** @param {D1Database} db @param {MetricScope} scope */
export async function metrics(db, scope) {
  if (!scope || !['actual','demo'].includes(scope.dataset) || !/^[A-Z]{3}$/.test(scope.currency) || !/^\d{4}-\d{2}$/.test(scope.month) || !/^\d{4}-\d{2}-\d{2}$/.test(scope.asOf)) throw new Error('invalid metric scope');
  const matches = 'dataset=? AND currency=? AND (? IS NULL OR offer=?)';
  const args=[scope.dataset,scope.currency,scope.offer,scope.offer];
  const contracts=/** @type {ContractRow[]} */ ((await db.prepare(`SELECT c.*,COALESCE((SELECT company_id FROM company_aliases WHERE id=c.company_id),c.company_id) AS canonical_company FROM contracts c WHERE ${matches} AND confirmation='confirmed' AND NOT EXISTS(SELECT 1 FROM contracts n WHERE n.supersedes=c.id)`).bind(...args).all()).results);
  const amounts=/** @type {AmountRow[]} */ ((await db.prepare(`SELECT * FROM amounts WHERE ${matches} AND confirmation='confirmed' AND occurred_on LIKE ? AND occurred_on<=?`).bind(...args,scope.month+'%',scope.asOf).all()).results);
  const active=contracts.filter(c=>c.paid_from<=scope.asOf && (!c.paid_until || scope.asOf<c.paid_until) && !(c.pause_from && c.pause_until && c.pause_from<=scope.asOf && scope.asOf<c.pause_until));
  let mrr=0n;for(const c of active) mrr+=BigInt(c.amount_minor)*(c.cadence==='monthly'?12n:1n);
  /** @type {Record<string, bigint | null>} */
  const sums={revenue:null,payment:null,forecast:null};
  for(const a of amounts){const key=a.kind==='forecast'?'forecast':a.kind.startsWith('revenue')?'revenue':'payment';const negative=a.kind.endsWith('refund')||a.kind.endsWith('cancel');sums[key]=(sums[key]??0n)+(negative?-1n:1n)*BigInt(a.amount_minor)}
  const newCount=contracts.filter(c=>c.paid_from.startsWith(scope.month)&&c.paid_from<=scope.asOf).length;
  const churn=contracts.filter(c=>c.paid_until?.startsWith(scope.month)&&c.paid_until<=scope.asOf).length;
  return {currency:scope.currency, revenue:sums.revenue===null?null:text(sums.revenue), payment:sums.payment===null?null:text(sums.payment),forecast:sums.forecast===null?null:text(sums.forecast),mrr:active.length?text(roundTwelve(mrr)):null,activeCompanies:contracts.length?new Set(active.map(c=>c.canonical_company)).size:null,activeContracts:contracts.length?active.length:null,newContracts:newCount||null,cancellations:churn||null,coverage:'unverified'};
}
