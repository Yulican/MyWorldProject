#!/usr/bin/env bash
# Waits until a connected Android emulator is idle: its CPU must stay below
# SETTLED_BUSY percent for SETTLED_WINDOWS 10-second windows in a row (at most
# 10 minutes). A freshly booted or restored emulator keeps the CPU busy with
# system work (app optimization, package scans, jobs due after the clock
# jump of a snapshot restore) for minutes; that work would show up as dropped
# frames.
#
# The CPU use is measured from /proc/stat, not the load average: after a
# snapshot restore the load average still holds the values from when the
# snapshot was saved.
set -euo pipefail
SETTLED_BUSY="${SETTLED_BUSY:-30}"
SETTLED_WINDOWS="${SETTLED_WINDOWS:-3}"
adb wait-for-device

# Prints "busy total" jiffies of all CPUs (busy excludes idle and iowait).
cpu_jiffies() {
  adb shell head -n 1 /proc/stat | awk '{ t = 0; for (i = 2; i <= NF; i++) t += $i; print t - $5 - $6, t }'
}

calm=0
read -r busy0 total0 < <(cpu_jiffies)
for _ in $(seq 1 60); do
  sleep 10
  read -r busy1 total1 < <(cpu_jiffies)
  percent=$(( (busy1 - busy0) * 100 / (total1 - total0 > 0 ? total1 - total0 : 1) ))
  busy0=$busy1
  total0=$total1
  if (( percent < SETTLED_BUSY )); then calm=$((calm + 1)); else calm=0; fi
  echo "Emulator CPU busy: ${percent}% (calm windows: $calm/$SETTLED_WINDOWS)"
  if (( calm >= SETTLED_WINDOWS )); then exit 0; fi
done
echo "::warning::The emulator CPU did not settle below ${SETTLED_BUSY}% within 10 minutes."
