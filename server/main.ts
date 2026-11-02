// The Nymra Privacy Scan as a local MCP server: Claude Code (or Cowork on this computer) starts it with
// `node server/main.ts` and talks to it over stdin and stdout. Node 22.18 or newer runs the TypeScript as is.
import { createInterface } from 'node:readline';
import { readKeys } from './keys.ts';
import { createServer } from './mcp.ts';
import { INSTRUCTIONS, VERSION } from './info.ts';
import { createTools, TOOLS } from './tools.ts';

const tools = createTools({ keys: readKeys() });
const server = createServer({ name: 'nymra-privacy-scan', title: 'Nymra Privacy Scan', version: VERSION, instructions: INSTRUCTIONS }, { tools: TOOLS, call: tools.call }, (line) => {
  process.stdout.write(line + '\n');
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => server.push(line));
// The client closed stdin: finish what runs, then leave.
rl.on('close', () => { void server.idle().then(() => process.exit(0)); });
