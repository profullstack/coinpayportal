#!/usr/bin/env python3
"""
Greenlight Python bridge for CoinPay Portal.
Called from TypeScript via execFileSync. Outputs JSON to stdout.

Commands:
  register <seed_hex> [network]     — Register a new node (or recover existing)
  get-info <node_id> [network]      — Get node info (pubkey, alias, etc.)
  offer <node_id> <description> [amount_msat] [network] — Create a BOLT12 offer
  invoice <node_id> <amount_msat> <description> [network] — Create a BOLT11 invoice
  pay <node_id> <bolt12_or_bolt11> [amount_msat] [network] — Pay an offer/invoice
  list-invoices <node_id> <last_pay_index> [network] — List settled invoices
  list-pays <node_id> [network]     — List outgoing payments

Requires GL_NOBODY_CRT and GL_NOBODY_KEY env vars (inline PEM or file paths).
"""

import os
import sys
import json
from pathlib import Path


def fix_pem(value):
    """Fix PEM that may have escaped newlines or be on a single line.
    Handles multi-cert chains (e.g., cert + intermediate CA)."""
    # Replace literal \n with real newlines
    value = value.replace('\\n', '\n')
    # Strip surrounding quotes if present
    value = value.strip().strip('"').strip("'")
    # If it already has proper newlines, return as-is
    lines = value.strip().split('\n')
    if len(lines) > 1 and lines[0].startswith('-----BEGIN'):
        return value.strip() + '\n'
    # Single line PEM — reformat
    if '-----BEGIN' in value and '\n' not in value.split('-----')[1]:
        parts = value.split('-----')
        if len(parts) >= 5:
            header = f"-----{parts[1]}-----"
            footer = f"-----{parts[3]}-----"
            body = parts[2].strip()
            lines = [body[i:i+64] for i in range(0, len(body), 64)]
            value = header + '\n' + '\n'.join(lines) + '\n' + footer + '\n'
    return value


def ensure_cert_files():
    """Write PEM env vars to temp files so the Rust binary can find them.
    The GL Rust binary reads GL_NOBODY_CRT/GL_NOBODY_KEY as file paths internally."""
    cert_env = os.environ.get('GL_NOBODY_CRT', '')
    key_env = os.environ.get('GL_NOBODY_KEY', '')
    
    if cert_env and cert_env.lstrip().startswith('-----'):
        os.makedirs('/tmp/gl-certs', exist_ok=True)
        with open('/tmp/gl-certs/nobody.crt', 'w') as f:
            f.write(fix_pem(cert_env))
        os.environ['GL_NOBODY_CRT'] = '/tmp/gl-certs/nobody.crt'
    if key_env and key_env.lstrip().startswith('-----'):
        os.makedirs('/tmp/gl-certs', exist_ok=True)
        with open('/tmp/gl-certs/nobody.key', 'w') as f:
            f.write(fix_pem(key_env))
        os.environ['GL_NOBODY_KEY'] = '/tmp/gl-certs/nobody.key'


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

    # Debug: log cert info (not the actual cert)
    print(json.dumps({
        "_debug_cert_len": len(cert_data),
        "_debug_key_len": len(key_data),
        "_debug_cert_starts": cert_data[:30].decode(errors='replace'),
        "_debug_cert_lines": cert_data.count(b'\n'),
    }), file=sys.stderr)

    return cert_data, key_data


def clean_network(network):
    """Strip comments and whitespace from network string."""
    return network.split('#')[0].strip()


def get_scheduler(network='bitcoin', device_creds_hex=None):
    """Create a Greenlight Scheduler with credentials.
    If device_creds_hex is provided, authenticate with device credentials.
    Otherwise use nobody (developer) credentials."""
    from glclient import Scheduler, Credentials
    network = clean_network(network)
    print(json.dumps({"_debug_network": network}), file=sys.stderr)

    if device_creds_hex:
        creds = Credentials.from_bytes(bytes.fromhex(device_creds_hex))
        scheduler = Scheduler(network, creds)
        return scheduler
    else:
        cert_data, key_data = get_credentials()
        creds = Credentials.nobody_with(cert_data, key_data)
        return Scheduler(network, creds)


