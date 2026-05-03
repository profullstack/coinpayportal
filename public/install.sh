#!/bin/sh
# CoinPay Portal — one-line installer for the `coinpay` CLI.
#
# Usage:
#   curl -fsSL https://coinpayportal.com/install.sh | sh
#
# Subcommands (also runnable directly via `coinpay`):
#   curl -fsSL https://coinpayportal.com/install.sh | sh -s -- install     (default)
#   curl -fsSL https://coinpayportal.com/install.sh | sh -s -- update
#   curl -fsSL https://coinpayportal.com/install.sh | sh -s -- upgrade     (alias)
#   curl -fsSL https://coinpayportal.com/install.sh | sh -s -- remove
#   curl -fsSL https://coinpayportal.com/install.sh | sh -s -- uninstall   (alias)
#
# What it does:
#   1. Detects OS (Linux/macOS — Windows users: use WSL).
#   2. Installs mise (https://mise.jdx.dev) if missing, lives under $HOME.
#   3. Installs Node.js 20 via mise if no system Node 18+ is present.
#   4. `npm install -g @profullstack/coinpay`.
#   5. Drops a wrapper at $HOME/.local/bin/coinpay that handles
#      `coinpay update | upgrade | remove | uninstall` itself and
#      forwards everything else to the real CLI.
#   6. Schedules a self-update poll every 5 minutes:
#         Linux  → systemd --user timer (falls back to cron)
#         macOS  → launchd LaunchAgent (StartInterval=300)
#   7. Prints next steps (`coinpay --help`).
#
# Override env vars:
#   COINPAY_HOME=/path           install dir          (default: $HOME/.coinpay)
#   COINPAY_BIN=/path/dir        wrapper bin dir      (default: $HOME/.local/bin)
#   COINPAY_NPM_VERSION=X.Y.Z    pin npm version      (default: latest)
#   COINPAY_NO_AUTOUPGRADE=1     skip the 5-min poll setup
#   COINPAY_API_URL=https://…    pin API base         (default: https://coinpayportal.com)
#
# Re-running this script updates an existing install in place.

set -eu

NPM_PACKAGE="@profullstack/coinpay"
DEFAULT_API_URL="https://coinpayportal.com"
INSTALL_URL="https://coinpayportal.com/install.sh"
# 5-minute poll interval, matching infernet + c0mpute.
UPGRADE_INTERVAL_SEC=300

# ---------------------------------------------------------------------------
# Operator identity resolution — never assume root, never trust env alone.
# `curl | sh` invocations can land with HOME / USER unset (cron, container
# init, /etc/skel-less images). Mirror infernet's resolver.
# ---------------------------------------------------------------------------
_cp_resolve_user() {
    if [ -n "${USER:-}" ]; then echo "$USER"; return 0; fi
    _u="$(whoami 2>/dev/null || id -un 2>/dev/null)"
    [ -n "$_u" ] && { echo "$_u"; return 0; }
    [ "$(id -u 2>/dev/null || echo 0)" = "0" ] && { echo "root"; return 0; }
    echo "user"
}

_cp_resolve_home() {
    if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then echo "$HOME"; return 0; fi
    _u="$(_cp_resolve_user)"
    _h="$(getent passwd "$_u" 2>/dev/null | awk -F: '{print $6}')"
    if [ -n "$_h" ] && [ -d "$_h" ]; then echo "$_h"; return 0; fi
    if [ "$(id -u 2>/dev/null || echo 0)" = "0" ]; then echo "/root"; return 0; fi
    _h="/tmp/$_u"
    mkdir -p "$_h" 2>/dev/null || true
    echo "$_h"
}

USER="$(_cp_resolve_user)"
HOME="$(_cp_resolve_home)"
export USER HOME

COINPAY_HOME="${COINPAY_HOME:-$HOME/.coinpay}"
COINPAY_BIN="${COINPAY_BIN:-$HOME/.local/bin}"
COINPAY_NPM_VERSION="${COINPAY_NPM_VERSION:-latest}"
COINPAY_API_URL="${COINPAY_API_URL:-$DEFAULT_API_URL}"
WRAPPER="$COINPAY_BIN/coinpay"
UPGRADER="$COINPAY_HOME/bin/coinpay-self-upgrade"
LOG_DIR="$COINPAY_HOME/log"
UPGRADE_LOG="$LOG_DIR/auto-upgrade.log"

