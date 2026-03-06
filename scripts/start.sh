#!/bin/sh
# Railway start script — runs Next.js app + payment monitor service

export NODE_OPTIONS="--max-old-space-size=1024 --unhandled-rejections=warn"

# Start the monitor service in the background
npx tsx scripts/monitor-service.ts &
MONITOR_PID=$!

# Trap signals to clean up both processes
cleanup() {
  echo "[start.sh] Shutting down..."
  kill $MONITOR_PID 2>/dev/null
  wait $MONITOR_PID 2>/dev/null
  exit 0
}
trap cleanup SIGTERM SIGINT

# Start Next.js in the foreground
pnpm start &
NEXT_PID=$!

# Wait for either to exit
wait $NEXT_PID
EXIT_CODE=$?

# If Next.js dies, kill the monitor too
kill $MONITOR_PID 2>/dev/null
exit $EXIT_CODE
