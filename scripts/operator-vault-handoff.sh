#!/usr/bin/env bash
# Hand CoinPay's operator unlock from the old container to the new one on a
# deploy, so a redeploy does not lock the vault (src/lib/wallets/operator-handoff.ts).
#
#   operator-vault-handoff.sh export <container>   prints the handoff JSON on stdout (keep it in a variable, never a file)
#   operator-vault-handoff.sh import <container>   reads that JSON on stdin, prints {"ok":..,"expires_at":..}
#
# deploy-app.sh on dev2:
#   H=$(scripts/operator-vault-handoff.sh export "$OLD_CID" 2>/dev/null || true)    # before compose up
#   printf '%s' "$H" | scripts/operator-vault-handoff.sh import "$NEW_CID"          # after it is healthy
#
# The data key only ever crosses stdin/stdout pipes (never argv, so not in ps).
set -euo pipefail
op=${1:?usage: operator-vault-handoff.sh export|import <container>}
cid=${2:?container id or name}
sock=${OPERATOR_HANDOFF_SOCKET:-/run/coinpay-operator/handoff.sock}

# Runs inside the container: send stdin as one line to the socket, print the reply.
client='const net=require("net");let i="";process.stdin.setEncoding("utf8");
process.stdin.on("data",d=>i+=d).on("end",()=>{const c=net.connect(process.argv[1],()=>c.write(i.trim()+"\n"));
let o="";c.setEncoding("utf8");c.on("data",d=>o+=d);c.on("end",()=>process.stdout.write(o));
c.on("error",e=>{process.stderr.write("handoff socket: "+e.message+"\n");process.exit(1)})});'

case "$op" in
  export)
    out=$(printf '{"op":"export"}' | docker exec -i "$cid" node -e "$client" "$sock")
    case "$out" in *'"ok":true'*) printf '%s' "$out" ;; *) echo "${out:-no reply}" | sed 's/"data_key":"[^"]*"/"data_key":"…"/' >&2; exit 1 ;; esac
    ;;
  import)
    in=$(cat)
    [ -n "$in" ] || { echo "nothing to import" >&2; exit 1; }
    # Turn the export reply into an import request without the key touching argv.
    req=$(printf '%s' "$in" | sed 's/"ok":true,//; s/^{/{"op":"import",/')
    # The new process may still be starting its socket: retry for ~30s.
    for _ in $(seq 1 15); do
      if out=$(printf '%s' "$req" | docker exec -i "$cid" node -e "$client" "$sock" 2>/dev/null) && [ -n "$out" ]; then
        printf '%s\n' "$out"
        case "$out" in *'"ok":true'*) exit 0 ;; *) exit 1 ;; esac
      fi
      sleep 2
    done
    echo "handoff socket never answered in $cid" >&2; exit 1
    ;;
  *) echo "unknown op: $op" >&2; exit 2 ;;
esac