# ---------------------------------------------------------------------------
# pretty output
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m')
    BLUE=$(printf '\033[34m'); RED=$(printf '\033[31m')
    BOLD=$(printf '\033[1m'); RESET=$(printf '\033[0m')
else
    GREEN=''; YELLOW=''; BLUE=''; RED=''; BOLD=''; RESET=''
fi
info()  { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()    { printf '%s ✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '%s !%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
fail()  { printf '%s ✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
detect_os() {
    UNAME_S="$(uname -s)"
    case "$UNAME_S" in
        Linux)  OS=linux ;;
        Darwin) OS=macos ;;
        *)      fail "unsupported OS: $UNAME_S (Linux and macOS only — Windows users: use WSL)" ;;
    esac
}

# ---------------------------------------------------------------------------
# mise + node install (idempotent)
# ---------------------------------------------------------------------------
ensure_mise() {
    if command -v mise >/dev/null 2>&1; then
        ok "mise $(mise --version 2>/dev/null | head -1)"
        return 0
    fi
    info "installing mise (https://mise.jdx.dev)"
    if ! command -v curl >/dev/null 2>&1; then
        fail "curl is required to install mise"
    fi
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://mise.run | sh 2>&1 | awk '
        /failed to preserve ownership|cannot preserve ownership/ {
            printf "  ! warn: %s (harmless on network FS)\n", $0; next
        }
        { print }
    '
    if [ -x "$HOME/.local/bin/mise" ]; then
        PATH="$HOME/.local/bin:$PATH"
        export PATH
        ok "mise installed at $HOME/.local/bin/mise"
    else
        fail "mise install failed (binary not at $HOME/.local/bin/mise)"
    fi
}

ensure_node_via_mise() {
    # Already have a usable system node? Skip mise entirely.
    if command -v node >/dev/null 2>&1; then
        _v="$(node -v 2>/dev/null | sed 's/^v//')"
        _major="$(echo "$_v" | cut -d. -f1)"
        if [ "${_major:-0}" -ge 18 ]; then
            ok "Node.js v$_v (system)"
            unset _v _major
            return 0
        fi
        unset _v _major
    fi

    ensure_mise
    info "installing Node.js 20 via mise"
    MISE_YES=1; export MISE_YES
    mise install node@20    >/dev/null 2>&1 || warn "mise install node@20 had warnings"
    mise use --global node@20 >/dev/null 2>&1 || warn "mise use --global node@20 had warnings"

    # Trust the config mise just wrote (it refuses to read untrusted
    # config.toml files by default — would break every later `node`/`npm`).
    _cfg="$HOME/.config/mise/config.toml"
    [ -f "$_cfg" ] && mise trust "$_cfg" >/dev/null 2>&1 || true
    unset _cfg

    # Expose mise shims for the rest of this script.
    _mise_data="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}"
    PATH="$HOME/.local/bin:$_mise_data/shims:$PATH"
    export PATH
    unset _mise_data

    command -v node >/dev/null 2>&1 || fail "node not on PATH after mise install"
    ok "Node.js $(node -v) (via mise)"
}

# ---------------------------------------------------------------------------
# install / update the npm package
# ---------------------------------------------------------------------------
install_npm_package() {
    if ! command -v npm >/dev/null 2>&1; then
        fail "npm not found — node install must have failed"
    fi
    info "installing $NPM_PACKAGE@$COINPAY_NPM_VERSION (npm install -g)"
    if ! npm install -g "$NPM_PACKAGE@$COINPAY_NPM_VERSION" >/dev/null 2>&1; then
        # Retry verbosely so the user sees the failure.
        npm install -g "$NPM_PACKAGE@$COINPAY_NPM_VERSION" \
            || fail "npm install -g $NPM_PACKAGE failed"
    fi
    # Reshim mise so the new global binary is on PATH via the shim layer.
    command -v mise >/dev/null 2>&1 && mise reshim >/dev/null 2>&1 || true
    ok "$NPM_PACKAGE installed"
}

