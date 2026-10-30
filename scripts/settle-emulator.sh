#!/usr/bin/env bash
# Waits until a connected Android emulator's 1-minute load average has
# settled (at most 10 minutes). A freshly booted emulator keeps the CPU busy
# with system work (app optimization, package scans) for minutes; it also
# draws on the CPU, so that work would show up as dropped frames.
set -euo pipefail
SETTLED_LOAD="${SETTLED_LOAD:-1.0}"
adb wait-for-device
for _ in $(seq 1 60); do
  load=$(adb shell cat /proc/loadavg | cut -d' ' -f1)
  echo "Emulator load: $load"
  if awk "BEGIN { exit !($load < $SETTLED_LOAD) }"; then exit 0; fi
  sleep 10
done
echo "::warning::The emulator load did not settle below $SETTLED_LOAD within 10 minutes."
