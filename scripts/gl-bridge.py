#!/usr/bin/env python3
"""
Greenlight Python bridge for CoinPay Portal.
Called from TypeScript via execFileSync. Outputs JSON to stdout.

Commands:
  register <seed_hex> [network]
  get-info <seed_hex> [network] [device_creds_hex]
  offer <seed_hex> <description> [amount_msat] [network] [device_creds_hex]
  invoice <seed_hex> <amount_msat> <description> [network] [device_creds_hex]
  pay <seed_hex> <bolt12_or_bolt11> [amount_msat] [network] [device_creds_hex]
  list-invoices <seed_hex> <last_pay_index> [network] [device_creds_hex]
  list-pays <seed_hex> [network] [device_creds_hex]

NOTE: Most commands now take seed_hex (not node_id) because the Signer
needs the seed to run. The Signer MUST be running for any node operation.

Requires GL_NOBODY_CRT and GL_NOBODY_KEY env vars (inline PEM or file paths).
"""

import os
import sys
import json
from pathlib import Path


def fix_pem(value):
    """Fix PEM that may have escaped newlines or be on a single line."""
    value = value.replace('\\n', '\n')
    value = value.strip().strip('"').strip("'")
    lines = value.strip().split('\n')
    if len(lines) > 1 and lines[0].startswith('-----BEGIN'):
        return value.strip() + '\n'
    if '-----BEGIN' in value and '\n' not in value.split('-----')[1]:
        parts = value.split('-----')
        if len(parts) >= 5:
            header = f"-----{parts[1]}-----"
            footer = f"-----{parts[3]}-----"
            body = parts[2].strip()
            lines = [body[i:i+64] for i in range(0, len(body), 64)]
            value = header + '\n' + '\n'.join(lines) + '\n' + footer + '\n'
    return value


def get_credentials():
    """Load Greenlight developer credentials from env."""
    cert_env = os.environ.get('GL_NOBODY_CRT', '')
    key_env = os.environ.get('GL_NOBODY_KEY', '')

    if not cert_env or not key_env:
        raise RuntimeError("GL_NOBODY_CRT and GL_NOBODY_KEY must be set")

    if cert_env.lstrip().startswith('-----') or '\\n' in cert_env:
        cert_data = fix_pem(cert_env).encode()
        key_data = fix_pem(key_env).encode()
    else:
        cert_path = Path(os.path.expanduser(cert_env))
        key_path = Path(os.path.expanduser(key_env))
        if not cert_path.exists() or not key_path.exists():
            raise RuntimeError(f"Cert files not found: {cert_path}, {key_path}")
        cert_data = cert_path.read_bytes()
        key_data = key_path.read_bytes()

    return cert_data, key_data


def clean_network(network):
    """Strip comments and whitespace from network string."""
    return network.split('#')[0].strip()


def start_node_with_signer(seed_hex, network='bitcoin', device_creds_hex=None):
    """
    Start a Greenlight node WITH the Signer running.
    
    The Signer must be running for any operation that requires signing
    (offers, invoices, payments, etc.). This is the correct way to use
    the Greenlight SDK.
    
    Returns (node, signer_handle) — caller should call signer_handle.shutdown()
    when done (or just let the process exit).
    """
    from glclient import Scheduler, Credentials, Signer

    network = clean_network(network)
    seed = bytes.fromhex(seed_hex)

    if device_creds_hex:
        # Use device credentials (post-registration)
        creds = Credentials.from_bytes(bytes.fromhex(device_creds_hex))
    else:
        # Use developer (nobody) credentials
        cert_data, key_data = get_credentials()
        creds = Credentials.nobody_with(cert_data, key_data)

    # Create Signer and start it in a background thread
    signer = Signer(seed, network, creds)
    signer_handle = signer.run_in_thread()

    log({"_debug": "signer started in thread", "node_id": signer.node_id().hex()})

    # Connect to the node via scheduler
    scheduler = Scheduler(network, creds)
    
    # Schedule wakes the node up on GL infrastructure
    try:
        scheduler.schedule()
        log({"_debug": "node scheduled"})
    except Exception as e:
        log({"_debug_schedule": str(e)})

    node = scheduler.node()
    log({"_debug": "node connected"})

    return node, signer_handle, signer


def log(obj):
    """Log debug info to stderr (not captured by TypeScript caller)."""
    print(json.dumps(obj), file=sys.stderr)