# Resolve where npm dropped the real coinpay binary.
resolve_real_coinpay() {
    _prefix="$(npm prefix -g 2>/dev/null)"
    if [ -n "$_prefix" ] && [ -x "$_prefix/bin/coinpay" ]; then
        echo "$_prefix/bin/coinpay"
        unset _prefix
        return 0
    fi
    # mise-shim case: the shim itself is on PATH but not under npm prefix.
    _shim="$(command -v coinpay 2>/dev/null || true)"
    if [ -n "$_shim" ] && [ "$_shim" != "$WRAPPER" ]; then
        echo "$_shim"
        unset _prefix _shim
        return 0
    fi
    unset _prefix _shim
    return 1
}

# ---------------------------------------------------------------------------
# wrapper at $COINPAY_BIN/coinpay
#
# The wrapper:
#   • intercepts `update|upgrade|remove|uninstall` and runs them itself
#   • forwards everything else to the real npm-installed binary
#   • is the single entry point users put on their PATH; the auto-upgrade
#     timer also exec's it
# ---------------------------------------------------------------------------
write_wrapper() {
    mkdir -p "$COINPAY_BIN"
    cat > "$WRAPPER" <<WRAPPER_EOF
#!/bin/sh
# CoinPay CLI wrapper — installed by https://coinpayportal.com/install.sh
# Re-run the installer to update this wrapper.
set -eu

COINPAY_HOME="\${COINPAY_HOME:-$COINPAY_HOME}"
COINPAY_BIN="\${COINPAY_BIN:-$COINPAY_BIN}"
NPM_PACKAGE="$NPM_PACKAGE"
INSTALL_URL="$INSTALL_URL"

# Make sure mise shims + ~/.local/bin are on PATH so 'npm' resolves
# even when invoked from a non-interactive shell (cron, systemd timer).
_mise_data="\${MISE_DATA_DIR:-\${XDG_DATA_HOME:-\$HOME/.local/share}/mise}"
case ":\$PATH:" in
    *":\$HOME/.local/bin:"*) ;;
    *) PATH="\$HOME/.local/bin:\$PATH" ;;
esac
case ":\$PATH:" in
    *":\$_mise_data/shims:"*) ;;
    *) PATH="\$_mise_data/shims:\$PATH" ;;
esac
export PATH
unset _mise_data

case "\${1:-}" in
    update|upgrade|self-update)
        shift || true
        exec sh -c "curl -fsSL '\$INSTALL_URL' | sh -s -- update \$@"
        ;;
    remove|uninstall)
        shift || true
        exec sh -c "curl -fsSL '\$INSTALL_URL' | sh -s -- remove \$@"
        ;;
esac

# Forward to the real binary. Try npm prefix first, fall back to PATH.
_real=""
if command -v npm >/dev/null 2>&1; then
    _prefix="\$(npm prefix -g 2>/dev/null)"
    [ -n "\$_prefix" ] && [ -x "\$_prefix/bin/coinpay" ] && _real="\$_prefix/bin/coinpay"
fi
if [ -z "\$_real" ]; then
    # Search PATH but skip our own wrapper to avoid recursion.
    for _dir in \$(echo "\$PATH" | tr ':' ' '); do
        if [ -x "\$_dir/coinpay" ] && [ "\$_dir/coinpay" != "\$0" ]; then
            _real="\$_dir/coinpay"; break
        fi
    done
fi

if [ -z "\$_real" ] || [ ! -x "\$_real" ]; then
    printf 'coinpay: real CLI not found — re-run installer:\n  curl -fsSL %s | sh\n' "\$INSTALL_URL" >&2
    exit 127
fi

exec "\$_real" "\$@"
WRAPPER_EOF
    chmod +x "$WRAPPER"
    ok "wrapper installed at $WRAPPER"
}

# ---------------------------------------------------------------------------
# self-upgrade helper
#
# Runs every $UPGRADE_INTERVAL_SEC by the timer/agent below. Compares
# the installed package version against npm registry; if a newer one
# exists, runs `npm install -g` and logs.
# ---------------------------------------------------------------------------
write_self_upgrade_helper() {
    mkdir -p "$COINPAY_HOME/bin" "$LOG_DIR"
    cat > "$UPGRADER" <<UPGRADER_EOF
#!/bin/sh
# CoinPay self-upgrade poll. Invoked every $UPGRADE_INTERVAL_SEC by
# systemd --user / launchd / cron. Idempotent — silent when up-to-date.
set -eu

NPM_PACKAGE="$NPM_PACKAGE"
LOG_FILE="$UPGRADE_LOG"
mkdir -p "\$(dirname "\$LOG_FILE")" 2>/dev/null || true

# Same PATH wiring as the wrapper so npm resolves under cron/systemd.
_mise_data="\${MISE_DATA_DIR:-\${XDG_DATA_HOME:-\$HOME/.local/share}/mise}"
PATH="\$HOME/.local/bin:\$_mise_data/shims:\$PATH"
export PATH
unset _mise_data

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '[%s] %s\n' "\$(ts)" "\$*" >> "\$LOG_FILE"; }

