# Jarvis Docker / CasaOS deployment

This deployment replaces the K3s Jarvis workloads with five Docker services:
`jarvis-server`, `jarvis-hermes-dashboard`, `jarvis-media-janitor`, and
`jarvis-postgres`, plus the capability-advertising `node-bridge`.

Durable tasks submit goals, required capabilities, and execution constraints.
The server selects any enabled executor whose registered runtime and metadata
match the request; callers do not choose a hard-coded Agent name.

Persistent data and secrets live under `/DATA/AppData/jarvis`. After the
configuration files have been populated, start everything with:

```bash
docker compose -f deploy/docker/compose.yaml up -d
```

Register the same Compose application in CasaOS with:

```bash
casaos-cli app-management install -f deploy/docker/compose.yaml
```

Jarvis is published on port `8080`; Hermes Dashboard is published on `9119`
and remains protected by its configured Basic Auth credentials.

## App connections

`deploy/docker/hermes-config.yaml` includes one static `apps` MCP provider. It
exposes `app_list`, `app_setup_guide`, `app_configure`, `app_test`,
`app_remove`, `app_tools_list` and `app_tool_call` for every app configured
after startup, plus the CasaOS management tools `casaos_app_detail`,
`casaos_app_add_ports`, `casaos_app_restart` and `casaos_app_logs`, so
installing a new CasaOS app or changing its port map never requires editing the
Hermes config or rebuilding its image. The server stores validated manifests in
the `integration_manifests` table (migration `0007`), encrypts credentials with
`INTEGRATION_CREDENTIAL_KEY`, and derives app URLs from the authenticated CasaOS
session (`CASAOS_SESSION_FILE`) plus `CASAOS_PUBLIC_URL`.

The one-click path in the web UI is: Apps → app detail → "一键连接 Jarvis" →
credential. Jarvis can also do the same through the conversation tools; it will
never ask for the secret in chat. See
[`docs/guides/app-connections.md`](../../docs/guides/app-connections.md) for the
recipe list, security boundary and extension steps.