def get_node(scheduler, device_creds_hex=None):
    """Get a node connection from the scheduler."""
    return scheduler.node()


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

    # Try register first, then recover if already exists
    try:
        reg = scheduler.register(signer)
        device_cert = reg.device_cert if hasattr(reg, 'device_cert') else ''
        device_key = reg.device_key if hasattr(reg, 'device_key') else ''
        creds_bytes = reg.creds if hasattr(reg, 'creds') else b''
        rune = reg.rune if hasattr(reg, 'rune') else ''

        # Extract node_id from device_cert CN (hex pubkey in the path)
        node_id = ''
        if device_cert:
            import re, base64
            # Try plaintext first, then decode base64 to find CN in raw DER bytes
            m = re.search(r'/users/([0-9a-f]{66})', device_cert)
            if not m:
                try:
                    pem_lines = [l for l in device_cert.split('\n')
                                 if l.strip() and not l.startswith('-----')]
                    raw = base64.b64decode(''.join(pem_lines[:20]))  # first cert only
                    raw_str = raw.decode('ascii', errors='replace')
                    m = re.search(r'/users/([0-9a-f]{66})', raw_str)
                except Exception:
                    pass
            if m:
                node_id = m.group(1)
        
        return {
            "action": "registered",
            "node_id": node_id,
            "device_cert": device_cert,
            "device_key": device_key,
            "creds": creds_bytes.hex() if isinstance(creds_bytes, bytes) else '',
            "rune": rune,
            "network": network,
        }
    except Exception as reg_err:
        reg_err_str = str(reg_err)
        print(json.dumps({"_debug_register_error": reg_err_str}), file=sys.stderr)

        try:
            rec = scheduler.recover(signer)
            device_cert = rec.device_cert if hasattr(rec, 'device_cert') else ''
            device_key = rec.device_key if hasattr(rec, 'device_key') else ''
            creds_bytes = rec.creds if hasattr(rec, 'creds') else b''
            rune = rec.rune if hasattr(rec, 'rune') else ''

            node_id = ''
            if device_cert:
                import re, base64
                m = re.search(r'/users/([0-9a-f]{66})', device_cert)
                if not m:
                    try:
                        pem_lines = [l for l in device_cert.split('\n')
                                     if l.strip() and not l.startswith('-----')]
                        raw = base64.b64decode(''.join(pem_lines[:20]))
                        raw_str = raw.decode('ascii', errors='replace')
                        m = re.search(r'/users/([0-9a-f]{66})', raw_str)
                    except Exception:
                        pass
                if m:
                    node_id = m.group(1)

            return {
                "action": "recovered",
                "node_id": node_id,
                "device_cert": device_cert,
                "device_key": device_key,
                "creds": creds_bytes.hex() if isinstance(creds_bytes, bytes) else '',
                "rune": rune,
                "network": network,
            }
        except Exception as rec_err:
            rec_err_str = str(rec_err)
            print(json.dumps({"_debug_recover_error": rec_err_str}), file=sys.stderr)
            return {"error": f"Register failed: {reg_err_str}; Recover failed: {rec_err_str}"}


def cmd_get_info(args):
    """Get node info."""
    node_id = args[0] if args else None
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[2] if len(args) > 2 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler)

    response = node.call('getinfo', '{}')
    data = json.loads(response) if isinstance(response, (str, bytes)) else response
    return {
        "id": data.get('id', ''),
        "alias": data.get('alias', ''),
        "color": data.get('color', ''),
        "num_peers": data.get('num_peers', 0),
        "num_active_channels": data.get('num_active_channels', 0),
        "blockheight": data.get('blockheight', 0),
        "network": data.get('network', network),
    }


def cmd_offer(args):
    """Create a BOLT12 offer."""
    if len(args) < 2:
        return {"error": "Usage: offer <node_id> <description> [amount_msat] [network] [device_creds_hex]"}

    node_id = args[0]
    description = args[1]
    amount_msat = args[2] if len(args) > 2 and args[2] != 'any' else None
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler, device_creds_hex)

    # Build offer request
    params = {"description": description}
    if amount_msat:
        params["amount"] = f"{amount_msat}msat"
    else:
        params["amount"] = "any"

    response = node.call('offer', json.dumps(params))
    data = json.loads(response) if isinstance(response, (str, bytes)) else response

    return {
        "bolt12": data.get('bolt12', ''),
        "offer_id": data.get('offer_id', ''),
        "active": data.get('active', True),
        "single_use": data.get('single_use', False),
    }


def cmd_invoice(args):
    """Create a BOLT11 invoice."""
    if len(args) < 3:
        return {"error": "Usage: invoice <node_id> <amount_msat> <description> [network] [device_creds_hex]"}

    node_id = args[0]
    amount_msat = args[1]
    description = args[2]
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler)

    import secrets
    label = f"coinpay-{secrets.token_hex(8)}"

    params = {
        "amount_msat": int(amount_msat),
        "label": label,
        "description": description,
    }

    response = node.call('invoice', json.dumps(params))
    data = json.loads(response) if isinstance(response, (str, bytes)) else response

    return {
        "bolt11": data.get('bolt11', ''),
        "payment_hash": data.get('payment_hash', ''),
        "expires_at": data.get('expires_at', 0),
        "label": label,
    }


