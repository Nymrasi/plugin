// The hosted mode, for Nymra's online MCP server: same tools and guard, other words,
// and no memory of earlier scans. The local plugin's words stay as they are (the default).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toModel } from '../vendor/scanbot/src/model.ts';
import type { ScanResult } from '../vendor/scanbot/vendor/privacy-scan/src/types.ts';
import { INSTRUCTIONS, INSTRUCTIONS_HOSTED } from '../server/info.ts';
import { HOSTED_GAP, scanText } from '../server/text.ts';
import { createTools, hostedModel, TOOLS, toolsFor } from '../server/tools.ts';
import { API_KEY_TEXT, API_KEY_TEXT_HOSTED, readWallet } from '../server/wallet.ts';
import { fakeScanner, fixture, noFetch, VITALIK, vitalik } from './helpers.ts';

const walled = (): ScanResult => {
  const r = { ...fixture('bad'), address: vitalik };
  return { ...r, status: 'partial', coverage: r.coverage.map((c, i) => (i === 0 ? { ...c, name: 'Base', status: 'error' as const } : c)) };
};

test('hosted tools: one tool, scan_wallet, read only with a title; its words say the server sees the address, keeps nothing, and the fix plan comes along', () => {
  const h = toolsFor('hosted');
  assert.deepEqual(h.map((t) => t.name), ['scan_wallet']);
  assert.deepEqual(h[0].inputSchema, TOOLS[0].inputSchema);
  assert.deepEqual(h[0].annotations, TOOLS[0].annotations);
  assert.equal(h[0].annotations.readOnlyHint, true);
  assert.equal(h[0].annotations.title, 'Nymra Privacy Scan');
  assert.match(h[0].description, /runs on Nymra's server, which sees the address it scans and keeps nothing: no log, no database, no cache/);
  assert.match(h[0].description, /in one answer, its Nymra Privacy Score .* and the fix plan/);
  assert.ok(!h[0].description.includes('runs on this computer'));
  assert.deepEqual(toolsFor('local'), TOOLS);
  assert.equal(TOOLS.length, 2);
});

test('hosted words: scan at once, as written, never ask the user to confirm the wallet first', () => {
  assert.match(toolsFor('hosted')[0].description, /Call it right away with the wallet exactly as the user wrote it, a 0x address or a name such as vitalik\.eth, also when it appears in a longer question; never ask the user to confirm or repeat the wallet first\./);
  assert.match(INSTRUCTIONS_HOSTED, /call scan_wallet at once with it as written; do not ask them to confirm it first/);
  assert.ok(!/confirm/.test(TOOLS.map((t) => t.description).join(' ')), 'the local words stay as they were');
});

test('hosted instructions name the server and its promise, and ask for no key', () => {
  assert.match(INSTRUCTIONS_HOSTED, /it runs on Nymra's server, which sees the address it scans and keeps nothing/);
  assert.match(INSTRUCTIONS_HOSTED, /Never ask for a seed phrase, a private key, an API key or a signature/);
  assert.ok(!INSTRUCTIONS_HOSTED.includes('run on this computer'));
  assert.match(INSTRUCTIONS, /run on this computer/);
});

test('hosted: scan_wallet answers with the score, the findings and the fix plan, from one scan', async () => {
  const s = fakeScanner(fixture('bad'));
  const out = await createTools({ keys: {}, fetch: noFetch, scanner: s, mode: 'hosted' }).call('scan_wallet', { wallet: VITALIK });
  const t = out.content[0].text;
  assert.equal(s.asked.length, 1);
  assert.match(t, /^\*\*Nymra Privacy Score: 36 of 100, Traceable\*\*/);
  const plan = t.indexOf('**Your fix plan**');
  assert.ok(plan > t.indexOf('**Findings, costliest first**'));
  assert.ok(t.trim().endsWith('It does not make a wallet anonymous.'));
  assert.ok(!t.includes('fix_plan tool'), 'no pointer to a second tool');
});

test('hosted: a wallet without a score answers with its words, without a plan', async () => {
  const con = { ...fixture('bad'), addressType: 'contract' as const };
  const t = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(con), mode: 'hosted' }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.match(t, /contract, not a wallet/);
  assert.ok(!t.includes('Your fix plan'));
});

test('local: scan_wallet still answers without the plan and points at fix_plan (the plugin is unchanged)', async () => {
  const t = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(fixture('bad')) }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.ok(!t.includes('Your fix plan'));
  assert.match(t, /The fix plan \(the fix_plan tool\) shows/);
});

