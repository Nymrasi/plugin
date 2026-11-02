// Copies the scan from the bot repo into this plugin, so the plugin runs the very same scan as the bot,
// the site and the ASI agent:
//   - scanbot/vendor/privacy-scan (the engine, as the bot vendored it from a commit of privacy-scan)
//   - scanbot/src/{model,relay,scanner,ens,parse}.ts (how the bot runs that engine outside a browser, holds
//     a user's own keys inside its own process, reads the result, and reads a wallet or an ENS name)
// From the bot repo's latest COMMIT (never a half-edited working tree), into vendor/scanbot/ with the same
// layout, so their relative imports work unchanged. One patch: the three files that hash with keccak import
// it from vendor/noble-hashes/ (the npm package @noble/hashes 2.4.0, MIT, three files), because a plugin
// ships without node_modules. Writes vendor/SOURCE.json with the commits and the patch.
//
//   node scripts/sync.mjs                         the engine as the bot vendored it
//   node scripts/sync.mjs --engine-from-main      the engine from privacy-scan's latest commit instead (a release
//                                                 the bot has not taken yet, such as an engine fix the server needs first)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const botsRepo = join(root, '..', 'bots');
if (!existsSync(join(botsRepo, '.git'))) throw new Error(`missing sibling repo: ${botsRepo}`);

const git = (...args) => execFileSync('git', ['-C', botsRepo, ...args], { encoding: 'utf8' }).trim();
const FILES = ['scanbot/src/model.ts', 'scanbot/src/relay.ts', 'scanbot/src/scanner.ts', 'scanbot/src/ens.ts', 'scanbot/src/parse.ts'];
const NOBLE_FROM = "'@noble/hashes/sha3.js'";
const NOBLE_TO = "'../../noble-hashes/sha3.js'";

const vendor = join(root, 'vendor', 'scanbot');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
// `git archive` from the top of the repo: run inside a subfolder with HEAD:sub it gives an empty tar.
const tar = execFileSync('git', ['-C', botsRepo, 'archive', '--format=tar', 'HEAD', 'scanbot/vendor/privacy-scan', 'scanbot/vendor/SOURCE.json', ...FILES], { maxBuffer: 256 * 1024 * 1024 });
execFileSync('tar', ['-x', '-C', vendor, '--strip-components=1'], { input: tar });

// The engine straight from privacy-scan's latest commit, in the same place and with the same parts as the bot's copy.
let engineSource = null;
if (process.argv.includes('--engine-from-main')) {
  const ps = join(root, '..', 'privacy-scan');
  if (!existsSync(join(ps, '.git'))) throw new Error(`missing sibling repo: ${ps}`);
  const psGit = (...a) => execFileSync('git', ['-C', ps, ...a], { encoding: 'utf8' }).trim();
  const dest = join(vendor, 'vendor', 'privacy-scan');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const t = execFileSync('git', ['-C', ps, 'archive', '--format=tar', 'HEAD', 'src', 'proxy/proxy.ts', 'fixtures', 'LICENSE'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dest], { input: t });
  engineSource = { repo: 'privacy-scan', commit: psGit('rev-parse', 'HEAD'), subject: psGit('log', '-1', '--format=%s'), patches: [], from: 'privacy-scan main (not through the bot)' };
}

const patched = [];
for (const f of FILES) {
  const p = join(vendor, f.replace(/^scanbot\//, ''));
  const src = readFileSync(p, 'utf8');
  if (!src.includes(NOBLE_FROM)) continue;
  writeFileSync(p, src.replaceAll(NOBLE_FROM, NOBLE_TO));
  patched.push(f);
}

// @noble/hashes: only sha3.js and the two files it imports, from an npm install of the exact version.
const NOBLE_VERSION = '2.4.0';
const nobleSrc = join(root, '..', 'asi-agent', 'node_modules', '@noble', 'hashes');
const noblePkg = JSON.parse(readFileSync(join(nobleSrc, 'package.json'), 'utf8'));
if (noblePkg.version !== NOBLE_VERSION) throw new Error(`@noble/hashes ${noblePkg.version}, want ${NOBLE_VERSION}`);
const noble = join(root, 'vendor', 'noble-hashes');
rmSync(noble, { recursive: true, force: true });
mkdirSync(noble, { recursive: true });
for (const f of ['sha3.js', 'sha3.d.ts', '_u64.js', '_u64.d.ts', 'utils.js', 'utils.d.ts', 'LICENSE']) cpSync(join(nobleSrc, f), join(noble, f));
writeFileSync(join(noble, 'package.json'), JSON.stringify({ name: '@noble/hashes', version: NOBLE_VERSION, type: 'module', license: 'MIT' }, null, 2) + '\n');

const botSource = JSON.parse(readFileSync(join(vendor, 'vendor', 'SOURCE.json'), 'utf8'));
rmSync(join(vendor, 'vendor', 'SOURCE.json'));
const source = {
  syncedAt: new Date().toISOString(),
  bots: { repo: 'bots', commit: git('rev-parse', 'HEAD'), subject: git('log', '-1', '--format=%s'), files: FILES },
  engine: engineSource ?? botSource.engine,
  patches: patched.map((f) => `${f}: ${NOBLE_FROM} -> ${NOBLE_TO}`),
  noble: { package: '@noble/hashes', version: NOBLE_VERSION, files: ['sha3.js', '_u64.js', 'utils.js'], integrity: 'sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==' },
};
writeFileSync(join(root, 'vendor', 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
console.log(`synced bots ${source.bots.commit.slice(0, 7)}, engine ${source.engine.commit.slice(0, 7)}, ${patched.length} files patched for noble`);
