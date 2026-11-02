// What the two tools say, in Markdown for the assistant to read and pass on. The states and their words
// follow the bot, the site and the ASI agent (vendor/scanbot/src/model.ts toModel): a number only for a
// person's wallet whose history was read; a contract, a service, an unused address, an unread or an
// incomplete scan are said in words, without a number. Unlike the bot, the plugin gives every finding with
// its evidence, because the assistant can explain them one by one. House rules: no em dash and no middle
// dot, a missing value is "n/a", a link between wallets is a likelihood with its confidence, never a claim
// of who owns a wallet.
import { fixPlan, FIX_TEXT, VIEWER_TEXT, type FixItem } from '../vendor/scanbot/vendor/privacy-scan/src/features/fix-plan.ts';
import type { Finding, ScanResult, ServiceKind } from '../vendor/scanbot/vendor/privacy-scan/src/types.ts';
import { checksum, confidenceText, short, type CardModel } from '../vendor/scanbot/src/model.ts';
import { KEY_ENV, type KeyName, type UserKeys } from './keys.ts';

export const SITE = 'https://nymra.si';
/** How many evidence lines one finding shows; the rest is counted. */
export const EVIDENCE_SHOWN = 3;
/** How many linked wallets one finding shows; the rest is counted. */
export const LINKS_SHOWN = 3;

const SIGN = (n: number) => (n < 0 ? `-${Math.abs(n)}` : `${n}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A contract or a service is no wallet of a person: its line says "Address". */
export function walletLine(m: CardModel, name?: string): string {
  const label = m.state === 'contract' || m.state === 'service' ? 'Address' : 'Wallet';
  const a = checksum(m.address);
  name ??= m.ens;
  return name ?`${label}: ${name} (${a})` : `${label}: ${a}`;
}

/** A service address in the site's words (the bot's text.ts SERVICE): what it is, and why that is no person. */
const SERVICE: Record<ServiceKind, { what: (e?: string) => string; why: string }> = {
  exchange: { what: (e) => `an exchange wallet${e ? ` of ${e}` : ''}`, why: 'It holds the funds of many customers, so its links and habits say nothing about one person.' },
  deposit: { what: (e) => `a deposit address${e ? ` at ${e}` : ''}`, why: 'The exchange holds its key and moves what arrives into its own wallets; who the customer is, only the exchange knows.' },
  bridge: { what: (e) => (e ? `${/^[aeiou]/i.test(e) ? 'an' : 'a'} ${e} bridge wallet` : 'a bridge wallet'), why: 'It moves the funds of many users between chains, so its links and habits say nothing about one person.' },
  bot: { what: () => 'a bot wallet', why: 'A program trades from it, such as an MEV or trading bot, so its habits describe a program, not a person.' },
  infrastructure: { what: (e) => `infrastructure${e ? ` of ${e}` : ''}, such as a bundler or a deployer`, why: 'It sends transactions for many users, so its links say nothing about one person.' },
  distributor: { what: (e) => `an airdrop or payout wallet${e ? ` of ${e}` : ''}`, why: 'It pays many wallets at once, so being paid by it says little, and its own links say nothing about one person.' },
  payments: { what: (e) => `a payment service's wallet${e ? ` (${e})` : ''}`, why: 'It moves the money of many customers, so its links and habits say nothing about one person.' },
  'market maker': { what: (e) => `a market maker's wallet${e ? ` (${e})` : ''}`, why: 'It trades for a firm, all day, so its links and habits say nothing about one person.' },
  service: { what: (e) => `a service's wallet${e ? ` (${e})` : ''}`, why: 'Many people use it, so its links and habits say nothing about one person.' },
};

/**
 * Which of the user's own keys reads a chain this computer cannot read without one. Base and Polygon PoS
 * through Alchemy (their explorers refuse anything but a browser, and Blockscout's plan for a key does not
 * serve them), Arbitrum One and Robinhood Chain through Blockscout's PRO API, BNB Smart Chain through NodeReal.
 */
