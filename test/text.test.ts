import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toModel } from '../vendor/scanbot/src/model.ts';
import type { ScanResult } from '../vendor/scanbot/vendor/privacy-scan/src/types.ts';
import { EVIDENCE_SHOWN, fixText, keyHint, scanText, SITE } from '../server/text.ts';
import { fixture } from './helpers.ts';

const ADDR = '0x983110309620d911731ac0932219af06091b6744';
const withAddr = (r: ScanResult): ScanResult => ({ ...r, address: ADDR });

/** The result with these chains not read (the explorer refused), the way a computer without keys sees them. */
function walled(r: ScanResult, names: string[]): ScanResult {
  const coverage = r.coverage.map((c, i) => (i < names.length ? { ...c, name: names[i], status: 'error' as const, error: 'the explorer asked for a bot check' } : c));
  return { ...withAddr(r), coverage, status: 'partial' };
}

const HOUSE = /[—–·]/; // em dash, en dash, middle dot

test('scanText: a score gives the number, the band, every costly finding costliest first, and the read line', () => {
  const r = withAddr(fixture('bad'));
  const t = scanText(r, toModel(r), {});
  assert.match(t, new RegExp(`^\\*\\*Nymra Privacy Score: ${r.score} of 100, Traceable\\*\\*`));
  const costly = r.findings.filter((f) => f.scoreImpact < 0).sort((a, b) => a.scoreImpact - b.scoreImpact);
  let at = -1;
  for (const f of costly) {
    const i = t.indexOf(`**${f.title}** (${f.scoreImpact} points`);
    assert.ok(i > at, `${f.id} in order`);
    at = i;
  }
  assert.match(t, /Active on \d+ EVM chains\./);
  assert.match(t, /fix_plan/);
});

test('scanText: costliest first also when the engine lists them otherwise', () => {
  const r = withAddr(fixture('bad'));
  const rev = { ...r, findings: [...r.findings].reverse() };
  const t = scanText(rev, toModel(rev), {});
  const pts = [...t.matchAll(/\*\* \((-\d+) points/g)].map((m) => Number(m[1]));
  assert.ok(pts.length >= 3);
  assert.deepEqual(pts, [...pts].sort((a, b) => a - b));
});

test('scanText: a chain only skipped (no key for it) leaves a partial score, says so, and names the key', () => {
  const r = { ...withAddr(fixture('bad')), status: 'partial' as const, incomplete: [{ part: 'skipped' as const, name: 'BNB Smart Chain', chainId: 56, reason: 'no key' }] } as ScanResult;
  const m = toModel(r);
  assert.equal(m.state, 'score');
  const t = scanText(r, m, {});
  assert.match(t, /\*\*Partial scan:\*\* BNB Smart Chain could not be read, so the score may be higher than it should be\./);
  assert.match(t, /- BNB Smart Chain: a NodeReal API key\./);
  assert.ok(!/[\u2014\u2013\u00b7]/.test(t));
  assert.match(fixText(r, m), /Part of the history could not be read \(BNB Smart Chain\), so this plan covers what was read\./);
});

test('scanText: evidence is shown per finding, at most EVIDENCE_SHOWN lines, the rest counted', () => {
  const r = withAddr(fixture('bad'));
  const f = r.findings.find((x) => x.scoreImpact < 0)!;
  const many = { ...r, findings: r.findings.map((x) => (x === f ? { ...x, evidence: Array.from({ length: 5 }, (_, i) => ({ kind: x.evidence[0]?.kind ?? 'tx', text: `proof ${i}`, url: `https://eth.blockscout.com/tx/0x${i}` })) } : x)) } as ScanResult;
  const t = scanText(many, toModel(many), {});
  for (let i = 0; i < EVIDENCE_SHOWN; i++) assert.ok(t.includes(`Evidence: proof ${i} https://eth.blockscout.com/tx/0x${i}`));
  assert.ok(!t.includes('proof 3'));
  assert.match(t, /2 more pieces of evidence/);
});

test('scanText: a linked wallet is a word with a percentage, never a claim of ownership', () => {
  const r = withAddr(fixture('bad'));
  const t = scanText(r, toModel(r), {});
  assert.match(t, /Linked wallet 0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}: (Likely|Possible|Weak) \d+%/);
  assert.match(t, /likelihoods, never proof of who owns a wallet/);
});

test('scanText: a wallet with no costly finding says nothing ties it, and still shows what it saw', () => {
  const r = withAddr(fixture('good'));
  const clean = { ...r, findings: r.findings.map((f) => ({ ...f, scoreImpact: 0 })) };
  const t = scanText(clean, toModel(clean), {});
  assert.match(t, /No finding cost a point/);
});

test('scanText: a walled chain withholds the number and names the key that reads it', () => {
  const r = walled(fixture('bad'), ['Base', 'Arbitrum One']);
  const m = toModel(r);
  assert.equal(m.state, 'incomplete');
  const t = scanText(r, m, {});
  assert.match(t, /^\*\*No score yet/);
  assert.ok(!/Privacy Score: \d/.test(t) && !t.includes(`${r.score} of 100`));
  assert.match(t, /Not read: Base, Arbitrum One\./);
  assert.match(t, /- Base: an Alchemy API key\. To get one, sign up at https:\/\/dashboard\.alchemy\.com\/signup/);
  assert.match(t, /- Arbitrum One: a Blockscout API key\. To get one, sign up at https:\/\/dev\.blockscout\.com/);
  assert.match(t, /\/plugin configure nymra-privacy-scan@nymra/);
  assert.match(t, /`NYMRA_ALCHEMY_API_KEY` and `NYMRA_BLOCKSCOUT_API_KEY` in your own shell profile/);
  assert.match(t, /Never paste a key into this chat/);
  const all = keyHint(['Base', 'Arbitrum One', 'BNB Smart Chain'], {})!;
  assert.match(all, /set `NYMRA_ALCHEMY_API_KEY`, `NYMRA_BLOCKSCOUT_API_KEY` and `NYMRA_NODEREAL_API_KEY` in your own shell profile/);
});

