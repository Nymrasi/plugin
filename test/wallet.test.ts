import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_KEY_TEXT, looksLikeApiKey, looksSecret, readWallet, SECRET_TEXT } from '../server/wallet.ts';
import { ensFetch, noFetch, SEED, VITALIK, vitalik } from './helpers.ts';

test('readWallet: an address in any case gives the lowercase address, without a lookup', async () => {
  assert.deepEqual(await readWallet(VITALIK, noFetch), { kind: 'address', address: vitalik });
  assert.deepEqual(await readWallet(vitalik, noFetch), { kind: 'address', address: vitalik });
});

test('readWallet: an explorer link with one address in it counts as that address', async () => {
  assert.deepEqual(await readWallet(`https://etherscan.io/address/${VITALIK}`, noFetch), { kind: 'address', address: vitalik });
});

test('readWallet: a seed phrase is refused, never repeated, never looked up', async () => {
  const w = await readWallet(SEED, noFetch);
  assert.equal(w.kind, 'refused');
  assert.equal((w as { message: string }).message, SECRET_TEXT);
  assert.ok(!SECRET_TEXT.includes('abandon'));
  // 24 words, in capitals or on several lines, too
  assert.equal((await readWallet(`${SEED} ${SEED}`.toUpperCase(), noFetch)).kind, 'refused');
  assert.equal((await readWallet(SEED.replaceAll(' ', '\n'), noFetch)).kind, 'refused');
});

test('readWallet: a private key (64 hex without 0x) is refused with the secret text', async () => {
  const w = await readWallet('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', noFetch);
  assert.deepEqual(w, { kind: 'refused', message: SECRET_TEXT });
});

test('readWallet: an API key is refused with the key text, never repeated, never looked up', async () => {
  // Made-up values in the shapes of Alchemy, Blockscout, NodeReal and Etherscan keys.
  for (const k of ['aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY', 'proapi_9f8e7d6c5b4a39281706f5e4d3c2b1a0', '0123456789abcdef0123456789abcdef', 'ABCD1234EFGH5678IJKL9012MNOP3456QR']) {
    const w = await readWallet(k, noFetch);
    assert.deepEqual(w, { kind: 'refused', message: API_KEY_TEXT }, k);
    assert.ok(!API_KEY_TEXT.includes(k));
  }
  assert.match(API_KEY_TEXT, /\/plugin configure nymra-privacy-scan@nymra/);
  assert.match(API_KEY_TEXT, /make a new key/);
});

test('readWallet: a real Solana address (44 characters) still gets the Solana answer', async () => {
  const w = await readWallet('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', noFetch);
  assert.match((w as { message: string }).message, /Solana/);
});

test('looksLikeApiKey: an address with or without 0x, a name or a word is no key', () => {
  assert.equal(looksLikeApiKey(VITALIK), false);
  assert.equal(looksLikeApiKey(VITALIK.slice(2)), false);
  assert.equal(looksLikeApiKey('vitalik.eth'), false);
  assert.equal(looksLikeApiKey('supercalifragilisticexpialidocious'), false); // letters only
  assert.equal(looksLikeApiKey('a1b2c3'), false); // too short
});

test('looksSecret: an address, a name or a short sentence is no secret', () => {
  assert.equal(looksSecret(VITALIK), false);
  assert.equal(looksSecret('vitalik.eth'), false);
  assert.equal(looksSecret('scan this wallet please'), false);
  assert.equal(looksSecret('one two three four five six seven eight nine ten eleven'), false); // 11 words
});

test('readWallet: a typo, a transaction hash, a Bitcoin address and nothing are refused with a reason', async () => {
  const typo = await readWallet(VITALIK.replace('dA6', 'Da6'), noFetch);
  assert.match((typo as { message: string }).message, /typo/);
  assert.match(((await readWallet(`0x${'ab'.repeat(32)}`, noFetch)) as { message: string }).message, /transaction hash/);
  assert.match(((await readWallet('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', noFetch)) as { message: string }).message, /Bitcoin/);
  for (const empty of ['', '   ', undefined, 42, null]) assert.equal((await readWallet(empty, noFetch)).kind, 'refused');
  // Past 400 characters nothing is read, also when one address stands inside.
  const long = `see ${'a'.repeat(380)} ${VITALIK}`;
  assert.ok(long.length > 400);
  assert.equal((await readWallet(long, noFetch)).kind, 'refused');
});

test('readWallet: an ENS name is resolved on a public Ethereum node and keeps its name', async () => {
  const { f, calls } = ensFetch(vitalik);
  assert.deepEqual(await readWallet('vitalik.eth', f), { kind: 'address', address: vitalik, name: 'vitalik.eth' });
  assert.ok(calls.length >= 2 && calls.every((u) => /^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)/.test(u)));
});

test('readWallet: a name without an address says so', async () => {
  const { f } = ensFetch(null);
  const w = await readWallet('nobody-here.eth', f);
  assert.equal(w.kind, 'refused');
  assert.match((w as { message: string }).message, /points to no address/);
});

test('readWallet: no ENS road answering gives a retry line, not a crash', async () => {
  const down = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const w = await readWallet('vitalik.eth', down);
  assert.equal(w.kind, 'refused');
  assert.match((w as { message: string }).message, /did not answer/);
});