if ! command -v npm >/dev/null 2>&1; then
    log "npm not on PATH — skipping"
    exit 0
fi
if ! command -v node >/dev/null 2>&1; then
    log "node not on PATH — skipping"
    exit 0
fi

# Read the installed version straight off disk via node — avoids fragile
# JSON parsing in shell. \$prefix is the global npm root; the package
# layout npm v7+ guarantees is \$prefix/lib/node_modules/<pkg>/package.json
# (or just <pkg>/package.json on Windows; we're Linux/macOS so OK).
prefix="\$(npm prefix -g 2>/dev/null)"
pkg_json="\$prefix/lib/node_modules/\$NPM_PACKAGE/package.json"
[ -f "\$pkg_json" ] || pkg_json="\$prefix/node_modules/\$NPM_PACKAGE/package.json"
if [ -f "\$pkg_json" ]; then
    current="\$(node -p "require('\$pkg_json').version" 2>/dev/null || echo "")"
else
    current=""
fi
latest="\$(npm view "\$NPM_PACKAGE" version 2>/dev/null || echo "")"

if [ -z "\$latest" ]; then
    log "could not reach npm registry; will retry"
    exit 0
fi
# If we can't determine the current version (fresh install missing
# package.json on disk), assume an upgrade is needed — npm install
# is idempotent so the worst case is a no-op reinstall.
if [ -n "\$current" ] && [ "\$current" = "\$latest" ]; then
    # Quiet success — uncomment to debug:
    # log "up-to-date (\$current)"
    exit 0
fi

log "upgrade available: \${current:-?} → \$latest"
if npm install -g "\$NPM_PACKAGE@\$latest" >> "\$LOG_FILE" 2>&1; then
    log "upgraded to \$latest"
    command -v mise >/dev/null 2>&1 && mise reshim >/dev/null 2>&1 || true
else
    log "npm install failed; will retry next tick"
    exit 1
fi
UPGRADER_EOF
    chmod +x "$UPGRADER"
    ok "self-upgrade helper at $UPGRADER"
}

# ---------------------------------------------------------------------------
# auto-upgrade scheduling — systemd --user (Linux) / launchd (macOS) / cron
# ---------------------------------------------------------------------------
schedule_systemd_timer() {
    # systemd --user requires a user systemd instance; not present on
    # WSL1, some containers, etc. Detect and fall back to cron.
    if ! command -v systemctl >/dev/null 2>&1; then return 1; fi
    if ! systemctl --user show-environment >/dev/null 2>&1; then return 1; fi

    _unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$_unit_dir"

    cat > "$_unit_dir/coinpay-autoupgrade.service" <<UNIT_EOF
[Unit]
Description=CoinPay CLI auto-upgrade poll
Documentation=https://coinpayportal.com/install.sh

[Service]
Type=oneshot
ExecStart=$UPGRADER
Nice=10
UNIT_EOF

    cat > "$_unit_dir/coinpay-autoupgrade.timer" <<TIMER_EOF
[Unit]
Description=CoinPay CLI auto-upgrade poll (every 5 min)
Documentation=https://coinpayportal.com/install.sh

[Timer]
OnBootSec=2min
OnUnitActiveSec=${UPGRADE_INTERVAL_SEC}sec
AccuracySec=30sec
Persistent=true
Unit=coinpay-autoupgrade.service

[Install]
WantedBy=timers.target
TIMER_EOF

    systemctl --user daemon-reload >/dev/null 2>&1 || true
    systemctl --user enable --now coinpay-autoupgrade.timer >/dev/null 2>&1 \
        || { unset _unit_dir; return 1; }

    ok "systemd --user timer enabled (every 5 min): coinpay-autoupgrade.timer"
    unset _unit_dir
    return 0
}

