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
trap '[ "$OWN" = 1 ] && kill "$SRV" 2>/dev/null' EXIT

node tools/check.mjs
