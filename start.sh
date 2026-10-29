#!/usr/bin/env bash
# Start the M7 API (port 3004) + Web (port 5173) in one command.
# Usage: bash /opt/Attaky/Attaky\ site/order-management-m7a-foundation/start.sh
# Stop:  Ctrl+C (kills both)

cd "$(dirname "$0")"

echo "=== Starting M7 API (port 3004) + Web (port 5173) ==="
echo ""

trap 'kill $(jobs -p) 2>/dev/null; exit 0' INT TERM

(cd apps/api && exec pnpm dev) &
API_PID=$!
echo "API  → http://localhost:3004  (PID $API_PID)"

(cd apps/web && exec pnpm dev -- --host 0.0.0.0) &
WEB_PID=$!
echo "Web  → http://localhost:5173  (PID $WEB_PID)"
echo ""
echo "Press Ctrl+C to stop both."
echo "================================================"

wait
