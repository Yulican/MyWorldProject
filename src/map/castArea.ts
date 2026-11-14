import { ABILITIES, TargetKind, type World } from '../sim';

// What the map highlights while a charge is cast (Requirement Gacha 8, target choice):
// plain TypeScript, so it is testable in Node.

/** Hexes within `radius` steps of `center` (1, 7 or 37 hexes for radius 0, 1, 3), center first. */
export function hexesWithin(world: World, center: number, radius: number): number[] {
  const out = [center];
  const seen = new Set(out);
  let ring = out.slice();
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const c of ring) {
      for (let d = 0; d < 6; d++) {
        const nb = world.neighbors[c * 6 + d];
        if (nb < 0 || seen.has(nb)) continue;
        seen.add(nb);
        next.push(nb);
        out.push(nb);
      }
    }
    ring = next;
  }
  return out;
}

/**
 * The hexes a cast of `ability` on `target` covers, for the preview: the
 * ability's area around a hex (Great River and Wild Fire show their start
 * hex: where they spread is decided when they run), or every hex of the
 * people for people and leader abilities.
 */
export function castArea(world: World, ability: number, target: number): number[] {
  const a = ABILITIES[ability];
  if (!a || target < 0) return [];
  if (a.target === TargetKind.Hex) return target < world.cellCount ? hexesWithin(world, target, Math.max(0, a.radius)) : [];
  return peopleHexes(world, [target]);
}

/** Every hex owned by one of `peoples`. */
export function peopleHexes(world: World, peoples: readonly number[]): number[] {
  const wanted = new Set(peoples);
  const out: number[] = [];
  for (let c = 0; c < world.cellCount; c++) if (world.owner[c] !== 0 && wanted.has(world.owner[c])) out.push(c);
  return out;
}
