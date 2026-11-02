import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, ERR, LATEST, VERSIONS, type Handler } from '../server/mcp.ts';
import type { ToolResult } from '../server/tools.ts';

const INFO = { name: 'nymra-privacy-scan', title: 'Nymra Privacy Scan', version: '0.1.0', instructions: 'read only' };

function harness(call?: Handler['call']) {
  const sent: any[] = [];
  const h: Handler = { tools: [{ name: 'scan_wallet' }], call: call ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })) };
  const s = createServer(INFO, h, (line) => sent.push(JSON.parse(line)));
  const push = (m: object) => s.push(JSON.stringify(m));
  return { sent, push, s };
}

test('initialize: the client version when it is one we speak, else the latest; tools only', () => {
  for (const v of VERSIONS) {
    const { sent, push } = harness();
    push({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } });
    assert.equal(sent[0].result.protocolVersion, v);
    assert.deepEqual(sent[0].result.capabilities, { tools: { listChanged: false } });
    assert.equal(sent[0].result.serverInfo.name, 'nymra-privacy-scan');
    assert.equal(sent[0].result.instructions, 'read only');
  }
  const { sent, push } = harness();
  push({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.equal(sent[0].result.protocolVersion, LATEST);
  assert.equal(sent[0].id, 'a');
});

test('ping, tools/list, and an unknown method', () => {
  const { sent, push } = harness();
  push({ jsonrpc: '2.0', id: 1, method: 'ping' });
  push({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  push({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
  assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 1, result: {} });
  assert.deepEqual(sent[1].result, { tools: [{ name: 'scan_wallet' }] });
  assert.equal(sent[2].error.code, ERR.method);
});

test('notifications get no answer; bad JSON and a non-request get an error', () => {
  const { sent, push, s } = harness();
  push({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(sent.length, 0);
  s.push('{not json');
  assert.equal(sent[0].error.code, ERR.parse);
  push({ id: 9, method: 'ping' });
  assert.equal(sent[1].error.code, ERR.invalid);
  s.push('   ');
  assert.equal(sent.length, 2);
});

test('tools/call: the handler gets the name and the arguments, the answer carries the id', async () => {
  const got: unknown[] = [];
  const { sent, push, s } = harness(async (name, args) => { got.push(name, args); return { content: [{ type: 'text', text: 'done' }] }; });
  push({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'scan_wallet', arguments: { wallet: 'x.eth' } } });
  await s.idle();
  assert.deepEqual(got, ['scan_wallet', { wallet: 'x.eth' }]);
  assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'done' }] } });
});

test('tools/call without a name is a params error', async () => {
  const { sent, push, s } = harness();
  push({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} });
  await s.idle();
  assert.equal(sent[0].error.code, ERR.params);
});

test('progress is sent only when the client gave a token, with that token', async () => {
  const call: Handler['call'] = async (_n, _a, progress) => { progress?.(1, 2); progress?.(2, 2); return { content: [] }; };
  const a = harness(call);
  a.push({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'scan_wallet', arguments: {}, _meta: { progressToken: 'tok' } } });
  await a.s.idle();
  assert.deepEqual(a.sent.slice(0, 2).map((m) => [m.method, m.params.progressToken, m.params.progress, m.params.total]), [['notifications/progress', 'tok', 1, 2], ['notifications/progress', 'tok', 2, 2]]);
  assert.equal(a.sent[2].id, 1);
  const b = harness(call);
  b.push({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'scan_wallet', arguments: {} } });
  await b.s.idle();
  assert.equal(b.sent.length, 1);
});

test('a cancelled call gets no answer; a cancel for a call already answered changes nothing', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { sent, push, s } = harness(async () => { await gate; return { content: [{ type: 'text', text: 'late' }] } as ToolResult; });
  push({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'scan_wallet' } });
  push({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } });
  release();
  await s.idle();
  assert.equal(sent.length, 0);
  push({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 6 } });
  push({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'scan_wallet' } });
  await s.idle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 6);
});

test('a handler that throws still answers, with the retry line and nothing of the error', async () => {
  const { sent, push, s } = harness(async () => { throw new Error('https://secret.invalid/0xabc'); });
  push({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'scan_wallet' } });
  await s.idle();
  assert.equal(sent[0].result.isError, true);
  assert.ok(!JSON.stringify(sent[0]).includes('secret'));
});

test('a batch is answered message by message', () => {
  const { sent, s } = harness();
  s.push(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]));
  assert.deepEqual(sent.map((m) => m.id), [1, 2]);
});
