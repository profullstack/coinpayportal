#!/usr/bin/env python3
"""
One-shot invoice checker for Greenlight nodes.
Called by the Next.js cron daemon. Outputs JSON to stdout.

Usage: python3 scripts/check-invoices.py <greenlight_node_id> <last_pay_index> <network>

Requires GL_NOBODY_CRT and GL_NOBODY_KEY env vars.
"""

import os
import sys
import json
from pathlib import Path
from glclient import Scheduler, Credentials


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: check-invoices.py <node_id> <last_pay_index> [network]"}))
        sys.exit(1)

    gl_node_id = sys.argv[1]
    last_pay_index = int(sys.argv[2])
    network = sys.argv[3] if len(sys.argv) > 3 else os.environ.get('GL_NETWORK', 'bitcoin')

    cert_path = Path(os.path.expanduser(os.environ.get('GL_NOBODY_CRT', '~/.greenlight/client.crt')))
    key_path = Path(os.path.expanduser(os.environ.get('GL_NOBODY_KEY', '~/.greenlight/client-key.pem')))

    if not cert_path.exists() or not key_path.exists():
        print(json.dumps({"error": "Greenlight credentials not found", "payments": []}))
        sys.exit(0)

    try:
        creds = Credentials.nobody_with(cert_path.read_bytes(), key_path.read_bytes())
        scheduler = Scheduler(network, creds)
        node = scheduler.node()

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

        print(json.dumps({"payments": payments}))

    except Exception as e:
        print(json.dumps({"error": str(e), "payments": []}))
        sys.exit(0)


if __name__ == '__main__':
    main()
