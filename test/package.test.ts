// The plugin as Anthropic's directory and Claude Code read it, and the promises its README makes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { CHAINS, defaultChainIds } from '../vendor/scanbot/vendor/privacy-scan/src/chains.ts';
import { ETH_RPCS } from '../vendor/scanbot/src/ens.ts';
import { CONFIG_ENV, KEY_ENV, KEY_OPTION, type KeyName } from '../server/keys.ts';
import { INSTRUCTIONS } from '../server/info.ts';
import { TOOLS } from '../server/tools.ts';
import { read, ROOT } from './helpers.ts';

const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
const mcp = JSON.parse(read('.mcp.json'));
const market = JSON.parse(read('.claude-plugin/marketplace.json'));

/** Every file git would ship (tracked or new, not ignored). */
function shipped(): string[] {
  try {
    return execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    const out: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = join(d, e.name); e.isDirectory() ? walk(p) : out.push(relative(ROOT, p)); } };
    walk(ROOT);
    return out;
  }
}

test('manifest: a lasting name of our own, Nymra as author, a license, a version', () => {
  assert.equal(plugin.name, 'nymra-privacy-scan');
  assert.match(plugin.name, /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
  assert.equal(plugin.author.name, 'Nymra');
  assert.equal(plugin.license, 'MIT');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './');
});

test('the MCP server starts as node on a file in the plugin, with plain arguments', () => {
  const s = mcp.mcpServers['nymra-privacy-scan'];
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/server/main.ts']);
  assert.ok(!('url' in s) && !('type' in s && s.type !== 'stdio'));
});

test('every key option is optional, masked, empty by default, and reaches exactly its own variable', () => {
  const opts = plugin.userConfig;
  const env = mcp.mcpServers['nymra-privacy-scan'].env;
  const want: Record<string, string> = Object.fromEntries((Object.keys(KEY_OPTION) as KeyName[]).map((k) => [KEY_OPTION[k], CONFIG_ENV[k]]));
  assert.deepEqual(Object.keys(opts).sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) {
    assert.equal(opts[k].sensitive, true, k);
    assert.equal(opts[k].required, false, k);
    assert.equal(opts[k].default, '', k);
    assert.equal(env[v], `\${user_config.${k}}`, k);
  }
  assert.deepEqual(Object.keys(env).sort(), Object.values(want).sort());
});

test('the directory checks: README of 40 words and more, a LICENSE, no system files, small files, few files', () => {
  const words = read('README.md').replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 40, `${words} words`);
  assert.match(read('LICENSE'), /^MIT License/);
  const files = shipped();
  assert.ok(files.length <= 512, `${files.length} files`);
  for (const f of files) {
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)$/.test(f), f);
    assert.ok(!/(^|\/)(\.npmrc|bunfig\.toml|uv\.toml|package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?)$/.test(f), f);
    // The engine's exchange list is the one file above 256 KiB (a reviewer reads it; it is data).
    if (f !== 'vendor/scanbot/vendor/privacy-scan/src/data/cex.json') assert.ok(statSync(join(ROOT, f)).size < 256 * 1024, `${f} is too big`);
  }
});

test('the README tells where each key comes from and both places it may go, and never the chat', () => {
  const readme = read('README.md');
  for (const v of Object.values(KEY_ENV)) assert.ok(readme.includes(`\`${v}\``), v);
  for (const u of ['https://dashboard.alchemy.com/signup', 'https://dev.blockscout.com', 'https://nodereal.io/meganode']) assert.ok(readme.includes(u), u);
  assert.ok(readme.includes('/plugin configure nymra-privacy-scan@nymra'));
  assert.match(readme, /Never paste a key into the chat:\*\* everything typed there reaches your AI provider/);
  // The settings variables are the plugin's own, never the names a user sets in a shell.
  for (const k of Object.keys(KEY_ENV) as KeyName[]) assert.notEqual(CONFIG_ENV[k], KEY_ENV[k]);
});

test('the README names every host the scan can reach', () => {
  const readme = read('README.md');
  const on = new Set(defaultChainIds());
  const hosts = new Set<string>(['bens.services.blockscout.com', 'api.blockscout.com', ...ETH_RPCS.map((u) => new URL(u).host)]);
  for (const c of CHAINS) {
    if (c.retired || !on.has(c.id)) continue;
    for (const s of [c.source, c.alt, c.keyedAlt, c.gapAlt]) if (s) hosts.add(new URL(s.api).host);
    if (c.rpc) hosts.add(new URL(c.rpc).host);
  }
  for (const h of hosts) assert.ok(readme.includes(`\`${h}\``), h);
});

const WORDS: Array<[string, string]> = [
  ['README.md', read('README.md')],
  ['SKILL.md', read('skills/wallet-privacy/SKILL.md')],
  ['commands/scan.md', read('commands/scan.md')],
  ['plugin.json', read('.claude-plugin/plugin.json')],
  ['marketplace.json', read('.claude-plugin/marketplace.json')],
  ['tools', JSON.stringify(TOOLS)],
  ['instructions', INSTRUCTIONS],
];

test('house rules in every text people read: no em dash, en dash or middle dot, no "free", nothing "not built"', () => {
  for (const [name, t] of WORDS) {
    assert.ok(!/[—–·]/.test(t), `${name}: dash or middle dot`);
    assert.ok(!/\bfree\b/i.test(t), `${name}: "free"`);
    assert.ok(!/not (yet )?built|coming soon|not live yet|in development/i.test(t), `${name}: not built`);
  }
});

test('the honest line: the scan is local, the chat reaches the AI provider', () => {
  assert.match(read('README.md'), /The scan runs on your computer and Nymra receives nothing\. What you type in the chat, the wallet included, reaches your AI provider/);
  assert.match(read('skills/wallet-privacy/SKILL.md'), /reaches the AI provider/);
});

test('only the Privacy Score and the fix plan: no Before you send and no Compare', () => {
  for (const [name, t] of WORDS) assert.ok(!/before you send|compare wallets|\bcompare\b/i.test(t), name);
});

test('the skill: a key belongs in the settings or the own environment, never in the chat, and is never repeated', () => {
  const s = read('skills/wallet-privacy/SKILL.md');
  assert.match(s, /If someone pastes an API key, do not repeat it and do not pass it to a tool/);
  assert.match(s, /\/plugin configure nymra-privacy-scan@nymra/);
  assert.match(s, /Never offer to take the key in the chat\./);
});

test('the skill: frontmatter with its folder name and one description line', () => {
  const s = read('skills/wallet-privacy/SKILL.md');
  const fm = s.match(/^---\n([\s\S]*?)\n---\n/)![1];
  assert.match(fm, /^name: wallet-privacy$/m);
  assert.match(fm, /^description: .{60,}$/m);
});
