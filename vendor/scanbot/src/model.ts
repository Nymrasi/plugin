// What the card and the caption show, derived once from a ScanResult. Bands come from the schema;
// the confidence word comes from the engine's own linkLevel (LINK_LEVELS: Likely from 0.70,
// Possible from 0.45, Weak below), the single source the site and the docs read too, and is
// always printed with the number.
import { keccak_256 } from '../../noble-hashes/sha3.js';
import { linkLevel } from '../vendor/privacy-scan/src/score.ts';
import type { LinkLevel, ScanResult, ScoreBand, ServiceIdentity, Severity } from '../vendor/privacy-scan/src/types.ts';

/**
 * What the bot shows, decided the way the site decides it (web/src/terminal/main.ts classify and
 * render.ts verdictOf, on the engine's SCHEMA): a number only for a person's wallet whose history
 * was read. Every other state is said in words, and no card is drawn.
 *   score       the score; marked partial when only side lists are missing (coverage.partly)
 *   unread      no chain where the wallet is active could be read
 *   contract    a smart contract: public by design, no person's privacy to score
 *   service     the address itself is a service (identity.service): an exchange, a deposit address,
 *               a bridge, a bot. The engine still computes a number for it; the bot never shows it
 *   unused      the engine's `unused`: never sent a transaction, holds nothing on any chain read and
 *               nothing names it, so there is nothing to score (the engine's 100 is by construction)
 *   incomplete  a chain, the funder and deposit checks, the identity read or the scan itself was cut
 *               short (REVIEW-1 B1): the score could move a long way, so none until it is read
 */
export type CardState = 'score' | 'unread' | 'contract' | 'service' | 'unused' | 'incomplete';

/** The engine's gaps that leave no score (SCHEMA "How to read a gap"); the others leave a partial one. */
const HARD_GAPS: ReadonlySet<string> = new Set(['chain', 'lookups', 'identity', 'aborted']);

export const BAND_LABEL: Record<ScoreBand, string> = {
  exposed: 'Exposed',
  traceable: 'Traceable',
  moderate: 'Moderate',
  private: 'Private',
};

export type ConfidenceLevel = LinkLevel;
export const confidenceLevel = (c: number): ConfidenceLevel => linkLevel(c);
const WORD: Record<ConfidenceLevel, string> = { likely: 'Likely', possible: 'Possible', weak: 'Weak' };
/** "Likely 82%": a link between wallets is always a word and a number, never a bare claim. */
export function confidenceText(c: number): string {
  return `${WORD[confidenceLevel(c)]} ${Math.round(c * 100)}%`;
}

