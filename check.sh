#!/usr/bin/env bash
# Behaviour checks. Starts its own static server, runs the suite, tears down.
set -uo pipefail
cd "$(dirname "$0")"

if lsof -ti tcp:4178 >/dev/null 2>&1; then
  OWN=0
else
  python3 -m http.server 4178 >/dev/null 2>&1 &
  SRV=$!
  OWN=1
  sleep 1
fi

node relay/server.mjs >/dev/null 2>&1 &
RELAY=$!
trap '[ "$OWN" = 1 ] && kill "$SRV" 2>/dev/null; kill "$RELAY" 2>/dev/null' EXIT
sleep 0.6

node tools/check.mjs || FAILED=1
node tools/bench-check.mjs || FAILED=1
exit ${FAILED:-0}
