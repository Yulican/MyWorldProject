import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scenarioFromUrl } from '../bench/benchmark';
import { useBenchmark } from '../bench/useBenchmark';
import { CastBar, invalidText, targetName, type CastState } from '../components/CastBar';
import { ChronicleDialog } from '../components/ChronicleDialog';
import { GachaPanel, formatFaith } from '../components/GachaPanel';
import { CivPanel } from '../components/CivPanel';
import { DiplomacyPanel } from '../components/DiplomacyPanel';
import { GovernmentPanel } from '../components/GovernmentPanel';
import { LeaderPanel } from '../components/LeaderPanel';
import { MenuPanel, OverwriteDialog } from '../components/MenuPanel';
import { WarPanel } from '../components/WarPanel';
import { HexInfoPanel, hexWar, strategicStock } from '../components/HexInfoPanel';
import { TimeControls } from '../components/TimeControls';
import { MapModeBar, MapModeList } from '../components/MapModePanel';
import { castArea, peopleHexes } from '../map/castArea';
import { WorldMap, type MapController, type MapHighlight, type TerritorySource } from '../map/WorldMap';
import {
  ABILITIES,
  TargetKind,
  canCast,
  hexBiome,
  hexEconomy,
  hexEffects,
  hexMilitary,
  hexSatisfaction,
  hexSupplyTerms,
  isWaterBiome,
  nextPullPrice,
  simulationYear,
  validTargets,
} from '../sim';
import {
  acknowledgeChronicle,
  castCharge,
  closeAllChronicle,
  armyStore,
  shownAfter,
  shownInDialog,
  landStore,
  mapArmies,
  mapWar,
  modeStore,
  setMapMode,
  setResumeSpeed,
  setSpeed,
  snapshotStore,
  useGameState,
  useMapMode,
} from '../state/worldStore';
import {
  answerOverwrite,
  closeMenu,
  continueAfterTap,
  dismissSaveMessage,
  loadFromMenu,
  newWorldFromMenu,
  onAppActive,
  onAppBackground,
  openMenu,
  saveFromMenu,
  setSaveBenchmark,
  startNewWorld,
  startSaveGame,
  useSaveState,
} from '../state/saveGame';
import { fileSlot } from '../state/saveSlot';
import { colors, spacing } from '../theme';

// CI opens the app with this link to start the benchmark (scripts/run-benchmark.sh).
const BENCHMARK_URL = 'myworld://benchmark';

type OpenPanel =
  | { kind: 'none' }
  | { kind: 'hex'; cell: number }
  | { kind: 'peoples' }
  | { kind: 'diplomacy' }
  | { kind: 'government' }
  | { kind: 'leader' }
  | { kind: 'war' }
  | { kind: 'gacha' }
  | { kind: 'modes' };

/** How long the note after a cast stays on screen. */
const NOTICE_MS = 3500;

