#!/usr/bin/env bash
# Builds the phone app for the web and drives its setup pages in a real browser.
#
# The app is React Native, so it cannot be clicked on a laptop as it stands. Expo
# builds the same source for the web, which gives a DOM to press. This proves the
# buttons work and the wizard advances. It proves nothing about the sensor, which
# a browser does not have, and the suite checks that the app says so rather than
# pretending otherwise.
set -uo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/shadow-racket-web"
rm -rf "$OUT"
( cd racket-app && npx expo export --platform web --output-dir "$OUT" ) >/dev/null 2>&1 \
  || { echo "  web export failed"; exit 1; }
node tools/phone-check.mjs "$OUT"
