// The two tools: scan_wallet (the Privacy Score, every finding with its evidence, the linked wallets) and
// fix_plan (what can be undone today, what to change from now on, what is on chain for good). Both read only.
// The scan runs in this process with the bot's scanner (vendor/scanbot/src/scanner.ts): it reads public
// explorers and nodes directly, and with a key of the user's own, the chains that need one through a relay
// that lives inside this process and never leaves it (vendor/scanbot/src/relay.ts, the local road).
//
// The last results stay in memory for ten minutes, so a fix plan right after a scan costs no second scan.
// Nothing is written anywhere: no file, no log line, no telemetry.
import { toModel, type CardModel } from '../vendor/scanbot/src/model.ts';
import { createScanner, type Scanner } from '../vendor/scanbot/src/scanner.ts';
import type { ScanResult } from '../vendor/scanbot/vendor/privacy-scan/src/types.ts';
import { scrub, type UserKeys } from './keys.ts';
import { fixText, scanText } from './text.ts';
import { readWallet } from './wallet.ts';

export const SCAN_TIMEOUT_MS = 150_000;
export const MEMO_MS = 10 * 60_000;
export const MEMO_MAX = 8;

const WALLET_SCHEMA = {
  type: 'object',
  properties: {
    wallet: { type: 'string', description: 'One EVM wallet: a 0x address with 40 hex characters, or an ENS name such as vitalik.eth.' },
  },
  required: ['wallet'],
  additionalProperties: false,
} as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/**
 * Where the scan runs. `local`: the plugin, on the user's own computer (the default). `hosted`: Nymra's online
 * MCP server, which scans with the relay's own keys, so the user needs none, and which sees the address it scans
 * and keeps nothing. Only the words differ; the tools, the guard and the scan are the same.
 */
export type Mode = 'local' | 'hosted';

const WHERE: Record<Mode, string> = {
  local: 'The scan runs on this computer and reads public block explorers and nodes directly; it only reads',
  hosted: "The scan runs on Nymra's server, which sees the address it scans and keeps nothing: no log, no database, no cache. It only reads",
};
const REUSE: Record<Mode, string> = {
  local: 'Uses a scan of the last ten minutes, or runs one.',
  hosted: 'Runs a fresh scan: the server keeps no earlier result.',
};

/** Hosted: scan at once, as written. A question back ("vitalik.eth?") costs the user a turn and a confirmation. */
const AT_ONCE =
  'Call it right away with the wallet exactly as the user wrote it, a 0x address or a name such as vitalik.eth, also when it appears in a longer question; never ask the user to confirm or repeat the wallet first.';

export function toolsFor(mode: Mode) {
  if (mode === 'hosted') {
    // One tool, one call, one confirmation: the answer holds the score, every finding and the fix plan.
    return [
      {
        name: 'scan_wallet',
        title: 'Nymra Privacy Scan',
        description:
          `Scan an EVM wallet and get, in one answer, its Nymra Privacy Score from 0 to 100, every finding that costs points with the evidence behind it, the wallets it is likely linked to, which chains were read, and the fix plan: what can be undone today and how many points that wins back, what to change from now on, and what is on chain for good. ${AT_ONCE} ${WHERE.hosted}, and never needs a seed phrase, a private key or a signature. A scan takes about 20 seconds to 2 minutes. A link between wallets is a likelihood with a confidence, never proof of who owns a wallet.`,
        inputSchema: WALLET_SCHEMA,
        annotations: { title: 'Nymra Privacy Scan', ...READ_ONLY },
      },
    ];
  }
  return [
    {
      name: 'scan_wallet',
      title: 'Nymra Privacy Scan',
      description:
        `Scan an EVM wallet and get its Nymra Privacy Score from 0 to 100: every finding that costs points, with the evidence behind it, the wallets it is likely linked to, and which chains were read. Give a 0x address or an ENS name. ${WHERE[mode]}, and never needs a seed phrase, a private key or a signature. A scan takes about 20 seconds to 2 minutes. A link between wallets is a likelihood with a confidence, never proof of who owns a wallet.`,
      inputSchema: WALLET_SCHEMA,
      annotations: { title: 'Nymra Privacy Scan', ...READ_ONLY },
    },
    {
      name: 'fix_plan',
      title: 'Nymra fix plan',
      description:
        `The Nymra fix plan for an EVM wallet: what its owner can undo today and how many points of the Privacy Score that wins back, what to do differently from now on, and what is on chain for good, with who can see each leak and the steps to take. Give a 0x address or an ENS name. ${REUSE[mode]}`,
      inputSchema: WALLET_SCHEMA,
      annotations: { title: 'Nymra fix plan', ...READ_ONLY },
    },
  ];
}