def cmd_pay(args):
    """Pay a BOLT12 offer or BOLT11 invoice."""
    if len(args) < 2:
        return {"error": "Usage: pay <node_id> <bolt12_or_bolt11> [amount_msat] [network]"}

    node_id = args[0]
    bolt = args[1]
    amount_msat = args[2] if len(args) > 2 and args[2] != '' else None
    network = args[3] if len(args) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[4] if len(args) > 4 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler)

    if bolt.startswith('lno1'):
        # BOLT12 offer — use fetchinvoice then pay
        fetch_params = {"offer": bolt}
        if amount_msat:
            fetch_params["amount_msat"] = int(amount_msat)

        fetch_resp = node.call('fetchinvoice', json.dumps(fetch_params))
        fetch_data = json.loads(fetch_resp) if isinstance(fetch_resp, (str, bytes)) else fetch_resp
        invoice = fetch_data.get('invoice', '')

        if not invoice:
            return {"error": "Failed to fetch invoice from offer", "raw": fetch_data}

        # Pay the fetched invoice
        pay_params = {"bolt11": invoice}
        response = node.call('pay', json.dumps(pay_params))
    else:
        # BOLT11 invoice — pay directly
        pay_params = {"bolt11": bolt}
        if amount_msat:
            pay_params["amount_msat"] = int(amount_msat)
        response = node.call('pay', json.dumps(pay_params))

    data = json.loads(response) if isinstance(response, (str, bytes)) else response

    return {
        "payment_hash": data.get('payment_hash', ''),
        "payment_preimage": data.get('payment_preimage', ''),
        "amount_msat": data.get('amount_msat', data.get('msatoshi', 0)),
        "status": data.get('status', ''),
    }


def cmd_list_invoices(args):
    """List settled invoices since last_pay_index."""
    node_id = args[0] if args else None
    last_pay_index = int(args[1]) if len(args) > 1 else 0
    network = args[2] if len(args) > 2 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[3] if len(args) > 3 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler)

    response = node.call('listinvoices', '{}')
    data = json.loads(response) if isinstance(response, (str, bytes)) else response
    invoices = data.get('invoices', [])

    payments = []
    for inv in invoices:
        if inv.get('status') != 'paid':
            continue
        pay_index = inv.get('pay_index', 0)
        if pay_index <= last_pay_index:
            continue

        amount_msat = inv.get('amount_received_msat', inv.get('msatoshi_received', 0))
        if isinstance(amount_msat, str) and amount_msat.endswith('msat'):
            amount_msat = int(amount_msat[:-4])

        payments.append({
            'payment_hash': inv.get('payment_hash', ''),
            'preimage': inv.get('payment_preimage', ''),
            'amount_msat': amount_msat,
            'pay_index': pay_index,
            'bolt12_offer': inv.get('local_offer_id'),
            'payer_note': inv.get('description'),
            'settled_at': inv.get('paid_at'),
        })

    return {"payments": payments}


def cmd_list_pays(args):
    """List outgoing payments."""
    node_id = args[0] if args else None
    network = args[1] if len(args) > 1 else os.environ.get('GL_NETWORK', 'bitcoin')
    device_creds_hex = args[2] if len(args) > 2 else None

    scheduler = get_scheduler(network, device_creds_hex)
    node = get_node(scheduler)

    response = node.call('listpays', '{}')
    data = json.loads(response) if isinstance(response, (str, bytes)) else response
    pays = data.get('pays', [])

    return {
        "payments": [
            {
                "payment_hash": p.get('payment_hash', ''),
                "status": p.get('status', ''),
                "amount_msat": p.get('amount_sent_msat', p.get('msatoshi_sent', 0)),
                "destination": p.get('destination', ''),
                "created_at": p.get('created_at', 0),
                "preimage": p.get('preimage', ''),
            }
            for p in pays
        ]
    }


COMMANDS = {
    'register': cmd_register,
    'get-info': cmd_get_info,
    'offer': cmd_offer,
    'invoice': cmd_invoice,
    'pay': cmd_pay,
    'list-invoices': cmd_list_invoices,
    'list-pays': cmd_list_pays,
}


def main():
    # Write inline PEM env vars to files for the Rust binary
    ensure_cert_files()

    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({
            "error": f"Usage: gl-bridge.py <command> [args...]\nCommands: {', '.join(COMMANDS.keys())}"
        }))
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    try:
        result = COMMANDS[command](args)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
