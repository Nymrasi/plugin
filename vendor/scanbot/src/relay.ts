// The bot's road to the explorers that refuse a server and to the keyed source (BNB Smart Chain;
// Linea is read without a key since engine a1ffb02): the site's relay (vendor/privacy-scan/proxy/proxy.ts), the same code the site serves at
// nymra.si/p. Three ways to run it:
//   remote  RELAY_URL + RELAY_TOKEN: a hosted relay holds the API keys, and the bot is its one server
//           caller (Authorization: Bearer RELAY_TOKEN).
//   local   the bot holds the keys itself (BLOCKSCOUT_PRO_KEY, ETHERSCAN_API_KEY, NODEREAL_API_KEY,
//           ALCHEMY_API_KEY) and runs the relay's handle() in its own process, at an address that never
//           leaves it. With the Alchemy key the engine reads Base and Polygon through Alchemy (keyedAlts).
//   none    keyless: the four walled explorers and the keyed chain come back as not read, and the
//           card says so.
// The engine decides when the relay is used: after a direct read was refused (bot wall or rate
// limit), and always for a keyed chain. A host that answered with a bot wall is remembered for ten
// minutes, so its next reads go to the relay without knocking on the wall again. That is the only
// state kept, and it holds hosts, never an address.
import { randomBytes } from 'node:crypto';
import { handle, type ProxyEnv, type RateLimiter } from '../vendor/privacy-scan/proxy/proxy.ts';

export type RoadKind = 'remote' | 'local' | 'none';

export interface RoadStats {
  /** Requests that went through the relay. */
  relayed: number;
  /** Direct reads skipped because the host walled us within the last ten minutes. */
  wallSkips: number;
}

export interface Road {
  kind: RoadKind;
  /** For the engine's `fallbackProxy` and `relay`; undefined when there is none. */
  relay?: string;
  /** The engine's `keyedAlts`: keyed second sources this road's relay holds the key of. */
  keyedAlts: Array<'alchemy'>;
  fetch: typeof fetch;
  stats: RoadStats;
}

export interface RoadOptions {
  relayUrl?: string;
  relayToken?: string;
  keys?: { pro?: string; etherscan?: string; nodereal?: string; alchemy?: string };
  fetch?: typeof fetch;
  now?: () => number;
  /** Least time between two relayed requests (tests); default RELAY_GAP_MS. */
  relayGapMs?: number;
  /** Least time between two relayed Alchemy calls (tests); default ALCHEMY_GAP_MS. */
  alchemyGapMs?: number;
}

/**
 * The local relay starts its requests at least this far apart: 4 a second. The PRO API's free plan
 * allows 5 a second, and the engine fires a chain's lists together, several chains at once; without a
 * gap PRO answered 429 eight times in one scan (17-10, BASEPRO) and Arbitrum's internal transfers went
 * missing. Direct reads are never held back.
 */
export const RELAY_GAP_MS = 250;
/**
 * And its Alchemy calls at least this far apart: 2 a second. Alchemy's free plan allows 300 compute units
 * a second per app and one transfer list costs 120, so 2.5 calls a second over Base and Polygon together
 * (one app, ALCHEMY 17-10). The other relayed requests keep their own gap.
 */
export const ALCHEMY_GAP_MS = 500;

/** Never resolves (RFC 2606 reserves .invalid): the local relay exists only inside this process. */
export const LOCAL_RELAY = 'https://relay.invalid/p';
const WALL_MS = 10 * 60_000;
/** The bot is the local relay's only caller; its own limits per person and per group apply before. */
const UNLIMITED: RateLimiter = { limit: async () => ({ success: true }) };

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
/** A relayed call to one of Alchemy's hosts (the target is in `?u=`). */
const toAlchemy = (url: string) => { try { return new URL(new URL(url).searchParams.get('u') ?? '').host.endsWith('.g.alchemy.com'); } catch { return false; } };

/** Each call takes the next free start, `gap` after the one before it (in order of arrival). */
function pacer(gap: number): () => Promise<void> {
  let nextStart = 0;
  return async () => {
    const t = performance.now();
    const at = Math.max(t, nextStart);
    nextStart = at + gap;
    if (at > t) await new Promise((r) => setTimeout(r, at - t));
  };
}
const isWall = (res: Response) => res.status === 403 && /text\/html/i.test(res.headers.get('content-type') ?? '');
/** What a bot wall looks like to the engine (http.ts): a 403 with an HTML page. */
const wallAnswer = () => new Response('<!doctype html><title>Just a moment...</title>', { status: 403, headers: { 'content-type': 'text/html' } });

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function createRoad(o: RoadOptions = {}): Road {
  const base = o.fetch ?? globalThis.fetch.bind(globalThis);
  const now = o.now ?? Date.now;
  const stats: RoadStats = { relayed: 0, wallSkips: 0 };
  const walls = new Map<string, number>();
  const keys = o.keys ?? {};
  const kind: RoadKind = o.relayUrl && o.relayToken ? 'remote' : keys.pro || keys.etherscan || keys.nodereal || keys.alchemy ? 'local' : 'none';

  async function direct(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const host = new URL(urlOf(input)).host;
    const until = walls.get(host);
    if (until !== undefined) {
      if (until > now()) { stats.wallSkips++; return wallAnswer(); }
      walls.delete(host);
    }
    const res = await base(input, init);
    if (isWall(res)) walls.set(host, now() + WALL_MS);
    return res;
  }

  if (kind === 'remote') {
    const relay = o.relayUrl!;
    const token = o.relayToken!;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).startsWith(`${relay}?`)) return direct(input, init);
      stats.relayed++;
      return base(urlOf(input), withAuth(init, token));
    }) as typeof fetch;
    return { kind, relay, keyedAlts: [], fetch: f, stats };
  }

  if (kind === 'local') {
    const token = randomBytes(24).toString('hex');
    const paced = pacer(o.relayGapMs ?? RELAY_GAP_MS);
    const alchemyPaced = pacer(o.alchemyGapMs ?? ALCHEMY_GAP_MS);
    const env: ProxyEnv = { BLOCKSCOUT_PRO_KEY: keys.pro, ETHERSCAN_API_KEY: keys.etherscan, NODEREAL_API_KEY: keys.nodereal, ALCHEMY_API_KEY: keys.alchemy, BOT_TOKEN: token, RATE_LIMIT: UNLIMITED };
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (!url.startsWith(`${LOCAL_RELAY}?`)) return direct(input, init);
      stats.relayed++;
      await paced();
      if (toAlchemy(url)) await alchemyPaced();
      const a = withAuth(init, token);
      return handle(new Request(url, { method: a.method ?? 'GET', headers: a.headers, body: a.body, signal: a.signal }), env);
    }) as typeof fetch;
    return { kind, relay: LOCAL_RELAY, keyedAlts: keys.alchemy ? ['alchemy'] : [], fetch: f, stats };
  }

  return { kind, keyedAlts: [], fetch: direct as typeof fetch, stats };
}
