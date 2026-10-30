#!/usr/bin/env bash
# Runs the map benchmark on a connected Android device or emulator and fails
# unless every swipe passes (rules in src/bench/benchmark.ts).
#
# Usage: scripts/run-benchmark.sh <benchmark.apk> [output dir]
# The APK must be built with EXPO_PUBLIC_BENCHMARK=1, so it starts the
# benchmark on launch and logs MYWORLD_BENCH_* lines.
set -euo pipefail

APK="$1"
OUT="${2:-benchmark-results}"
PACKAGE=com.example.myworldproject
TIMEOUT_S=1500

mkdir -p "$OUT"
adb wait-for-device
adb install -r "$APK"
adb logcat -c
adb shell am start -n "$PACKAGE/.MainActivity"

# Wait for the summary line, or for the app to die.
start=$(date +%s)
while true; do
  adb logcat -d -s ReactNativeJS:V > "$OUT/logcat.txt" || true
  if grep -q 'MYWORLD_BENCH_DONE' "$OUT/logcat.txt"; then break; fi
  if ! adb shell pidof "$PACKAGE" > /dev/null; then
    adb logcat -d > "$OUT/logcat-full.txt" || true
    echo "::error::The app stopped before the benchmark finished (see logcat-full.txt)."
    exit 1
  fi
  if (( $(date +%s) - start > TIMEOUT_S )); then
    adb logcat -d > "$OUT/logcat-full.txt" || true
    echo "::error::The benchmark did not finish within ${TIMEOUT_S}s."
    exit 1
  fi
  progress=$(grep -c 'MYWORLD_BENCH_SWIPE' "$OUT/logcat.txt" || true)
  echo "Swipes measured: $progress/400"
  sleep 15
done

grep -o 'MYWORLD_BENCH_SWIPE .*' "$OUT/logcat.txt" | sed 's/^MYWORLD_BENCH_SWIPE //' > "$OUT/swipes.jsonl"
grep -o 'MYWORLD_BENCH_DONE .*' "$OUT/logcat.txt" | tail -n 1 | sed 's/^MYWORLD_BENCH_DONE //' > "$OUT/summary.json"

node - "$OUT" <<'EOF'
const fs = require('fs');
const out = process.argv[2];
const summary = JSON.parse(fs.readFileSync(`${out}/summary.json`, 'utf8'));
const swipes = fs.readFileSync(`${out}/swipes.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lines = [
  `## Map benchmark: ${summary.pass ? 'PASSED' : 'FAILED'}`,
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
const text = lines.join('\n') + '\n';
fs.writeFileSync(`${out}/summary.md`, text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
if (!summary.pass) {
  console.log(`::error::Map benchmark failed: ${summary.failed}/${summary.swipes} swipes below 60 fps or with a frame over 25 ms.`);
  process.exit(1);
}
EOF