schedule_launchd_agent() {
    _agents_dir="$HOME/Library/LaunchAgents"
    _plist="$_agents_dir/com.coinpayportal.autoupgrade.plist"
    mkdir -p "$_agents_dir"

    cat > "$_plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>          <string>com.coinpayportal.autoupgrade</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UPGRADER</string>
  </array>
  <key>StartInterval</key>  <integer>$UPGRADE_INTERVAL_SEC</integer>
  <key>RunAtLoad</key>      <false/>
  <key>StandardOutPath</key><string>$UPGRADE_LOG</string>
  <key>StandardErrorPath</key><string>$UPGRADE_LOG</string>
</dict>
</plist>
PLIST_EOF

    # Reload — unload-then-load is the idempotent pattern.
    launchctl unload "$_plist" >/dev/null 2>&1 || true
    launchctl load   "$_plist" >/dev/null 2>&1 || { unset _agents_dir _plist; return 1; }

    ok "launchd agent loaded (every 5 min): com.coinpayportal.autoupgrade"
    unset _agents_dir _plist
    return 0
}

schedule_cron_fallback() {
    if ! command -v crontab >/dev/null 2>&1; then return 1; fi
    _marker="# coinpay-autoupgrade (managed by install.sh)"
    _line="*/5 * * * * $UPGRADER  $_marker"
    # Read existing crontab, strip any old coinpay-autoupgrade line, append fresh.
    _existing="$(crontab -l 2>/dev/null | grep -v 'coinpay-autoupgrade' || true)"
    {
        [ -n "$_existing" ] && printf '%s\n' "$_existing"
        printf '%s\n' "$_line"
    } | crontab - >/dev/null 2>&1 || { unset _marker _line _existing; return 1; }
    ok "cron job installed (every 5 min)"
    unset _marker _line _existing
    return 0
}

schedule_auto_upgrade() {
    if [ "${COINPAY_NO_AUTOUPGRADE:-}" = "1" ]; then
        info "COINPAY_NO_AUTOUPGRADE=1 — skipping auto-upgrade scheduling"
        return 0
    fi
    case "$OS" in
        macos)
            schedule_launchd_agent && return 0
            warn "launchd setup failed — falling back to cron"
            schedule_cron_fallback || warn "no scheduler available; auto-upgrade not scheduled"
            ;;
        linux)
            schedule_systemd_timer && return 0
            schedule_cron_fallback || warn "no scheduler available (no systemd --user, no crontab)"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# PATH wiring
# ---------------------------------------------------------------------------
ensure_path() {
    case ":$PATH:" in
        *":$COINPAY_BIN:"*) ;;
        *) PATH="$COINPAY_BIN:$PATH"; export PATH ;;
    esac
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        [ -f "$rc" ] || continue
        if ! grep -q '/.local/bin' "$rc" 2>/dev/null; then
            printf '\n# Added by CoinPay installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
        fi
    done
}

# ---------------------------------------------------------------------------
# remove / uninstall
# ---------------------------------------------------------------------------
unschedule_systemd_timer() {
    [ -d "$HOME/.config/systemd/user" ] || return 0
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user disable --now coinpay-autoupgrade.timer >/dev/null 2>&1 || true
        systemctl --user daemon-reload >/dev/null 2>&1 || true
    fi
    rm -f "$HOME/.config/systemd/user/coinpay-autoupgrade.timer" \
          "$HOME/.config/systemd/user/coinpay-autoupgrade.service" 2>/dev/null || true
}

unschedule_launchd_agent() {
    _plist="$HOME/Library/LaunchAgents/com.coinpayportal.autoupgrade.plist"
    [ -f "$_plist" ] || return 0
    launchctl unload "$_plist" >/dev/null 2>&1 || true
    rm -f "$_plist" 2>/dev/null || true
    unset _plist
}

unschedule_cron() {
    command -v crontab >/dev/null 2>&1 || return 0
    _existing="$(crontab -l 2>/dev/null | grep -v 'coinpay-autoupgrade' || true)"
    if [ -n "$_existing" ]; then
        printf '%s\n' "$_existing" | crontab - >/dev/null 2>&1 || true
    else
        crontab -r >/dev/null 2>&1 || true
    fi
    unset _existing
}