test('hosted: a chain not read says to scan again, never to bring a key', () => {
  const r = walled();
  const t = scanText(r, toModel(r), {}, undefined, 'hosted');
  assert.match(t, /^\*\*No score yet/);
  assert.ok(t.includes(HOSTED_GAP));
  assert.ok(!/key of your own|plugin configure|NYMRA_[A-Z]+_API_KEY|shell profile/.test(t));
  // The local words for the same result still give the key steps.
  assert.match(scanText(r, toModel(r), {}), /key of your own/);
});

test('hosted: a pasted API key gets the hosted text, which points at no plugin setting', async () => {
  const k = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY';
  assert.deepEqual(await readWallet(k, noFetch, 'hosted'), { kind: 'refused', message: API_KEY_TEXT_HOSTED });
  assert.deepEqual(await readWallet(k, noFetch), { kind: 'refused', message: API_KEY_TEXT });
  assert.ok(!API_KEY_TEXT_HOSTED.includes(k) && !API_KEY_TEXT_HOSTED.includes('/plugin'));
  assert.match(API_KEY_TEXT_HOSTED, /This scan needs no key/);
});

test('hosted: the tool itself answers a pasted key with the hosted text', async () => {
  const s = fakeScanner(fixture('bad'));
  const out = await createTools({ keys: {}, fetch: noFetch, scanner: s, mode: 'hosted' }).call('scan_wallet', { wallet: 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY' });
  assert.deepEqual(out, { content: [{ type: 'text', text: API_KEY_TEXT_HOSTED }], isError: true });
  assert.equal(s.asked.length, 0);
});

test('hosted: no memory of earlier scans, so a fix plan right after a scan scans again', async () => {
  const s = fakeScanner(fixture('bad'));
  const tools = createTools({ keys: {}, fetch: noFetch, scanner: s, mode: 'hosted' });
  await tools.call('scan_wallet', { wallet: VITALIK });
  await tools.call('fix_plan', { wallet: VITALIK });
  assert.equal(s.asked.length, 2);
  assert.equal(tools.memo.size, 0);
});

test('hosted: the tool answer for a walled chain carries the hosted line, and the server keys are scrubbed', async () => {
  const r = walled();
  const leak = { ...r, findings: r.findings.map((f, i) => (i === 0 ? { ...f, explanation: `${f.explanation} relay-KEY-123456` } : f)) };
  const tools = createTools({ keys: { alchemy: 'relay-KEY-123456' }, fetch: noFetch, scanner: fakeScanner(leak), mode: 'hosted' });
  const out = await tools.call('scan_wallet', { wallet: VITALIK });
  assert.ok(out.content[0].text.includes(HOSTED_GAP));
  assert.ok(!out.content[0].text.includes('KEY-123456'));
});

// 23-10, his vitalik.eth in ChatGPT: Arbitrum's token list slow, the funder and deposit checks cut by the time limit.
const cut = (parts: Array<{ part: string; name: string }>, chainError = false): ScanResult => {
  const r = { ...fixture('bad'), address: vitalik };
  return {
    ...r,
    status: 'partial',
    coverage: chainError ? r.coverage.map((c, i) => (i === 0 ? { ...c, name: 'Arbitrum One', status: 'error' as const } : c)) : r.coverage,
    incomplete: parts.map((p) => ({ ...p, chainId: 42161, reason: 'time limit' })),
  } as unknown as ScanResult;
};
const VITALIK_CUT = [{ part: 'tokens', name: 'Arbitrum One' }, { part: 'lookups', name: 'Funder and deposit checks' }];

test('hostedModel: only the funder and deposit checks cut gives a partial score; the local rule keeps no score', () => {
  const r = cut(VITALIK_CUT);
  assert.equal(toModel(r).state, 'incomplete');
  const h = hostedModel(r, toModel(r));
  assert.equal(h.state, 'score');
  assert.equal(h.partial, true);
});

test('hostedModel: a chain not read, the identity read cut, the time limit on chains, or a chain error still give no score', () => {
  for (const parts of [
    [...VITALIK_CUT, { part: 'chain', name: 'Arbitrum One' }],
    [...VITALIK_CUT, { part: 'identity', name: 'ENS name and labels' }],
    [...VITALIK_CUT, { part: 'aborted', name: 'chains' }],
  ]) {
    const r = cut(parts);
    assert.equal(hostedModel(r, toModel(r)).state, 'incomplete', parts.map((p) => p.part).join(','));
  }
  const err = cut(VITALIK_CUT, true);
  assert.equal(hostedModel(err, toModel(err)).state, 'incomplete');
  const svc = { ...fixture('bad'), addressType: 'contract' as const };
  assert.equal(hostedModel(svc, toModel(svc)).state, 'contract');
});

test('hosted scan_wallet on the vitalik case: the score, the partial line naming the cut parts, the fix plan; the local plugin says no score', async () => {
  const r = cut(VITALIK_CUT);
  const hosted = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(r), mode: 'hosted' }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.match(hosted, /^\*\*Nymra Privacy Score: 36 of 100, Traceable\*\*/);
  assert.match(hosted, /\*\*Partial scan:\*\* parts of Arbitrum One, funder and deposit checks could not be read, so the score may be higher than it should be\./);
  assert.ok(hosted.includes(HOSTED_GAP));
  assert.ok(hosted.includes('**Your fix plan**'));
  const local = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(r) }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.match(local, /^\*\*No score yet/);
});

