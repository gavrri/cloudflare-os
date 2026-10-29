-- Preserve existing alias and evidence rows; version checks apply only to new links.
ALTER TABLE company_aliases ADD COLUMN expected_version INTEGER;
CREATE TRIGGER alias_version_guard BEFORE INSERT ON company_aliases WHEN NEW.expected_version IS NULL OR NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id AND version=NEW.expected_version) BEGIN SELECT RAISE(ABORT,'stale or missing target company'); END;
CREATE TRIGGER alias_version_apply AFTER INSERT ON company_aliases BEGIN UPDATE companies SET version=version+1 WHERE id=NEW.company_id; END;
