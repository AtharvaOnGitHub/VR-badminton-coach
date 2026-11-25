#!/usr/bin/env bash
# Starts everything Shadow needs. Ctrl-C stops all three.
set -m
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")

echo ""
echo "  Shadow"
echo "  ------"
echo "  Court      http://localhost:4178"
echo "  Phone app  exp://$IP:8081      (open in Expo Go)"
echo "  Relay      ws://$IP:4179       (type $IP into the phone app)"
echo ""

python3 -m http.server 4178 >/dev/null 2>&1 &
node relay/server.mjs &
( cd racket-app && npx expo start --lan ) &
wait