def extract_node_id_from_cert(device_cert):
    """Extract node_id (66-char hex pubkey) from device cert DER bytes."""
    import re, base64
    # Try plaintext first
    m = re.search(r'/users/([0-9a-f]{66})', device_cert)
    if m:
        return m.group(1)
    # Decode DER and search raw bytes
    try:
        pem_lines = [l for l in device_cert.split('\n')
                     if l.strip() and not l.startswith('-----')]
        raw = base64.b64decode(''.join(pem_lines[:20]))
        raw_str = raw.decode('ascii', errors='replace')
        m = re.search(r'/users/([0-9a-f]{66})', raw_str)
        if m:
            return m.group(1)
    except Exception:
        pass
    return ''


# ──────────────────────────────────────────────
# Commands
# ──────────────────────────────────────────────

def cmd_register(args):
    """Register or recover a Greenlight node from seed."""
    if len(args) < 1:
        return {"error": "Usage: register <seed_hex> [network]"}

    seed_hex = args[0]
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    network = clean_network(network)
    seed = bytes.fromhex(seed_hex)

    from glclient import Scheduler, Credentials, Signer

    cert_data, key_data = get_credentials()
    creds = Credentials.nobody_with(cert_data, key_data)
    signer = Signer(seed, network, creds)
    scheduler = Scheduler(network, creds)

    def extract_result(res, action):
        device_cert = res.device_cert if hasattr(res, 'device_cert') else ''
        device_key = res.device_key if hasattr(res, 'device_key') else ''
        creds_bytes = res.creds if hasattr(res, 'creds') else b''
        rune = res.rune if hasattr(res, 'rune') else ''
        node_id = extract_node_id_from_cert(device_cert) if device_cert else signer.node_id().hex()
        return {
            "action": action,
            "node_id": node_id,
            "device_cert": device_cert,
            "device_key": device_key,
            "creds": creds_bytes.hex() if isinstance(creds_bytes, bytes) else '',
            "rune": rune,
            "network": network,
        }

    try:
        reg = scheduler.register(signer)
        return extract_result(reg, "registered")
    except Exception as reg_err:
        log({"_debug_register_error": str(reg_err)})
        try:
            rec = scheduler.recover(signer)
            return extract_result(rec, "recovered")
        except Exception as rec_err:
            log({"_debug_recover_error": str(rec_err)})
            return {"error": f"Register: {reg_err}; Recover: {rec_err}"}


def cmd_get_info(args):
    """Get node info using proper SDK method."""
    if len(args) < 1:
        return {"error": "Usage: get-info <seed_hex> [network] [device_creds_hex]"}

    seed_hex = args[0]
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[2] if len(args) > 2 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        info = node.get_info()
        return {
            "id": info.id.hex() if isinstance(info.id, bytes) else str(info.id),
            "alias": info.alias,
            "color": info.color.hex() if isinstance(info.color, bytes) else str(info.color),
            "num_peers": info.num_peers,
            "num_active_channels": info.num_active_channels,
            "blockheight": info.blockheight,
            "network": info.network,
        }
    finally:
        signer_handle.shutdown()


def cmd_offer(args):
    """Create a BOLT12 offer. Uses raw gRPC since Node has no offer() method."""
    if len(args) < 2:
        return {"error": "Usage: offer <seed_hex> <description> [amount_msat] [network] [device_creds_hex]"}

    seed_hex = args[0]
    description = args[1]
    amount_msat = args[2] if len(args) > 2 and args[2] != 'any' else None
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        from glclient import clnpb
        amount_str = f"{amount_msat}msat" if amount_msat else "any"
        req = clnpb.OfferRequest(amount=amount_str, description=description)
        uri = "/cln.Node/Offer"
        raw_resp = node.inner.call(uri, req.SerializeToString())
        resp = clnpb.OfferResponse.FromString(bytes(raw_resp))
        return {
            "bolt12": resp.bolt12 if hasattr(resp, 'bolt12') else '',
            "offer_id": resp.offer_id.hex() if hasattr(resp, 'offer_id') and resp.offer_id else '',
            "active": resp.active if hasattr(resp, 'active') else True,
            "single_use": resp.single_use if hasattr(resp, 'single_use') else False,
        }
    except Exception as e:
        log({"_debug_offer_error": str(e)})
        return {"error": f"Offer creation failed: {e}"}
    finally:
        signer_handle.shutdown()