/** EIP-55 mixed case, so a short address reads the way wallets and explorers print it. */
export function checksum(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '');
  const hash = keccak_256(new TextEncoder().encode(hex));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    out += nibble >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function short(address: string, head = 6, tail = 4): string {
  const a = checksum(address);
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

export interface CardLink {
  level: ConfidenceLevel;
  confidence: number;
  address: string;
  /** Other wallets this same finding links to, not shown. */
  more: number;
}

export interface CardFinding {
  severity: Severity;
  title: string;
  points: number;
  link?: CardLink;
}

export interface CardModel {
  /** Empty when `shared`. */
  address: string;
  ens?: string;
  /**
   * For a group or for inline: no address, no name and no linked wallet anywhere in the model,
   * and finding titles without the funder the engine names after ": ".
   */
  shared: boolean;
  /** A score, or a state in words instead of one (CardState). */
  state: CardState;
  /** The engine's identity.service when the address is a service; without its entity when `shared`. */
  service?: ServiceIdentity;
  score: number;
  band: ScoreBand;
  bandLabel: string;
  contract: boolean;
  /** At most three, costliest first; info notes never count. */
  top: CardFinding[];
  /** Findings that cost points but are not in `top`. */
  more: number;
  /** Wallets linked by any finding, each a likelihood. */
  linkedCount: number;
  /**
   * Look-alike addresses in the history (address poisoning, the engine's `warnings`). Only the
   * count: shortened, a look-alike reads exactly like the real address, so the bot never prints one.
   */
  lookalikes: number;
  /**
   * What was not read, from the engine's `coverage` and `incomplete`. No score with either of these:
   * failed, chains not read (or with a gap in the explorer's index); checks, ENS and labels, funder
   * and deposit checks, a scan stopped by the time limit. A partial score with partly, in words for
   * a sentence: "parts of Base" (token or internal transfers, the oldest page), "BNB Smart Chain" (a chain the
   * wallet used that Nymra does not read yet, part `skipped`), "other ENS names" and "ENS records"
   * (part `names`). partlyChains: how many chains are among them.
   */
  coverage: { active: number; read: number; failed: string[]; partly: string[]; partlyChains: number; checks: string[] };
  partial: boolean;
}

/** ENS names can hold any script or emoji; the card font is Latin only, so those stay in the caption. */
export function cardSafe(s: string): boolean {
  return /^[\x20-\x7e]+$/.test(s);
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** A finding title with nothing that points at a wallet: the engine names a funder after ": ". */
export function sharedTitle(t: string): string {
  return t.replace(/:\s.*$/, '').replace(/0x[0-9a-fA-F]{4,}(\.{3}[0-9a-fA-F]+)?/g, 'a wallet').replace(/[^\s]+\.(eth|xyz|box|cb\.id)\b/gi, 'a name').trim();
}

export function toModel(r: ScanResult, typedName?: string, o: { shared?: boolean } = {}): CardModel {
  const shared = !!o.shared;
  // Costliest first (the engine's order); on equal points the more severe one leads.
  const costly = r.findings
    .filter((f) => f.severity !== 'info')
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.scoreImpact - b.f.scoreImpact || RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
  const top: CardFinding[] = costly.slice(0, 3).map((f) => {
    const rel = [...(f.related ?? [])].sort((a, b) => b.confidence - a.confidence);
    const first = rel[0];
    return {
      severity: f.severity,
      title: shared ? sharedTitle(f.title) : f.title,
      points: f.scoreImpact,
      ...(first ? { link: { level: confidenceLevel(first.confidence), confidence: first.confidence, address: shared ? '' : first.address, more: rel.length - 1 } } : {}),
    };
  });
  const read = r.coverage.filter((c) => c.status === 'scanned' || c.status === 'partial' || c.status === 'no_activity');
  const gaps = r.incomplete ?? [];
  const unique = (xs: string[]) => [...new Set(xs)];
  const failed = unique([...r.coverage.filter((c) => c.status === 'error').map((c) => c.name), ...gaps.filter((g) => g.part === 'chain').map((g) => g.name)]);
  const inPart = unique(gaps.filter((g) => g.part === 'tokens' || g.part === 'internal' || g.part === 'oldest').map((g) => g.name)).filter((n) => !failed.includes(n));
  const unreadYet = unique(gaps.filter((g) => g.part === 'skipped').map((g) => g.name)).filter((n) => !failed.includes(n) && !inPart.includes(n));
  // Inside a sentence "Other ENS names" reads "other ENS names"; "ENS records" and chain names stay as they are.
  const inSentence = (n: string) => (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
  const names = unique(gaps.filter((g) => g.part === 'names').map((g) => inSentence(g.name)));
  const partly = [...inPart.map((n) => `parts of ${n}`), ...unreadYet, ...names];
  const checks = unique(gaps.filter((g) => g.part === 'identity' || g.part === 'lookups' || g.part === 'aborted').map((g) => (g.part === 'aborted' ? 'the chains left at the time limit' : inSentence(g.name))));
  const ens = shared ? undefined : typedName ?? r.identity.ens;
  // The site's order (classify): nothing read, a contract, a service, never used, then the score
  // itself, which a hard gap withholds.
  const asked = r.coverage.filter((c) => c.status !== 'skipped');
  const errored = asked.filter((c) => c.status === 'error').length;
  const history = asked.filter((c) => c.status === 'scanned' || c.status === 'partial').length;
  const service = r.identity.service;
  const state: CardState = errored && !history ? 'unread'
    : r.addressType === 'contract' ? 'contract'
    : service ? 'service'
    : r.unused ? 'unused'
    : errored || gaps.some((g) => HARD_GAPS.has(g.part)) ? 'incomplete'
    : 'score';
  return {
    address: shared ? '' : r.address,
    ...(ens ? { ens } : {}),
    shared,
    state,
    ...(service ? { service: shared ? { kind: service.kind } : { ...service } } : {}),
    score: r.score,
    band: r.band,
    bandLabel: BAND_LABEL[r.band],
    contract: r.addressType === 'contract',
    top,
    more: costly.length - top.length,
    linkedCount: r.linkedWallets.length,
    lookalikes: new Set((r.warnings ?? []).flatMap((w) => w.lookalikes.map((l) => l.address))).size,
    coverage: { active: read.filter((c) => c.status !== 'no_activity').length, read: read.length, failed, partly, partlyChains: inPart.length + unreadYet.length, checks },
    partial: r.status !== 'complete' || failed.length + partly.length + checks.length > 0,
  };
}
