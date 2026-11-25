#!/usr/bin/env bash
# Shadow — brings up all three services. Ctrl-C stops every one of them.
set -uo pipefail
cd "$(dirname "$0")"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
SDK=$(node -e "console.log(require('./racket-app/package.json').dependencies.expo)" 2>/dev/null || echo "?")

for P in 4178 4179 8081; do
  if lsof -ti tcp:"$P" >/dev/null 2>&1; then
    echo "  port $P is already in use. Run ./stop.sh first."
    exit 1
  fi
done

PIDS=()
cleanup() {
  echo ""
  echo "  stopping..."
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done
  # Metro spawns children that outlive the npx wrapper
  for P in 4178 4179 8081; do
    LEFT=$(lsof -ti tcp:"$P" 2>/dev/null)
    [ -n "$LEFT" ] && echo "$LEFT" | xargs kill 2>/dev/null
  done
  wait 2>/dev/null
  echo "  all stopped."
}
trap cleanup INT TERM EXIT

cat <<BANNER

  Shadow
  ------
  Court       http://localhost:4178
  Relay       ws://$IP:4179
  Phone app   exp://$IP:8081          Expo SDK pin: $SDK

  On the phone:
    1. open Expo Go and scan the QR below, or enter exp://$IP:8081
    2. type  $IP  into the app's host box, then Connect
    3. pick your hand, then calibrate with your arm relaxed

  If the phone cannot reach the laptop, university Wi-Fi is isolating
  clients. Use the phone's hotspot, join the laptop to it, and re-run
  this script to pick up the new IP.

BANNER

python3 -m http.server 4178 >/dev/null 2>&1 &
PIDS+=($!)

# give the static server a moment, then put the court on screen
( sleep 1; open "http://localhost:4178" ) >/dev/null 2>&1 &

node relay/server.mjs &
PIDS+=($!)

( cd racket-app && npx expo start --lan ) &
PIDS+=($!)

wait
