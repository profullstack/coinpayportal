#!/usr/bin/env bash
#
# CoinPay Lightning Droplet Setup
# Idempotent — safe to run multiple times.
#
# Installs: Bitcoin Core (pruned) + Core Lightning (CLN) + LNbits + Nginx reverse proxy
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/profullstack/coinpayportal/master/scripts/setup-droplet.sh | bash
#   # or
#   bash scripts/setup-droplet.sh
#
# Requirements: Ubuntu 22.04+ droplet, 2GB+ RAM, 50GB disk
#
set -euo pipefail

BITCOIN_VERSION="27.1"
LNBITS_VERSION="0.12.12"
CLN_VERSION="25.05"
LNBITS_PORT=5000
LNBITS_DOMAIN="${LNBITS_DOMAIN:-ln.coinpayportal.com}"
CLN_NETWORK="${CLN_NETWORK:-bitcoin}"
CLN_USER="ubuntu"
CLN_DIR="/home/${CLN_USER}/.lightning"
BITCOIN_DIR="/home/${CLN_USER}/.bitcoin"
LNBITS_DIR="/opt/lnbits"
LNBITS_DATA="/opt/lnbits-data"
BITCOIN_RPC_USER="clnrpc"
BITCOIN_RPC_PASS="clnrpc2026secret"

echo "═══════════════════════════════════════════"
echo "  CoinPay Lightning Droplet Setup"
echo "  Bitcoin Core ${BITCOIN_VERSION} + CLN ${CLN_VERSION} + LNbits ${LNBITS_VERSION}"
echo "═══════════════════════════════════════════"

# ─────────────────────────────────────────────
# 1. System packages
# ─────────────────────────────────────────────
echo "▶ [1/9] System packages..."

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq \
  sudo git curl wget jq ufw \
  python3 python3-pip python3-venv \
  nginx certbot python3-certbot-nginx \
  autoconf automake build-essential libtool libsqlite3-dev \
  libgmp-dev libsodium-dev pkg-config net-tools \
  2>/dev/null

# ─────────────────────────────────────────────
# 2. Install Bitcoin Core (pruned)
# ─────────────────────────────────────────────
echo "▶ [2/9] Bitcoin Core (pruned)..."

if ! command -v bitcoind &>/dev/null; then
  BITCOIN_ARCH="$(uname -m)"
  cd /tmp
  wget -q "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-${BITCOIN_ARCH}-linux-gnu.tar.gz" \
    -O bitcoin.tar.gz
  tar xzf bitcoin.tar.gz
  install -m 0755 "bitcoin-${BITCOIN_VERSION}/bin/bitcoind" "bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli" /usr/local/bin/
  rm -rf "bitcoin-${BITCOIN_VERSION}" bitcoin.tar.gz
  echo "  Bitcoin Core installed: $(bitcoind --version | head -1)"
else
  echo "  Bitcoin Core already installed: $(bitcoind --version | head -1)"
fi

# Bitcoin config
mkdir -p "${BITCOIN_DIR}"
if [ ! -f "${BITCOIN_DIR}/bitcoin.conf" ]; then
  cat > "${BITCOIN_DIR}/bitcoin.conf" <<EOF
# CoinPay Bitcoin Core — pruned mode
server=1
prune=1000
txindex=0
dbcache=512
maxmempool=50

# RPC for CLN
rpcuser=${BITCOIN_RPC_USER}
rpcpassword=${BITCOIN_RPC_PASS}
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
EOF
  echo "  Bitcoin config written"
else
  echo "  Bitcoin config already exists"
fi
chown -R "${CLN_USER}:${CLN_USER}" "${BITCOIN_DIR}"

# Bitcoin systemd service
cat > /etc/systemd/system/bitcoind.service <<EOF
[Unit]
Description=Bitcoin daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/bitcoind -datadir=${BITCOIN_DIR} -daemon=0
User=${CLN_USER}
Type=simple
Restart=on-failure
RestartSec=30
MemoryMax=1200M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bitcoind

if systemctl is-active --quiet bitcoind; then
  echo "  bitcoind already running"
else
  systemctl start bitcoind
  echo "  bitcoind started — Initial Block Download will take 12-24h"
fi

# ─────────────────────────────────────────────
# 3. Install Core Lightning
# ─────────────────────────────────────────────
echo "▶ [3/9] Core Lightning..."

