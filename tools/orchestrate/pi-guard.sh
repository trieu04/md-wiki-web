#!/usr/bin/env bash
# pi-guard.sh <events.jsonl> -- <pi args...>
# Runs pi in JSON event mode with a watchdog so a stuck agent never blocks orchestration.
#   STARTUP_SEC (default 90)   no "session" event within this time        -> kill, exit 126
#   IDLE_SEC    (default 900)  no new event for this long                 -> kill, exit 125
#   HARD_SEC    (default 3600) total wall time                            -> kill, exit 124
#   HANG_RETRIES (default 2)   startup/idle hangs are retried automatically (they do not count as task retries)
# On success prints the agent's final assistant text to stdout and exits with pi's exit code.
set -uo pipefail
EVENTS=$1; shift; [ "${1:-}" = "--" ] && shift
STARTUP_SEC=${STARTUP_SEC:-90}; IDLE_SEC=${IDLE_SEC:-900}; HARD_SEC=${HARD_SEC:-3600}; HANG_RETRIES=${HANG_RETRIES:-2}

final_text() {
  python3 -I - "$1" <<'PY'
import json, sys
last = ""
for line in open(sys.argv[1], errors="replace"):
    try: e = json.loads(line)
    except Exception: continue
    m = e.get("message") or {}
    if e.get("type") == "message_end" and m.get("role") == "assistant" and isinstance(m.get("content"), list):
        t = "".join(c.get("text", "") for c in m["content"] if c.get("type") == "text")
        if t.strip(): last = t
print(last)
PY
}

kill_tree() { pkill -TERM -P "$1" 2>/dev/null; kill -TERM "$1" 2>/dev/null; sleep 3; pkill -KILL -P "$1" 2>/dev/null; kill -KILL "$1" 2>/dev/null; }

try=0
while :; do
  : > "$EVENTS"
  pi --mode json "$@" < /dev/null >> "$EVENTS" 2>&1 &
  PID=$!
  start=$(date +%s); last_size=0; last_change=$start; reason=""
  while kill -0 "$PID" 2>/dev/null; do
    sleep 5
    now=$(date +%s); size=$(wc -c < "$EVENTS" | tr -d ' ')
    if [ "$size" != "$last_size" ]; then last_size=$size; last_change=$now; fi
    if ! grep -q '"type":"session"' "$EVENTS" && [ $((now - start)) -ge "$STARTUP_SEC" ]; then reason=startup; break; fi
    if [ $((now - last_change)) -ge "$IDLE_SEC" ]; then reason=idle; break; fi
    if [ $((now - start)) -ge "$HARD_SEC" ]; then reason=hard; break; fi
  done
  if [ -z "$reason" ]; then
    wait "$PID"; RC=$?
    # agent finished but never emitted a final message: treat like a hang
    if grep -q '"type":"agent_end"' "$EVENTS"; then final_text "$EVENTS"; exit $RC; fi
    reason=noend
  else
    kill_tree "$PID"
  fi
  echo "[pi-guard] $(date +%T) $reason hang (attempt $((try+1))), events: $(wc -l < "$EVENTS" | tr -d ' ')" >&2
  cp "$EVENTS" "$EVENTS.hang$try"
  [ "$reason" = hard ] && { echo "PI_GUARD: HARD_TIMEOUT after ${HARD_SEC}s"; exit 124; }
  try=$((try+1))
  if [ $try -gt "$HANG_RETRIES" ]; then echo "PI_GUARD: HUNG ($reason) $try times"; [ "$reason" = startup ] && exit 126 || exit 125; fi
  sleep 10
done
