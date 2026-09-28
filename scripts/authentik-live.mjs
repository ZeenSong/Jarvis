#!/usr/bin/env node
// Deploy the persistent, Tailnet-only identity service. Secrets stay in Kubernetes.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const secretName = "jarvis-authentik";
const env = { ...process.env, KUBECONFIG: process.env.KUBECONFIG || ".local/m2.kubeconfig" };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, encoding: "utf8", ...options });
  if (result.status !== 0) throw Error(`${command} failed: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}
const action = process.argv[2];
if (!["up", "status", "configure"].includes(action)) throw Error("Usage: node scripts/authentik-live.mjs up|status|configure");
const saved = run("kubectl", ["-n", "jarvis", "get", "secret", secretName, "--ignore-not-found", "-o", "json"]);
let values;
if (saved.trim()) {
  values = Object.fromEntries(Object.entries(JSON.parse(saved).data).map(([key, value]) => [key, Buffer.from(value, "base64").toString()]));
} else {
  if (action !== "up") throw Error("Identity service has not been provisioned");
  values = {
    AUTHENTIK_POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    AUTHENTIK_SECRET_KEY: randomBytes(48).toString("hex"),
    AUTHENTIK_BOOTSTRAP_PASSWORD: randomBytes(24).toString("base64url"),
    AUTHENTIK_BIND_ADDRESS: "100.77.157.73",
    AUTHENTIK_PORT: "9000",
  };
  run("kubectl", ["create", "-f", "-"], { input: JSON.stringify({ apiVersion: "v1", kind: "Secret", metadata: { name: secretName, namespace: "jarvis" }, type: "Opaque", stringData: values }) });
}
Object.assign(env, values);
const compose = ["compose", "-f", "deploy/authentik/compose.yaml"];
if (action === "up") console.log(run("docker", [...compose, "up", "-d"]));
if (action === "status") console.log(run("docker", [...compose, "ps"]));
if (action === "configure") {
  const code = `
from authentik.core.models import Application
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping
provider, created = OAuth2Provider.objects.get_or_create(name="Jarvis", defaults={
    "client_id": "jarvis-web", "client_type": "public",
    "authorization_flow": Flow.objects.get(slug="default-provider-authorization-explicit-consent"),
    "invalidation_flow": Flow.objects.get(slug="default-provider-invalidation-flow"),
    "_redirect_uris": [{"matching_mode": "strict", "url": "http://100.77.157.73:8080/api/v2/auth/oidc/callback"}],
})
if created:
    provider.property_mappings.set(ScopeMapping.objects.filter(scope_name__in=["openid", "profile", "email"]))
assert provider.property_mappings.count() >= 3, "Required scope mappings missing"
Application.objects.get_or_create(slug="jarvis", defaults={"name": "Jarvis", "provider": provider, "meta_launch_url": "http://100.77.157.73:8080/"})
print("Jarvis OIDC application configured")
`;
  console.log(run("docker", [...compose, "exec", "-T", "server", "ak", "shell", "-c", code]));
  // Patch only these variables; retain the live image and all unrelated configuration.
  console.log(run("kubectl", ["-n", "jarvis", "set", "env", "deployment/jarvis-server",
    "AUTHENTIK_ISSUER=http://100.77.157.73:9000/application/o/jarvis/",
    "AUTHENTIK_CLIENT_ID=jarvis-web", "AUTHENTIK_REDIRECT_URI=http://100.77.157.73:8080/api/v2/auth/oidc/callback",
    "AUTHENTIK_OIDC_SCOPES=openid profile email"]));
}
