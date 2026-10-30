import type { SkImage } from '@shopify/react-native-skia';
import type { TileRef } from './viewport';

/** JS time spent rendering tiles before yielding, so view updates aren't held up. */
const SLICE_MS = 8;
/** Memory for rendered tiles (4 bytes per pixel). */
const BUDGET_BYTES = 96 * 1024 * 1024;
/** A replaced or evicted image is only freed after this long (it may still be on screen). */
const KEEP_MS = 1000;
/**
 * Outdated tiles still show their old image, so they are redone one per frame:
 * each new image is uploaded to the GPU when first drawn, and a burst of them
 * after a snapshot would land in the same frame.
 */
const REDO_GAP_MS = 16;

/** Renders one tile at a scale (pixels per picture pixel); null when the tile is empty. */
export type RenderTile = (chunk: number, pxPerUnit: number) => SkImage | null;
/** A number that only changes when a tile's image would change (see `invalidate`). */
export type TileSignature = (chunk: number) => number;

type Entry = { image: SkImage | null; bytes: number; usedAt: number; stale: boolean; signature: number };
export type TileRequest = TileRef & { tier: number };

/**
 * Pre-rendered tile images of one map layer, per zoom tier. Tiles are
 * rendered in the background, nearest to the view first; `onReady` is called
 * when new ones are available. After `invalidate()` (the layer's data changed)
 * tiles whose signature changed are rendered again, and the old image stays
 * visible until the new one is ready. Unchanged tiles keep their image, so the
 * UI thread doesn't have to upload it again. Least recently drawn tiles are freed when the memory budget is
 * exceeded.
 */
export class TileImages {
  private entries = new Map<string, Entry>();
  private queue: TileRequest[] = [];
  /** Tiles of the current view (any tier): never freed. */
  private wanted = new Set<number>();
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private render: RenderTile,
    /** Without one, every tile counts as changed on `invalidate`. */
    private signature: TileSignature | null,
    /** Pixels per picture pixel for each tier. */
    private tierScales: readonly number[],
    private onReady: () => void,
  ) {}

  /** The image of a tile at a tier, or at any other tier as a stand-in. */
  get(chunk: number, tier: number): SkImage | null {
    const now = Date.now();
    const exact = this.entries.get(key(chunk, tier));
    if (exact) {
      exact.usedAt = now;
      return exact.image;
    }
    for (let t = this.tierScales.length - 1; t >= 0; t--) {
      const other = this.entries.get(key(chunk, t));
      if (other) {
        other.usedAt = now;
        return other.image;
      }
    }
    return null;
  }

  /** Replaces the wanted tiles; missing ones are rendered first, then outdated ones, nearest first. */
  want(requests: TileRequest[]) {
    if (this.disposed) return;
    this.wanted = new Set(requests.map((r) => r.chunk));
    const seen = new Set<string>();
    this.queue = requests
      .filter((r) => {
        const k = key(r.chunk, r.tier);
        const entry = this.entries.get(k);
        if ((entry && !entry.stale) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      // Missing tiles first (blank on screen), then outdated ones; nearest first.
      .sort((a, b) => this.redo(a) - this.redo(b) || a.distance - b.distance);
    if (this.queue.length > 0 && this.timer === null) this.timer = setTimeout(this.work, 0);
  }

  private redo(r: TileRequest): number {
    return this.entries.has(key(r.chunk, r.tier)) ? 1 : 0;
  }

  /**
   * The layer's data changed: tiles near the view are rendered again on the
   * next `want`, the others are dropped.
   */
  invalidate() {
    for (const [k, e] of this.entries) {
      const chunk = chunkOf(k);
      if (this.wanted.has(chunk)) {
        if (!this.signature || this.signature(chunk) !== e.signature) e.stale = true;
      } else {
        this.entries.delete(k);
        this.free(e);
      }
    }
  }

  private work = () => {
    this.timer = null;
    if (this.disposed) return;
    const start = Date.now();
    let rendered = 0;
    let redone = false;
    while (this.queue.length > 0 && (rendered === 0 || Date.now() - start < SLICE_MS)) {
      const r = this.queue[0];
      const k = key(r.chunk, r.tier);
      const old = this.entries.get(k);
      if (old && !old.stale) {
        this.queue.shift();
        continue;
      }
      if (old && redone) break;
      this.queue.shift();
      if (old) redone = true;
      const signature = this.signature ? this.signature(r.chunk) : 0;
      const image = this.render(r.chunk, this.tierScales[r.tier]);
      const bytes = image ? image.width() * image.height() * 4 : 0;
      this.entries.set(k, { image, bytes, usedAt: Date.now(), stale: false, signature });
      this.bytes += bytes;
      if (old) this.free(old);
      rendered++;
    }
    this.evict();
    if (rendered > 0) this.onReady();
    if (this.queue.length > 0) this.timer = setTimeout(this.work, redone ? REDO_GAP_MS : 0);
  };

  /** Frees the least recently drawn tiles while over budget. */
  private evict() {
    if (this.bytes <= BUDGET_BYTES) return;
    const now = Date.now();
    const old = [...this.entries]
      .filter(([k, e]) => !this.wanted.has(chunkOf(k)) && now - e.usedAt > KEEP_MS)
      .sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [k, e] of old) {
      if (this.bytes <= BUDGET_BYTES) break;
      this.entries.delete(k);
      this.free(e);
    }
  }

  /** Releases an entry's image once it can no longer be on screen. */
  private free(e: Entry) {
    this.bytes -= e.bytes;
    const image = e.image;
    if (image) setTimeout(() => image.dispose(), KEEP_MS);
  }

  /** Stops rendering and frees all tiles once they can no longer be on screen. */
  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    for (const e of this.entries.values()) this.free(e);
    this.entries.clear();
  }
}

function key(chunk: number, tier: number): string {
  return `${tier}:${chunk}`;
}

function chunkOf(k: string): number {
  return Number(k.slice(k.indexOf(':') + 1));
}
