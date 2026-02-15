#!/usr/bin/env bash
#
# CoinPay Lightning Droplet Setup
# Idempotent — safe to run multiple times.
#
# Installs: Core Lightning (CLN) + LNbits + Nginx reverse proxy
# CLN uses Blockstream Esplora for block data (no full Bitcoin node needed).
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/profullstack/coinpayportal/master/scripts/setup-droplet.sh | bash
#   # or
#   bash scripts/setup-droplet.sh
#
# Requirements: Ubuntu 22.04+ droplet, 2GB+ RAM, 50GB disk
#
set -euo pipefail

LNBITS_VERSION="0.12.12"
CLN_VERSION="25.05"
LNBITS_PORT=5000
LNBITS_DOMAIN="${LNBITS_DOMAIN:-lnbits.coinpayportal.com}"
CLN_NETWORK="${CLN_NETWORK:-bitcoin}"
CLN_USER="lightning"
CLN_DIR="/home/${CLN_USER}/.lightning"
LNBITS_DIR="/opt/lnbits"
LNBITS_DATA="/opt/lnbits-data"

echo "═══════════════════════════════════════════"
echo "  CoinPay Lightning Droplet Setup"
echo "  CLN ${CLN_VERSION} + LNbits ${LNBITS_VERSION}"
echo "═══════════════════════════════════════════"

# ─────────────────────────────────────────────
# 1. System packages
# ─────────────────────────────────────────────
echo "▶ [1/8] System packages..."

export DEBIAN_FRONTEND=noninteractive

if ! command -v lightningd &>/dev/null || ! command -v nginx &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq \
    sudo git curl wget jq ufw \
    python3 python3-pip python3-venv \
    nginx certbot python3-certbot-nginx \
    autoconf automake build-essential libtool libsqlite3-dev \
    libgmp-dev libsodium-dev pkg-config net-tools \
    2>/dev/null
fi

# ─────────────────────────────────────────────
# 2. Create lightning user
# ─────────────────────────────────────────────
echo "▶ [2/8] Lightning user..."

if ! id -u "${CLN_USER}" &>/dev/null; then
  useradd -m -s /bin/bash "${CLN_USER}"
  echo "  Created user: ${CLN_USER}"
else
  echo "  User ${CLN_USER} already exists"
fi

# ─────────────────────────────────────────────
# 3. Install Core Lightning
# ─────────────────────────────────────────────
echo "▶ [3/8] Core Lightning..."

if ! command -v lightningd &>/dev/null; then
  echo "  Installing CLN from Ubuntu PPA..."
  
  # Add CLN PPA
  if [ ! -f /etc/apt/sources.list.d/lightningd.list ]; then
    add-apt-repository -y ppa:lightningd/release 2>/dev/null || {
      # Fallback: install from release binary
      echo "  PPA failed, installing from GitHub release..."
      CLN_ARCH="$(uname -m)"
      if [ "$CLN_ARCH" = "x86_64" ]; then
        CLN_ARCH="amd64"
      fi
      CLN_URL="https://github.com/ElementsProject/lightning/releases/download/v${CLN_VERSION}/clightning-v${CLN_VERSION}-Ubuntu-24.04-${CLN_ARCH}.tar.xz"
      cd /tmp
      wget -q "${CLN_URL}" -O cln.tar.xz || {
        # Try 22.04
        CLN_URL="https://github.com/ElementsProject/lightning/releases/download/v${CLN_VERSION}/clightning-v${CLN_VERSION}-Ubuntu-22.04-${CLN_ARCH}.tar.xz"
        wget -q "${CLN_URL}" -O cln.tar.xz
      }
      tar xf cln.tar.xz -C /usr/local --strip-components=2
      rm -f cln.tar.xz
    }
  fi
  
  if ! command -v lightningd &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq lightningd 2>/dev/null || true
  fi
  
  if command -v lightningd &>/dev/null; then
    echo "  CLN installed: $(lightningd --version 2>/dev/null || echo 'ok')"
  else
    echo "  ⚠ CLN install failed — try manually: apt install lightningd"
  fi
else
  echo "  CLN already installed: $(lightningd --version 2>/dev/null || echo 'ok')"
fi

# ─────────────────────────────────────────────
# 4. Configure CLN (Esplora backend, no full node)
# ─────────────────────────────────────────────
echo "▶ [4/8] CLN configuration..."

mkdir -p "${CLN_DIR}"

if [ ! -f "${CLN_DIR}/config" ]; then
  cat > "${CLN_DIR}/config" <<EOF
# CoinPay Lightning Node
network=${CLN_NETWORK}
log-level=info
log-file=${CLN_DIR}/cln.log

# Use Blockstream Esplora — no local Bitcoin node needed
bitcoin-rpcurl=https://blockstream.info/api/
bitcoin-rpcport=443

# CLNRest plugin (for LNbits)
clnrest-port=3010
clnrest-host=127.0.0.1

# Alias visible on the network
alias=CoinPay Portal
rgb=8B5CF6

# Auto-manage fees
fee-base=1000
fee-per-satoshi=10

# Accept zero-conf channels from known LSPs
experimental-dual-fund
experimental-offers

