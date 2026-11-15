#!/usr/bin/env bash
# Runs the map benchmark on a connected Android device or emulator and fails
# unless every swipe passes (rules in src/bench/benchmark.ts).
#
# Usage: scripts/run-benchmark.sh <apk> [output dir] [scenario: young|aged|cities|unrest|trade|diplomacy|government|war|gacha|save|modes]
# The app is opened with the link myworld://benchmark?scenario=..., which
# starts the benchmark; it logs MYWORLD_BENCH_* lines.
set -euo pipefail

APK="$1"
OUT="${2:-benchmark-results}"
SCENARIO="${3:-young}"
PACKAGE=com.example.myworldproject
TIMEOUT_S=1500

mkdir -p "$OUT"
adb wait-for-device
adb install -r "$APK"

"$(dirname "$0")/settle-emulator.sh"
adb logcat -G 16M || true
adb logcat -c
# The busiest processes every 5 s, to see what else uses the CPU when a
# swipe fails (failures have clustered about 95 s after the app started).
( while true; do
    echo "=== $(date -u +%H:%M:%S.%3N) (runner clock, UTC)"
    adb shell top -b -n 1 -m 12 2>/dev/null
    sleep 5
  done ) > "$OUT/top.txt" 2>&1 &
TOP_PID=$!
trap 'kill $TOP_PID 2>/dev/null || true; adb logcat -d > "$OUT/logcat-full.txt" 2>/dev/null || true' EXIT
adb shell am start -W -a android.intent.action.VIEW -d "myworld://benchmark?scenario=$SCENARIO" "$PACKAGE"
APP_PID=$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
echo "App pid: ${APP_PID:-unknown}"

# When the app stops early or hangs: all logcat buffers, native crash dumps
# from the dropbox and the newest tombstone (if the emulator allows root),
# then the crash cause in the job log and summary (scripts/crash-report.sh).
report_crash() {
  local dir="$OUT/crash"
  mkdir -p "$dir"
  timeout 60 adb logcat -d -b all > "$OUT/logcat-crash.txt" 2>/dev/null \
    || timeout 60 adb logcat -d > "$OUT/logcat-crash.txt" 2>/dev/null || true
  local tag
  for tag in data_app_native_crash SYSTEM_TOMBSTONE data_app_crash data_app_anr; do
    timeout 30 adb shell dumpsys dropbox --print "$tag" 2>/dev/null | head -c 2000000 > "$dir/dropbox-$tag.txt" || true
  done
  local newest
  newest=$(timeout 15 adb shell "su 0 ls -t /data/tombstones 2>/dev/null || ls -t /data/tombstones 2>/dev/null" \
    | tr -d '\r' | grep -v '\.pb$' | head -n 1 || true)
  if [[ -n "$newest" ]]; then
    timeout 30 adb shell "su 0 cat /data/tombstones/$newest 2>/dev/null || cat /data/tombstones/$newest" \
      > "$dir/tombstone-$newest.txt" 2>/dev/null || true
  fi
  "$(dirname "$0")/crash-report.sh" "$OUT/logcat-crash.txt" "$APP_PID" "$dir" \
    "Crash report ($SCENARIO): $1" | tee "$OUT/crash-report.txt"
}

# Wait for the summary line, or for the app to die.
start=$(date +%s)
while true; do
  adb logcat -d -s ReactNativeJS:V > "$OUT/logcat.txt" || true
  if grep -q 'MYWORLD_BENCH_DONE' "$OUT/logcat.txt"; then break; fi
  if ! adb shell pidof "$PACKAGE" > /dev/null; then
    adb logcat -d > "$OUT/logcat-full.txt" || true
    echo "::error::The app stopped before the benchmark finished (see logcat-full.txt and the crash report below)."
    report_crash "the app stopped before the benchmark finished"
    exit 1
  fi
  if (( $(date +%s) - start > TIMEOUT_S )); then
    adb logcat -d > "$OUT/logcat-full.txt" || true
    echo "::error::The benchmark did not finish within ${TIMEOUT_S}s."
    report_crash "the benchmark did not finish within ${TIMEOUT_S}s"
    exit 1
  fi
  progress=$(grep -c 'MYWORLD_BENCH_SWIPE' "$OUT/logcat.txt" || true)
  echo "Swipes measured: $progress/400 · emulator load $(adb shell cat /proc/loadavg | cut -d' ' -f1-3)"
  sleep 15
done

grep -o 'MYWORLD_BENCH_SWIPE .*' "$OUT/logcat.txt" | sed 's/^MYWORLD_BENCH_SWIPE //' > "$OUT/swipes.jsonl"
# The save scenario: its saves and the load once per world (src/bench/benchSaves.ts).
grep -o 'MYWORLD_BENCH_SAVE .*' "$OUT/logcat.txt" | sed 's/^MYWORLD_BENCH_SAVE //' > "$OUT/saves.jsonl" || true
grep -o 'MYWORLD_BENCH_DONE .*' "$OUT/logcat.txt" | tail -n 1 | sed 's/^MYWORLD_BENCH_DONE //' > "$OUT/summary.json"