if ! command -v lightningd &>/dev/null; then
  echo "  Installing CLN from GitHub release..."
  CLN_ARCH="$(uname -m)"
  if [ "$CLN_ARCH" = "x86_64" ]; then
    CLN_ARCH="amd64"
  fi
  cd /tmp
  CLN_URL="https://github.com/ElementsProject/lightning/releases/download/v${CLN_VERSION}/clightning-v${CLN_VERSION}-Ubuntu-24.04-${CLN_ARCH}.tar.xz"
  wget -q "${CLN_URL}" -O cln.tar.xz || {
    CLN_URL="https://github.com/ElementsProject/lightning/releases/download/v${CLN_VERSION}/clightning-v${CLN_VERSION}-Ubuntu-22.04-${CLN_ARCH}.tar.xz"
    wget -q "${CLN_URL}" -O cln.tar.xz
  }
  tar xf cln.tar.xz -C /usr/local --strip-components=2
  rm -f cln.tar.xz

  if command -v lightningd &>/dev/null; then
    echo "  CLN installed: $(lightningd --version 2>/dev/null || echo 'ok')"
  else
    echo "  ⚠ CLN install failed — try PPA: add-apt-repository ppa:lightningd/release && apt install lightningd"
  fi
else
  echo "  CLN already installed: $(lightningd --version 2>/dev/null || echo 'ok')"
fi

# ─────────────────────────────────────────────
# 4. Configure CLN (bitcoind backend via bcli)
# ─────────────────────────────────────────────
echo "▶ [4/9] CLN configuration..."

mkdir -p "${CLN_DIR}"

if [ ! -f "${CLN_DIR}/config" ]; then
  cat > "${CLN_DIR}/config" <<EOF
# CoinPay Lightning Node
network=${CLN_NETWORK}
log-level=info
log-file=${CLN_DIR}/cln.log

# Alias visible on the network
alias=CoinPay Portal
rgb=8B5CF6

# Fee policy
fee-base=1000
fee-per-satoshi=10

# Listening
addr=0.0.0.0:9735

# CLNRest plugin (for LNbits)
clnrest-port=3010
clnrest-host=127.0.0.1

# Use local bitcoind via bcli
bitcoin-rpcuser=${BITCOIN_RPC_USER}
bitcoin-rpcpassword=${BITCOIN_RPC_PASS}
bitcoin-rpcconnect=127.0.0.1
bitcoin-rpcport=8332
EOF
  echo "  Config written to ${CLN_DIR}/config"
else
  echo "  Config already exists"
fi

chown -R "${CLN_USER}:${CLN_USER}" "${CLN_DIR}"

# ─────────────────────────────────────────────
# 5. CLN systemd service
# ─────────────────────────────────────────────
echo "▶ [5/9] CLN systemd service..."

cat > /etc/systemd/system/lightningd.service <<EOF
[Unit]
Description=Core Lightning daemon
After=bitcoind.service
Wants=bitcoind.service

[Service]
User=${CLN_USER}
Group=${CLN_USER}
Type=simple
ExecStart=/usr/bin/lightningd --lightning-dir=${CLN_DIR}
Restart=on-failure
RestartSec=10
TimeoutStartSec=120

# Hardening
PrivateTmp=true
ProtectSystem=full
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lightningd

if systemctl is-active --quiet lightningd; then
  echo "  lightningd already running"
else
  systemctl start lightningd || echo "  ⚠ lightningd failed to start (bitcoind may still be syncing) — check: journalctl -u lightningd -n 50"
fi

# Wait for CLN to be ready
echo "  Waiting for CLN..."
CLN_READY=false
for i in $(seq 1 15); do
  if sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo &>/dev/null; then
    echo "  CLN is ready!"
    sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo | jq '{id, alias, network, blockheight}'
    CLN_READY=true
    break
  fi
  sleep 2
done

if [ "$CLN_READY" = false ]; then
  echo "  ⚠ CLN not ready yet — bitcoind may still be syncing. CLN will start once bitcoind catches up."
fi

# ─────────────────────────────────────────────
# 6. Create runes for LNbits
# ─────────────────────────────────────────────
echo "▶ [6/9] LNbits runes..."

RUNE_FILE="${CLN_DIR}/lnbits-runes.env"