# Listening
addr=0.0.0.0:9735
announce-addr=${LNBITS_DOMAIN}:9735
EOF
  echo "  Config written to ${CLN_DIR}/config"
else
  echo "  Config already exists"
fi

chown -R "${CLN_USER}:${CLN_USER}" "${CLN_DIR}"

# ─────────────────────────────────────────────
# 5. CLN systemd service
# ─────────────────────────────────────────────
echo "▶ [5/8] CLN systemd service..."

cat > /etc/systemd/system/lightningd.service <<EOF
[Unit]
Description=Core Lightning daemon
After=network-online.target
Wants=network-online.target

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
  systemctl start lightningd || echo "  ⚠ lightningd failed to start — check: journalctl -u lightningd -n 50"
fi

# Wait for CLN to be ready
echo "  Waiting for CLN to start..."
for i in $(seq 1 30); do
  if sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo &>/dev/null; then
    echo "  CLN is ready!"
    sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo | jq '{id, alias, network, blockheight}'
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────
# 6. Create runes for LNbits
# ─────────────────────────────────────────────
echo "▶ [6/8] LNbits runes..."

RUNE_FILE="${CLN_DIR}/lnbits-runes.env"

if [ ! -f "${RUNE_FILE}" ]; then
  # Wait for CLN to be ready before creating runes
  if sudo -u "${CLN_USER}" lightning-cli --network="${CLN_NETWORK}" getinfo &>/dev/null; then
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
    echo "  ⚠ CLN not ready yet — runes will be created on next run"
  fi
else
  echo "  Runes already exist"
fi

# ─────────────────────────────────────────────
# 7. Install LNbits
# ─────────────────────────────────────────────
echo "▶ [7/8] LNbits..."

mkdir -p "${LNBITS_DATA}"

if [ ! -d "${LNBITS_DIR}" ]; then
  git clone --depth 1 https://github.com/lnbits/lnbits.git "${LNBITS_DIR}"
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
  # Read runes if available
  READONLY_RUNE=""
  INVOICE_RUNE=""
  PAY_RUNE=""
  if [ -f "${RUNE_FILE}" ]; then
    source "${RUNE_FILE}"
    READONLY_RUNE="${CLNREST_READONLY_RUNE:-}"
    INVOICE_RUNE="${CLNREST_INVOICE_RUNE:-}"
    PAY_RUNE="${CLNREST_PAY_RUNE:-}"
  fi

  # Generate secret key
  AUTH_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

  cat > "${LNBITS_ENV}" <<EOF
# LNbits Configuration — CoinPay Portal
HOST=127.0.0.1
PORT=${LNBITS_PORT}

LNBITS_ADMIN_UI=true
LNBITS_DATA_FOLDER=${LNBITS_DATA}
LNBITS_EXTENSIONS_DEFAULT_INSTALL="lnaddress,tpos"

# CLNRest backend
LNBITS_BACKEND_WALLET_CLASS=CLNRestWallet
CLNREST_URL=https://127.0.0.1:3010
CLNREST_CA=${CLN_DIR}/${CLN_NETWORK}/ca.pem
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
echo "▶ [8/8] Nginx + Firewall..."

# Nginx config
NGINX_CONF="/etc/nginx/sites-available/lnbits"
if [ ! -f "${NGINX_CONF}" ]; then
  cat > "${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${LNBITS_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${LNBITS_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # LNURL / Lightning Address well-known
    location /.well-known/lnurlp/ {
        proxy_pass http://127.0.0.1:${LNBITS_PORT}/.well-known/lnurlp/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/lnbits
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
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
  ufw --force enable 2>/dev/null || true
  echo "  Firewall configured (22, 80, 443, 9735)"
fi

# SSL cert
if [ ! -d "/etc/letsencrypt/live/${LNBITS_DOMAIN}" ]; then
  echo "  Run this to enable HTTPS:"
  echo "    certbot --nginx -d ${LNBITS_DOMAIN}"
else
  echo "  SSL cert already exists for ${LNBITS_DOMAIN}"
fi

# ─────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Services:"
echo "    lightningd  → systemctl status lightningd"
echo "    lnbits       → systemctl status lnbits"
echo ""
echo "  LNbits UI:  http://${LNBITS_DOMAIN}"
echo "  CLN RPC:    sudo -u ${CLN_USER} lightning-cli --network=${CLN_NETWORK} getinfo"
echo ""
echo "  Next steps:"
echo "    1. Point DNS: ${LNBITS_DOMAIN} → this server's IP"
echo "    2. Get SSL:   certbot --nginx -d ${LNBITS_DOMAIN}"
echo "    3. Fund node: lightning-cli newaddr bech32"
echo "       Send BTC to that address, then open a channel:"
echo "       lightning-cli connect <peer_id>@<host>:<port>"
echo "       lightning-cli fundchannel <peer_id> <amount_sats>"
echo "    4. Create LNbits wallet at http://${LNBITS_DOMAIN}"
echo "    5. Enable Lightning Address extension in LNbits admin"
echo ""
echo "  Runes saved to: ${RUNE_FILE}"
echo "  LNbits config:  ${LNBITS_ENV}"
echo ""
