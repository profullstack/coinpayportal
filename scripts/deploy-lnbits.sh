#!/usr/bin/env bash
#
# CoinPay LNbits Deploy / Upgrade Script
# Idempotent — safe to run on every deploy.
#
# Flow: stop lnbits → backup db → git pull → upgrade deps → start lnbits
#
# Usage:
#   bash scripts/deploy-lnbits.sh
#
set -euo pipefail

LNBITS_DIR="/opt/lnbits"
LNBITS_DATA="/opt/lnbits-data"
BACKUP_DIR="/opt/lnbits-backups"
MAX_BACKUPS=10

echo "═══════════════════════════════════════════"
echo "  CoinPay LNbits Deploy"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════"

# ─────────────────────────────────────────────
# 1. Stop LNbits
# ─────────────────────────────────────────────
echo "▶ [1/5] Stopping LNbits..."

if systemctl is-active --quiet lnbits; then
  systemctl stop lnbits
  echo "  LNbits stopped"
else
  echo "  LNbits was not running"
fi

# ─────────────────────────────────────────────
# 2. Backup database
# ─────────────────────────────────────────────
echo "▶ [2/5] Backing up database..."

mkdir -p "${BACKUP_DIR}"

DB_FILE="${LNBITS_DATA}/database.sqlite3"
if [ -f "${DB_FILE}" ]; then
  TIMESTAMP=$(date -u '+%Y%m%d-%H%M%S')
  BACKUP_FILE="${BACKUP_DIR}/lnbits-db-${TIMESTAMP}.sqlite3"

  # Use sqlite3 .backup for a consistent snapshot (if sqlite3 is available)
  if command -v sqlite3 &>/dev/null; then
    sqlite3 "${DB_FILE}" ".backup '${BACKUP_FILE}'"
  else
    cp "${DB_FILE}" "${BACKUP_FILE}"
  fi

  # Compress the backup
  if command -v gzip &>/dev/null; then
    gzip "${BACKUP_FILE}"
    BACKUP_FILE="${BACKUP_FILE}.gz"
  fi

  BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "  Backed up to ${BACKUP_FILE} (${BACKUP_SIZE})"

  # Rotate old backups — keep only the last N
  BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/lnbits-db-*.sqlite3* 2>/dev/null | wc -l)
  if [ "${BACKUP_COUNT}" -gt "${MAX_BACKUPS}" ]; then
    ls -1t "${BACKUP_DIR}"/lnbits-db-*.sqlite3* | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f
    echo "  Rotated old backups (keeping last ${MAX_BACKUPS})"
  fi
else
  echo "  No database found at ${DB_FILE} — skipping backup"
fi

# ─────────────────────────────────────────────
# 3. Update LNbits (git pull)
# ─────────────────────────────────────────────
echo "▶ [3/5] Updating LNbits..."

if [ -d "${LNBITS_DIR}/.git" ]; then
  cd "${LNBITS_DIR}"
  
  BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  
  git fetch origin
  git reset --hard origin/main 2>/dev/null || git reset --hard origin/master 2>/dev/null || git reset --hard origin/dev 2>/dev/null || {
    echo "  ⚠ git reset failed — trying pull instead"
    git pull --ff-only
  }
  
  AFTER=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  
  if [ "${BEFORE}" = "${AFTER}" ]; then
    echo "  Already up to date (${AFTER})"
  else
    echo "  Updated: ${BEFORE} → ${AFTER}"
  fi
else
  echo "  LNbits not a git repo at ${LNBITS_DIR} — run setup-droplet.sh first"
  # Start lnbits back up before exiting on error
  systemctl start lnbits 2>/dev/null || true
  exit 1
fi

# ─────────────────────────────────────────────
# 4. Upgrade dependencies
# ─────────────────────────────────────────────
echo "▶ [4/5] Upgrading dependencies..."

cd "${LNBITS_DIR}"

if [ -d ".venv" ]; then
  .venv/bin/pip install --upgrade pip -q
  # Surface install errors instead of falling back silently. Previous
  # version did `pip install -e ".[all]" 2>/dev/null || pip install -e .`,
  # which masked missing-extra failures and let new hard deps (e.g. the
  # pyinstrument bump in upstream commit 8b426efa) ship to a venv that
  # didn't have them — LNbits then crashed on import while systemd still
  # reported `active`. Fail loud here so the deploy actually fails.
  .venv/bin/pip install -e ".[all]"
  echo "  Dependencies updated"
else
  echo "  No virtualenv found — run setup-droplet.sh first"
  systemctl start lnbits 2>/dev/null || true
  exit 1
fi

# ─────────────────────────────────────────────
# 5. Start LNbits
# ─────────────────────────────────────────────
echo "▶ [5/5] Starting LNbits..."

systemctl start lnbits

# Wait for LNbits to be ready
READY=false
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:5000/api/v1/health" 2>/dev/null | grep -q "200"; then
    READY=true
    break
  fi
  sleep 1
done

if [ "$READY" = true ]; then
  echo "  ✅ LNbits is running and healthy"
else
  # Check if process is at least running
  if systemctl is-active --quiet lnbits; then
    echo "  ⚠ LNbits is running but health check timed out (may still be starting)"
  else
    echo "  ❌ LNbits failed to start — check: journalctl -u lnbits -n 50"
    exit 1
  fi
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Deploy complete!"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════"
echo ""
echo "  LNbits: $(cd ${LNBITS_DIR} && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "  Status: systemctl status lnbits"
echo "  Logs:   journalctl -u lnbits -f"
echo "  Backup: ${BACKUP_DIR}/"
