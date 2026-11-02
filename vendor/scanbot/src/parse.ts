// What did the person ask for? Commands (/scan, /start, /help, /privacy), and the wallet inside them.
// Wallet parsing follows the site (web/src/terminal/util.ts parseQuery) word for word where it can,
// so the bot and the terminal accept and refuse the same things, plus two chat habits: an explorer
// link, and a sentence with one address in it.
import { keccak_256 } from '../../noble-hashes/sha3.js';

export type Target =
  | { kind: 'address'; address: string }
  | { kind: 'ens'; name: string }
  | { kind: 'error'; message: string };

const HEX40 = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/** EIP-55: a mixed-case address encodes a checksum in its capitals. */
export function checksumOk(addr: string): boolean {
  const hex = addr.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = keccak_256(new TextEncoder().encode(hex.toLowerCase()));
  for (let i = 0; i < 40; i++) {
    const c = hex[i];
    if (!/[a-f]/i.test(c)) continue;
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    if (nibble >= 8 ? c !== c.toUpperCase() : c !== c.toLowerCase()) return false;
  }
  return true;
}

function tidy(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '') // zero-width characters from copy and paste
    .trim()
    .replace(/^[`'"<(\[]+|[`'">)\].,;!?]+$/g, '')
    .trim();
}

export function parseTarget(raw: string): Target {
  const q = tidy(raw).replace(/^ethereum:/i, '').replace(/@\d+$/, '');
  if (!q) return { kind: 'error', message: 'Send an address (0x...) or an ENS name (name.eth).' };

  // An explorer link or a sentence: exactly one address inside it counts.
  if (!/^0x[0-9a-fA-F]*$/.test(q)) {
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) return { kind: 'error', message: 'That is a transaction hash, not a wallet. Send the address instead.' };
    const found = [...new Set(q.match(HEX40) ?? [])];
    if (/\/tx\/0x[0-9a-fA-F]{64}/.test(q)) return { kind: 'error', message: 'That is a link to a transaction, not a wallet. Send the address instead.' };
    if (found.length === 1) return parseTarget(found[0]);
    if (found.length > 1) return { kind: 'error', message: 'That has more than one address in it. Send one at a time.' };
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    if (!checksumOk(q)) return { kind: 'error', message: 'This address has a typo: its capital letters do not match its checksum. Copy it again from the source.' };
    return { kind: 'address', address: q.toLowerCase() };
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) return { kind: 'error', message: 'That is a transaction hash, not a wallet. Send the address instead.' };
  if (/^0x[0-9a-fA-F]*$/i.test(q)) return { kind: 'error', message: `An EVM address is 0x and 40 characters; this one has ${q.length - 2}.` };
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(q)) return { kind: 'error', message: 'That looks like a Bitcoin address. Nymra scans EVM wallets only.' };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) return { kind: 'error', message: 'That looks like a Solana address. Nymra scans EVM wallets only.' };
  if (q.length <= 255 && /^[^\s/@:]+\.[a-z0-9-]{2,}$/i.test(q)) return { kind: 'ens', name: q.toLowerCase() };
  return { kind: 'error', message: 'That is not an EVM address or an ENS name. Try 0x... or name.eth.' };
}

export interface Entity { type: string; offset: number; length: number }

export interface Command {
  /** Lowercase, without the slash and without @botname. */
  name: string;
  /** Everything after the command, trimmed. */
  args: string;
}

/**
 * The command at the start of a message, or null. A command addressed to another bot
 * (/scan@OtherBot) is not ours and returns null.
 */
export function readCommand(text: string | undefined, entities: Entity[] | undefined, botUsername: string): Command | null {
  if (!text) return null;
  const e = (entities ?? []).find((x) => x.type === 'bot_command' && x.offset === 0);
  const head = e ? text.slice(0, e.length) : text.match(/^\/[A-Za-z0-9_]{1,32}(@[A-Za-z0-9_]{3,64})?/)?.[0];
  if (!head || !head.startsWith('/')) return null;
  const [name, to] = head.slice(1).split('@');
  if (to && to.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: name.toLowerCase(), args: text.slice(head.length).trim() };
}

/**
 * One of `words` written alone, without the slash, in any case ("ca", "Help"; his words 16-10 22:20):
 * the whole message, never a word inside a sentence. "ca" may carry one more part (an admin's address).
 */
export function readWord(text: string | undefined, words: ReadonlySet<string>): Command | null {
  const m = text?.trim().match(/^([A-Za-z]{1,32})(?:\s+(\S+))?$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!words.has(name) || (m[2] && name !== 'ca')) return null;
  return { name, args: m[2] ?? '' };
}

/** Deep link payload: t.me/<bot>?start=scan_0x... (Telegram allows A-Z, a-z, 0-9, _ and -, 64 max). */
export function startPayload(address: string): string {
  return `scan_${address.toLowerCase()}`;
}

export function readStartPayload(args: string): string | null {
  const m = args.match(/^scan_(0x[0-9a-f]{40})$/i);
  return m ? m[1].toLowerCase() : null;
}
