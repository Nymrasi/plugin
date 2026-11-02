import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTools, FAILED_TEXT, MEMO_MAX, MEMO_MS, TOOLS } from '../server/tools.ts';
import { fakeScanner, fixture, noFetch, SEED, VITALIK, vitalik } from './helpers.ts';

test('TOOLS: two tools, scan_wallet and fix_plan, both marked read only, both taking one wallet', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['scan_wallet', 'fix_plan']);
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
    assert.deepEqual(t.inputSchema.required, ['wallet']);
    assert.equal(t.inputSchema.additionalProperties, false);
  }
});

test('TOOLS: no Before you send and no Compare among the tools or in their words', () => {
  const words = JSON.stringify(TOOLS);
  assert.ok(!/before.you.send|compare/i.test(words));
});

test('scan_wallet: scans the address and gives the score text', async () => {
  const s = fakeScanner(fixture('bad'));
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: s });
  const r = await tools.call('scan_wallet', { wallet: VITALIK });
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.asked, [vitalik]);
  assert.match(r.content[0].text, /^\*\*Nymra Privacy Score: 36 of 100, Traceable\*\*/);
});

test('fix_plan right after scan_wallet reuses the scan: one scan for both', async () => {
  const s = fakeScanner(fixture('bad'));
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: s });
  await tools.call('scan_wallet', { wallet: VITALIK });
  const r = await tools.call('fix_plan', { wallet: vitalik });
  assert.equal(s.asked.length, 1);
  assert.match(r.content[0].text, /^\*\*Your fix plan\*\*/);
});

test('the memory forgets a scan after MEMO_MS and keeps at most MEMO_MAX wallets', async () => {
  let t = 0;
  const s = fakeScanner(fixture('good'));
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: s, now: () => t });
  await tools.call('scan_wallet', { wallet: VITALIK });
  t += MEMO_MS + 1;
  await tools.call('scan_wallet', { wallet: VITALIK });
  assert.equal(s.asked.length, 2);
  for (let i = 0; i < MEMO_MAX + 3; i++) await tools.call('scan_wallet', { wallet: `0x${String(i).padStart(40, '1')}` });
  assert.equal(tools.memo.size, MEMO_MAX);
});

test('fix_plan for a wallet without a score gives the scan words, not a plan', async () => {
  const r0 = fixture('bad');
  const con = { ...r0, addressType: 'contract' as const };
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(con) });
  const r = await tools.call('fix_plan', { wallet: VITALIK });
  assert.match(r.content[0].text, /contract, not a wallet/);
  assert.ok(!r.content[0].text.includes('fix plan**'));
});

test('a seed phrase is refused before any scan and is not in the answer', async () => {
  const s = fakeScanner(fixture('bad'));
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: s });
  const r = await tools.call('scan_wallet', { wallet: SEED });
  assert.equal(r.isError, true);
  assert.equal(s.asked.length, 0);
  assert.ok(!r.content[0].text.includes('abandon'));
});

test('a scan that throws gives the retry line, and nothing of the error', async () => {
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(new Error(`boom https://x.invalid/${vitalik}`)) });
  const r = await tools.call('scan_wallet', { wallet: VITALIK });
  assert.deepEqual(r, { content: [{ type: 'text', text: FAILED_TEXT }], isError: true });
});

test('an unknown tool is an error and scans nothing', async () => {
  const s = fakeScanner(fixture('bad'));
  const r = await createTools({ keys: {}, fetch: noFetch, scanner: s }).call('compare', { wallet: VITALIK });
  assert.equal(r.isError, true);
  assert.equal(s.asked.length, 0);
});

test('a key of the user never reaches an answer, even when a result carries it', async () => {
  const r0 = fixture('bad');
  const leak = { ...r0, findings: r0.findings.map((f, i) => (i === 0 ? { ...f, explanation: `${f.explanation} https://base-mainnet.g.alchemy.com/v2/alc-SECRET-77` } : f)) };
  const tools = createTools({ keys: { alchemy: 'alc-SECRET-77' }, fetch: noFetch, scanner: fakeScanner(leak) });
  const r = await tools.call('scan_wallet', { wallet: VITALIK });
  assert.ok(!r.content[0].text.includes('SECRET'));
  assert.ok(r.content[0].text.includes('[key]'));
});

test('progress per chain reaches the caller', async () => {
  const seen: Array<[number, number]> = [];
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(fixture('good'), 3) });
  await tools.call('scan_wallet', { wallet: VITALIK }, (d, t) => seen.push([d, t]));
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
});
