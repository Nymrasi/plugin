// What the plugin promises about privacy, checked on its code and on the real server process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRoad, LOCAL_RELAY } from '../vendor/scanbot/src/relay.ts';
import { read, ROOT, SEED } from './helpers.ts';

const SERVER = readdirSync(join(ROOT, 'server')).filter((f) => f.endsWith('.ts')).map((f) => [f, read(`server/${f}`)] as const);

test('the plugin code writes nothing: no console, no stderr, no file, no log', () => {
  for (const [f, src] of SERVER) {
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/console\.|process\.stderr|writeFile|appendFile|createWriteStream|node:fs/.test(code), f);
  }
});

test('the plugin code never calls Nymra: no nymra.si and no relay address anywhere it runs', () => {
  for (const [f, src] of SERVER) {
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/nymra\.si\/p\b|RELAY_URL|relayUrl|relayToken/.test(code), f);
  }
  // The only nymra.si it holds is the docs link base of the fix plan.
  assert.match(read('server/text.ts'), /export const SITE = 'https:\/\/nymra\.si';/);
});

test('with a key of the user, the relay lives inside the process: the key goes to its provider and nowhere else', async (t) => {
  // The relay's handle() forwards with the global fetch; the road's own fetch takes the direct reads.
  const seen: string[] = [];
  const spy = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('{"jsonrpc":"2.0","id":1,"result":{"transfers":[]}}', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  t.mock.method(globalThis, 'fetch', spy);
  const road = createRoad({ keys: { alchemy: 'alc-TESTKEY-1' }, fetch: spy, relayGapMs: 0, alchemyGapMs: 0 });
  assert.equal(road.kind, 'local');
  assert.equal(road.relay, LOCAL_RELAY);
  assert.match(LOCAL_RELAY, /\.invalid\//);
  const target = 'https://base-mainnet.g.alchemy.com/v2/';
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [{ fromAddress: '0x983110309620d911731ac0932219af06091b6744', category: ['external'] }] });
  const res = await road.fetch(`${LOCAL_RELAY}?u=${encodeURIComponent(target)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://base-mainnet.g.alchemy.com/v2/alc-TESTKEY-1']);
  // A direct read goes straight to its host, with no key and no relay.
  await road.fetch('https://eth.blockscout.com/api/v2/addresses/0x983110309620d911731ac0932219af06091b6744');
  assert.equal(seen[1], 'https://eth.blockscout.com/api/v2/addresses/0x983110309620d911731ac0932219af06091b6744');
  assert.ok(seen.every((u) => !u.includes('relay.invalid') && !u.includes('nymra')));
});

test('without keys there is no relay at all', () => {
  const road = createRoad({ keys: {} });
  assert.equal(road.kind, 'none');
  assert.equal(road.relay, undefined);
});

/** The real server, as Claude Code starts it: messages in, messages out, and what it wrote to stderr. */
function runServer(lines: object[], env: Record<string, string> = {}): Promise<{ out: any[]; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'server', 'main.ts')], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ out: out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)), err, code }));
    for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n');
    child.stdin.end();
  });
}

test('the real server: initialize, the two tools, a seed phrase refused, a clean exit and not one byte on stderr', async () => {
  const { out, err, code } = await runServer([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'scan_wallet', arguments: { wallet: SEED } } },
  ], { NYMRA_ALCHEMY_API_KEY: 'alc-TESTKEY-2' });
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.equal(out[0].result.serverInfo.name, 'nymra-privacy-scan');
  assert.deepEqual(out[1].result.tools.map((t: { name: string }) => t.name), ['scan_wallet', 'fix_plan']);
  assert.equal(out[2].result.isError, true);
  const all = JSON.stringify(out);
  assert.ok(!all.includes('abandon') && !all.includes('TESTKEY'));
});