run_remove() {
    info "removing CoinPay CLI"
    detect_os
    unschedule_systemd_timer
    unschedule_launchd_agent
    unschedule_cron

    if command -v npm >/dev/null 2>&1; then
        npm uninstall -g "$NPM_PACKAGE" >/dev/null 2>&1 || true
        ok "npm uninstall -g $NPM_PACKAGE"
    fi

    rm -f "$WRAPPER" 2>/dev/null || true
    rm -rf "$COINPAY_HOME" 2>/dev/null || true
    ok "removed wrapper $WRAPPER"
    ok "removed $COINPAY_HOME"

    cat <<NOTE_EOF

CoinPay has been uninstalled.

Files left in place (kept on purpose — they hold your wallet/secrets):
  $HOME/.coinpay-wallet.gpg   (your encrypted wallet, if any)
  $HOME/.coinpay.json         (CLI config — API key, base URL)

Remove them manually if you really want a clean slate:
  rm -f $HOME/.coinpay-wallet.gpg $HOME/.coinpay.json

NOTE_EOF
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
print_banner() {
    printf '\n'
    printf '%sCoinPay Portal installer%s\n' "$BOLD" "$RESET"
    printf '  user:        %s (uid=%s)\n' "$USER" "$(id -u 2>/dev/null || echo ?)"
    printf '  home:        %s\n' "$HOME"
    printf '  install dir: %s\n' "$COINPAY_HOME"
    printf '  bin dir:     %s\n' "$COINPAY_BIN"
    printf '  api:         %s\n' "$COINPAY_API_URL"
    printf '\n'
}

run_install() {
    print_banner
    detect_os
    ok "OS: $OS"

    mkdir -p "$COINPAY_HOME/bin" "$COINPAY_BIN" "$LOG_DIR"

    ensure_node_via_mise
    install_npm_package
    write_self_upgrade_helper
    write_wrapper
    ensure_path
    schedule_auto_upgrade

    printf '\n%sInstall complete.%s\n\n' "$GREEN" "$RESET"
    printf 'Use:\n'
    printf '  coinpay --help                           # full command list\n'
    printf '  coinpay config set-key <api-key>         # configure your API key\n'
    printf '  coinpay wallet create --words 24         # create a non-custodial wallet\n'
    printf '  coinpay payment create                   # accept a payment\n'
    printf '\n'
    printf 'Lifecycle:\n'
    printf '  coinpay update                           # upgrade to latest\n'
    printf '  coinpay remove                           # uninstall\n'
    printf '  curl -fsSL %s | sh -s -- update\n' "$INSTALL_URL"
    printf '  curl -fsSL %s | sh -s -- remove\n' "$INSTALL_URL"
    printf '\n'
    if [ "${COINPAY_NO_AUTOUPGRADE:-}" != "1" ]; then
        printf 'Auto-upgrade: every 5 min (logs: %s)\n' "$UPGRADE_LOG"
    fi
    if ! command -v coinpay >/dev/null 2>&1 || [ "$(command -v coinpay)" != "$WRAPPER" ]; then
        printf '\n%sIf this shell isn'"'"'t picking up coinpay, run:%s\n' "$YELLOW" "$RESET"
        printf '  export PATH="%s:$PATH"\n' "$COINPAY_BIN"
    fi
    printf '\n'
}

run_update() {
    print_banner
    detect_os
    info "checking for updates"
    ensure_node_via_mise
    install_npm_package
    write_self_upgrade_helper
    write_wrapper
    ensure_path
    schedule_auto_upgrade
    printf '\n%sUpdate complete.%s\n\n' "$GREEN" "$RESET"
}

# ---------------------------------------------------------------------------
# entry
# ---------------------------------------------------------------------------
CMD="${1:-install}"
shift 2>/dev/null || true

case "$CMD" in
    install)              run_install ;;
    update|upgrade)       run_update ;;
    remove|uninstall)     run_remove ;;
    -h|--help|help)
        sed -n '2,40p' "$0" 2>/dev/null || cat <<HELP_EOF
CoinPay installer — usage:
  curl -fsSL $INSTALL_URL | sh                       # install (default)
  curl -fsSL $INSTALL_URL | sh -s -- update          # upgrade in place
  curl -fsSL $INSTALL_URL | sh -s -- remove          # uninstall

Env: COINPAY_HOME, COINPAY_BIN, COINPAY_NPM_VERSION, COINPAY_NO_AUTOUPGRADE
HELP_EOF
        ;;
    *)
        fail "unknown command: $CMD (try: install | update | remove | help)"
        ;;
esac
