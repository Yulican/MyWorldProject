import { Biome, Resource, type BiomeId, type ResourceId } from './biomes';

// Special deposits: rare features that make a place valuable. Ids are stored
// per hex in a Uint8Array (0 = none): append new ones, never reorder.

export const Deposit = {
  None: 0,
  Copper: 1,
  Tin: 2,
  Iron: 3,
  Gold: 4,
  Salt: 5,
  Flint: 6,
  Marble: 7,
  Gems: 8,
  FishingGrounds: 9,
  WildHorses: 10,
  Floodplain: 11,
  Spices: 12,
  HolySpring: 13,
  SacredGrove: 14,
  Meteorite: 15,
  AncientRuins: 16,
} as const;
export type DepositId = (typeof Deposit)[keyof typeof Deposit];

export type DepositCategory = 'metal' | 'mineral' | 'bounty' | 'mystic';

export type DepositInfo = {
  name: string;
  category: DepositCategory;
  /** Biomes it can appear in. */
  biomes: readonly BiomeId[];
  /** Only on hexes with a river. */
  needsRiver?: boolean;
  /** Only next to fresh water (river on the hex or adjacent lake). */
  needsFreshWater?: boolean;
  /** Expected count per 1,000 land hexes. */
  frequency: number;
  /** Boost added to the hex's resource capacity. */
  bonus?: { resource: ResourceId; amount: number };
};

const LAND: readonly BiomeId[] = [
  Biome.Tundra, Biome.Plains, Biome.Forest, Biome.Hills, Biome.Mountains,
  Biome.Desert, Biome.Savanna, Biome.Jungle, Biome.Swamp,
];

// Index = deposit id. Index 0 (None) is a placeholder.
export const DEPOSITS: readonly DepositInfo[] = [
  { name: 'None', category: 'mineral', biomes: [], frequency: 0 },
  { name: 'Copper', category: 'metal', biomes: [Biome.Hills, Biome.Mountains], frequency: 4, bonus: { resource: Resource.Ore, amount: 0.3 } },
  { name: 'Tin', category: 'metal', biomes: [Biome.Hills, Biome.Mountains], frequency: 2, bonus: { resource: Resource.Ore, amount: 0.3 } },
  { name: 'Iron', category: 'metal', biomes: [Biome.Hills, Biome.Mountains, Biome.Tundra], frequency: 4, bonus: { resource: Resource.Ore, amount: 0.4 } },
  { name: 'Gold', category: 'metal', biomes: [Biome.Hills, Biome.Mountains, Biome.Jungle], frequency: 1.5, bonus: { resource: Resource.Ore, amount: 0.2 } },
  { name: 'Salt', category: 'mineral', biomes: [Biome.Desert, Biome.Plains, Biome.Swamp], frequency: 3, bonus: { resource: Resource.Stone, amount: 0.1 } },
  { name: 'Flint', category: 'mineral', biomes: [Biome.Plains, Biome.Hills, Biome.Savanna], frequency: 4, bonus: { resource: Resource.Stone, amount: 0.3 } },
  { name: 'Marble', category: 'mineral', biomes: [Biome.Hills, Biome.Mountains], frequency: 2, bonus: { resource: Resource.Stone, amount: 0.4 } },
  { name: 'Gems', category: 'mineral', biomes: [Biome.Mountains, Biome.Jungle], frequency: 1.5 },
  { name: 'Fishing grounds', category: 'bounty', biomes: [Biome.ShallowSea], frequency: 6, bonus: { resource: Resource.Fish, amount: 0.6 } },
  { name: 'Wild horses', category: 'bounty', biomes: [Biome.Plains, Biome.Savanna, Biome.Tundra], frequency: 3, bonus: { resource: Resource.Game, amount: 0.3 } },
  { name: 'Floodplain', category: 'bounty', biomes: [Biome.Plains, Biome.Savanna, Biome.Desert], needsRiver: true, frequency: 4, bonus: { resource: Resource.Fertility, amount: 0.5 } },
  { name: 'Spices', category: 'bounty', biomes: [Biome.Jungle, Biome.Savanna], frequency: 2.5 },
  { name: 'Holy spring', category: 'mystic', biomes: [Biome.Hills, Biome.Forest, Biome.Mountains, Biome.Plains], needsFreshWater: true, frequency: 1 },
  { name: 'Sacred grove', category: 'mystic', biomes: [Biome.Forest, Biome.Jungle], frequency: 1.5 },
  { name: 'Meteorite', category: 'mystic', biomes: LAND, frequency: 0.5, bonus: { resource: Resource.Ore, amount: 0.3 } },
  { name: 'Ancient ruins', category: 'mystic', biomes: LAND, frequency: 1.5 },
];
