import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BIOMES,
  DEPOSITS,
  GOOD_NAMES,
  MIL,
  RESOURCE_COUNT,
  RESOURCE_NAMES,
  SUPPLY_NAMES,
  TROOP_NAMES,
  elevationMeters,
  hasFreshWater,
  resourceCapacityTerms,
  sumTerms,
  type HexEconomy,
  type HexMilitary,
  type HexSatisfaction,
  type Simulation,
  type Term,
  type World,
} from '../sim';
import { FIRST_LUXURY, LUXURY_COUNT, STORED_COUNT } from '../sim/society/buildings';
import { TROOP_GOOD } from '../sim/society/military';
import { colors, spacing } from '../theme';

type Props = {
  world: World;
  cell: number;
  /** Name of the civilization living in the hex, if any. */
  civName?: string | null;
  /**
   * How the hex's food, water and space (in people, see SUPPLY_NAMES) are
   * calculated; null for water.
   */
  supply?: readonly (readonly Term[])[] | null;
  /** Stock, harvest and buildings; null for water. */
  economy?: HexEconomy | null;
  /** How satisfied the settlement is and why; null if nobody lives here. */
  satisfaction?: HexSatisfaction | null;
  /** Soldiers per troop type; null for water. */
  military?: HexMilitary | null;
  /** Strategic goods without comfort (iron, flint) in stock; horses show with the luxury goods. */
  strategic?: readonly StrategicStock[] | null;
  onClose: () => void;
};

/**
 * Info about one hex. Starts as a slim bar with the key facts so the map
 * stays usable; tapping the bar expands it to all stats.
 */
