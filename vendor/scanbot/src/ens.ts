// Forward ENS lookup (name to address), the same two roads as the site (web/src/terminal/ens.ts):
// 1. a public Ethereum RPC: registry.resolver(node), then resolver.addr(node);
// 2. when that finds nothing or reverts (offchain names such as name.base.eth use CCIP-read),
//    Blockscout's ENS service (BENS), which the scan engine also uses for identity.
// Names are lowercased, not fully ENSIP-15 normalized.
import { keccak_256 } from '../../noble-hashes/sha3.js';

const REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
const SEL_RESOLVER = '0178b8bf';
const SEL_ADDR = '3b3b57de';
const ZERO = /^0x0*$/;
const BENS = 'https://bens.services.blockscout.com/api/v1/1';
export const ETH_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'];

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function namehash(name: string): string {
  let node = new Uint8Array(32);
  const labels = name ? name.split('.') : [];
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = keccak_256(new TextEncoder().encode(labels[i]));
    const buf = new Uint8Array(64);
    buf.set(node, 0);
    buf.set(label, 32);
    node = keccak_256(buf);
  }
  return hex(node);
}

export class EnsError extends Error {
  constructor() {
    super('ENS lookup did not answer');
    this.name = 'EnsError';
  }
}

async function ethCall(f: typeof fetch, to: string, data: string): Promise<string> {
  for (const rpc of ETH_RPCS) {
    try {
      const res = await f(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = (await res.json()) as { result?: unknown };
      if (typeof j.result === 'string') return j.result;
    } catch { /* next RPC */ }
  }
  throw new EnsError();
}

async function viaRegistry(f: typeof fetch, name: string): Promise<string | null> {
  const node = namehash(name);
  const resolverWord = await ethCall(f, REGISTRY, `0x${SEL_RESOLVER}${node}`);
  if (ZERO.test(resolverWord)) return null;
  const addrWord = await ethCall(f, `0x${resolverWord.slice(-40)}`, `0x${SEL_ADDR}${node}`);
  if (ZERO.test(addrWord) || addrWord.length < 66) return null;
  return `0x${addrWord.slice(-40)}`.toLowerCase();
}

async function viaBens(f: typeof fetch, name: string): Promise<string | null> {
  const res = await f(`${BENS}/domains/${encodeURIComponent(name)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new EnsError();
  const j = (await res.json()) as { resolved_address?: string | { hash?: string } };
  const a = typeof j?.resolved_address === 'object' ? j.resolved_address?.hash : j?.resolved_address;
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
}

/** The lowercase address, or null when the name has no address. Throws EnsError when no road answered. */
export async function resolveEns(name: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string | null> {
  let registryAnswered = false;
  try {
    const a = await viaRegistry(f, name);
    if (a) return a;
    registryAnswered = true;
  } catch { /* reverted (offchain name) or no RPC answered: try BENS */ }
  try {
    return await viaBens(f, name);
  } catch {
    if (registryAnswered) return null;
    throw new EnsError();
  }
}
