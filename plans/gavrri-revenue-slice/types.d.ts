/** A reference to the evidence used to confirm a record. URLs must not contain credentials. */
export interface Evidence {
  sourceUrl: string;
  sourceRef: string;
  recordedOn: string;
  confirmation: "confirmed" | "unconfirmed";
}

/** A stable company identity. Alias links are explicit and never inferred from a domain. */
export interface CompanySummary {
  companyId: string;
  displayName: string;
  aliases: string[];
  contactBlocked: boolean;
}

/** One company × offer × motion candidate. Registry status is not a contact result. */
export interface CandidateSummary {
  candidateId: string;
  registryId: string | null;
  company: CompanySummary;
  offer: string;
  motion: string;
  registryStatus: "active" | "hold" | "future" | "excluded";
  nextAction: string | null;
  nextActionDate: string | null;
  version: number;
}

/** A recorded observation or contact outcome. */
export interface ContactEvent {
  eventId: string;
  candidateId: string;
  kind: "sent" | "form_accepted" | "automatic_reply" | "human_reply" | "unknown" | "refused" | "skipped" | "meeting" | "introduced" | "note";
  occurredOn: string;
  evidence: Evidence;
  note: string;
}

/** An evidenced, recurring paid agreement. End and suspension dates are exclusive. */
export interface Contract {
  contractId: string;
  companyId: string;
  offer: string;
  dataset: "actual" | "demo";
  currency: string;
  amount: string;
  cadence: "monthly" | "annual";
  paidFrom: string;
  paidUntil: string | null;
  pauseFrom: string | null;
  pauseUntil: string | null;
  evidence: Evidence;
  version: number;
}

/** A revenue, receipt, reversal or forecast entry for one offer and company. */
export interface AmountEntry {
  entryId: string;
  companyId: string;
  offer: string;
  dataset: "actual" | "demo";
  currency: string;
  kind: "revenue" | "payment" | "revenue_refund" | "payment_refund" | "revenue_cancel" | "payment_cancel" | "forecast";
  amount: string;
  occurredOn: string;
  periodStart: string;
  periodEnd: string;
  evidence: Evidence;
}

/** One period's known values; null means not verified and must not be rendered as zero. */
export interface MetricPeriod {
  month: string;
  through: string;
  partial: boolean;
  revenue: string | null;
  payment: string | null;
  mrr: string | null;
  newContracts: number | null;
  cancellations: number | null;
}

/** Exact scope for financial metrics. Currency conversion is not performed. */
export interface MetricScope {
  dataset: "actual" | "demo";
  offer: string | null;
  currency: string;
  month: string;
  asOf: string;
  months: 1 | 3 | 6 | 12;
}

/** Metrics and comparison periods based only on confirmed evidence. */
export interface MetricReport {
  scope: MetricScope;
  activeCompanies: number | null;
  activeContracts: number | null;
  periods: MetricPeriod[];
  coverage: "unverified";
}

/** A bounded page of candidate summaries. */
export interface CandidatePage {
  items: CandidateSummary[];
  nextCursor: string | null;
}

/** A capability for one candidate and its history. */
export interface SalesCandidate {
  /** Returns this candidate's current summary. */
  get(): Promise<CandidateSummary>;
  /** Returns recorded history in chronological order. */
  listEvents(): Promise<ContactEvent[]>;
  /** Records one observation or contact result. Reusing requestId returns the same result. */
  recordEvent(input: Omit<ContactEvent, "eventId" | "candidateId">, requestId: string): Promise<ContactEvent>;
  /** Changes the next action only if expectedVersion matches the current version. */
  setNextAction(action: string | null, dueOn: string | null, expectedVersion: number, requestId: string): Promise<CandidateSummary>;
}

/** A capability for one company's confirmed identity and linked sales candidates. */
export interface SalesCompany {
  /** Returns this company's identity and suppression status. */
  get(): Promise<CompanySummary>;
  /** Lists candidate records linked to this company. */
  listCandidates(): Promise<CandidateSummary[]>;
  /** Lists the company's evidenced contract records for the requested offer and dataset. */
  listContracts(offer: string, dataset: "actual" | "demo"): Promise<Contract[]>;
  /** Records an evidenced paid contract for this company. Reusing requestId returns the same result. */
  recordContract(input: Omit<Contract, "contractId" | "companyId" | "version">, requestId: string): Promise<Contract>;
  /** Creates a new revision of a contract only when expectedVersion matches. */
  reviseContract(contractId: string, input: Omit<Contract, "contractId" | "companyId" | "version">, expectedVersion: number, requestId: string): Promise<Contract>;
  /** Records a revenue, receipt, reversal, or forecast entry for this company. */
  recordAmount(input: Omit<AmountEntry, "entryId" | "companyId">, requestId: string): Promise<AmountEntry>;
  /** Links an explicitly identified alias; ambiguous similarity never links automatically. */
  linkAlias(aliasCompanyId: string, expectedVersion: number, requestId: string): Promise<CompanySummary>;
}

/** A capability scoped to one accessible sales portfolio. */
export interface SalesPortfolio {
  /** Lists candidates for the selected offer and optional search query. */
  listCandidates(offer: string | null, query: string | null, cursor: string | null): Promise<CandidatePage>;
  /** Creates an offer and motion candidate for an existing company. */
  createCandidate(companyId: string, offer: string, motion: string, registryId: string | null, requestId: string): Promise<SalesCandidate>;
  /** Opens a single candidate by its stable ID. Throws if inaccessible. */
  openCandidate(candidateId: string): Promise<SalesCandidate>;
  /** Opens a single company by its stable ID. Throws if inaccessible. */
  openCompany(companyId: string): Promise<SalesCompany>;
  /** Calculates a currency-specific report. Missing values remain null. */
  getMetrics(scope: MetricScope): Promise<MetricReport>;
  /** Returns the configured initial-contact limit and observed count for a date. */
  getPeriodLimit(offer: string, day: string): Promise<{ start: string; end: string; limit: number; observed: number } | null>;
}
