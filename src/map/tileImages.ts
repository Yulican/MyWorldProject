import type { SkImage } from '@shopify/react-native-skia';
import type { World } from '../sim';
import type { TileRef } from './viewport';
import { renderTile } from './worldPicture';

/** JS time spent rendering tiles before yielding, so view updates aren't held up. */
const SLICE_MS = 8;
/** Memory for rendered tiles (4 bytes per pixel). */
const BUDGET_BYTES = 96 * 1024 * 1024;
/** A tile is only freed after not being drawn for this long (it may still be on screen). */
const KEEP_MS = 1000;

type Entry = { image: SkImage; bytes: number; usedAt: number };
export type TileRequest = TileRef & { tier: number };

/**
 * Pre-rendered detail tile images of one world, per zoom tier. Tiles are
 * rendered in the background, nearest to the view first; `onReady` is called
 * when new ones are available. Least recently drawn tiles are freed when the
 * memory budget is exceeded.
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
    private world: World,
    private chunkCols: number,
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

  /** Replaces the wanted tiles; missing ones are rendered, nearest first. */
  want(requests: TileRequest[]) {
    if (this.disposed) return;
    this.wanted = new Set(requests.map((r) => r.chunk));
    const seen = new Set<string>();
    this.queue = requests
      .filter((r) => {
        const k = key(r.chunk, r.tier);
        if (this.entries.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.distance - b.distance);
    if (this.queue.length > 0 && this.timer === null) this.timer = setTimeout(this.work, 0);
  }

  private work = () => {
    this.timer = null;
    if (this.disposed) return;
    const start = Date.now();
    let rendered = 0;
    while (this.queue.length > 0 && (rendered === 0 || Date.now() - start < SLICE_MS)) {
      const r = this.queue.shift()!;
      const k = key(r.chunk, r.tier);
      if (this.entries.has(k)) continue;
      const image = renderTile(this.world, r.chunk, this.chunkCols, this.tierScales[r.tier]);
      if (!image) continue;
      const bytes = image.width() * image.height() * 4;
      this.entries.set(k, { image, bytes, usedAt: Date.now() });
      this.bytes += bytes;
      rendered++;
    }
    this.evict();
    if (rendered > 0) this.onReady();
    if (this.queue.length > 0) this.timer = setTimeout(this.work, 0);
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
      this.bytes -= e.bytes;
      e.image.dispose();
    }
  }

  /** Stops rendering and frees all tiles once they can no longer be on screen. */
  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    const images = [...this.entries.values()].map((e) => e.image);
    this.entries.clear();
    setTimeout(() => images.forEach((image) => image.dispose()), KEEP_MS);
  }
}

function key(chunk: number, tier: number): string {
  return `${tier}:${chunk}`;
}

function chunkOf(k: string): number {
  return Number(k.slice(k.indexOf(':') + 1));
}
