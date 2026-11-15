#!/usr/bin/env bash
# Pulls the cause of an early app stop out of a logcat dump and prints it to
# stdout (the job log) and, in CI, to the job summary ($GITHUB_STEP_SUMMARY),
# so a crash can be read without downloading the benchmark artifacts.
#
# Usage: scripts/crash-report.sh <logcat file> [app pid] [crash dir] [title]
#   logcat file  `adb logcat -d` output (threadtime format; `-b all` is best)
#   app pid      the app's process id; found from "Start proc" lines if empty
#   crash dir    optional directory with tombstones / dropbox dumps (*.txt)
#   title        heading for the summary
# The report is at most MAX_LINES lines; it never fails the caller.
set -uo pipefail

LOG="${1:?logcat file}"
APP_PID="${2:-}"
CRASH_DIR="${3:-}"
TITLE="${4:-Crash report}"
PACKAGE="${PACKAGE:-com.example.myworldproject}"
MAX_LINES=200
WIDTH=400

[[ -f "$LOG" ]] || { echo "crash-report: no logcat file $LOG"; exit 0; }

if [[ -z "$APP_PID" ]]; then
  # ActivityManager: "Start proc 4321:com.example.myworldproject/u0a123 for ..."
  APP_PID=$(grep -o "Start proc [0-9]*:$PACKAGE[/ ]" "$LOG" | tail -n 1 | sed 's/Start proc \([0-9]*\):.*/\1/' || true)
fi

cut_lines() { cut -c1-"$WIDTH"; }

# Crash lines with the lines that belong to them (stack traces, backtraces).
crash_lines() {
  awk -v pkg="$PACKAGE" '
    function show(n) { if (n > rest) rest = n; }
    {
      hit = 0
      if ($0 ~ /FATAL EXCEPTION/)                         { hit = 1; show(30) }
      if ($0 ~ /backtrace:/)                              { hit = 1; show(40) }
      if ($0 ~ /AndroidRuntime: /)                        hit = 1
      if ($0 ~ /Fatal signal|SIGSEGV|SIGABRT|SIGBUS|SIGILL|SIGFPE/) hit = 1
      if ($0 ~ /Abort message/)                           hit = 1
      if ($0 ~ /OutOfMemoryError/)                        { hit = 1; show(10) }
      if ($0 ~ /ANR in /)                                 { hit = 1; show(10) }
      if ($0 ~ /lowmemorykiller|lmkd|Low on memory/)      hit = 1
      if ($0 ~ /Killing / && (index($0, pkg) || $0 ~ /lmk|lowmem/)) hit = 1
      if ($0 ~ /am_kill|am_crash|am_anr|am_proc_died/ && index($0, pkg)) hit = 1
      if (index($0, "Process " pkg) && $0 ~ /has died/)   hit = 1
      if (hit || rest > 0) { print; if (!hit) rest--; }
    }' "$1"
}

# The app's own JS / benchmark lines before the stop (long swipe JSON cut).
js_lines() {
  grep -E 'ReactNativeJS|MYWORLD_BENCH' "$LOG" | tail -n 30 || true
}

pid_lines() {
  [[ -n "$APP_PID" ]] || return 0
  awk -v pid="$APP_PID" '$3 == pid' "$LOG" | tail -n 50
}

# The first backtrace of the newest tombstone / native crash dump.
tombstone_lines() {
  [[ -n "$CRASH_DIR" && -d "$CRASH_DIR" ]] || return 0
  local f
  for f in $(ls -t "$CRASH_DIR"/* 2>/dev/null); do
    [[ -s "$f" ]] || continue
    grep -q 'backtrace:' "$f" || continue
    echo "--- $(basename "$f")"
    grep -m 4 -E '^(Cmdline|pid:|signal|Abort message)|Fatal signal' "$f" || true
    awk '/backtrace:/ { on = 1 } on { print; if (++n >= 41) exit }' "$f"
    return 0
  done
}

report() {
  echo "App pid: ${APP_PID:-unknown} · logcat lines: $(wc -l < "$LOG")"
  local crash
  crash=$(crash_lines "$LOG" | cut_lines | head -n 110)
  echo
  if [[ -n "$crash" ]]; then
    echo "== Crash lines from logcat"
    echo "$crash"
  else
    echo "== no crash lines found; last 50 logcat lines of the app (pid ${APP_PID:-unknown})"
    local own
    own=$(pid_lines | cut_lines)
    if [[ -n "$own" ]]; then echo "$own"; else tail -n 50 "$LOG" | cut_lines; fi
  fi
  local tomb
  tomb=$(tombstone_lines | cut_lines)
  if [[ -n "$tomb" ]]; then
    echo
    echo "== Tombstone (first backtrace)"
    echo "$tomb"
  fi
  echo
  echo "== Last 30 app log lines (ReactNativeJS / benchmark)"
  js_lines | cut -c1-200
}

TEXT=$(report | head -n "$MAX_LINES")
echo "===== $TITLE ====="
echo "$TEXT"
echo "===== end of $TITLE ====="
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### $TITLE"
    echo
    echo '```text'
    # A fence inside the text would end the block early.
    echo "$TEXT" | sed 's/```/` ` `/g'
    echo '```'
    echo
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