node - "$OUT" "$SCENARIO" <<'EOF'
const fs = require('fs');
const out = process.argv[2];
const scenario = process.argv[3];
const scenarioText = {
  young: 'young worlds',
  aged: 'worlds after 300 simulated years',
  cities: 'worlds after 300 years, every settlement a big city, ruins around them',
  unrest: 'worlds after 300 years, every settlement but the capitals rose up',
  trade: 'worlds after 300 years, a trade center in every settlement and a harbor on every coast',
  diplomacy: 'worlds after 300 years, all borders open and free trade between all peoples',
  government: 'worlds after 300 years, seats of government and government buildings everywhere',
  war: 'worlds after 300 years, uprisings, seats and soldiers everywhere, three rebellions and two blocks of allies at war, 32 army markers, 6 siege frames',
  gacha: 'worlds after 300 years, charges of all 25 abilities cast, fires burning, biomes shifting and rivers springing during the swipes',
  save: 'worlds after 300 years, the sliced autosave running over and over during the swipes, the save loaded back once per world',
  modes: 'worlds after 300 years, the map mode cycling through all modes and sub-modes during the swipes (colors and numbers in the tiles)',
}[scenario] ?? scenario;
const summary = JSON.parse(fs.readFileSync(`${out}/summary.json`, 'utf8'));
const swipes = fs.readFileSync(`${out}/swipes.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lines = [
  `## Map benchmark, ${scenarioText}: ${summary.pass ? 'PASSED' : 'FAILED'}`,
  '',
  'Rule: 5 random worlds, zoom 2, 1500 pt/s, 10 swipes in each of 8 directions; every swipe needs >= 60 fps and no frame over 25 ms.',
  '',
  `- Swipes failed: ${summary.failed}/${summary.swipes}`,
  `- fps: min ${summary.minFps.toFixed(1)}, median ${summary.medianFps.toFixed(1)}`,
  `- Worst frame: ${summary.worstMs.toFixed(1)} ms`,
  `- Seeds: ${summary.seeds.join(', ')}`,
  '',
  '| World | Seed | Direction | Swipes | Failed | Min fps | Worst ms |',
  '|---|---|---|---|---|---|---|',
];
const groups = new Map();
for (const s of swipes) {
  const key = `${s.world}|${s.seed}|${s.direction}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(s);
}
for (const [key, g] of groups) {
  const [world, seed, dir] = key.split('|');
  const failed = g.filter((s) => !s.pass).length;
  const minFps = Math.min(...g.map((s) => s.fps));
  const worst = Math.max(...g.map((s) => s.worstMs));
  lines.push(`| ${+world + 1} | ${seed} | ${dir} | ${g.length} | ${failed} | ${minFps.toFixed(1)} | ${worst.toFixed(1)} |`);
}
// Diagnostics: what else happened in the app during failing vs. passing
// swipes (counts per swipe, see src/state/perfStats.ts).
const withEvents = swipes.filter((s) => s.events);
if (withEvents.length > 0) {
  const keys = Object.keys(withEvents[0].events);
  const mean = (list, k) => (list.length ? list.reduce((sum, s) => sum + s.events[k], 0) / list.length : 0);
  const failing = withEvents.filter((s) => !s.pass);
  const passing = withEvents.filter((s) => s.pass);
  lines.push('', '### What happened during the swipes (mean per swipe)', '', '| Event | Failing swipes | Passing swipes |', '|---|---|---|');
  for (const k of keys) lines.push(`| ${k} | ${mean(failing, k).toFixed(2)} | ${mean(passing, k).toFixed(2)} |`);
  if (failing.length > 0) {
    lines.push('', '### Failing swipes', '', '| World | Direction | fps | Worst ms | ' + keys.join(' | ') + ' |', '|---|---|---|---|' + keys.map(() => '---|').join(''));
    for (const s of failing) {
      lines.push(`| ${s.world + 1} | ${s.direction} | ${s.fps.toFixed(1)} | ${s.worstMs.toFixed(1)} | ` + keys.map((k) => s.events[k]).join(' | ') + ' |');
    }
    // What ran around each failing swipe's worst frame (useBenchmark: worstFrameWork).
    lines.push('', '### Worst frame of each failing swipe: what ran around it', '', '| World | Direction | Worst ms | JS work (ms), when, UI pictures |', '|---|---|---|---|');
    for (const s of failing) {
      lines.push(`| ${s.world + 1} | ${s.direction} | ${s.worstMs.toFixed(1)} | ${(s.worstFrame ?? 'not recorded').replace(/\|/g, '/')} |`);
    }
  }
}
// The save scenario: saves per world and the load back (it must give the world saved).
const saveLines = fs.existsSync(`${out}/saves.jsonl`)
  ? fs.readFileSync(`${out}/saves.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const loads = saveLines.filter((l) => !l.end);
const badLoads = loads.filter((l) => !l.ok);
if (saveLines.length > 0) {
  lines.push('', '### Saves and loads', '', '| World | Seed | Step | Loaded | Load ms | Bytes | Saves | Written | Skipped | Note |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const l of saveLines) {
    lines.push(
      `| ${l.world + 1} | ${l.seed} | ${l.end ? 'end' : 'load'} | ${l.end ? '' : l.ok ? 'yes' : 'NO'} | ${l.ms !== undefined ? l.ms.toFixed(0) : ''} | ${l.bytes ?? ''} | ${l.saves} | ${l.written} | ${l.skipped} | ${(l.message ?? '').replace(/\|/g, '/')} |`,
    );
  }
}
const text = lines.join('\n') + '\n';
fs.writeFileSync(`${out}/summary.md`, text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
if (scenario === 'save' && (loads.length < 5 || badLoads.length > 0)) {
  console.log(`::error::Save benchmark: ${badLoads.length} of ${loads.length} loads did not give the world saved (one per world expected).`);
  process.exit(1);
}
if (!summary.pass) {
  console.log(`::error::Map benchmark (${scenarioText}) failed: ${summary.failed}/${summary.swipes} swipes below 60 fps or with a frame over 25 ms.`);
  process.exit(1);
}
EOF
