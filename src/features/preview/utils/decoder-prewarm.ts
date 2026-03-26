/**
 * Main-thread manager for the decoder prewarm Web Worker.
 *
 * Sends pre-seek requests to a background worker that runs mediabunny WASM
 * decode off the main thread. The worker returns decoded ImageBitmaps that
 * the render loop can draw directly — zero main-thread WASM work.
 *
 * This eliminates the 300-500ms keyframe seek stall when occluded variable-
 * speed clips become visible mid-playback.
 */

import { createLogger } from '@/shared/logging/logger';

const log = createLogger('DecoderPrewarm');
const MAX_CACHED_BITMAPS_PER_SOURCE = 6;
const PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS = 1 / 240;

export interface DecoderPrewarmMetricsSnapshot {
  requests: number;
  cacheHits: number;
  inflightReuses: number;
  workerPosts: number;
  workerSuccesses: number;
  workerFailures: number;
  waitRequests: number;
  waitMatches: number;
  waitResolved: number;
  waitTimeouts: number;
  cacheSources: number;
  cacheBitmaps: number;
}

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<string, {
  resolve: (bitmap: ImageBitmap | null) => void;
}>();

/** Cache of pre-decoded bitmaps keyed by video source URL. Multiple entries per source. */
type CachedBitmapEntry = { bitmap: ImageBitmap; timestamp: number };
const bitmapCache = new Map<string, CachedBitmapEntry[]>();

type InflightPreseek = {
  timestamp: number;
  promise: Promise<ImageBitmap | null>;
};

const decoderPrewarmMetrics: DecoderPrewarmMetricsSnapshot = {
  requests: 0,
  cacheHits: 0,
  inflightReuses: 0,
  workerPosts: 0,
  workerSuccesses: 0,
  workerFailures: 0,
  waitRequests: 0,
  waitMatches: 0,
  waitResolved: 0,
  waitTimeouts: 0,
  cacheSources: 0,
  cacheBitmaps: 0,
};

/** In-flight preseek promises keyed by source URL — lets the render engine await
 *  a pending worker decode instead of falling through to a blocking main-thread decode. */
const inflightPreseekBySrc = new Map<string, InflightPreseek[]>();

// Dev: expose cache for debugging
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__PREWARM_CACHE__ = bitmapCache;
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    log.info('Creating decoder prewarm worker');
    worker = new Worker(
      new URL('../workers/decoder-prewarm-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      // eslint-disable-next-line no-console
      console.log('[DecoderPrewarm]', msg.type, msg.step || '', msg.success, msg.error || '', msg.src || '', !!msg.bitmap);
      if (msg.type === 'preseek_done') {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          pending.resolve(msg.bitmap ?? null);
        }
      }
    };
    worker.onerror = (error) => {
      log.warn('Decoder prewarm worker error', { message: error.message, filename: error.filename, lineno: error.lineno });
    };
    worker.addEventListener('messageerror', (e) => {
      log.warn('Decoder prewarm worker message error', { data: e.data });
    });
    return worker;
  } catch (error) {
    log.warn('Failed to create decoder prewarm worker', { error });
    return null;
  }
}

function findClosestBitmapEntry(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): CachedBitmapEntry | null {
  const entries = bitmapCache.get(src);
  if (!entries || entries.length === 0) return null;

  let best: CachedBitmapEntry | null = null;
  let bestDist = Infinity;
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp);
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }

  return best;
}

function findMatchingInflightPreseek(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): InflightPreseek | null {
  const entries = inflightPreseekBySrc.get(src);
  if (!entries || entries.length === 0) return null;

  let best: InflightPreseek | null = null;
  let bestDist = Infinity;
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp);
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }

  return best;
}

function cachePredecodedBitmap(src: string, timestamp: number, bitmap: ImageBitmap): void {
  const entries = bitmapCache.get(src) ?? [];
  entries.push({ bitmap, timestamp });
  while (entries.length > MAX_CACHED_BITMAPS_PER_SOURCE) {
    const old = entries.shift();
    old?.bitmap.close();
  }
  bitmapCache.set(src, entries);
  decoderPrewarmMetrics.cacheSources = bitmapCache.size;
  decoderPrewarmMetrics.cacheBitmaps = [...bitmapCache.values()].reduce((sum, sourceEntries) => sum + sourceEntries.length, 0);
}

function addInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src) ?? [];
  entries.push(entry);
  inflightPreseekBySrc.set(src, entries);
}

function removeInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src);
  if (!entries || entries.length === 0) return;

  const filtered = entries.filter((candidate) => candidate !== entry);
  if (filtered.length === 0) {
    inflightPreseekBySrc.delete(src);
    return;
  }

  inflightPreseekBySrc.set(src, filtered);
}

/**
 * Pre-decode a video frame in a background Web Worker.
 * Returns the decoded ImageBitmap or null on failure.
 * The bitmap is also cached by source URL for the render loop to use.
 */
/** Cache of fetched blobs to avoid re-fetching for the same source. */
const blobByUrl = new Map<string, Blob>();

