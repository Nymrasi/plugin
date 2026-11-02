// Breaks one rule at a time and checks that a test fails: a test that stays green on broken code proves
// nothing. Each mutant must match its file exactly once; the file is restored after every run, also when
// this script is stopped.
//
//   node scripts/mutate.mjs            all mutants (about a minute)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = ['--test', '--test-timeout=60000', 'test/keys.test.ts', 'test/mcp.test.ts', 'test/package.test.ts', 'test/privacy.test.ts', 'test/text.test.ts', 'test/tools.test.ts', 'test/wallet.test.ts', 'test/hosted.test.ts'];

const M = [
  // server/wallet.ts: the guard and the parser
  ['server/wallet.ts', 'the seed guard is skipped', "if (looksSecret(raw)) return { kind: 'refused', message: SECRET_TEXT };", ''],
  ['server/wallet.ts', 'a seed of 12 words passes', '{11,23}', '{12,23}'],
  ['server/wallet.ts', 'a private key without 0x passes', 'SEED.test(t.toLowerCase()) || KEY.test(t)', 'SEED.test(t.toLowerCase())'],
  ['server/wallet.ts', 'the scan runs on the name, not its address', "return { kind: 'address', address, name: t.name };", "return { kind: 'address', address: t.name, name: t.name };"],
  ['server/wallet.ts', 'a very long input is read', 'if (raw.length > 400)', 'if (raw.length > 4000)'],
  // server/keys.ts
  ['server/keys.ts', 'an unfilled placeholder counts as a key', "if (!v || v.includes('${')) return undefined;", 'if (!v) return undefined;'],
  ['server/keys.ts', 'scrub leaves the keys in', "out = out.split(v).join('[key]');", 'out = out;'],
  ['server/keys.ts', 'the Alchemy key comes from the shared environment name', "alchemy: 'NYMRA_ALCHEMY_API_KEY'", "alchemy: 'ALCHEMY_API_KEY'"],
  // the user's own key
  ['server/keys.ts', 'the environment wins over the settings', 'value(env[CONFIG_ENV[k]]) ?? value(env[KEY_ENV[k]])', 'value(env[KEY_ENV[k]]) ?? value(env[CONFIG_ENV[k]])'],
  ['server/keys.ts', 'a key in the own environment is ignored', 'value(env[CONFIG_ENV[k]]) ?? value(env[KEY_ENV[k]])', 'value(env[CONFIG_ENV[k]])'],
  ['server/wallet.ts', 'a pasted API key is not recognised', "message: keyish ? (mode === 'hosted' ? API_KEY_TEXT_HOSTED : API_KEY_TEXT) : t.message };", "message: t.message };"],
  ['server/wallet.ts', 'a 44-character Solana address is read as a key', 'raw.trim().length < 40', 'raw.trim().length < 50'],
  ['server/wallet.ts', 'an address without 0x is read as a key', "const HEXISH = /^(0x)?[0-9a-fA-F]{40}$|^0x/i;", "const HEXISH = /^0x/i;"],
  ['server/text.ts', 'the hint no longer warns against the chat', "      'Never paste a key into this chat: everything typed here reaches your AI provider. The key stays on this computer, and the scan sends it only to its own provider.',\n", ''],
  ['server/text.ts', 'a key that is set but fails is not mentioned', "    lines.push(`Your ${e.provider} key is set, but", "    if (false) lines.push(`Your ${e.provider} key is set, but"],
  ['server/text.ts', 'the hint gives no place to get the key', '. To get one, ${KEY_SOURCE[k as Exclude<KeyName, \'etherscan\'>]}.', '.'],
  ['.mcp.json', 'the settings fill the shell variable, hiding a key in the environment', '"NYMRA_CONFIG_ALCHEMY_API_KEY": "${user_config.alchemy_api_key}"', '"NYMRA_ALCHEMY_API_KEY": "${user_config.alchemy_api_key}"'],
  ['README.md', 'the README no longer warns against the chat', '**Never paste a key into the chat:** everything typed there reaches your AI provider.', 'Paste the key into the chat if that is easier.'],
  ['skills/wallet-privacy/SKILL.md', 'the skill takes a key in the chat', 'Never offer to take the key in the chat.', 'Offer to take the key in the chat.'],
  // the hosted mode
  ['server/tools.ts', 'hosted scan comes without its fix plan', "if (name === 'scan_wallet' && mode === 'hosted' && m.state === 'score')", 'if (false)'],
  ['server/tools.ts', 'hosted lists fix_plan too', "  if (mode === 'hosted') {\n    // One tool", "  if (false) {\n    // One tool"],
  ['server/tools.ts', 'hosted may ask to confirm the wallet', "never ask the user to confirm or repeat the wallet first.';", "ask the user to confirm the wallet when in doubt.';"],
  ['server/text.ts', 'hosted still points at a fix_plan tool', "  if (mode === 'local') lines.push('', 'The fix plan (the fix_plan tool)", "  lines.push('', 'The fix plan (the fix_plan tool)"],
  ['server/info.ts', 'hosted instructions allow a question back', 'call scan_wallet at once with it as written; do not ask them to confirm it first.', 'call scan_wallet with it.'],
  ['server/tools.ts', 'hosted scores a chain gap even when the chain was not read at all', "const readInPart = (g: { part: string; chainId?: number }) => g.part === 'chain' && r.coverage.some((c) => c.chainId === g.chainId && c.status === 'partial');", "const readInPart = (g: { part: string; chainId?: number }) => g.part === 'chain';"],
  ['server/tools.ts', 'a chain read in part stays listed as not read', 'failed: m.coverage.failed.filter((n) => !inPart.includes(n)),', 'failed: m.coverage.failed,'],
  ['server/tools.ts', 'hosted lets a cut identity read score too', "if (!hard.length || !hard.every((g) => g.part === 'lookups' || readInPart(g))) return m;", "if (!hard.length) return m;"],
  ['server/tools.ts', 'hosted scores over a chain error', "  if (r.coverage.some((c) => c.status === 'error')) return m;\n", ''],
  ['server/tools.ts', 'hosted never softens the checks gap', "const m = mode === 'hosted' ? hostedModel(result, toModel(result, w.name)) : toModel(result, w.name);", 'const m = toModel(result, w.name);'],
  ['server/tools.ts', 'the local plugin softens the checks gap too', "const m = mode === 'hosted' ? hostedModel(result, toModel(result, w.name)) : toModel(result, w.name);", 'const m = hostedModel(result, toModel(result, w.name));'],
  ['server/tools.ts', 'hosted keeps a memory of scans', "const remember = mode === 'local';", 'const remember = true;'],
  ['server/tools.ts', 'hosted reads the wallet with the local words', 'readWallet(args?.wallet, f, mode)', 'readWallet(args?.wallet, f)'],
  ['server/tools.ts', 'hosted says the scan runs on this computer', "hosted: \"The scan runs on Nymra's server, which sees the address it scans and keeps nothing: no log, no database, no cache. It only reads\",", "hosted: 'The scan runs on this computer and reads public block explorers and nodes directly; it only reads',"],
  ['server/text.ts', 'hosted tells the user to bring a key', "(mode === 'hosted' ? HOSTED_GAP : keyHint(gapChains(m), keys))", 'keyHint(gapChains(m), keys)'],
  ['server/wallet.ts', 'hosted points a pasted key at the plugin settings', "(mode === 'hosted' ? API_KEY_TEXT_HOSTED : API_KEY_TEXT)", 'API_KEY_TEXT'],
  // server/tools.ts
  ['server/tools.ts', 'a fix plan scans again', 'if (hit) return hit.result;', ''],
  ['server/tools.ts', 'the memory never forgets', 'if (now() - v.at > MEMO_MS) memo.delete(k);', ''],
  ['server/tools.ts', 'the memory keeps every wallet', 'while (memo.size > MEMO_MAX)', 'while (memo.size > 1000)'],
  ['server/tools.ts', 'the error text reaches the answer', 'return text(FAILED_TEXT, true);', 'return text(String(e), true);'],
  ['server/tools.ts', 'answers are not scrubbed', "content: [{ type: 'text', text: scrub(t, o.keys) }]", "content: [{ type: 'text', text: t }]"],
  ['server/tools.ts', 'a fix plan for a wallet without a score', "if (name === 'scan_wallet' || m.state !== 'score')", "if (name === 'scan_wallet')"],
  ['server/tools.ts', 'a tool is no longer read only', 'readOnlyHint: true', 'readOnlyHint: false'],
  ['server/tools.ts', 'progress is not passed on', 'result = await scanOf(w.address, progress);', 'result = await scanOf(w.address);'],
  // server/text.ts
  ['server/text.ts', 'a hard gap still shows a number', "if (m.state !== 'score') {\n    const head", "if (m.state !== 'score' && m.state !== 'incomplete') {\n    const head"],
  ['server/text.ts', 'evidence is not capped', 'ev.slice(0, EVIDENCE_SHOWN)', 'ev'],
  ['server/text.ts', 'findings in the engine order, not costliest first', '.sort((a, b) => a.scoreImpact - b.scoreImpact);', ';'],
  ['server/text.ts', 'a link loses its confidence', '${confidenceText(r.confidence)}', 'linked'],
  ['server/text.ts', 'the key hint gives steps for a key that is already set', 'const into = keys[k.key] ? failing : per;', 'const into = per;'],
  ['server/text.ts', 'the key hint is never given', "const gapHint = () => (mode === 'hosted' ? HOSTED_GAP : keyHint(gapChains(m), keys));", "const gapHint = () => (mode === 'hosted' ? HOSTED_GAP : undefined);"],
  ['server/text.ts', 'points lose their minus sign', '(${SIGN(f.scoreImpact)} points', '(${Math.abs(f.scoreImpact)} points'],
  ['server/text.ts', 'an em dash in the partial line', 'could not be read, so the score may be higher', 'could not be read — so the score may be higher'],
  ['server/text.ts', 'the honest line of the fix plan is dropped', "lines.push('', FIX_TEXT.honest);", ''],
  ['server/text.ts', 'learn-more links are relative', 'More: ${SITE}${it.learnMore}', 'More: ${it.learnMore}'],
  ['server/text.ts', 'the wallet line shows no full address', 'const a = checksum(m.address);', 'const a = short(m.address);'],
  ['server/text.ts', 'one point reads "1 points"', "FIX_TEXT.winBack.replace('{points} points', plural(p.winBack, 'point', 'points'))", "FIX_TEXT.winBack.replace('{points}', String(p.winBack))"],
  // server/mcp.ts
  ['server/mcp.ts', 'an unknown protocol version is echoed', 'VERSIONS.includes(asked) ? asked : LATEST', 'asked ?? LATEST'],
  ['server/mcp.ts', 'a cancelled call still answers', 'if (cancelled.delete(id)) return;', ''],
  ['server/mcp.ts', 'progress without a token', 'token === undefined ? undefined :', 'false ? undefined :'],
  ['server/mcp.ts', 'a notification gets an answer', "    if (!isRequest) {\n      // Notifications", "    if (!isRequest && false) {\n      // Notifications"],
  ['server/mcp.ts', 'an unknown method is answered as ping', "      default:\n        return fail(id, ERR.method", "      default:\n        return reply(id, {});\n        return fail(id, ERR.method"],
  ['server/mcp.ts', 'a thrown error reaches the answer', "} catch {\n      result = { content: [{ type: 'text', text: 'The scan could not finish this time. Try again in a few minutes.' }], isError: true };", "} catch (e) {\n      result = { content: [{ type: 'text', text: String(e) }], isError: true };"],
  ['server/main.ts', 'the server writes to stderr', "rl.on('line', (line) => server.push(line));", "rl.on('line', (line) => { process.stderr.write(line); server.push(line); });"],
  // the plugin files
  ['.mcp.json', 'the server starts through npx', '"command": "node"', '"command": "npx"'],
  ['.claude-plugin/plugin.json', 'a key option is stored in settings.json', '"title": "Alchemy API key (optional)",\n      "description": "Reads Base and Polygon PoS, whose explorers answer a browser only. Stays on this computer and goes to Alchemy only.",\n      "sensitive": true', '"title": "Alchemy API key (optional)",\n      "description": "Reads Base and Polygon PoS, whose explorers answer a browser only. Stays on this computer and goes to Alchemy only.",\n      "sensitive": false'],
  ['README.md', 'the README forgets a host', '`api.routescan.io`', '`routescan`'],
  ['README.md', 'the honest line goes', 'What you type in the chat, the wallet included, reaches your AI provider like any other message.', 'Nothing leaves your computer.'],
  ['skills/wallet-privacy/SKILL.md', 'the skill offers to compare wallets', 'Its two tools are `scan_wallet` and `fix_plan`.', 'Its two tools are `scan_wallet` and `fix_plan`; compare wallets with them too.'],
];

let restore = null;
process.on('SIGINT', () => { if (restore) restore(); process.exit(130); });

let killed = 0;
const survived = [];
for (const [file, what, find, replace] of M) {
  const path = join(root, file);
  const src = readFileSync(path, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) { console.log(`BAD MUTANT (${n} matches): ${what}`); process.exitCode = 2; continue; }
  restore = () => writeFileSync(path, src);
  writeFileSync(path, src.replace(find, replace));
  try {
    const r = spawnSync(process.execPath, TESTS, { cwd: root, encoding: 'utf8', timeout: 180_000 });
    if (r.status === 0) { survived.push(what); console.log(`SURVIVED  ${file}: ${what}`); }
    else { killed++; console.log(`killed    ${file}: ${what}`); }
  } finally {
    restore();
    restore = null;
  }
}
console.log(`\n${killed} of ${M.length} killed${survived.length ? `; survived: ${survived.join('; ')}` : ''}`);
if (survived.length) process.exitCode = 1;