test('keyHint: a provider whose key is set gets no steps to get one; nothing to add gives nothing', () => {
  assert.equal(keyHint(['OP Mainnet'], { alchemy: 'set-123456' }), undefined);
  assert.equal(keyHint(['OP Mainnet'], {}), undefined);
  const h = keyHint(['Base', 'Polygon PoS', 'Arbitrum One', 'BNB Smart Chain'], { pro: 'set-123456' })!;
  assert.match(h, /- Base and Polygon PoS: an Alchemy API key\./);
  assert.match(h, /- BNB Smart Chain: a NodeReal API key\. To get one, sign up at https:\/\/nodereal\.io\/meganode/);
  // The Blockscout key is set: only its "still could not be read" line, no steps to get one.
  assert.match(h, /^Your Blockscout key is set, but Arbitrum One still could not be read\./);
  assert.ok(!h.includes('a Blockscout API key') && !h.includes('NYMRA_BLOCKSCOUT_API_KEY'));
  assert.ok(!h.includes('set-123456'));
  assert.ok(!/free/i.test(h));
});

test('keyHint: a key that is set while its chains still fail says so, without the key', () => {
  const h = keyHint(['Base', 'Polygon PoS'], { alchemy: 'set-123456' })!;
  assert.match(h, /^Your Alchemy key is set, but Base and Polygon PoS still could not be read\. Check the key/);
  assert.ok(!h.includes('set-123456') && !h.includes('Read the missing chains'));
});

test('scanText: a service, a contract and an unused address get words and no number', () => {
  const r = withAddr(fixture('bad'));
  const svc = { ...r, identity: { ...r.identity, service: { kind: 'exchange' as const, entity: 'Binance' } } } as ScanResult;
  assert.match(scanText(svc, toModel(svc), {}), /^\*\*This is an exchange wallet of Binance\.\*\*\nAddress: /);
  const con = { ...r, addressType: 'contract' as const };
  assert.match(scanText(con, toModel(con), {}), /^\*\*This address is a contract, not a wallet\.\*\*/);
  const un: ScanResult = { ...withAddr(fixture('good')), unused: true, findings: [] };
  const t = scanText(un, toModel(un), {});
  assert.match(t, /^\*\*Nothing to reveal yet\.\*\*/);
  for (const x of [svc, con]) assert.ok(!scanText(x, toModel(x), {}).includes(' of 100'));
});

test('scanText: the wallet line gives the ENS name and the full checksummed address', () => {
  const r = withAddr(fixture('bad'));
  const t = scanText(r, toModel(r, 'brantly.eth'), {}, 'brantly.eth');
  assert.ok(t.includes('Wallet: brantly.eth (0x983110309620D911731Ac0932219af06091b6744)'));
});

test('fixText: title, score now, win-back, sections in order, steps, absolute links, the honest line', () => {
  const r = withAddr(fixture('bad'));
  const t = fixText(r, toModel(r));
  assert.match(t, /^\*\*Your fix plan\*\*/);
  assert.match(t, new RegExp(`Nymra Privacy Score now: ${r.score} of 100\\.`));
  assert.match(t, /You can win back up to \d+ points today\. The score would then be \d+\.|Nothing here can be undone today/);
  const order = ['**Do today**', '**From now on**', '**On chain for good**'].map((h) => t.indexOf(h)).filter((i) => i >= 0);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(t, /Who can see it: /);
  assert.ok(t.includes(`More: ${SITE}/docs/findings/`));
  assert.ok(t.trim().endsWith('It does not make a wallet anonymous.'));
});

test('fixText: one point to win back reads "1 point"', () => {
  const r = withAddr(fixture('bad'));
  // A primary ENS name and nothing else that can be undone today: clearing it wins back exactly what it costs.
  const one = { ...r, score: 99, findings: [{ ...r.findings[0], id: 'public_identity.ens_reverse', key: 'public_identity.ens_reverse', detector: 'public_identity' as const, severity: 'low' as const, confidence: 0.25, scoreImpact: -1, rawImpact: -1, related: [] }], breakdown: undefined } as unknown as ScanResult;
  const t = fixText(one, toModel(one));
  assert.match(t, /You can win back up to 1 point today\. The score would then be 100\./);
  assert.ok(!/\b1 points\b/.test(t));
});

test('house rules: no em dash, en dash or middle dot in any answer, on every fixture and state', () => {
  for (const n of ['bad', 'average', 'good', 'worked-example'] as const) {
    const r = withAddr(fixture(n));
    assert.ok(!HOUSE.test(scanText(r, toModel(r), {})), `scan ${n}`);
    assert.ok(!HOUSE.test(fixText(r, toModel(r))), `fix ${n}`);
    const w = walled(fixture(n), ['Base', 'Polygon PoS']);
    assert.ok(!HOUSE.test(scanText(w, toModel(w), {})), `walled ${n}`);
  }
});