export function backgroundPreseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  decoderPrewarmMetrics.requests += 1;

  const cachedBitmap = getCachedPredecodedBitmap(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  );
  if (cachedBitmap) {
    decoderPrewarmMetrics.cacheHits += 1;
    return Promise.resolve(cachedBitmap);
  }

  const inflightMatch = findMatchingInflightPreseek(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  );
  if (inflightMatch) {
    decoderPrewarmMetrics.inflightReuses += 1;
    return inflightMatch.promise;
  }

  const id = `preseek-${++requestId}`;
  const promise = new Promise<ImageBitmap | null>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, 5000);

    pendingRequests.set(id, {
      resolve: (bitmap) => {
        clearTimeout(timeout);
        if (bitmap) {
          decoderPrewarmMetrics.workerSuccesses += 1;
          cachePredecodedBitmap(src, timestamp, bitmap);
        } else {
          decoderPrewarmMetrics.workerFailures += 1;
        }
        resolve(bitmap);
      },
    });

    // Send the blob directly to avoid slow UrlSource fetch in the worker.
    // Blobs are transferred via structured clone — fast and avoids re-fetch.
    decoderPrewarmMetrics.workerPosts += 1;
    const cachedBlob = blobByUrl.get(src);
    if (cachedBlob) {
      w.postMessage({ type: 'preseek', id, src, timestamp, blob: cachedBlob });
    } else if (src.startsWith('blob:')) {
      // Fetch the blob URL to get the actual Blob, then send it
      void fetch(src).then((r) => r.blob()).then((blob) => {
        blobByUrl.set(src, blob);
        w.postMessage({ type: 'preseek', id, src, timestamp, blob });
      }).catch(() => {
        // Fallback to UrlSource
        w.postMessage({ type: 'preseek', id, src, timestamp });
      });
    } else {
      w.postMessage({ type: 'preseek', id, src, timestamp });
    }
  });
  const inflightEntry: InflightPreseek = { timestamp, promise };
  addInflightPreseek(src, inflightEntry);
  void promise.finally(() => {
    removeInflightPreseek(src, inflightEntry);
  });
  return promise;
}

/**
 * Get a pre-decoded bitmap from the cache for a video source.
 * Returns the bitmap if it exists and is for a nearby timestamp.
 */
export function getCachedPredecodedBitmap(src: string, timestamp: number, toleranceSeconds = 0.5): ImageBitmap | null {
  return findClosestBitmapEntry(src, timestamp, toleranceSeconds)?.bitmap ?? null;
}

/**
 * Get the in-flight preseek promise for a source, if one is pending.
 * The render engine can await this instead of starting a blocking
 * main-thread mediabunny decode — the worker is already doing the work.
 */
export function getInflightPreseek(src: string): Promise<ImageBitmap | null> | null {
  const entries = inflightPreseekBySrc.get(src);
  const lastEntry = entries && entries.length > 0 ? entries[entries.length - 1] : null;
  return lastEntry?.promise ?? null;
}

export async function waitForInflightPredecodedBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = 0.5,
  maxWaitMs = 12,
): Promise<ImageBitmap | null> {
  decoderPrewarmMetrics.waitRequests += 1;
  const inflight = findMatchingInflightPreseek(src, timestamp, toleranceSeconds);
  if (!inflight) return null;
  decoderPrewarmMetrics.waitMatches += 1;

  let resolved: ImageBitmap | null = null;
  if (maxWaitMs <= 0) {
    resolved = await inflight.promise;
    if (resolved) {
      decoderPrewarmMetrics.waitResolved += 1;
    }
  } else {
    resolved = await new Promise<ImageBitmap | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        decoderPrewarmMetrics.waitTimeouts += 1;
        resolve(null);
      }, maxWaitMs);

      void inflight.promise.then((bitmap) => {
        clearTimeout(timeoutId);
        if (bitmap) {
          decoderPrewarmMetrics.waitResolved += 1;
        }
        resolve(bitmap);
      }).catch(() => {
        clearTimeout(timeoutId);
        resolve(null);
      });
    });
  }

  if (!resolved) {
    return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds);
  }

  return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds) ?? resolved;
}

/**
 * Clear cached bitmaps for a source.
 */
export function clearPredecodedCache(src?: string): void {
  if (src) {
    const entries = bitmapCache.get(src);
    if (entries) {
      for (const entry of entries) entry.bitmap.close();
    }
    bitmapCache.delete(src);
    blobByUrl.delete(src);
  } else {
    for (const entries of bitmapCache.values()) {
      for (const entry of entries) entry.bitmap.close();
    }
    bitmapCache.clear();
    blobByUrl.clear();
  }
  decoderPrewarmMetrics.cacheSources = bitmapCache.size;
  decoderPrewarmMetrics.cacheBitmaps = [...bitmapCache.values()].reduce((sum, sourceEntries) => sum + sourceEntries.length, 0);
}

/**
 * Dispose the worker and clean up.
 */
export function disposePrewarmWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const pending of pendingRequests.values()) {
    pending.resolve(null);
  }
  pendingRequests.clear();
  inflightPreseekBySrc.clear();
  clearPredecodedCache();
}

export function getDecoderPrewarmMetricsSnapshot(): DecoderPrewarmMetricsSnapshot {
  return { ...decoderPrewarmMetrics };
}
