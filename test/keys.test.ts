import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG_ENV, KEY_ENV, readKeys, scrub } from '../server/keys.ts';

test('readKeys: no key at all is fine and gives an empty set', () => {
  assert.deepEqual(readKeys({}), {});
});

test('readKeys: an option left empty, blank or as its own placeholder counts as no key', () => {
  assert.deepEqual(readKeys({ NYMRA_CONFIG_ALCHEMY_API_KEY: '', NYMRA_CONFIG_BLOCKSCOUT_API_KEY: '   ', NYMRA_CONFIG_NODEREAL_API_KEY: '${user_config.nodereal_api_key}', NYMRA_ETHERSCAN_API_KEY: ' ' }), {});
});

test('readKeys: each variable fills its own key, trimmed', () => {
  assert.deepEqual(
    readKeys({ NYMRA_ALCHEMY_API_KEY: ' alc-123456 ', NYMRA_BLOCKSCOUT_API_KEY: 'bs-123456', NYMRA_NODEREAL_API_KEY: 'nr-123456', NYMRA_ETHERSCAN_API_KEY: 'es-123456' }),
    { alchemy: 'alc-123456', pro: 'bs-123456', nodereal: 'nr-123456', etherscan: 'es-123456' },
  );
});

test("readKeys: a key in the user's own environment counts when the settings leave it empty", () => {
  assert.deepEqual(readKeys({ NYMRA_CONFIG_ALCHEMY_API_KEY: '', NYMRA_ALCHEMY_API_KEY: 'env-123456' }), { alchemy: 'env-123456' });
  assert.deepEqual(readKeys({ NYMRA_CONFIG_NODEREAL_API_KEY: '${user_config.nodereal_api_key}', NYMRA_NODEREAL_API_KEY: 'env-654321' }), { nodereal: 'env-654321' });
});

test('readKeys: a key in the settings wins over the environment', () => {
  assert.deepEqual(readKeys({ NYMRA_CONFIG_BLOCKSCOUT_API_KEY: 'cfg-123456', NYMRA_BLOCKSCOUT_API_KEY: 'env-123456' }), { pro: 'cfg-123456' });
});

test('CONFIG_ENV: every settings variable carries its own prefix', () => {
  for (const v of Object.values(CONFIG_ENV)) assert.match(v, /^NYMRA_CONFIG_[A-Z]+_API_KEY$/);
});

test('readKeys: other variables of the environment are never read as a key', () => {
  assert.deepEqual(readKeys({ ALCHEMY_API_KEY: 'x-123456', ETHERSCAN_API_KEY: 'y-123456', GITHUB_TOKEN: 'z-123456' }), {});
});

test('KEY_ENV: every variable carries the plugin prefix', () => {
  for (const v of Object.values(KEY_ENV)) assert.match(v, /^NYMRA_[A-Z]+_API_KEY$/);
});

test('scrub: every key value is taken out of a text, wherever it stands', () => {
  const keys = { alchemy: 'alc-SECRET-1', pro: 'bs-SECRET-2' };
  const out = scrub('https://base-mainnet.g.alchemy.com/v2/alc-SECRET-1 and Bearer bs-SECRET-2, twice alc-SECRET-1', keys);
  assert.ok(!out.includes('SECRET'));
  assert.equal(out.split('[key]').length - 1, 3);
});

test('scrub: without keys the text is unchanged', () => {
  assert.equal(scrub('score 34 of 100', {}), 'score 34 of 100');
});