export const KEY_FOR_CHAIN: Record<string, { key: KeyName; provider: string }> = {
  'Base': { key: 'alchemy', provider: 'Alchemy' },
  'Polygon PoS': { key: 'alchemy', provider: 'Alchemy' },
  'Arbitrum One': { key: 'pro', provider: 'Blockscout' },
  'Robinhood Chain': { key: 'pro', provider: 'Blockscout' },
  'BNB Smart Chain': { key: 'nodereal', provider: 'NodeReal' },
};

/** Where a user gets each key, in the provider's own steps. */
export const KEY_SOURCE: Record<Exclude<KeyName, 'etherscan'>, string> = {
  alchemy: 'sign up at https://dashboard.alchemy.com/signup, create an app and copy its API key',
  pro: 'sign up at https://dev.blockscout.com and create an API key',
  nodereal: 'sign up at https://nodereal.io/meganode and copy the API key it gives you',
};

export const PLUGIN_ID = 'nymra-privacy-scan@nymra';

/**
 * How to read the chains of this result that a key of the user's own would read: which key, where to get
 * it, where to put it (the plugin's settings or the user's own environment, never the chat). A provider
 * whose key is already set is left out (then the gap has another cause, such as a rate limit).
 */
export function keyHint(chains: string[], keys: UserKeys): string | undefined {
  const per = new Map<KeyName, { provider: string; chains: string[] }>();
  const failing = new Map<KeyName, { provider: string; chains: string[] }>();
  for (const c of chains) {
    const k = KEY_FOR_CHAIN[c];
    if (!k) continue;
    const into = keys[k.key] ? failing : per;
    const e = into.get(k.key) ?? { provider: k.provider, chains: [] };
    e.chains.push(c);
    into.set(k.key, e);
  }
  const lines: string[] = [];
  // A key that is set while its chains still could not be read: wrong, revoked or out of quota, or the provider was slow.
  for (const [, e] of failing) {
    lines.push(`Your ${e.provider} key is set, but ${e.chains.join(' and ')} still could not be read. Check the key in the plugin's settings (\`/plugin configure ${PLUGIN_ID}\`) or at ${e.provider}, or scan again in a few minutes.`);
  }
  if (per.size) {
    if (lines.length) lines.push('');
    lines.push('**Read the missing chains with a key of your own**');
    for (const [k, e] of per) {
      lines.push(`- ${e.chains.join(' and ')}: ${/^[AEIOU]/.test(e.provider) ? 'an' : 'a'} ${e.provider} API key. To get one, ${KEY_SOURCE[k as Exclude<KeyName, 'etherscan'>]}.`);
    }
    const vars = [...per.keys()].map((k) => `\`${KEY_ENV[k]}\``);
    lines.push(
      `Put it in the plugin's settings: in Claude Code, run \`/plugin configure ${PLUGIN_ID}\`, which keeps it in your system's secure credential store. Or set ${vars.length === 1 ? vars[0] : `${vars.slice(0, -1).join(', ')} and ${vars[vars.length - 1]}`} in your own shell profile and restart Claude Code. Then run \`/reload-plugins\` and scan again.`,
      'Never paste a key into this chat: everything typed here reaches your AI provider. The key stays on this computer, and the scan sends it only to its own provider.',
    );
  }
  return lines.length ? lines.join('\n') : undefined;
}

function gapList(m: CardModel): string {
  const gaps = [...m.coverage.failed, ...m.coverage.partly, ...m.coverage.checks];
  return gaps.length <= 4 ? gaps.join(', ') : `${gaps.slice(0, 3).join(', ')} and ${gaps.length - 3} more`;
}

/** Chains named in the gaps (failed, skipped), for the key hint. */
function gapChains(m: CardModel): string[] {
  return [...m.coverage.failed, ...m.coverage.partly].filter((n) => n in KEY_FOR_CHAIN);
}

