# Encrypting the CLN hsm_secret (dev2)

The Lightning node's `hsm_secret` is the root of every channel and on-chain key the node holds. Today it sits in plaintext at `/home/lightning/.lightning/bitcoin/hsm_secret`. On 2026-10-27 root on dev2 was enough to close every channel and sweep 2.6M sat. Encrypting the file means a copied disk or a restored backup is useless without a passphrase that lives only in Anthony's head and offline notes.

**Limits.** While the node runs, the decrypted secret is in `hsmd`'s memory. Root on a running box can still read it. What encryption protects is the file at rest: disk copies, backups, a stopped node. The node is a 24/7 service, so this is the "unlock at start" form of the fleet rule. Every restart (reboot, OOM, deploy) needs the passphrase typed in, and the node stays down until then.

## Facts (2026-10-28)
- CLN v25.05, `/usr/local/bin/lightningd`, systemd `lightningd.service` (user `lightning`, `--lightning-dir=/home/lightning/.lightning`), plus `bitcoind.service` and `lnbits.service`.
- Node id `03f635570db7ae152ce04bf97dd237cefee06ae4b52db5a24d3834fe2d9319b014`. It was rebuilt on 2026-10-28 with a new `hsm_secret`, whose hex is in vault **coinpayportal--treasury** as `LN_HSM_SECRET_HEX`.
- There are no channels and 0 msat, so this is the cheapest moment to do it.

## Before you start
1. Have the backup: `umask 077; logicsrc get coinpayportal--treasury LN_HSM_SECRET_HEX > /dev/shm/hsm.hex`. That path is RAM, never disk. The script refuses to change anything unless this matches the live file byte for byte.
2. Pick the passphrase and write it down offline (paper, Bitwarden personal). Losing it means restoring the plaintext secret from the vault backup. That is the only way back.
3. Be at a terminal for the whole run. The script asks for the passphrase three times: twice for `encrypt`, once to verify it.

## The one command
```sh
sudo /home/anthony/www/coinpayportal.com/app/scripts/cln-encrypt-hsm.sh check   /dev/shm/hsm.hex   # read-only
sudo /home/anthony/www/coinpayportal.com/app/scripts/cln-encrypt-hsm.sh encrypt /dev/shm/hsm.hex
shred -u /dev/shm/hsm.hex
```
`encrypt` does the following:
1. Re-runs every check: the file is 32 bytes, the backup matches, `getnodeid` returns the id above, and `getinfo` answers.
2. Stops the node and keeps a plaintext copy until step 4 passes.
3. Runs `lightning-hsmtool encrypt`.
4. Asks for the passphrase again and checks it with `getnodeid`. If that fails, it restores the plaintext and restarts the node.
5. Installs `/etc/systemd/system/lightningd.service.d/encrypted-hsm.conf`. This keeps the unit's current `ExecStart`, adds `--encrypted-hsm`, feeds the passphrase from `systemd-ask-password`, and sets `Restart=no`.
6. Starts the node and waits until `getinfo` shows the same node id.

## Every restart after this
```sh
sudo systemctl start lightningd    # waits for the passphrase
sudo systemd-tty-ask-password-agent --query
sudo -u lightning lightning-cli --lightning-dir=/home/lightning/.lightning getinfo | grep '"id"'
```
LNbits reconnects by itself once the node is up. Until then, Lightning invoices and payments fail, and CoinPay's other chains are unaffected.

## Rollback (wrong passphrase, or the node will not start)
```sh
sudo systemctl stop lightningd
sudo rm /etc/systemd/system/lightningd.service.d/encrypted-hsm.conf && sudo systemctl daemon-reload
# either decrypt with the passphrase:
sudo lightning-hsmtool decrypt /home/lightning/.lightning/bitcoin/hsm_secret
# or restore the plaintext from the vault backup:
xxd -r -p /dev/shm/hsm.hex | sudo tee /home/lightning/.lightning/bitcoin/hsm_secret >/dev/null
sudo chown lightning:lightning /home/lightning/.lightning/bitcoin/hsm_secret && sudo chmod 0400 /home/lightning/.lightning/bitcoin/hsm_secret
sudo systemctl start lightningd
```
**Never** run `generatehsm` or delete `hsm_secret`: either one is a new node, and the funds are gone.

## Also open
- The plaintext backup in vault `coinpayportal--treasury` is still a 24/7 copy of the key that root on a vault host could read. Once encrypted, consider replacing it with the encrypted 73-byte file plus the offline passphrase.
- LNbits per-user wallet keys (`wallets.ln_wallet_adminkey`) are encrypted under `LN_KEY_ENCRYPTION_KEY`, which the server holds. That is not user-held. Rotate LNbits keys before Lightning holds funds again.
