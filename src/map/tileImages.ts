import type { SkImage } from '@shopify/react-native-skia';
import type { TileRef } from './viewport';

/** JS time spent rendering tiles before yielding, so view updates aren't held up. */
const SLICE_MS = 8;
/**
 * New images per slice, and the pause after a slice that made some: each new
 * image is uploaded to the GPU when first drawn, so a burst of them (a swipe
 * into fresh map, a snapshot) would all land in one frame.
 */
const TILES_PER_SLICE = 3;
/** While the map moves only one per slice: a swipe into fresh map spreads its tiles (and their memory) over more frames. */
const TILES_PER_SLICE_MOVING = 1;
const SLICE_PAUSE_MS = 16;
/** Default memory for rendered tiles (4 bytes per pixel). */
const BUDGET_BYTES = 96 * 1024 * 1024;
/** A replaced or evicted image is only freed after this long (it may still be on screen). */
const KEEP_MS = 1000;

/** Renders one tile at a scale (pixels per picture pixel); null when the tile is empty. */
export type RenderTile = (chunk: number, pxPerUnit: number) => SkImage | null;
/** A number that only changes when a tile's image would change (see `invalidate`). */
export type TileSignature = (chunk: number) => number;

/** `unchecked`: the data changed while the tile was out of view; its signature is compared once it is wanted again. */
type Entry = { image: SkImage | null; bytes: number; usedAt: number; stale: boolean; unchecked: boolean; signature: number };
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
  /**
   * Whether the map rests (setResting). Outdated tiles still show their old
   * image, so they are only redone while it rests: rendering them while the
   * map moves takes CPU time from drawing frames, and each new image is
   * uploaded to the GPU when first drawn.
   */
  private resting = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Longest recent tile render in ms (decays), to stop a slice before it overruns SLICE_MS. */
  private tileMs = 0;

  constructor(
    private render: RenderTile,
    /** Without one, every tile counts as changed on `invalidate`. */
    private signature: TileSignature | null,
    /** Pixels per picture pixel for each tier. */
    private tierScales: readonly number[],
    private onReady: () => void,
    /** Memory for this layer's images; least recently drawn tiles out of view are freed beyond it. */
    private budgetBytes: number = BUDGET_BYTES,
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
        if (entry?.unchecked) {
          entry.unchecked = false;
          if (!this.signature || this.signature(r.chunk) !== entry.signature) entry.stale = true;
        }
        if ((entry && !entry.stale) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      // Missing tiles first (blank on screen), then outdated ones; nearest first.
      .sort((a, b) => this.redo(a) - this.redo(b) || a.distance - b.distance);
    if (this.queue.length > 0 && this.timer === null) this.timer = setTimeout(this.work, 0);
  }

  /** The map stopped moving (true) or started (false): outdated tiles are redone only while it rests. */
  setResting(resting: boolean) {
    this.resting = resting;
    if (resting && this.queue.length > 0 && this.timer === null && !this.disposed) this.timer = setTimeout(this.work, 0);
  }

  private redo(r: TileRequest): number {
    return this.entries.has(key(r.chunk, r.tier)) ? 1 : 0;
  }

  /**
   * The layer's data changed: tiles near the view that look different are
   * rendered again on the next `want`. The others keep their image and are
   * checked once they are wanted again: coming into view while the map
   * moves, they show the old image (like any outdated tile) instead of
   * having to be rendered during the movement.
   */
  invalidate() {
    for (const [k, e] of this.entries) {
      if (this.wanted.has(chunkOf(k))) {
        if (!this.signature || this.signature(chunkOf(k)) !== e.signature) e.stale = true;
      } else e.unchecked = true;
    }
  }

  private work = () => {
    this.timer = null;
    if (this.disposed) return;
    const start = Date.now();
    let rendered = 0;
    /** Only outdated tiles are left and the map moves: go on once it rests (setResting). */
    let held = false;
    // A further tile only if one more of the recent (worst) duration still fits the slice.
    while (
      this.queue.length > 0 &&
      rendered < (this.resting ? TILES_PER_SLICE : TILES_PER_SLICE_MOVING) &&
      (rendered === 0 || Date.now() - start + this.tileMs <= SLICE_MS)
    ) {
      const r = this.queue[0];
      const k = key(r.chunk, r.tier);
      const old = this.entries.get(k);
      if (old && !old.stale) {
        this.queue.shift();
        continue;
      }
      if (old && !this.resting) {
        held = true;
        break;
      }
      this.queue.shift();
      const signature = this.signature ? this.signature(r.chunk) : 0;
      const before = Date.now();
      const image = this.render(r.chunk, this.tierScales[r.tier]);
      this.tileMs = Math.max(Date.now() - before, this.tileMs * 0.9);
      const bytes = image ? image.width() * image.height() * 4 : 0;
      this.entries.set(k, { image, bytes, usedAt: Date.now(), stale: false, unchecked: false, signature });
      this.bytes += bytes;
      if (old) this.free(old);
      rendered++;
    }
    this.evict();
    if (rendered > 0) this.onReady();
    if (this.queue.length > 0 && !held) this.timer = setTimeout(this.work, rendered > 0 ? SLICE_PAUSE_MS : 0);
  };

  /** Frees the least recently drawn tiles while over budget. */
  private evict() {
    if (this.bytes <= this.budgetBytes) return;
    const now = Date.now();
    const old = [...this.entries]
      .filter(([k, e]) => !this.wanted.has(chunkOf(k)) && now - e.usedAt > KEEP_MS)
      .sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [k, e] of old) {
      if (this.bytes <= this.budgetBytes) break;
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
