#!/usr/bin/env bash
#
# Encrypt Core Lightning's hsm_secret on dev2 (CLN v25.05, systemd unit
# lightningd.service, user lightning, --lightning-dir=/home/lightning/.lightning).
# Runbook: docs/runbooks/cln-encrypted-hsm.md. Run as root, at a terminal.
#
#   cln-encrypt-hsm.sh check   <backup-hex-file>   # read-only: prerequisites + backup match
#   cln-encrypt-hsm.sh encrypt <backup-hex-file>   # stop node, encrypt, verify, install unit, start
#
# <backup-hex-file> holds the 64-hex hsm_secret from vault coinpayportal--treasury
# (LN_HSM_SECRET_HEX), pulled to RAM only, e.g.:
#   umask 077; logicsrc get coinpayportal--treasury LN_HSM_SECRET_HEX > /dev/shm/hsm.hex
# The script refuses to touch anything unless that backup matches the live
# hsm_secret byte for byte. A wrong passphrase later means: restore the
# plaintext hsm_secret from that backup (see runbook), never regenerate.
set -euo pipefail

LDIR=${LDIR:-/home/lightning/.lightning}
NET=${NET:-bitcoin}
HSM="$LDIR/$NET/hsm_secret"
UNIT=lightningd.service
DROPIN_DIR=/etc/systemd/system/$UNIT.d
EXPECTED_NODE_ID=${EXPECTED_NODE_ID:-03f635570db7ae152ce04bf97dd237cefee06ae4b52db5a24d3834fe2d9319b014}
HSMTOOL=${HSMTOOL:-/usr/local/bin/lightning-hsmtool}
CLI=(sudo -u lightning /usr/local/bin/lightning-cli --lightning-dir="$LDIR")

die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
say() { printf '==> %s\n' "$*"; }

[ "$(id -u)" = 0 ] || die "run as root"
mode=${1:-}; backup=${2:-}
[ -n "$mode" ] && [ -n "$backup" ] || die "usage: $0 check|encrypt <backup-hex-file>"
[ -r "$backup" ] || die "backup file $backup not readable"
[ -f "$HSM" ] || die "$HSM not found"

# The unit's current command line, kept as is, plus --encrypted-hsm.
CUR_EXEC=$(systemctl cat "$UNIT" | awk '/^ExecStart=./{v=substr($0,11)} END{print v}')

check() {
  [ -n "$CUR_EXEC" ] || die "could not read ExecStart of $UNIT"
  case "$CUR_EXEC" in *encrypted-hsm*|*"'"*|*'"'*) die "unexpected ExecStart: $CUR_EXEC";; esac
  say "current ExecStart: $CUR_EXEC"
  local size; size=$(stat -c %s "$HSM")
  # A plain hsm_secret is exactly 32 bytes; an encrypted one is 73.
  [ "$size" = 32 ] || die "$HSM is $size bytes, not a 32-byte plaintext secret (already encrypted?)"
  local hex; hex=$(tr -d ' \n\r' < "$backup" | tr 'A-F' 'a-f')
  [[ "$hex" =~ ^[0-9a-f]{64}$ ]] || die "backup is not 64 hex characters"
  [ "$(xxd -p -c 64 "$HSM")" = "$hex" ] || die "backup does NOT match the live hsm_secret; fix the backup first"
  say "backup matches the live hsm_secret"
  local id; id=$("$HSMTOOL" getnodeid "$HSM")
  [ "$id" = "$EXPECTED_NODE_ID" ] || die "live node id $id != expected $EXPECTED_NODE_ID"
  say "node id $id"
  "${CLI[@]}" getinfo >/dev/null || die "lightning-cli getinfo failed: is the node healthy?"
  say "node answers getinfo; prerequisites OK"
}

encrypt() {
  check
  say "stopping $UNIT"
  systemctl stop "$UNIT"
  cp -p "$HSM" "$HSM.pre-encrypt"   # removed below once the encrypted file is proven
  say "lightning-hsmtool encrypt: choose the passphrase now (twice). Write it down offline."
  "$HSMTOOL" encrypt "$HSM"
  [ "$(stat -c %s "$HSM")" = 73 ] || { cp -p "$HSM.pre-encrypt" "$HSM"; die "encrypted file has an unexpected size; plaintext restored"; }
  say "re-enter the passphrase to prove it opens the file"
  local id; id=$("$HSMTOOL" getnodeid "$HSM") || true
  if [ "$id" != "$EXPECTED_NODE_ID" ]; then
    cp -p "$HSM.pre-encrypt" "$HSM"; systemctl start "$UNIT"
    die "passphrase check failed (got '$id'); plaintext restored, node restarted unencrypted"
  fi
  shred -u "$HSM.pre-encrypt"
  say "installing $DROPIN_DIR/encrypted-hsm.conf (passphrase asked at every start)"
  mkdir -p "$DROPIN_DIR"
  {
    echo '[Service]'
    echo '# hsm_secret is encrypted: lightningd reads the passphrase from stdin.'
    echo '# Answer the prompt with: systemd-tty-ask-password-agent --query'
    echo 'ExecStart='
    echo "ExecStart=/bin/sh -c 'systemd-ask-password --timeout=0 \"CLN hsm_secret passphrase:\" | exec $CUR_EXEC --encrypted-hsm'"
    echo '# A restart would wait on the prompt: restart by hand.'
    echo 'Restart=no'
  } > "$DROPIN_DIR/encrypted-hsm.conf"
  systemctl daemon-reload
  say "starting $UNIT: answer the prompt with: systemd-tty-ask-password-agent --query"
  systemctl start --no-block "$UNIT"
  systemd-tty-ask-password-agent --query || true
  for _ in $(seq 1 60); do
    if id=$("${CLI[@]}" getinfo 2>/dev/null | sed -n 's/.*"id": "\([0-9a-f]*\)".*/\1/p'); [ "$id" = "$EXPECTED_NODE_ID" ]; then
      say "node up with encrypted hsm_secret, id $id"; return 0
    fi
    sleep 2
  done
  die "node did not come up in 2 minutes: journalctl -u $UNIT -n 50 (runbook: rollback)"
}

case "$mode" in
  check) check ;;
  encrypt) encrypt ;;
  *) die "unknown mode $mode" ;;
esac
