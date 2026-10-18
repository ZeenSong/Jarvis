/**
 * App catalog persistence.
 *
 * A CasaOS app configured once must stay configured across restarts, and a newly
 * installed app must be remembered so Jarvis does not notify the household about
 * it on every poll. Manifests are stored as validated JSON (the schemas live in
 * packages/integrations), so adding an app remains a data change.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS integration_manifests (
  id TEXT PRIMARY KEY,
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_discovery (
  app_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  base_url TEXT,
  installed BOOLEAN NOT NULL DEFAULT true,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS app_discovery_installed ON app_discovery(installed, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_discovery_unnotified ON app_discovery(installed, notified_at) WHERE notified_at IS NULL;
`;