export function HexInfoPanel({ world, cell, civName, supply, economy, satisfaction, military, strategic, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const col = cell % world.width;
  const row = Math.floor(cell / world.width);
  const biome = BIOMES[world.biome[cell]];
  const deposit = world.deposit[cell] ? DEPOSITS[world.deposit[cell]] : null;
  const river = world.riverFlow[cell];
  const meters = elevationMeters(world, cell);

  const facts = [
    `${world.temperature[cell].toFixed(0)} °C`,
    meters >= 0 ? `${meters} m` : `${-meters} m deep`,
    river > 0 ? riverSize(river) : null,
  ].filter(Boolean);
  const people = Math.round(world.population[cell]);
  const totals = supply ? supply.map(sumTerms) : null;
  const supports = totals ? Math.floor(Math.min(...totals)) : 0;
  const scarcest = totals ? SUPPLY_NAMES[totals.indexOf(Math.min(...totals))] : null;
  let roads = 0;
  for (let d = 0; d < 6; d++) if (world.roads[cell] & (1 << d)) roads++;
  const standing = economy ? economy.buildings.filter((b) => b.state === 'standing').length : 0;
  const ruins = economy ? economy.buildings.filter((b) => b.state === 'ruin' || b.state === 'repair').length : 0;
  const highlights = [
    civName ? `${civName} · ${people}/${supports} people · ${percent(world.faith[cell])} faith` : null,
    civName ? settlementName(standing) : null,
    military && military.soldiers > 0 ? `${military.soldiers} soldier${military.soldiers > 1 ? 's' : ''}` : null,
    !civName && ruins > 0 ? `${ruins} ruin${ruins > 1 ? 's' : ''}` : null,
    cell === world.startCell ? 'Your tribe starts here' : null,
    deposit ? deposit.name : null,
  ].filter(Boolean);

  return (
    <View style={styles.panel}>
      <View style={styles.bar}>
        <Pressable style={styles.summary} onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.title} numberOfLines={1}>
            {biome.name}
            <Text style={styles.facts}>{'  ' + facts.join(' · ')}</Text>
          </Text>
          {highlights.length > 0 && (
            <Text style={styles.highlight} numberOfLines={1}>
              {highlights.join(' · ')}
            </Text>
          )}
          <Text style={styles.more}>{expanded ? 'Less ▾' : 'Details ▴'}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {expanded && (
        <ScrollView style={styles.details}>
          <Row label="Hex" value={`${col}, ${row}`} />
          {!biome.water && <Row label="Moisture" value={percent(world.moisture[cell])} />}
          {!biome.water && (
            <Row label="Fresh water" value={river > 0 || hasFreshWater(world, cell) ? 'Yes' : 'No'} />
          )}
          <Row label="Danger" value={percent(world.danger[cell])} />
          <Row
            label="Travel cost"
            value={`×${world.moveCost[cell]}${roads > 0 ? ` · ${roads} road${roads > 1 ? 's' : ''} (half cost)` : ''}`}
          />
          {deposit && <Row label="Deposit" value={`${deposit.name} (${deposit.category})`} />}

          <Text style={styles.section}>Resources</Text>
          {RESOURCE_NAMES.map((name, r) => (
            <View key={name}>
              <Bar
                label={name}
                value={world.resources[cell * RESOURCE_COUNT + r]}
                capacity={world.resourceCapacity[cell * RESOURCE_COUNT + r]}
              />
              <Text style={styles.terms}>{formatTerms(resourceCapacityTerms(world, cell, r))}</Text>
            </View>
          ))}

          {supply && totals && (
            <>
              <Text style={styles.section}>
                Supports {supports} people · scarcest: {scarcest}
              </Text>
              {SUPPLY_NAMES.map((name, k) => (
                <View key={name}>
                  <Row label={name} value={`${Math.floor(totals[k])} people`} />
                  {supply[k].map((t, i) => (
                    <TermRow key={i} term={t} digits={0} />
                  ))}
                </View>
              ))}
              <Text style={styles.note}>
                Each person needs one unit of food, water and space. Buildings and other modifiers appear as extra
                lines; percentages apply after the rest and multiply.
              </Text>
            </>
          )}

          {satisfaction && (
            <>
              <Text style={styles.section}>
                Satisfaction {signed(satisfaction.value, 0)} · heading for {signed(satisfaction.target, 0)}
              </Text>
              {satisfaction.terms.map((t, i) => (
                <TermRow key={i} term={t} digits={1} />
              ))}
              {satisfaction.unhappyYears > 0 && (
                <Row
                  label="Unhappy"
                  value={`for ${satisfaction.unhappyYears} year${satisfaction.unhappyYears > 1 ? 's' : ''}${satisfaction.restless ? ' · ready to break away' : ''}`}
                />
              )}
              {satisfaction.luxury.map((g) => (
                <Row key={g.name} label={g.name} value={`${Math.floor(g.stock)} in stock${g.covered ? ' · enough for everyone' : ''}`} />
              ))}
              <Text style={styles.note}>
                Satisfaction moves a quarter of the way to its target each year. Satisfied settlements have more
                children and harvest more; unhappy ones send people away, and after {UNHAPPY_NOTE} below zero,
                settlements joined by roads break away together.
              </Text>
            </>
          )}

          {economy && (
            <>
              <Text style={styles.section}>
                Buildings {economy.buildings.length}/{economy.slots}
              </Text>
              {economy.buildings.length === 0 && <Text style={styles.note}>No buildings yet.</Text>}
              {economy.buildings.map((b, i) => (
                <View key={i}>
                  <Row label={b.name} value={`${buildingState(b.state, b.workLeft)} · ${b.effect}`} />
                  <Text style={styles.terms}>
                    Upkeep {b.upkeep} a year
                    {b.unpaidYears > 0 ? ` · unpaid for ${b.unpaidYears} year${b.unpaidYears > 1 ? 's' : ''}` : ''}
                  </Text>
                </View>
              ))}

              {(economy.government.seat >= 0 || economy.government.buildings.length > 0) && (
                <>
                  <Text style={styles.section}>
                    Government buildings {economy.government.buildings.length}/{economy.government.slots}
                  </Text>
                  {economy.government.seat >= 0 && (
                    <Row
                      label="District"
                      value={`${economy.government.capital ? 'capital' : 'seat of government'} at ${economy.government.seat % world.width}, ${Math.floor(economy.government.seat / world.width)}`}
                    />
                  )}
                  {economy.government.seat >= 0 && (
                    <Row label="Taxes" value={`money ${Math.round(economy.government.rate * 100)} % · goods ${Math.round(economy.government.goodsRate * 100)} %`} />
                  )}
                  {economy.government.buildings.map((b, i) => (
                    <View key={i}>
                      <Row label={b.name} value={`${buildingState(b.state, b.workLeft)} · ${b.effect}`} />
                      <Text style={styles.terms}>
                        Upkeep {b.upkeep} a year
                        {b.unpaidYears > 0 ? ` · unpaid for ${b.unpaidYears} year${b.unpaidYears > 1 ? 's' : ''}` : ''}
                      </Text>
                    </View>
                  ))}
                  {(economy.government.wood >= 0.5 || economy.government.stone >= 0.5) && (
                    <Row label="Government stock" value={`${Math.floor(economy.government.wood)} wood · ${Math.floor(economy.government.stone)} stone`} />
                  )}
                </>
              )}

              <Text style={styles.section}>Stock</Text>
              <Row label="Wood" value={`${Math.floor(economy.wood)} · ${yearly(sumTerms(economy.harvest.wood), economy.upkeepWood)}`} />
              {economy.harvest.wood.map((t, i) => (
                <TermRow key={i} term={t} digits={1} />
              ))}
              <Row label="Stone" value={`${Math.floor(economy.stone)} · ${yearly(sumTerms(economy.harvest.stone), economy.upkeepStone)}`} />
              {economy.harvest.stone.map((t, i) => (
                <TermRow key={i} term={t} digits={1} />
              ))}
              <Row label="Money" value={`${Math.floor(economy.trade.money)} · +${economy.trade.income.toFixed(1)} a year`} />
              {strategic?.map((g) => (
                <Row key={g.name} label={g.name} value={`${Math.floor(g.stock)} · for soldiers`} />
              ))}
              {economy.trade.grain >= 0.5 && <Row label="Grain" value={String(Math.floor(economy.trade.grain))} />}
              {economy.trade.barrels >= 0.5 && <Row label="Water barrels" value={String(Math.floor(economy.trade.barrels))} />}
              <Text style={styles.note}>
                {people > 0
                  ? 'People harvest wood and stone on their own hex and pay buildings and upkeep from this stock. Adults earn money; grain and water barrels in stock feed people.'
                  : 'Nobody lives here: nothing is harvested, buildings decay to ruins, the stock stays on the ground.'}
              </Text>

              {people > 0 && (
                <>
                  <Text style={styles.section}>Trade</Text>
                  <Row
                    label="Merchants"
                    value={
                      economy.trade.merchants > 0
                        ? `${economy.trade.merchants - economy.trade.away} at home · ${economy.trade.away} on the way`
                        : 'None (needs a trade center or harbor)'
                    }
                  />
                  {economy.trade.partner >= 0 && (
                    <Row label="Last partner" value={`Hex ${economy.trade.partner % world.width}, ${Math.floor(economy.trade.partner / world.width)}`} />
                  )}
                  <Row label="Asks for" value={goodsList(economy.trade.asks)} />
                  <Row label="Can spare" value={goodsList(economy.trade.spares)} />
                  <Text style={styles.note}>
                    Merchants carry goods between settlements of the same people on roads, rivers and between harbors,
                    paid in money. Some of a load can get lost on the way.
                  </Text>
                </>
              )}
            </>
          )}

          {military && military.troops.length > 0 && (
            <>
              <Text style={styles.section}>Soldiers {military.soldiers}</Text>
              {military.troops.map((t) => (
                <Row
                  key={t.name}
                  label={t.name}
                  value={`${t.soldiers}/${t.capacity} · ${t.supplied ? `with ${troopGood(t.name)}, ×${MIL.factor} strength` : `no ${troopGood(t.name)}`}`}
                />
              ))}
              <Text style={styles.note}>
                Barracks, shooting ranges and stables train soldiers from the adults while the district treasury can
                pay them ({MIL.sold} money each a year); unpaid soldiers go home. Iron, flint and horses make melee,
                ranged and shock soldiers {MIL.factor} times as strong.
              </Text>
            </>
          )}

          <Text style={styles.section}>People</Text>
          <Row label="Civilization" value={civName ?? 'Nobody'} />
          <Row label="Population" value={String(people)} />
          <Row label="Faith in you" value={people > 0 ? percent(world.faith[cell]) : '–'} />
        </ScrollView>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** One line of a calculation: what it is and how much it adds. */
function TermRow({ term, digits }: { term: Term; digits: number }) {
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{term.label}</Text>
      <Text style={styles.termValue}>{signed(term.value, digits)}</Text>
    </View>
  );
}

/** A resource's calculation on one line, e.g. "Plains 0.80 · Terrain ×1.05 +0.04 · River +0.17 = 1.01". */
function formatTerms(terms: readonly Term[]): string {
  const parts = terms.map((t, i) => (i === 0 ? `${t.label} ${t.value.toFixed(2)}` : `${t.label} ${signed(t.value, 2)}`));
  return `${parts.join(' · ')} = ${sumTerms(terms).toFixed(2)}`;
}

const signed = (v: number, digits: number) => {
  const text = Math.abs(v).toFixed(digits);
  return Number(text) === 0 ? `±${text}` : `${v < 0 ? '−' : '+'}${text}`;
};

function Bar({ label, value, capacity }: { label: string; value: number; capacity: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barCapacity, { width: `${capacity * 100}%` }]} />
        <View style={[styles.barFill, { width: `${value * 100}%` }]} />
      </View>
    </View>
  );
}

/** A strategic good in a hex's stock. */
export type StrategicStock = { name: string; stock: number };

/** Iron and flint in the hex's stock (horses are a luxury good too and show with them). */
export function strategicStock(sim: Simulation, cell: number): StrategicStock[] {
  const goods: StrategicStock[] = [];
  for (let k = LUXURY_COUNT; k < STORED_COUNT; k++) {
    const stock = sim.economy.luxury[cell * STORED_COUNT + k];
    if (stock >= 0.5) goods.push({ name: GOOD_NAMES[FIRST_LUXURY + k], stock });
  }
  return goods;
}

/** The strategic good a troop type needs, lower case ("iron"). */
const troopGood = (troop: string) => {
  const t = TROOP_NAMES.indexOf(troop as (typeof TROOP_NAMES)[number]);
  return t >= 0 ? GOOD_NAMES[FIRST_LUXURY + TROOP_GOOD[t]].toLowerCase() : 'its good';
};

const percent = (v: number) => `${Math.round(v * 100)} %`;
const goodsList = (goods: readonly { good: string; amount: number }[]) =>
  goods.length === 0 ? 'Nothing' : goods.map((g) => `${Math.round(g.amount)} ${g.good.toLowerCase()}`).join(', ');
const UNHAPPY_NOTE = '5 years';
/** Settlement size by standing buildings, as the map icon shows it. */
const settlementName = (buildings: number) => (buildings === 0 ? 'Tribe' : buildings <= 2 ? 'Small city' : 'Big city');
const yearly = (harvest: number, upkeep: number) =>
  `+${harvest.toFixed(1)}${upkeep > 0 ? ` −${upkeep} upkeep` : ''} a year`;

function buildingState(state: string, workLeft: number): string {
  const years = `${Math.round(workLeft * 4) / 4} y left`;
  if (state === 'construction') return `Building, ${years}`;
  if (state === 'repair') return `Repairing, ${years}`;
  if (state === 'ruin') return 'Ruin';
  return 'Standing';
}
const riverSize = (flow: number) => (flow < 2 ? 'Stream' : flow < 5 ? 'River' : 'Great river');

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    maxHeight: '50%',
    backgroundColor: colors.panel,
    borderRadius: 12,
    opacity: 0.96,
  },
  bar: { flexDirection: 'row', alignItems: 'center' },
  summary: { flex: 1, paddingVertical: spacing.sm, paddingLeft: spacing.md },
  title: { color: colors.panelText, fontSize: 16, fontWeight: '700' },
  facts: { color: colors.panelMuted, fontSize: 14, fontWeight: '400' },
  highlight: { color: colors.accent, fontSize: 13, marginTop: 2 },
  more: { color: colors.panelMuted, fontSize: 12, marginTop: 2 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.panelMuted, fontSize: 20 },
  details: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  section: { color: colors.panelText, fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  label: { color: colors.panelMuted, fontSize: 14, width: 110 },
  value: { color: colors.panelText, fontSize: 14, flex: 1 },
  termRow: { flexDirection: 'row', paddingLeft: spacing.md, paddingVertical: 1 },
  termLabel: { color: colors.panelMuted, fontSize: 12, flex: 1 },
  termValue: { color: colors.panelMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  terms: { color: colors.panelMuted, fontSize: 11, paddingLeft: 110, marginTop: -1, marginBottom: 3 },
  note: { color: colors.panelMuted, fontSize: 11, marginTop: spacing.xs, fontStyle: 'italic' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.barTrack, overflow: 'hidden' },
  barCapacity: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.barCapacity },
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
});
