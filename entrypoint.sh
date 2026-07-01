#!/usr/bin/env bash
set -euo pipefail

# Next.js-friendly defaults
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8080}"
export NODE_ENV=production

echo "Environment configured for production mode (HOST=${HOST} PORT=${PORT})"

# Write tor config (points onion:80 -> your local app on $PORT)
cat >/etc/tor/torrc <<EOF
DataDirectory /var/lib/tor
Log notice file /var/log/tor/notices.log
User debian-tor

HiddenServiceDir /var/lib/tor/hidden_service
HiddenServicePort 80 127.0.0.1:${PORT}

SocksPort 0
ORPort 0
ExitPolicy reject *:*
EOF

# Perms for mounted volume
mkdir -p /var/lib/tor/hidden_service /var/log/tor
chown -R debian-tor:debian-tor /var/lib/tor /var/log/tor
chmod 700 /var/lib/tor/hidden_service || true

# Start Tor
echo "Starting Tor daemon..."
tor -f /etc/tor/torrc &
TOR_PID=$!

sleep 2
if ! kill -0 $TOR_PID 2>/dev/null; then
  echo "ERROR: Tor failed to start" >&2
  cat /var/log/tor/notices.log 2>/dev/null || echo "No Tor logs found" >&2
  exit 1
fi
echo "Tor started successfully (PID: $TOR_PID)"

# Wait for onion hostname (first run generates keys)
echo "Waiting for Tor to generate hidden service keys..."
for i in $(seq 1 60); do
  if [ -s /var/lib/tor/hidden_service/hostname ]; then
    break
  fi
  if [ $i -eq 10 ] || [ $i -eq 30 ]; then
    ls -la /var/lib/tor/hidden_service/ 2>/dev/null || echo "Directory not accessible"
    tail -5 /var/log/tor/notices.log 2>/dev/null || echo "No logs available"
  fi
  sleep 1
done

if [ -s /var/lib/tor/hidden_service/hostname ]; then
  ONION_URL="$(cat /var/lib/tor/hidden_service/hostname)"
  echo "🧅 TOR HIDDEN SERVICE READY!"
  echo "ONION_URL=${ONION_URL}"
  echo "Your site is accessible at: http://${ONION_URL}"
  echo ""
  echo "📋 To surface the Tor link in the UI, set this Railway variable:"
  echo "   NEXT_PUBLIC_ONION_URL=${ONION_URL}"
  export ONION_URL="${ONION_URL}"
  export NEXT_PUBLIC_ONION_URL="${ONION_URL}"
else
  echo "❌ Failed to generate onion hostname" >&2
  tail -10 /var/log/tor/notices.log 2>/dev/null || echo "No logs available"
fi

# Sanity-check Next.js build artifacts
if [ ! -d "/app/.next" ] || [ ! -f "/app/.next/BUILD_ID" ]; then
  echo "❌ ERROR: Next.js build artifacts missing in /app/.next" >&2
  ls -la /app/.next/ 2>/dev/null || ls -la /app/
  exit 1
fi
echo "✅ Next.js build artifacts found (BUILD_ID: $(cat /app/.next/BUILD_ID))"

# Start the app (limit heap like scripts/start.sh does)
echo "Starting Next.js on ${HOST}:${PORT}..."
NODE_OPTIONS="--max-old-space-size=512 --unhandled-rejections=warn" \
  NODE_ENV=production HOST="${HOST}" PORT="${PORT}" pnpm start &
APP_PID=$!

# Exit if either process dies, then clean up both
wait -n $APP_PID $TOR_PID
echo "Shutting down services..."
kill $APP_PID $TOR_PID 2>/dev/null || true
wait $APP_PID $TOR_PID 2>/dev/null || true