// 23-10, sassal.eth: OP Mainnet read, but its explorer lists 32 of the 41 transactions the node counts.
const indexGap = (status: 'partial' | 'error'): ScanResult => {
  const r = { ...fixture('bad'), address: vitalik };
  return {
    ...r,
    status: 'partial',
    coverage: r.coverage.map((c, i) => (i === 0 ? { ...c, chainId: 10, name: 'OP Mainnet', status } : c)),
    incomplete: [{ part: 'chain', chainId: 10, name: 'OP Mainnet', reason: 'OP Mainnet: transactions could not be read (the explorer lists 32 of the 41 this address sent here)' }],
  } as unknown as ScanResult;
};

test('hostedModel: a chain read in part (explorer index gap) keeps the score as "parts of" that chain; a chain error does not', () => {
  const r = indexGap('partial');
  assert.equal(toModel(r).state, 'incomplete');
  const h = hostedModel(r, toModel(r));
  assert.equal(h.state, 'score');
  assert.deepEqual(h.coverage.failed, []);
  assert.ok(h.coverage.partly.includes('parts of OP Mainnet'));
  const e = indexGap('error');
  assert.equal(hostedModel(e, toModel(e)).state, 'incomplete');
});

test('hosted scan_wallet on the sassal case: score, "parts of OP Mainnet" in the partial line, fix plan; local says no score', async () => {
  const r = indexGap('partial');
  const t = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(r), mode: 'hosted' }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.match(t, /^\*\*Nymra Privacy Score: 36 of 100/);
  assert.match(t, /\*\*Partial scan:\*\* parts of OP Mainnet could not be read, so the score may be higher than it should be\./);
  assert.ok(t.includes('**Your fix plan**'));
  const local = (await createTools({ keys: {}, fetch: noFetch, scanner: fakeScanner(r) }).call('scan_wallet', { wallet: VITALIK })).content[0].text;
  assert.match(local, /^\*\*No score yet/);
});
