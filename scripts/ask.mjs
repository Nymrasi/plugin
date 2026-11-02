// Ask the plugin's MCP server one question the way Claude does, over stdio, and print its answer.
//   node scripts/ask.mjs scan_wallet vitalik.eth
//   node scripts/ask.mjs fix_plan 0x...
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [tool = 'scan_wallet', wallet = ''] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [join(root, 'server', 'main.ts')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.method === 'notifications/progress') process.stderr.write(`${m.params.message}\n`);
    else if (m.id === 2) {
      console.log(m.result.content.map((c) => c.text).join('\n'));
      child.stdin.end();
    }
  }
});
const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ask', version: '0' } } });
send({ method: 'notifications/initialized' });
send({ id: 2, method: 'tools/call', params: { name: tool, arguments: { wallet }, _meta: { progressToken: 1 } } });
