/** Synthetic-only sales records; every result is confined to this local demo account. */
export interface SalesSession {
  /** Lists the scoped sample candidates. */
  listCandidates(cursor?:string|null): Promise<{items: Candidate[];nextCursor:string|null}>;
  /** Lists recorded contact events for one candidate. */
  listEvents(candidateId: string,cursor?:string|null): Promise<{items:ContactEvent[];nextCursor:string|null}>;
  /** Submits an event for approval. A pending result is not a saved contact. */
  recordEvent(candidateId:string,input:EventInput,requestId:string): Promise<{status:'pending'|'applied'|'rejected';actionId:number}>;
  previewDemoRegistry():Promise<RegistryPreview>;
  listCompanies():Promise<{items:{id:string;name:string;version:number;canonicalId:string}[]}>;
  listLimits():Promise<{items:{offer:string;startDate:string;endDate:string;maxContacts:number;used:number}[]}>;
  proposeNextAction(candidateId:string,action:string|null,dueOn:string|null,expectedVersion:number,requestId:string):Promise<Proposal>;
  proposeLinkAlias(aliasCompanyId:string,targetCompanyId:string,expectedVersion:number,requestId:string):Promise<Proposal>;
  getPeriodLimit(offer:string,day:string):Promise<{start:string;end:string;limit:number;observed:number}|null>;
  proposeCompany(name:string,requestId:string):Promise<Proposal>;
  proposeCandidate(companyId:string,offer:string,motion:string,registryId:string|null,requestId:string):Promise<Proposal>;
  proposePermission(candidateId:string,allowed:'yes'|'no'|'unknown',evidence:Evidence,version:number,requestId:string):Promise<Proposal>;
  proposeContract(input:ContractInput,requestId:string):Promise<Proposal>;
  proposeAmount(input:AmountInput,requestId:string):Promise<Proposal>;
  /** Calculates confirmed values for one currency; null means unconfirmed. */
  getMetrics(scope:MetricScope): Promise<MetricResult>;
}
export interface Candidate {id:string;companyId:string;companyName:string;offer:string;motion:string;contactAllowed:string;registryStatus:'active'|'hold'|'future'|'excluded';companyRefused:boolean;nextAction:string|null;nextActionDate:string|null;version:number}
export interface Evidence {sourceUrl:string;sourceRef:string;recordedOn:string;confirmation:'confirmed'|'unconfirmed'}
export interface EventInput {kind:'sent'|'form_accepted'|'automatic_reply'|'human_reply'|'unknown'|'refused'|'skipped'|'meeting'|'introduced'|'note';occurredOn:string;note:string;evidence:Evidence}
export interface ContactEvent {id:string;candidateId:string;kind:string;occurredOn:string;note:string;evidence:Evidence}
export interface MetricScope {dataset:'actual'|'demo';offer:string|null;currency:string;month:string;asOf:string}
export interface MetricResult {currency:string;revenue:string|null;payment:string|null;forecast:string|null;mrr:string|null;activeCompanies:number|null;activeContracts:number|null;newContracts:number|null;cancellations:number|null;coverage:'unverified'}

export type Proposal={status:'pending'|'applied'|'rejected';actionId:number};
export interface FinancialInput {companyId:string;offer:string;dataset:'demo';currency:string;amount:string;evidence:Evidence}
export interface ContractInput extends FinancialInput {cadence:'monthly'|'annual';paidFrom:string;paidUntil:string|null;pauseFrom:string|null;pauseUntil:string|null;supersedes:string|null}
export interface AmountInput extends FinancialInput {kind:'revenue'|'payment'|'revenue_refund'|'payment_refund'|'revenue_cancel'|'payment_cancel'|'forecast';occurredOn:string;periodStart:string;periodEnd:string}

export interface RegistryPreview {rows:{line:number;registryId:string;company:string;offer:string;motion:string;registryStatus:string;executionId:string;companyId:string|null;companyCandidates:{id:string;name:string;canonical_id:string}[];conflicts:string[];notes:string[]}[];total:number}
