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