def cmd_invoice(args):
    """Create a BOLT11 invoice using proper SDK method."""
    if len(args) < 3:
        return {"error": "Usage: invoice <seed_hex> <amount_msat> <description> [network] [device_creds_hex]"}

    seed_hex = args[0]
    amount_msat = int(args[1])
    description = args[2]
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        import secrets
        from glclient import AmountOrAny, Amount
        label = f"coinpay-{secrets.token_hex(8)}"

        resp = node.invoice(
            amount_msat=AmountOrAny(amount=Amount(msat=amount_msat)),
            label=label,
            description=description,
        )

        return {
            "bolt11": resp.bolt11,
            "payment_hash": resp.payment_hash.hex() if isinstance(resp.payment_hash, bytes) else str(resp.payment_hash),
            "payment_secret": resp.payment_secret.hex() if isinstance(resp.payment_secret, bytes) else str(resp.payment_secret),
            "expires_at": resp.expires_at,
            "label": label,
        }
    except Exception as e:
        log({"_debug_invoice_error": str(e)})
        return {"error": f"Invoice creation failed: {e}"}
    finally:
        signer_handle.shutdown()


def cmd_pay(args):
    """Pay a BOLT11 invoice or fetch+pay a BOLT12 offer using proper SDK methods."""
    if len(args) < 2:
        return {"error": "Usage: pay <seed_hex> <bolt12_or_bolt11> [amount_msat] [network] [device_creds_hex]"}

    seed_hex = args[0]
    payment_str = args[1]
    amount_msat = int(args[2]) if len(args) > 2 and args[2] else None
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        from glclient import Amount

        if payment_str.startswith('lno'):
            # BOLT12 offer — fetch invoice first, then pay
            amount_arg = Amount(msat=amount_msat) if amount_msat else None
            fetch_resp = node.fetch_invoice(offer=payment_str, amount_msat=amount_arg)
            bolt11 = fetch_resp.invoice
            log({"_debug": "fetched invoice from offer", "invoice": bolt11[:40] + "..."})
        else:
            bolt11 = payment_str

        amount_arg = Amount(msat=amount_msat) if amount_msat else None
        resp = node.pay(bolt11=bolt11, amount_msat=amount_arg)

        return {
            "payment_preimage": resp.payment_preimage.hex() if isinstance(resp.payment_preimage, bytes) else str(resp.payment_preimage),
            "payment_hash": resp.payment_hash.hex() if isinstance(resp.payment_hash, bytes) else str(resp.payment_hash),
            "status": str(resp.status) if hasattr(resp, 'status') else 'complete',
            "amount_msat": resp.amount_msat.msat if hasattr(resp, 'amount_msat') and resp.amount_msat else amount_msat,
            "amount_sent_msat": resp.amount_sent_msat.msat if hasattr(resp, 'amount_sent_msat') and resp.amount_sent_msat else None,
        }
    except Exception as e:
        log({"_debug_pay_error": str(e)})
        return {"error": f"Payment failed: {e}"}
    finally:
        signer_handle.shutdown()


def cmd_list_invoices(args):
    """List invoices using proper SDK method."""
    if len(args) < 1:
        return {"error": "Usage: list-invoices <seed_hex> [last_pay_index] [network] [device_creds_hex]"}

    seed_hex = args[0]
    last_pay_index = int(args[1]) if len(args) > 1 and args[1] else 0
    network = args[2] if len(args) > 2 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[3] if len(args) > 3 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        resp = node.list_invoices()
        invoices = []
        for inv in resp.invoices:
            invoices.append({
                "label": inv.label,
                "bolt11": inv.bolt11 if hasattr(inv, 'bolt11') else '',
                "bolt12": inv.bolt12 if hasattr(inv, 'bolt12') else '',
                "payment_hash": inv.payment_hash.hex() if isinstance(inv.payment_hash, bytes) else str(inv.payment_hash),
                "status": str(inv.status),
                "amount_msat": inv.amount_msat.msat if hasattr(inv, 'amount_msat') and inv.amount_msat else None,
                "amount_received_msat": inv.amount_received_msat.msat if hasattr(inv, 'amount_received_msat') and inv.amount_received_msat else None,
                "paid_at": inv.paid_at if hasattr(inv, 'paid_at') else None,
                "pay_index": inv.pay_index if hasattr(inv, 'pay_index') else None,
                "expires_at": inv.expires_at if hasattr(inv, 'expires_at') else None,
            })
        return {"invoices": invoices}
    except Exception as e:
        log({"_debug_list_invoices_error": str(e)})
        return {"error": f"List invoices failed: {e}"}
    finally:
        signer_handle.shutdown()