export function WorldScreen() {
  const { sim, speed, chronicleSeen, resumeSpeed, chronicleDialogs } = useGameState();
  const mapMode = useMapMode();
  const world = sim?.world ?? null;
  const [panel, setPanel] = useState<OpenPanel>({ kind: 'none' });
  // A charge being cast (target choice on the map), and the note after a cast.
  const [cast, setCast] = useState<CastState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const mapController = useRef<MapController | null>(null);
  const benchmark = useBenchmark(mapController);
  const benchmarkRunning = benchmark.status?.running === true;

  const save = useSaveState();
  // The menu and the overwrite question pause the game: the controls around the map wait.
  const modal = save.menuOpen || save.askOverwrite;

  // App start: the saved world continues (paused until the first tap), else a new world.
  // Opened by the benchmark link, the save isn't read: the benchmark makes its own worlds.
  const runBenchmark = benchmark.run;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    Linking.getInitialURL().then(
      (url) => {
        const bench = url?.startsWith(BENCHMARK_URL) === true;
        // The benchmark's world is never autosaved into the player's slot.
        if (bench) setSaveBenchmark(true);
        startSaveGame(fileSlot(), { skipSave: bench });
        if (bench && url) runBenchmark(scenarioFromUrl(url));
      },
      () => startSaveGame(fileSlot()),
    );
  }, [runBenchmark]);

  // Autosave when the app goes to the background; the overwrite question skipped there comes on return.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') onAppBackground();
      else if (next === 'active') onAppActive();
    });
    return () => subscription.remove();
  }, []);

  // Save messages (load failed, could not save) show like the note after a cast.
  useEffect(() => {
    if (!save.message) return;
    const timer = setTimeout(dismissSaveMessage, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [save.message]);
  const shownNotice = save.message ?? notice;

  // Stable per world, so the map doesn't re-render with every simulation update.
  const territory = useMemo<TerritorySource>(
    () => ({
      ...snapshotStore,
      civColor: (id) => sim?.civs[id]?.color ?? '#ffffff',
      war: mapWar,
      land: landStore,
      mode: modeStore,
      armies: { ...armyStore, markers: mapArmies },
    }),
    [sim],
  );

  /** Loading and a new world close panels and the cast mode (Requirement Speichern und Laden 4). */
  const resetView = () => {
    setPanel({ kind: 'none' });
    setCast(null);
  };
  const newWorld = () => {
    resetView();
    startNewWorld();
  };
  const showMenu = () => {
    resetView();
    openMenu();
  };

  // While casting: the valid targets, checked again when the ability, the direction or the year changes (validTargets allocates).
  const year = sim ? simulationYear(sim) : 0;
  const castAbilityId = cast?.ability ?? -1;
  const castOption = cast?.option ?? 0;
  const [castRound, setCastRound] = useState(0);
  const valid = useMemo(
    () => new Set(sim && castAbilityId >= 0 ? validTargets(sim, castAbilityId, castOption) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- year and castRound say when the targets may have changed
    [sim, castAbilityId, castOption, year, castRound],
  );
  const castTarget = cast?.target ?? -1;
  const highlight = useMemo<MapHighlight | null>(() => {
    if (!sim || castAbilityId < 0) return null;
    const onHex = ABILITIES[castAbilityId].target === TargetKind.Hex;
    return {
      targets: onHex ? [...valid] : peopleHexes(sim.world, [...valid]),
      area: castArea(sim.world, castAbilityId, castTarget),
    };
  }, [sim, castAbilityId, castTarget, valid]);

  /** A target tapped or picked while casting: chosen if valid, else why not. */
  const chooseTarget = useCallback(
    (target: number) =>
      setCast((c) => {
        if (!c || !sim) return c;
        if (target <= 0 && ABILITIES[c.ability].target !== TargetKind.Hex) return { ...c, target: -1, message: 'Nobody lives there.' };
        if (target < 0) return c;
        if (!canCast(sim, c.ability, target, c.option)) return { ...c, target: -1, message: `Not a valid target: ${invalidText(c.ability)}` };
        return { ...c, target, message: null };
      }),
    [sim],
  );

  /** The people living in a hex, for the hex panel's last trade partner. */
  const civNameAt = useCallback((cell: number) => (sim ? (sim.civs[sim.world.owner[cell]]?.name ?? null) : null), [sim]);

  const selectedCell = panel.kind === 'hex' ? panel.cell : -1;
  // Tapping the selected hex again (or off the map) closes the info bar; while casting, a tap chooses the target.
  const casting = cast !== null;
  const onTapCell = useCallback(
    (cell: number) => {
      if (casting) {
        if (cell < 0 || !sim) return;
        const kind = ABILITIES[castAbilityId].target;
        chooseTarget(kind === TargetKind.Hex ? cell : sim.world.owner[cell]);
        return;
      }
      setPanel((open) =>
        cell < 0 || (open.kind === 'hex' && open.cell === cell) ? { kind: 'none' } : { kind: 'hex', cell },
      );
    },
    [casting, castAbilityId, chooseTarget, sim],
  );

  const startCast = (ability: number) => {
    setPanel({ kind: 'none' });
    setCast({ ability, option: 0, target: -1, message: null });
  };
  const confirmCast = () => {
    if (!sim || !cast || cast.target < 0) return;
    const name = targetName(sim, cast.ability, cast.target);
    const result = castCharge(cast.ability, cast.target, cast.option);
    if (result === 'invalid') {
      setCast({ ...cast, target: -1, message: `Not a valid target: ${invalidText(cast.ability)}` });
      setCastRound((n) => n + 1);
      return;
    }
    setCast(null);
    setCastRound((n) => n + 1);
    setNotice(`You cast ${ABILITIES[cast.ability].name} on ${name}${result === 'next' ? ' (from next week)' : ''}.`);
  };
  const price = sim ? nextPullPrice(sim) : 0;
  const affordable = sim !== null && !sim.gameOver && sim.gacha.faith >= price;
  const closePanel = () => setPanel({ kind: 'none' });
  // An important chronicle entry pauses the game and is shown until the player closes it.
  const next = sim && chronicleDialogs && !sim.gameOver ? sim.chronicle[chronicleSeen] : undefined;
  const entry = next && shownInDialog(next) ? next : undefined;
  const goTo = (cell: number) => {
    mapController.current?.centerOn(cell);
    setPanel({ kind: 'hex', cell });
    acknowledgeChronicle();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.topText}>
          <Text style={styles.title}>{sim ? `Year ${simulationYear(sim)}` : 'MyWorld'}</Text>
          <Text style={styles.meta}>
            {sim ? `${sim.pop.count} people · ${sim.believers} believe in you` : 'Creating world…'}
          </Text>
        </View>
        {/* Faith and the next pull's price, always in view; green when a pull is affordable. */}
        <Pressable
          style={({ pressed }) => [styles.gacha, affordable && styles.gachaReady, pressed && styles.buttonPressed]}
          disabled={!sim || benchmarkRunning || modal}
          onPress={() => {
            setCast(null);
            setPanel(panel.kind === 'gacha' ? { kind: 'none' } : { kind: 'gacha' });
          }}
        >
          <Text style={[styles.gachaLabel, affordable && styles.gachaLabelReady]}>Gacha</Text>
          <Text style={[styles.gachaFaith, affordable && styles.gachaLabelReady]}>
            {sim ? `${formatFaith(sim.gacha.faith)} / ${price}` : ''}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          disabled={benchmarkRunning || !sim || modal}
          onPress={showMenu}
        >
          <Text style={styles.buttonText}>Menu</Text>
        </Pressable>
      </View>

      <View style={styles.mapArea}>
        {world && (
          <WorldMap
            world={world}
            selectedCell={selectedCell}
            highlight={highlight}
            onTapCell={onTapCell}
            territory={territory}
            controller={mapController}
          />
        )}
        {/* The active map mode's name and legend, with a quick way back to Political (Requirement Kartenmodi 2). */}
        {sim && <MapModeBar mode={mapMode} onMode={setMapMode} />}
        {sim && panel.kind === 'hex' && (
          <HexInfoPanel
            world={sim.world}
            cell={panel.cell}
            civName={sim.civs[sim.world.owner[panel.cell]]?.name ?? null}
            civNameAt={civNameAt}
            supply={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexSupplyTerms(sim, panel.cell)}
            economy={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexEconomy(sim, panel.cell)}
            satisfaction={hexSatisfaction(sim, panel.cell)}
            military={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexMilitary(sim, panel.cell)}
            strategic={isWaterBiome(sim.world.biome[panel.cell]) ? null : strategicStock(sim, panel.cell)}
            war={hexWar(sim, panel.cell)}
            god={hexEffects(sim, panel.cell)}
            biomeTrend={isWaterBiome(sim.world.biome[panel.cell]) ? null : hexBiome(sim, panel.cell)}
            onClose={closePanel}
          />
        )}
        {sim && panel.kind === 'gacha' && <GachaPanel sim={sim} onClose={closePanel} onUse={startCast} />}
        {sim && cast && (
          <CastBar
            sim={sim}
            cast={cast}
            valid={valid}
            onOption={(option) => setCast({ ...cast, option, target: -1, message: null })}
            onPick={chooseTarget}
            onConfirm={confirmCast}
            onCancel={() => setCast(null)}
          />
        )}
        {shownNotice && (
          <View style={styles.notice} pointerEvents="none">
            <Text style={styles.noticeText}>{shownNotice}</Text>
          </View>
        )}
        {sim && panel.kind === 'peoples' && (
          <CivPanel
            sim={sim}
            onClose={closePanel}
            onDiplomacy={() => setPanel({ kind: 'diplomacy' })}
            onGovernment={() => setPanel({ kind: 'government' })}
            onLeader={() => setPanel({ kind: 'leader' })}
            onWar={() => setPanel({ kind: 'war' })}
          />
        )}
        {sim && panel.kind === 'modes' && (
          <MapModeList
            mode={mapMode}
            onMode={(m) => {
              setMapMode(m);
              closePanel();
            }}
            onClose={closePanel}
          />
        )}
        {sim && panel.kind === 'diplomacy' && <DiplomacyPanel sim={sim} onClose={closePanel} />}
        {sim && panel.kind === 'government' && <GovernmentPanel sim={sim} onClose={closePanel} />}
        {sim && panel.kind === 'leader' && <LeaderPanel sim={sim} onClose={closePanel} />}
        {sim && panel.kind === 'war' && <WarPanel sim={sim} onClose={closePanel} />}
        {sim && entry && (
          <ChronicleDialog
            entry={entry}
            more={shownAfter(sim, chronicleSeen)}
            onGoTo={goTo}
            onOk={acknowledgeChronicle}
            onCloseAll={closeAllChronicle}
          />
        )}
        {save.waitingForTap && !save.menuOpen && (
          <Pressable style={styles.tapToContinue} onPress={() => continueAfterTap()}>
            <View style={styles.tapBadge}>
              <Text style={styles.tapText}>Tap to continue</Text>
            </View>
          </Pressable>
        )}
        {save.menuOpen && (
          <MenuPanel
            save={save}
            onSave={saveFromMenu}
            onLoad={async () => {
              if (await loadFromMenu()) resetView();
            }}
            onNewWorld={async (saveFirst) => {
              if (await newWorldFromMenu(saveFirst)) resetView();
            }}
            onClose={closeMenu}
          />
        )}
        {save.askOverwrite && <OverwriteDialog onAnswer={answerOverwrite} />}
        {sim?.gameOver && (
          <View style={styles.gameOver}>
            <Text style={styles.gameOverTitle}>Nobody prays to you anymore</Text>
            <Text style={styles.gameOverText}>Your last believer is gone in year {simulationYear(sim)}.</Text>
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={newWorld}>
              <Text style={styles.buttonText}>New world</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.bottomBar}>
        {/* While a chronicle entry is open, the controls choose the speed the game continues at. */}
        <TimeControls
          speed={entry ? resumeSpeed : speed}
          onChange={entry ? setResumeSpeed : save.waitingForTap ? continueAfterTap : setSpeed}
          disabled={!sim || sim.gameOver || modal}
        />
        <View style={styles.bottomButtons}>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            disabled={modal}
            onPress={() => setPanel(panel.kind === 'peoples' ? { kind: 'none' } : { kind: 'peoples' })}
          >
            <Text style={styles.secondaryText}>Peoples</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            disabled={modal || !sim}
            onPress={() => setPanel(panel.kind === 'modes' ? { kind: 'none' } : { kind: 'modes' })}
          >
            <Text style={styles.secondaryText}>Map</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.panel },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topText: { flex: 1 },
  title: { color: colors.panelText, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.panelMuted, fontSize: 13, marginTop: 2 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  gacha: {
    marginRight: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.panelMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignItems: 'center',
  },
  gachaReady: { backgroundColor: '#3fa860', borderColor: '#3fa860' },
  gachaLabel: { color: colors.panelText, fontWeight: '700', fontSize: 12 },
  gachaFaith: { color: colors.panelMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  gachaLabelReady: { color: '#ffffff' },
  notice: {
    position: 'absolute',
    // Below the map mode's legend bar.
    top: spacing.sm + 48,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(20,23,31,0.92)',
    borderRadius: 10,
    padding: spacing.sm,
  },
  noticeText: { color: colors.panelText, fontSize: 13, textAlign: 'center' },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.panel, fontWeight: '700', fontSize: 14 },
  mapArea: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bottomButtons: { flexDirection: 'row', gap: spacing.sm },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    height: 36,
    justifyContent: 'center',
  },
  secondaryText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  gameOver: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '30%',
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  gameOverTitle: { color: colors.panelText, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  gameOverText: { color: colors.panelMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
  tapToContinue: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapBadge: {
    backgroundColor: 'rgba(20,23,31,0.85)',
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tapText: { color: colors.panelText, fontSize: 16, fontWeight: '700' },
});
