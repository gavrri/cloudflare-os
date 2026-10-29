/** The same canonical identity relation as the Core contact guard. */
export const candidateQuery = `SELECT c.rowid AS page_rowid,c.id,c.company_id,c.offer,c.motion,c.registry_status,c.contact_allowed,c.next_action,c.next_date,c.version,co.name,
 EXISTS(SELECT 1 FROM events e JOIN candidates other ON other.id=e.candidate_id
 WHERE e.kind='refused' AND COALESCE((SELECT company_id FROM company_aliases WHERE id=other.company_id),other.company_id)=COALESCE((SELECT company_id FROM company_aliases WHERE id=c.company_id),c.company_id)) AS company_refused
 FROM candidates c JOIN companies co ON co.id=c.company_id WHERE c.rowid>? AND c.rowid<=? ORDER BY c.rowid LIMIT 100`;
