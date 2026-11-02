// From the `wallet` argument of a tool call to one lowercase address: the bot's own parser (an address, an
// explorer link with one address in it, or an ENS name), with a guard in front of it for a seed phrase or a
// private key, which is refused and never repeated.
import { EnsError, resolveEns } from '../vendor/scanbot/src/ens.ts';
import { parseTarget } from '../vendor/scanbot/src/parse.ts';

export type Wallet =
  | { kind: 'address'; address: string; name?: string }
  | { kind: 'refused'; message: string };

/** 12 to 24 lowercase words: the shape of a seed phrase (BIP-39 uses 12, 15, 18, 21 or 24). */
const SEED = /^(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}$/;
/** 64 hex characters without 0x: the shape of a private key. With 0x the parser reads a transaction hash. */
const KEY = /^[0-9a-fA-F]{64}$/;

/**
 * One word of 20 to 80 letters, digits, `-` or `_` with both letters and digits in it: the shape of an API key
 * (Alchemy, NodeReal, Etherscan, Blockscout's proapi_...). An address, with or without its 0x, and a
 * transaction hash are not one: the parser answers those.
 */
const API_KEY = /^[A-Za-z0-9_-]{20,80}$/;
const HEXISH = /^(0x)?[0-9a-fA-F]{40}$|^0x/i;

export const API_KEY_TEXT =
  "That looks like an API key. A key never goes in the chat: everything typed here reaches the AI provider. It was not used or repeated here. Put the key in the plugin's settings instead (in Claude Code: /plugin configure nymra-privacy-scan@nymra), and since this one passed through the chat, make a new key at its provider and delete this one. For a scan, give the wallet address (0x...) or its ENS name.";

/** The same, on Nymra's online server, which needs no key from anyone. */
export const API_KEY_TEXT_HOSTED =
  'That looks like an API key. This scan needs no key, and a key never goes in the chat: everything typed here reaches the AI provider. It was not used or repeated here. Since it passed through the chat, make a new key at its provider and delete this one. For a scan, give the wallet address (0x...) or its ENS name.';

/** The parser's answer for something that is no wallet at all (vendor/scanbot/src/parse.ts). */
export const NOT_A_WALLET = 'That is not an EVM address or an ENS name. Try 0x... or name.eth.';

const SOLANA = 'That looks like a Solana address. Nymra scans EVM wallets only.';

export function looksLikeApiKey(raw: string): boolean {
  const t = raw.trim();
  return API_KEY.test(t) && /[0-9]/.test(t) && /[A-Za-z]/.test(t) && !HEXISH.test(t);
}

export const SECRET_TEXT =
  'That looks like a seed phrase or a private key. Never share it with anyone, an AI assistant included. It was not scanned or repeated here. It did pass through this chat, so if it is real, treat it as leaked: move the funds to a new wallet now. For a scan, give the wallet address (0x...) or its ENS name.';

export function looksSecret(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, ' ');
  return SEED.test(t.toLowerCase()) || KEY.test(t);
}

export async function readWallet(raw: unknown, f: typeof fetch, mode: 'local' | 'hosted' = 'local'): Promise<Wallet> {
  if (typeof raw !== 'string' || !raw.trim()) return { kind: 'refused', message: 'Give one EVM wallet: an address (0x...) or an ENS name (name.eth).' };
  if (raw.length > 400) return { kind: 'refused', message: 'Give one EVM wallet: an address (0x...) or an ENS name (name.eth).' };
  if (looksSecret(raw)) return { kind: 'refused', message: SECRET_TEXT };
  const t = parseTarget(raw);
  // What the parser recognises (a Bitcoin address, a hash) it names; what it cannot read may be a key. A Solana
  // address is 43 or 44 characters nearly always, an Alchemy key 32: a "Solana address" under 40 is read as a key.
  if (t.kind === 'error') {
    const keyish = looksLikeApiKey(raw) && (t.message === NOT_A_WALLET || (t.message === SOLANA && raw.trim().length < 40));
    return { kind: 'refused', message: keyish ? (mode === 'hosted' ? API_KEY_TEXT_HOSTED : API_KEY_TEXT) : t.message };
  }
  if (t.kind === 'address') return { kind: 'address', address: t.address };
  try {
    const address = await resolveEns(t.name, f);
    if (!address) return { kind: 'refused', message: `${t.name} points to no address. Check the name, or give the 0x address.` };
    return { kind: 'address', address, name: t.name };
  } catch (e) {
    if (e instanceof EnsError) return { kind: 'refused', message: 'The ENS lookup did not answer. Try again in a minute, or give the 0x address.' };
    throw e;
  }
}