if [ ! -f "${RUNE_FILE}" ]; then
  if [ "$CLN_READY" = true ]; then
    READONLY_RUNE=$(sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" createrune \
      restrictions='[["method=listfunds","method=listpays","method=listinvoices","method=getinfo","method=summary","method=waitanyinvoice"]]' \
      | jq -r .rune)
    
    INVOICE_RUNE=$(sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" createrune \
      restrictions='[["method=invoice"],["pnamelabel^LNbits"],["rate=60"]]' \
      | jq -r .rune)
    
    PAY_RUNE=$(sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" createrune \
      restrictions='[["method=pay"],["rate=10"]]' \
      | jq -r .rune)

    cat > "${RUNE_FILE}" <<EOF
CLNREST_READONLY_RUNE=${READONLY_RUNE}
CLNREST_INVOICE_RUNE=${INVOICE_RUNE}
CLNREST_PAY_RUNE=${PAY_RUNE}
EOF
    chmod 600 "${RUNE_FILE}"
    chown "${CLN_USER}:${CLN_USER}" "${RUNE_FILE}"
    echo "  Runes created and saved to ${RUNE_FILE}"
  else
    echo "  ⚠ CLN not ready — runes will need to be created manually after sync"
    echo "  Run this script again after bitcoind finishes syncing"
  fi
else
  echo "  Runes already exist"
fi

# ─────────────────────────────────────────────
# 7. Install LNbits
# ─────────────────────────────────────────────
echo "▶ [7/9] LNbits..."

mkdir -p "${LNBITS_DATA}"

if [ ! -d "${LNBITS_DIR}/.venv" ]; then
  if [ ! -d "${LNBITS_DIR}" ]; then
    git clone --depth 1 https://github.com/lnbits/lnbits.git "${LNBITS_DIR}"
  fi
  cd "${LNBITS_DIR}"
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -e ".[all]"
  echo "  LNbits installed"
else
  echo "  LNbits already installed at ${LNBITS_DIR}"
fi

# LNbits .env config
LNBITS_ENV="${LNBITS_DIR}/.env"
if [ ! -f "${LNBITS_ENV}" ]; then
  READONLY_RUNE=""
  INVOICE_RUNE=""
  PAY_RUNE=""
  if [ -f "${RUNE_FILE}" ]; then
    source "${RUNE_FILE}"
    READONLY_RUNE="${CLNREST_READONLY_RUNE:-}"
    INVOICE_RUNE="${CLNREST_INVOICE_RUNE:-}"
    PAY_RUNE="${CLNREST_PAY_RUNE:-}"
  fi

  # Get CLN node ID if available
  CLN_NODEID=""
  if [ "$CLN_READY" = true ]; then
    CLN_NODEID=$(sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo | jq -r .id)
  fi

  AUTH_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

  cat > "${LNBITS_ENV}" <<EOF
# LNbits Configuration — CoinPay Portal
HOST=127.0.0.1
PORT=${LNBITS_PORT}
DEBUG=False

LNBITS_ADMIN_UI=true
LNBITS_DATA_FOLDER=${LNBITS_DATA}
LNBITS_EXTENSIONS_DEFAULT_INSTALL="lnaddress,tpos"

# CLNRest backend
LNBITS_BACKEND_WALLET_CLASS=CLNRestWallet
CLNREST_URL=https://127.0.0.1:3010
CLNREST_CA=${CLN_DIR}/${CLN_NETWORK}/ca.pem
CLNREST_NODEID=${CLN_NODEID}
CLNREST_READONLY_RUNE=${READONLY_RUNE}
CLNREST_INVOICE_RUNE=${INVOICE_RUNE}
CLNREST_PAY_RUNE=${PAY_RUNE}

# Auth
AUTH_SECRET_KEY=${AUTH_SECRET}
AUTH_ALLOWED_METHODS="user-id-only, username-password"
AUTH_TOKEN_EXPIRE_MINUTES=525600

FORWARDED_ALLOW_IPS="*"
EOF
  echo "  LNbits .env written"
else
  echo "  LNbits .env already exists"
fi

# LNbits systemd service
cat > /etc/systemd/system/lnbits.service <<EOF
[Unit]
Description=LNbits Lightning Wallet
After=lightningd.service
Wants=lightningd.service

[Service]
WorkingDirectory=${LNBITS_DIR}
ExecStart=${LNBITS_DIR}/.venv/bin/lnbits --port ${LNBITS_PORT} --host 127.0.0.1
Restart=on-failure
RestartSec=5
Environment=LNBITS_DATA_FOLDER=${LNBITS_DATA}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lnbits

if systemctl is-active --quiet lnbits; then
  echo "  LNbits already running"
else
  systemctl start lnbits || echo "  ⚠ LNbits failed to start — check: journalctl -u lnbits -n 50"
fi

# ─────────────────────────────────────────────
# 8. Nginx reverse proxy + firewall
# ─────────────────────────────────────────────
echo "▶ [8/9] Nginx + Firewall..."

NGINX_CONF="/etc/nginx/sites-available/lnbits"
if [ ! -f "${NGINX_CONF}" ]; then
  cat > "${NGINX_CONF}" <<'NGINXEOF'
server {
    listen 80;
    server_name LNBITS_DOMAIN_PLACEHOLDER;

    # API endpoints — no basic auth (LNbits API key auth)
    location /api/ {
        proxy_pass http://127.0.0.1:LNBITS_PORT_PLACEHOLDER;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }

    # LNURL / Lightning Address well-known
    location /.well-known/ {
        proxy_pass http://127.0.0.1:LNBITS_PORT_PLACEHOLDER;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # UI — basic auth
    location / {
        auth_basic "Admin Area";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:LNBITS_PORT_PLACEHOLDER;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINXEOF

  sed -i "s/LNBITS_DOMAIN_PLACEHOLDER/${LNBITS_DOMAIN}/g" "${NGINX_CONF}"
  sed -i "s/LNBITS_PORT_PLACEHOLDER/${LNBITS_PORT}/g" "${NGINX_CONF}"
  
  ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/lnbits
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  
  # Create htpasswd if it doesn't exist
  if [ ! -f /etc/nginx/.htpasswd ]; then
    echo "  ⚠ Create /etc/nginx/.htpasswd for admin UI protection:"
    echo "    htpasswd -c /etc/nginx/.htpasswd admin"
  fi
  
  nginx -t && systemctl reload nginx
  echo "  Nginx configured for ${LNBITS_DOMAIN}"
else
  echo "  Nginx config already exists"
fi

# Firewall
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   2>/dev/null || true  # SSH
  ufw allow 80/tcp   2>/dev/null || true  # HTTP
  ufw allow 443/tcp  2>/dev/null || true  # HTTPS
  ufw allow 9735/tcp 2>/dev/null || true  # Lightning P2P
  ufw allow 8333/tcp 2>/dev/null || true  # Bitcoin P2P
  ufw --force enable 2>/dev/null || true
  echo "  Firewall configured (22, 80, 443, 8333, 9735)"
fi

# SSL cert
if [ ! -d "/etc/letsencrypt/live/${LNBITS_DOMAIN}" ]; then
  echo "  Run this to enable HTTPS:"
  echo "    certbot --nginx -d ${LNBITS_DOMAIN}"
else
  echo "  SSL cert already exists for ${LNBITS_DOMAIN}"
fi

# ─────────────────────────────────────────────
# 9. Status check
# ─────────────────────────────────────────────
echo "▶ [9/9] Status..."

BITCOIN_BLOCKS="unknown"
BITCOIN_HEADERS="unknown"
if command -v bitcoin-cli &>/dev/null; then
  BITCOIN_INFO=$(bitcoin-cli -rpcuser="${BITCOIN_RPC_USER}" -rpcpassword="${BITCOIN_RPC_PASS}" getblockchaininfo 2>/dev/null || echo '{}')
  BITCOIN_BLOCKS=$(echo "$BITCOIN_INFO" | jq -r '.blocks // "unknown"')
  BITCOIN_HEADERS=$(echo "$BITCOIN_INFO" | jq -r '.headers // "unknown"')
  BITCOIN_IBD=$(echo "$BITCOIN_INFO" | jq -r '.initialblockdownload // "unknown"')
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Services:"
echo "    bitcoind    → systemctl status bitcoind    (blocks: ${BITCOIN_BLOCKS}/${BITCOIN_HEADERS}, IBD: ${BITCOIN_IBD:-unknown})"
echo "    lightningd  → systemctl status lightningd"
echo "    lnbits      → systemctl status lnbits"
echo ""
echo "  LNbits UI:  https://${LNBITS_DOMAIN}"
echo "  CLN RPC:    sudo -u ${CLN_USER} lightning-cli --network=${CLN_NETWORK} getinfo"
echo "  Bitcoin:    bitcoin-cli -rpcuser=${BITCOIN_RPC_USER} -rpcpassword=${BITCOIN_RPC_PASS} getblockchaininfo"
echo ""
echo "  Next steps:"
echo "    1. Wait for bitcoind to finish syncing (12-24h on first run)"
echo "    2. Point DNS: ${LNBITS_DOMAIN} → this server's IP"
echo "    3. Get SSL:   certbot --nginx -d ${LNBITS_DOMAIN}"
echo "    4. Fund node: lightning-cli newaddr bech32"
echo "       Send BTC, then open a channel:"
echo "       lightning-cli connect <peer_id>@<host>:<port>"
echo "       lightning-cli fundchannel <peer_id> <amount_sats>"
echo "    5. Create LNbits wallet at https://${LNBITS_DOMAIN}"
echo "    6. Enable LNURLp extension in LNbits admin"
echo ""
echo "  Config files:"
echo "    Bitcoin:  ${BITCOIN_DIR}/bitcoin.conf"
echo "    CLN:      ${CLN_DIR}/config"
echo "    LNbits:   ${LNBITS_DIR}/.env"
echo "    Runes:    ${RUNE_FILE}"
echo "    Nginx:    ${NGINX_CONF}"
echo ""
