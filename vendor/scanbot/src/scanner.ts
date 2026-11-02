// The site's engine, run server side. One place decides how a scan reaches the explorers: the
// relay road (relay.ts), remote, local or none. Two people asking for the same wallet at the same
// moment share one scan; the entry is gone the moment the answer exists. Nothing is cached after
// that: the engine's own 10-minute answer cache (meant for a browser tab) is switched off here.
import { CHAIN_BY_ID, defaultChainIds, UNSUPPORTED } from '../vendor/privacy-scan/src/chains.ts';
import { scan as engineScan } from '../vendor/privacy-scan/src/index.ts';
import type { ScanResult } from '../vendor/privacy-scan/src/types.ts';
import { createRoad, type RoadKind, type RoadOptions, type RoadStats } from './relay.ts';

export type OnChain = (done: number, total: number) => void;

export interface Scanner {
  scan(address: string, onChain?: OnChain): Promise<ScanResult>;
  /** Chains a default scan reads (shown in the "Scanning" message). */
  readonly chainCount: number;
  /** How walled and keyed sources are reached (for the health line and the start log). */
  readonly road: RoadKind;
  readonly stats?: RoadStats;
}

export interface ScannerOptions extends RoadOptions {
  timeoutMs: number;
  /** Override the engine (tests). */
  engine?: typeof engineScan;
}

export function createScanner(o: ScannerOptions): Scanner {
  const road = createRoad(o);
  const run = o.engine ?? engineScan;
  const inflight = new Map<string, Promise<ScanResult>>();
  const chainIds = defaultChainIds();

  return {
    chainCount: chainIds.length,
    road: road.kind,
    stats: road.stats,
    scan(address, onChain) {
      const key = address.toLowerCase();
      const running = inflight.get(key);
      if (running) return running;
      let done = 0;
      const total = chainIds.length;
      const p = run(key, {
        chainIds: [...chainIds, ...UNSUPPORTED.map((u) => u.id)],
        fetch: road.fetch,
        ...(road.relay ? { fallbackProxy: road.relay, relay: road.relay } : {}),
        // Base and Polygon through Alchemy, only when this road's relay holds that key.
        ...(road.keyedAlts.length ? { keyedAlts: road.keyedAlts } : {}),
        cache: false,
        // The engine stops in time on its own and lists what it did not read (result.incomplete),
        // so a slow explorer gives a partial card, not an apology; the signal is the hard stop.
        timeLimitMs: Math.max(5_000, o.timeoutMs - 10_000),
        signal: AbortSignal.timeout(o.timeoutMs),
        requestTimeoutMs: 12_000,
        onProgress: (e) => {
          if (e.type === 'chain' && CHAIN_BY_ID.has(e.coverage.chainId)) onChain?.(++done, total);
        },
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}
