import { DurableObject } from "cloudflare:workers";

/** Workshop-hosted UI facade for an explicitly introduced scoped SALES capability. */
export class Gadget extends DurableObject {
  #sales() {
    if (!this.env.SALES) throw new Error("営業データの接続が設定されていません。");
    return this.env.SALES;
  }
  async listCandidates(cursor) { return this.#sales().listCandidates(cursor); }
  async listEvents(candidateId, cursor) { return this.#sales().listEvents(candidateId, cursor); }
  async recordEvent(candidateId, input, requestId) {
    return this.#sales().recordEvent(candidateId, input, requestId);
  }
  async previewDemoRegistry() { return this.#sales().previewDemoRegistry(); }
  async listCompanies() { return this.#sales().listCompanies(); }
  async listLimits() { return this.#sales().listLimits(); }
  async proposeNextAction(candidateId, action, dueOn, expectedVersion, requestId) { return this.#sales().proposeNextAction(candidateId, action, dueOn, expectedVersion, requestId); }
  async proposeLinkAlias(aliasCompanyId, targetCompanyId, expectedVersion, requestId) { return this.#sales().proposeLinkAlias(aliasCompanyId, targetCompanyId, expectedVersion, requestId); }
  async proposePermission(candidateId, allowed, evidence, version, requestId) { return this.#sales().proposePermission(candidateId, allowed, evidence, version, requestId); }
  async proposeCompany(name, requestId) { return this.#sales().proposeCompany(name, requestId); }
  async proposeCandidate(companyId, offer, motion, registryId, requestId) { return this.#sales().proposeCandidate(companyId, offer, motion, registryId, requestId); }
  async proposeContract(input, requestId) { return this.#sales().proposeContract(input, requestId); }
  async proposeAmount(input, requestId) { return this.#sales().proposeAmount(input, requestId); }
  async getMetrics(scope) { return this.#sales().getMetrics(scope); }
}
