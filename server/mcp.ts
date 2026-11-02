// A Model Context Protocol server over stdio, small enough to read in one sitting: JSON-RPC 2.0, one message
// per line on stdin and stdout (the MCP stdio transport). It answers initialize, ping, tools/list and
// tools/call, sends progress while a scan runs when the client asks for it, and drops the answer of a call
// the client cancelled. Nothing is written to stderr or to a file: a message holds the wallet asked about.
import type { ToolResult } from './tools.ts';

/** Protocol versions this server speaks; it answers with the client's when it is one of these. */
export const VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
export const LATEST = VERSIONS[VERSIONS.length - 1];

type Id = string | number;
interface Message { jsonrpc?: string; id?: Id | null; method?: string; params?: any }

export interface ServerInfo { name: string; title: string; version: string; instructions: string }

export interface Handler {
  tools: unknown[];
  call(name: string, args: Record<string, unknown> | undefined, progress?: (done: number, total: number) => void): Promise<ToolResult>;
}

export const ERR = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603 } as const;

/**
 * Feeds lines in, sends lines out. `send` gets one JSON text per message, without the newline.
 * Returns `push(line)` for each line read and `idle()`, which resolves once every call in flight has answered.
 */
export function createServer(info: ServerInfo, h: Handler, send: (line: string) => void) {
  const cancelled = new Set<Id>();
  const running = new Set<Id>();
  const inflight = new Set<Promise<void>>();
  const out = (m: object) => send(JSON.stringify({ jsonrpc: '2.0', ...m }));
  const reply = (id: Id, result: unknown) => out({ id, result });
  const fail = (id: Id | null, code: number, message: string) => out({ id, error: { code, message } });

  async function onCall(id: Id, params: any) {
    const name = params?.name;
    if (typeof name !== 'string') return fail(id, ERR.params, 'tools/call needs a tool name');
    const token = params?._meta?.progressToken;
    const progress = token === undefined ? undefined : (done: number, total: number) => {
      if (!cancelled.has(id)) out({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message: `Read ${done} of ${total} chains` } });
    };
    let result: ToolResult;
    try {
      result = await h.call(name, params?.arguments ?? undefined, progress);
    } catch {
      result = { content: [{ type: 'text', text: 'The scan could not finish this time. Try again in a few minutes.' }], isError: true };
    }
    running.delete(id);
    if (cancelled.delete(id)) return;
    reply(id, result);
  }

  function handle(m: Message) {
    const isRequest = m.id !== undefined && m.id !== null;
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
      if (isRequest) fail(m.id as Id, ERR.invalid, 'not a JSON-RPC 2.0 request');
      return;
    }
    if (!isRequest) {
      // Notifications: initialized, cancelled, roots changes. Only a cancel changes anything.
      if (m.method === 'notifications/cancelled' && running.has(m.params?.requestId)) cancelled.add(m.params.requestId);
      return;
    }
    const id = m.id as Id;
    switch (m.method) {
      case 'initialize': {
        const asked = m.params?.protocolVersion;
        return reply(id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : LATEST,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, title: info.title, version: info.version },
          instructions: info.instructions,
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: h.tools });
      case 'tools/call': {
        running.add(id);
        const p = onCall(id, m.params).finally(() => { inflight.delete(p); running.delete(id); cancelled.delete(id); });
        inflight.add(p);
        return;
      }
      default:
        return fail(id, ERR.method, `method not found: ${m.method}`);
    }
  }

  function push(line: string) {
    const t = line.trim();
    if (!t) return;
    let msg: unknown;
    try {
      msg = JSON.parse(t);
    } catch {
      return fail(null, ERR.parse, 'parse error');
    }
    // A batch is not part of the protocol since 2025-06-18; answer each message in it anyway.
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (m && typeof m === 'object') handle(m as Message);
      else fail(null, ERR.invalid, 'not a JSON-RPC 2.0 request');
    }
  }

  const idle = async () => { while (inflight.size) await Promise.all([...inflight]); };
  return { push, idle };
}