def cmd_list_pays(args):
    """List outgoing payments using proper SDK method."""
    if len(args) < 1:
        return {"error": "Usage: list-pays <seed_hex> [network] [device_creds_hex]"}

    seed_hex = args[0]
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[2] if len(args) > 2 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        resp = node.listpays()
        pays = []
        for p in resp.pays:
            pays.append({
                "payment_hash": p.payment_hash.hex() if isinstance(p.payment_hash, bytes) else str(p.payment_hash),
                "status": str(p.status),
                "amount_msat": p.amount_msat.msat if hasattr(p, 'amount_msat') and p.amount_msat else None,
                "amount_sent_msat": p.amount_sent_msat.msat if hasattr(p, 'amount_sent_msat') and p.amount_sent_msat else None,
                "destination": p.destination.hex() if hasattr(p, 'destination') and isinstance(p.destination, bytes) else str(p.destination) if hasattr(p, 'destination') else '',
                "bolt11": p.bolt11 if hasattr(p, 'bolt11') else '',
                "bolt12": p.bolt12 if hasattr(p, 'bolt12') else '',
                "preimage": p.preimage.hex() if hasattr(p, 'preimage') and isinstance(p.preimage, bytes) else '',
            })
        return {"pays": pays}
    except Exception as e:
        log({"_debug_list_pays_error": str(e)})
        return {"error": f"List pays failed: {e}"}
    finally:
        signer_handle.shutdown()


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def cmd_lsp_info(args):
    """List available LSPs and their protocols."""
    if len(args) < 1:
        return {"error": "Usage: lsp-info <seed_hex> [network] [device_creds_hex]"}

    seed_hex = args[0]
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[2] if len(args) > 2 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        lsp_client = node.get_lsp_client()
        servers = lsp_client.list_lsp_servers()
        
        protocols = {}
        for server in servers:
            try:
                proto_list = lsp_client.list_protocols(server)
                protocols[server] = str(proto_list)
            except Exception as e:
                protocols[server] = f"error: {e}"
        
        # Also get node info for connectivity status
        info = node.get_info()
        funds = node.list_funds()
        channels = node.list_channels()
        
        return {
            "lsp_servers": servers,
            "protocols": protocols,
            "node_id": info.id.hex() if isinstance(info.id, bytes) else str(info.id),
            "num_peers": info.num_peers,
            "num_channels": info.num_active_channels,
            "channels": [
                {
                    "peer_id": ch.peer_id.hex() if isinstance(ch.peer_id, bytes) else str(ch.peer_id),
                    "spendable_msat": ch.spendable_msat.msat if hasattr(ch, 'spendable_msat') and ch.spendable_msat else 0,
                    "receivable_msat": ch.receivable_msat.msat if hasattr(ch, 'receivable_msat') and ch.receivable_msat else 0,
                    "state": str(ch.state) if hasattr(ch, 'state') else '',
                }
                for ch in (channels.channels if hasattr(channels, 'channels') else [])
            ],
        }
    except Exception as e:
        log({"_debug_lsp_error": str(e)})
        return {"error": f"LSP info failed: {e}"}
    finally:
        signer_handle.shutdown()


def cmd_connect_peer(args):
    """Connect to a peer node."""
    if len(args) < 2:
        return {"error": "Usage: connect-peer <seed_hex> <peer_id@host:port> [network] [device_creds_hex]"}

    seed_hex = args[0]
    peer_addr = args[1]
    network = args[2] if len(args) > 2 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[3] if len(args) > 3 else None

    node, signer_handle, signer = start_node_with_signer(seed_hex, network, device_creds_hex)
    try:
        # Parse peer_id@host:port
        if '@' in peer_addr:
            peer_id, host_port = peer_addr.split('@', 1)
        else:
            return {"error": "Peer address must be in format peer_id@host:port"}
        
        node.connect_peer(peer_id, host_port)
        return {"connected": True, "peer_id": peer_id, "host": host_port}
    except Exception as e:
        log({"_debug_connect_error": str(e)})
        return {"error": f"Connect failed: {e}"}
    finally:
        signer_handle.shutdown()


COMMANDS = {
    'register': cmd_register,
    'get-info': cmd_get_info,
    'offer': cmd_offer,
    'invoice': cmd_invoice,
    'pay': cmd_pay,
    'list-invoices': cmd_list_invoices,
    'list-pays': cmd_list_pays,
    'lsp-info': cmd_lsp_info,
    'connect-peer': cmd_connect_peer,
}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": f"Usage: gl-bridge.py <command> [args...]\nCommands: {', '.join(COMMANDS.keys())}"}))
        sys.exit(1)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd not in COMMANDS:
        print(json.dumps({"error": f"Unknown command: {cmd}. Available: {', '.join(COMMANDS.keys())}"}))
        sys.exit(1)

    try:
        result = COMMANDS[cmd](args)
        # Filter out _debug keys from result
        clean = {k: v for k, v in result.items() if not k.startswith('_debug')}
        print(json.dumps(clean))
    except Exception as e:
        log({"_debug_fatal": str(e)})
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