function poisoning(n: number): string {
  const who = n === 1 ? 'An address made to look like this wallet, or like one it uses, is' : `${n} addresses made to look like this wallet, or like one it uses, are`;
  return `**Warning:** ${who} in its history. Never copy an address from the history.`;
}

function findingLines(f: Finding, i: number): string[] {
  const out = [`${i}. **${f.title}** (${SIGN(f.scoreImpact)} points, ${f.severity}, confidence ${Math.round(f.confidence * 100)}%)`, `   ${f.explanation}`];
  const ev = f.evidence.filter((e) => e.text);
  for (const e of ev.slice(0, EVIDENCE_SHOWN)) out.push(`   - Evidence: ${e.text}${e.url ? ` ${e.url}` : ''}`);
  if (ev.length > EVIDENCE_SHOWN) out.push(`   - ${plural(ev.length - EVIDENCE_SHOWN, 'more piece of evidence', 'more pieces of evidence')}`);
  const rel = [...(f.related ?? [])].sort((a, b) => b.confidence - a.confidence);
  for (const r of rel.slice(0, LINKS_SHOWN)) out.push(`   - Linked wallet ${short(r.address)}: ${confidenceText(r.confidence)}${r.reasons?.length ? ` (${r.reasons.join('; ')})` : ''}`);
  if (rel.length > LINKS_SHOWN) out.push(`   - ${plural(rel.length - LINKS_SHOWN, 'more linked wallet', 'more linked wallets')}`);
  return out;
}

/** The answer of scan_wallet. */
/** Hosted, a chain not read has no key to add: the server holds them. Only a later scan can read it. */
export const HOSTED_GAP = 'Nymra could not read these parts this time. Scan again in a few minutes.';

export function scanText(r: ScanResult, m: CardModel, keys: UserKeys, name?: string, mode: 'local' | 'hosted' = 'local'): string {
  const gapHint = () => (mode === 'hosted' ? HOSTED_GAP : keyHint(gapChains(m), keys));
  const lines: string[] = [];
  if (m.state !== 'score') {
    const head: Record<Exclude<CardModel['state'], 'score'>, () => [string, string]> = {
      service: () => {
        const s = SERVICE[m.service?.kind ?? 'service'] ?? SERVICE.service;
        return [`This is ${s.what(m.service?.entity)}.`, `Nymra scores personal wallets. ${s.why}`];
      },
      contract: () => ['This address is a contract, not a wallet.', "A contract runs code in public by design, so there is no person's privacy to score. Nymra scores wallets that people control."],
      unused: () => ['Nothing to reveal yet.', 'This address has no transactions on the EVM chains Nymra reads, so there is nothing to score. A wallet that has never been used gives nothing away; that changes with its first transaction.'],
      unread: () => ['No chain could be read.', 'No chain where this wallet is active could be read, so there is no score. Try again in a few minutes.'],
      incomplete: () => ['No score yet: part of the history could not be read.', `Not read: ${gapList(m)}. Nymra shows no score until it is read, because the missing part could move it a long way.`],
    };
    const [title, body] = head[m.state]();
    lines.push(`**${title}**`, walletLine(m, name), '', body);
    if (m.state === 'incomplete' || m.state === 'unread') {
      const hint = gapHint();
      if (hint) lines.push('', hint);
    }
    if (m.lookalikes > 0) lines.push('', poisoning(m.lookalikes));
    return lines.join('\n');
  }

  lines.push(`**Nymra Privacy Score: ${m.score} of 100, ${m.bandLabel}**`, walletLine(m, name), '');
  const costly = r.findings.filter((f) => f.scoreImpact < 0).sort((a, b) => a.scoreImpact - b.scoreImpact);
  const free = r.findings.filter((f) => f.scoreImpact >= 0);
  if (!costly.length) {
    lines.push('No finding cost a point. Nothing we can see ties this wallet to other wallets or to an account.');
  } else {
    lines.push('**Findings, costliest first**');
    costly.forEach((f, i) => lines.push(...findingLines(f, i + 1)));
  }
  if (free.length) {
    lines.push('', '**Seen, but costing no points**');
    for (const f of free) lines.push(`- ${f.title}: ${f.explanation}`);
  }
  lines.push('');
  const { active, read, failed, partly, checks } = m.coverage;
  if (failed.length + partly.length + checks.length) {
    lines.push(`**Partial scan:** ${gapList(m)} could not be read, so the score may be higher than it should be.`);
    const hint = gapHint();
    if (hint) lines.push('', hint);
  } else {
    lines.push(!active ? 'No activity on the EVM chains Nymra reads.' : active >= read ? 'Active on every EVM chain Nymra reads.' : `Active on ${active} EVM ${active === 1 ? 'chain' : 'chains'}.`);
  }
  if (m.linkedCount > 0) lines.push(`${m.linkedCount === 1 ? '1 linked wallet' : `${m.linkedCount} linked wallets`}: likelihoods, never proof of who owns a wallet.`);
  if (m.lookalikes > 0) lines.push(poisoning(m.lookalikes));
  // Hosted, the fix plan follows in the same answer (tools.ts).
  if (mode === 'local') lines.push('', 'The fix plan (the fix_plan tool) shows what can be undone today and how many points that wins back.');
  return lines.join('\n');
}

