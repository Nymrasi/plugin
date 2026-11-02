import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scanner } from '../vendor/scanbot/src/scanner.ts';
import type { ScanResult } from '../vendor/scanbot/vendor/privacy-scan/src/types.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'vendor', 'scanbot', 'vendor', 'privacy-scan', 'fixtures');
export const fixture = (n: 'bad' | 'average' | 'good' | 'worked-example'): ScanResult => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf8'));
export const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

export const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
export const vitalik = VITALIK.toLowerCase();
/** The 12-word test vector of BIP-39 ("abandon" x11 + "about"): a seed phrase that holds nothing. */
export const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** A scanner that answers with a fixture (or throws), and remembers what it was asked. */
export function fakeScanner(result: ScanResult | Error, onChain = 0) {
  const asked: string[] = [];
  const s: Scanner & { asked: string[] } = {
    asked,
    chainCount: 15,
    road: 'none',
    async scan(address, progress) {
      asked.push(address);
      for (let i = 1; i <= onChain; i++) progress?.(i, onChain);
      if (result instanceof Error) throw result;
      return { ...result, address };
    },
  };
  return s;
}

/** A fetch that must never be called (no ENS lookup, no network). */
export const noFetch = (async () => { throw new Error('no network in this test'); }) as unknown as typeof fetch;

/** A fetch that answers an ENS registry lookup for one name with one address (eth_call on the public RPC). */
export function ensFetch(address: string | null) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const data: string = body.params?.[0]?.data ?? '';
    // resolver(node) answers a resolver; addr(node) answers the address (or zero: no address).
    const word = data.startsWith('0x0178b8bf') ? '0x' + '0'.repeat(24) + '4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41'
      : '0x' + '0'.repeat(24) + (address ? address.slice(2) : '0'.repeat(40));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: word }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
