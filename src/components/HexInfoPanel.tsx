import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BIOMES,
  DEPOSITS,
  RESOURCE_COUNT,
  RESOURCE_NAMES,
  elevationMeters,
  hasFreshWater,
  type World,
} from '../sim';
import { colors, spacing } from '../theme';

type Props = {
  world: World;
  cell: number;
  onClose: () => void;
};

/**
 * Info about one hex. Starts as a slim bar with the key facts so the map
 * stays usable; tapping the bar expands it to all stats.
 */
export function HexInfoPanel({ world, cell, onClose }: Props) {
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
  const highlights = [
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
          <Row label="Travel cost" value={`×${world.moveCost[cell]}`} />
          {deposit && <Row label="Deposit" value={`${deposit.name} (${deposit.category})`} />}

          <Text style={styles.section}>Resources</Text>
          {RESOURCE_NAMES.map((name, r) => (
            <Bar
              key={name}
              label={name}
              value={world.resources[cell * RESOURCE_COUNT + r]}
              capacity={world.resourceCapacity[cell * RESOURCE_COUNT + r]}
            />
          ))}

          <Text style={styles.section}>People</Text>
          <Row label="Civilization" value={world.owner[cell] ? `#${world.owner[cell]}` : 'Nobody'} />
          <Row label="Population" value={String(Math.round(world.population[cell]))} />
          <Row label="Faith in you" value={world.population[cell] > 0 ? percent(world.faith[cell]) : '–'} />
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

const percent = (v: number) => `${Math.round(v * 100)} %`;
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
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.barTrack, overflow: 'hidden' },
  barCapacity: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.barCapacity },
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
});
