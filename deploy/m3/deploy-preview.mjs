// Upgrade only the existing single-node Gateway; retain database and Workers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, copyFile, chmod, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const run = promisify(execFile);
const kubeconfig = resolve('.local/m2.kubeconfig');
const k = async args => (await run('kubectl', ['--kubeconfig', kubeconfig, '--context', 'default', ...args], { maxBuffer: 8*1024*1024 })).stdout;
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const nodes = JSON.parse(await k(['get', 'nodes', '-o', 'json'])).items;
if (nodes.length !== 1 || !nodes[0].status.nodeInfo.kubeletVersion.includes('k3s')) throw Error('Expected single-node K3s');
const backup = (await readFile('.local/m2-last-backup', 'utf8')).trim();
const before = JSON.parse(await readFile(`${backup}/before.json`, 'utf8'));
const verified = JSON.parse(await readFile(`${backup}/postgres.dump.verified.json`, 'utf8'));
if (before.context !== 'default' || verified.status !== 'passed' || Date.now()-Date.parse(before.created_at)>86400000) throw Error('Fresh verified backup required');
const deployment = JSON.parse(await k(['-n', 'jarvis', 'get', 'deployment', 'jarvis-server', '-o', 'json']));
const output = resolve(`.local/m3-release-${version}`);
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(`${output}/deployment-before.json`, JSON.stringify(deployment, null, 2), { flag: 'wx', mode: 0o600 });
const sessionDir = resolve('.local/m3-production-casaos');
await mkdir(sessionDir, { recursive: true, mode: 0o700 });
const session = `${sessionDir}/casaos-session.json`;
try { await access(session); } catch { await copyFile(resolve('.local/m3-private/casaos-session.json'), session); }
await chmod(session, 0o600);
const patch = { spec: { template: { spec: {
  containers: [{ name: 'server', image: `jarvis-server:${version}`, env: [{ name: 'CASAOS_SESSION_FILE', value: '/var/lib/jarvis-casaos/casaos-session.json' }], volumeMounts: [{ name: 'casaos-session', mountPath: '/var/lib/jarvis-casaos', readOnly: false }] }],
  volumes: [{ name: 'casaos-session', hostPath: { path: sessionDir, type: 'Directory' } }]
} } } };
await writeFile(`${output}/gateway-patch.json`, JSON.stringify(patch, null, 2), { mode: 0o600 });
console.log(await k(['-n', 'jarvis', 'patch', 'deployment', 'jarvis-server', '--type=strategic', '--patch-file', `${output}/gateway-patch.json`]));
console.log(await k(['-n', 'jarvis', 'rollout', 'status', 'deployment/jarvis-server', '--timeout=180s']));
console.log(`Snapshot: ${output}/deployment-before.json; database backup: ${backup}`);
