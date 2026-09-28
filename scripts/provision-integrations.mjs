#!/usr/bin/env node
// Review-first preparation. Service creation and deployment are deliberately
// not executable here; the only write mode fills one missing Secret data key.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const namespace = 'jarvis';
const secretName = 'jarvis-secrets';
const keyName = 'integration-credential-key';

export function keyPatch(secret, generate = () => randomBytes(32).toString('base64url')) {
  if (secret?.metadata?.name !== secretName || secret?.metadata?.namespace !== namespace ||
      typeof secret?.metadata?.resourceVersion !== 'string') throw Error('unexpected_secret');
  if (secret.data && Object.hasOwn(secret.data, keyName)) {
    // Reuse only a valid existing value. Empty/corrupt values require separate
    // investigation, never an implicit rotation of ciphertext encryption keys.
    const encoded = secret.data[keyName];
    if (typeof encoded !== 'string') throw Error('existing_key_invalid_no_rotation');
    const value = Buffer.from(encoded, 'base64').toString('utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(value) ||
        Buffer.from(value, 'base64url').toString('base64url') !== value ||
        Buffer.from(value).toString('base64') !== encoded) throw Error('existing_key_invalid_no_rotation');
    return null;
  }
  if (secret.immutable) throw Error('secret_immutable');
  const value = generate();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').length !== 32)
    throw Error('generated_key_invalid');
  const encoded = Buffer.from(value).toString('base64');
  return [
    { op: 'test', path: '/metadata/resourceVersion', value: secret.metadata.resourceVersion },
    secret.data == null
      ? { op: 'add', path: '/data', value: { [keyName]: encoded } }
      : { op: 'add', path: `/data/${keyName}`, value: encoded },
  ];
}

export function plan() {
  return {
    mode: 'plan-only', executed: false,
    encryption: { secret: `${namespace}/${secretName}`, key: keyName,
      command: 'node scripts/provision-integrations.mjs --ensure-key --execute',
      deployment: 'Separate review required; running pods do not reload Secret env vars.' },
    providers: {
      'home-assistant': {
        transport: 'Authenticated /api/websocket; admin session used only for account setup',
        createUser: { type: 'config/auth/create', name: 'Jarvis read-only', group_ids: ['system-read-only'] },
        createLogin: { type: 'config/auth_provider/homeassistant/create', user_id: '<new-user-id>',
          username: 'jarvis_readonly', password: '<new dedicated password from secret manager>' },
        createTokenAs: 'The new service user, never the administrator',
        createToken: { type: 'auth/long_lived_access_token', client_name: 'Jarvis M3.2 read-only', lifespan: 365 },
        gates: ['verify non-owner and only system-read-only membership',
          'entity read-only policy is not proof that every HA API is read-only; review exposure'],
      },
      immich: {
        createAs: 'Dedicated non-admin service user with explicitly authorized photo library',
        method: 'POST', path: '/api/api-keys',
        body: { name: 'Jarvis M3.2 read-only', permissions: ['asset.read', 'asset.view'] },
        gates: ['Confirm photo ownership/partner visibility; shared albums alone do not prove search visibility',
          'Do not grant all, asset.write, asset.delete or apiKey.create to the resulting key'],
      },
      frigate: {
        createAs: 'Admin session on authenticated port 8971, only for account setup',
        method: 'POST', path: '/api/users',
        body: { username: 'jarvis_readonly', password: '<new dedicated password from secret manager>', role: 'viewer' },
        login: { method: 'POST', path: '/api/login', body: { user: 'jarvis_readonly', password: '<dedicated password>' } },
        blocked: 'JWT expires. Current Jarvis adapter has no login/refresh loop. No permanent scoped API key established.',
        gates: ['Confirm authorized cameras; viewer covers all cameras, otherwise use a configured custom role',
          'Trusted TLS on 8971; never use unauthenticated 5000 or forge JWT using server signing secret'],
      },
    },
    persistence: { method: 'POST', path: '/api/v2/integration.credential.put',
      body: { credential_id: '<stable UUID recorded before first attempt>', provider: '<provider above>',
        label: 'Jarvis dedicated read-only', secret: '<new scoped service token>',
        metadata: { service_account: '<dedicated identity>', permissions: '<verified permissions>' } },
      gates: ['Correct authenticated Jarvis household; master key loaded in runtime',
        'No service secrets in stdout, argv, repository, plan output, or general environment fallback',
        'This plan does not create accounts, service tokens, database rows, or deployments'] },
  };
}

function kubectl(args, input) {
  const result = spawnSync('kubectl', ['-n', namespace, ...args], {
    input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Do not surface stderr: Kubernetes errors may include a rejected patch body.
  if (result.error || result.status !== 0) throw Error('kubectl_failed_no_change_confirmed_recheck');
  return result.stdout;
}

function patchSecret(patch) {
  const directory = mkdtempSync(`${tmpdir()}/jarvis-secret-patch-`);
  const file = `${directory}/patch.json`;
  try {
    writeFileSync(file, JSON.stringify(patch), { mode: 0o600 });
    return kubectl(['patch', 'secret', secretName, '--type=json', `--patch-file=${file}`, '-o', 'name']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function main(args) {
  const mode = args.join(' ');
  if (!mode || mode === '--plan') return console.log(JSON.stringify(plan(), null, 2));
  if (!['--check-key', '--ensure-key --execute'].includes(mode)) throw Error('usage_plan_or_check-key_or_ensure-key_execute');
  const secret = JSON.parse(kubectl(['get', 'secret', secretName, '-o', 'json']));
  // In diagnostic mode even random key generation is avoided.
  const patch = keyPatch(secret, mode === '--check-key' ? () => 'A'.repeat(43) : undefined);
  if (!patch) return console.log('existing_valid_key_reused; no write; no deployment');
  if (mode === '--check-key') return console.log('key_missing; would add only integration-credential-key; no write');
  patchSecret(patch);
  console.log('missing_key_added; no service credentials created; no deployment');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    const safe = new Set(['unexpected_secret', 'existing_key_invalid_no_rotation', 'secret_immutable',
      'generated_key_invalid', 'kubectl_failed_no_change_confirmed_recheck',
      'usage_plan_or_check-key_or_ensure-key_execute']);
    console.error(safe.has(error.message) ? error.message : 'preparation_failed_details_suppressed');
    process.exitCode = 1;
  }
}
