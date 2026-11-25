#!/usr/bin/env bash
# Frees Shadow's three ports, whatever is holding them.
for P in 4178 4179 8081; do
  PID=$(lsof -ti tcp:"$P" 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "  port $P  -> killing $PID"
    echo "$PID" | xargs kill 2>/dev/null
  else
    echo "  port $P  free"
  fi
done