const KIND_HEAD = { now: 'Do today', habit: 'From now on', permanent: 'On chain for good' } as const;

function itemLines(it: FixItem, i: number): string[] {
  const pts = it.kind === 'now' && it.gain ? ` (wins back ${it.gain} ${it.gain === 1 ? 'point' : 'points'})` : it.points < 0 ? ` (${SIGN(it.points)} points now)` : '';
  const out = [`${i}. **${it.action}**${pts}`];
  out.push(`   Who can see it: ${it.who.map((w) => VIEWER_TEXT[w]).join(', ')}.`);
  if (it.heldBy === 'ceiling') out.push('   The score stays where it is while a public label names this wallet; this still removes the leak itself.');
  if (it.heldBy === 'cap') out.push('   Other findings of the same kind still count, so the score moves only once those go too.');
  for (const s of it.steps) out.push(`   - ${s}`);
  if (it.source) out.push(`   Source: ${it.source}`);
  out.push(`   More: ${SITE}${it.learnMore}`);
  return out;
}

/** The answer of fix_plan, for a wallet with a score. Other states get the scan's own words (scanText). */
export function fixText(r: ScanResult, m: CardModel, name?: string): string {
  const p = fixPlan(r);
  const lines = [`**${FIX_TEXT.title}**`, walletLine(m, name), `Nymra Privacy Score now: ${p.score} of 100.`, '', FIX_TEXT.lead];
  lines.push(p.winBack > 0 ? `${FIX_TEXT.winBack.replace('{points} points', plural(p.winBack, 'point', 'points'))} The score would then be ${p.scoreAfter}.` : FIX_TEXT.winBackNone);
  if (!p.items.length) {
    lines.push('', 'Nothing in this scan asks for a change. Keep it that way with a fresh wallet for anything you want kept apart.');
  }
  if (p.top) lines.push('', `Start with: ${p.top.action}.`);
  let n = 0;
  for (const kind of ['now', 'habit', 'permanent'] as const) {
    const items = p.items.filter((it) => it.kind === kind);
    if (!items.length) continue;
    lines.push('', `**${KIND_HEAD[kind]}**`);
    for (const it of items) lines.push(...itemLines(it, ++n));
  }
  if (m.partial) lines.push('', `Part of the history could not be read (${gapList(m)}), so this plan covers what was read.`);
  lines.push('', FIX_TEXT.honest);
  return lines.join('\n');
}