export const TOOLS = toolsFor('local');

/**
 * Hosted only: two hard gaps keep the score, marked partial with the gap named, because what is missing can only
 * leave out points ("the score may be higher than it should be"):
 *   - the funder and deposit checks, which run last and are the part the server's time limit cuts first (23-10:
 *     Arbitrum's token list took 18 to 22 s a page; his vitalik.eth in ChatGPT got no score);
 *   - a chain that was read but whose explorer lists fewer transactions than its node counts (23-10: sassal.eth on
 *     OP Mainnet, 32 of 41); it reads "parts of <chain>".
 * A chain that could not be read (an error), the identity read cut short (the named-wallet ceiling) or the time
 * limit on chains still leave no score. The local plugin keeps the house rule of the site and the bot unchanged.
 */
export function hostedModel(r: ScanResult, m: CardModel): CardModel {
  if (m.state !== 'incomplete') return m;
  if (r.coverage.some((c) => c.status === 'error')) return m;
  const hard = (r.incomplete ?? []).filter((g) => g.part === 'chain' || g.part === 'lookups' || g.part === 'identity' || g.part === 'aborted');
  const readInPart = (g: { part: string; chainId?: number }) => g.part === 'chain' && r.coverage.some((c) => c.chainId === g.chainId && c.status === 'partial');
  if (!hard.length || !hard.every((g) => g.part === 'lookups' || readInPart(g))) return m;
  const inPart = [...new Set(hard.filter(readInPart).map((g) => g.name))];
  // m.partial is already true: the result has gaps.
  return {
    ...m,
    state: 'score',
    coverage: {
      ...m.coverage,
      failed: m.coverage.failed.filter((n) => !inPart.includes(n)),
      partly: [...inPart.map((n) => `parts of ${n}`).filter((p) => !m.coverage.partly.includes(p)), ...m.coverage.partly],
    },
  };
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type Progress = (done: number, total: number) => void;

export interface ToolsOptions {
  keys: UserKeys;
  /** Where the scan runs (default `local`). `hosted` also turns the memory of recent scans off. */
  mode?: Mode;
  fetch?: typeof fetch;
  /** Override the scanner (tests). */
  scanner?: Scanner;
  now?: () => number;
}

export const FAILED_TEXT = 'The scan could not finish this time. Try again in a few minutes.';

export function createTools(o: ToolsOptions) {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const now = o.now ?? Date.now;
  const scanner = o.scanner ?? createScanner({ timeoutMs: SCAN_TIMEOUT_MS, keys: o.keys, fetch: f });
  const mode: Mode = o.mode ?? 'local';
  // Hosted, the server keeps nothing: no memory of an earlier scan, so a fix plan scans again.
  const remember = mode === 'local';
  const memo = new Map<string, { at: number; result: ScanResult }>();

  async function scanOf(address: string, progress?: Progress): Promise<ScanResult> {
    for (const [k, v] of memo) if (now() - v.at > MEMO_MS) memo.delete(k);
    const hit = memo.get(address);
    if (hit) return hit.result;
    const result = await scanner.scan(address, progress);
    if (!remember) return result;
    memo.delete(address);
    memo.set(address, { at: now(), result });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
    return result;
  }

  const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: scrub(t, o.keys) }], ...(isError ? { isError: true } : {}) });

  async function call(name: string, args: Record<string, unknown> | undefined, progress?: Progress): Promise<ToolResult> {
    if (name !== 'scan_wallet' && name !== 'fix_plan') return text(`Unknown tool: ${name}.`, true);
    const w = await readWallet(args?.wallet, f, mode);
    if (w.kind === 'refused') return text(w.message, true);
    let result: ScanResult;
    try {
      result = await scanOf(w.address, progress);
    } catch {
      return text(FAILED_TEXT, true);
    }
    const m = mode === 'hosted' ? hostedModel(result, toModel(result, w.name)) : toModel(result, w.name);
    // Hosted, a scan answers with its fix plan too: one call, one confirmation, one scan.
    if (name === 'scan_wallet' && mode === 'hosted' && m.state === 'score') return text(`${scanText(result, m, o.keys, w.name, mode)}\n\n${fixText(result, m, w.name)}`);
    if (name === 'scan_wallet' || m.state !== 'score') return text(scanText(result, m, o.keys, w.name, mode));
    return text(fixText(result, m, w.name));
  }

  return { call, memo };
}
