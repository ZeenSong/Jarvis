import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyPatch, plan, main } from './provision-integrations.mjs';

const base = () => ({ metadata: { name: 'jarvis-secrets', namespace: 'jarvis', resourceVersion: '123' },
  data: { 'database-url': 'unchanged' } });
const generate = () => Buffer.alloc(32, 7).toString('base64url');
test('missing key patch preserves siblings and guards resourceVersion', () => {
  const secret = base();
  const before = structuredClone(secret);
  const patch = keyPatch(secret, generate);
  assert.deepEqual(patch[0], { op: 'test', path: '/metadata/resourceVersion', value: '123' });
  assert.equal(patch.length, 2);
  assert.equal(patch[1].path, '/data/integration-credential-key');
  assert.equal(Buffer.from(patch[1].value, 'base64').toString(), generate());
  assert.deepEqual(secret, before);
});
test('existing valid key reused without invoking randomness, including immutable Secret', () => {
  const secret = base();
  secret.immutable = true;
  secret.data['integration-credential-key'] = Buffer.from(generate()).toString('base64');
  assert.equal(keyPatch(secret, () => { throw Error('must not generate'); }), null);
});
test('empty or malformed existing keys never rotated', () => {
  for (const value of ['', 'bad', Buffer.from('short').toString('base64')]) {
    const secret = base();
    secret.data['integration-credential-key'] = value;
    assert.throws(() => keyPatch(secret), /existing_key_invalid_no_rotation/);
  }
});
test('absent data map supported without overwriting other Secret fields', () => {
  const secret = base(); delete secret.data;
  assert.deepEqual(Object.keys(keyPatch(secret, generate)[1].value), ['integration-credential-key']);
});
test('wrong targets, immutable missing key and unsafe CLI modes fail closed', () => {
  assert.throws(() => keyPatch({ ...base(), metadata: { ...base().metadata, namespace: 'other' } }), /unexpected_secret/);
  assert.throws(() => keyPatch({ ...base(), immutable: true }), /secret_immutable/);
  for (const args of [['--execute'], ['--ensure-key'], ['--apply'], ['--plan', '--execute']])
    assert.throws(() => main(args), /usage_/);
});
test('service plan has narrow scopes and explicitly blocks permanent Frigate JWT use', () => {
  const p = plan();
  assert.equal(p.executed, false);
  assert.deepEqual(p.providers.immich.body.permissions, ['asset.read', 'asset.view']);
  assert.deepEqual(p.providers['home-assistant'].createUser.group_ids, ['system-read-only']);
  assert.equal(p.providers.frigate.body.role, 'viewer');
  assert.match(p.providers.frigate.blocked, /expires/);
});
