#!/usr/bin/env python3
"""
Lightning Payment Monitor Daemon

Connects to Greenlight nodes using developer mTLS credentials,
polls for incoming payments via listinvoices, and POSTs settled
payments to the CoinPay webhook endpoint.

Usage:
    source .venv/bin/activate
    python3 scripts/lightning-monitor.py

Environment variables:
    GL_NOBODY_CRT       - Path to Greenlight developer certificate
    GL_NOBODY_KEY       - Path to Greenlight developer key
    GL_NETWORK          - Network: bitcoin or testnet (default: bitcoin)
    GL_WEBHOOK_SECRET   - Webhook secret (optional)
    WEBHOOK_URL         - Webhook endpoint (default: https://coinpayportal.com/api/lightning/webhook)
    NEXT_PUBLIC_SUPABASE_URL  - Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
    POLL_INTERVAL       - Seconds between polls (default: 30)
"""

import os
import sys
import time
import signal
import logging
from pathlib import Path

import requests
from glclient import Scheduler, Signer, Credentials

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger('lightning-monitor')

# ── Config ──

GL_CERT = os.path.expanduser(os.environ.get('GL_NOBODY_CRT', '~/.greenlight/client.crt'))
GL_KEY = os.path.expanduser(os.environ.get('GL_NOBODY_KEY', '~/.greenlight/client-key.pem'))
GL_NETWORK = os.environ.get('GL_NETWORK', 'bitcoin')
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', 'https://coinpayportal.com/api/lightning/webhook')
WEBHOOK_SECRET = os.environ.get('GL_WEBHOOK_SECRET', '')
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
POLL_INTERVAL = int(os.environ.get('POLL_INTERVAL', '30'))

running = True


def handle_signal(signum, frame):
    global running
    log.info(f'Received signal {signum}, shutting down...')
    running = False


signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)


def load_credentials() -> Credentials:
    """Load Greenlight developer (Nobody) credentials."""
    cert_path = Path(GL_CERT)
    key_path = Path(GL_KEY)

    if not cert_path.exists():
        log.error(f'Certificate not found: {GL_CERT}')
        sys.exit(1)
    if not key_path.exists():
        log.error(f'Key not found: {GL_KEY}')
        sys.exit(1)

    cert_data = cert_path.read_bytes()
    key_data = key_path.read_bytes()

    return Credentials.nobody_with(cert_data, key_data)


def supabase_headers() -> dict:
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }


def get_active_nodes() -> list:
    """Fetch active LN nodes from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.warning('Supabase not configured, cannot fetch nodes')
        return []

    try:
        resp = requests.get(
            f'{SUPABASE_URL}/rest/v1/ln_nodes'
            '?status=eq.active'
            '&select=id,greenlight_node_id,node_pubkey,last_pay_index,business_id,seed_hash',
            headers=supabase_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.error(f'Failed to fetch nodes: {e}')
        return []


def update_pay_index(node_id: str, pay_index: int):
    """Update the last_pay_index watermark for a node."""
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/ln_nodes?id=eq.{node_id}',
            headers={**supabase_headers(), 'Prefer': 'return=minimal'},
            json={'last_pay_index': pay_index},
            timeout=10,
        )
    except Exception as e:
        log.error(f'Failed to update pay_index for {node_id}: {e}')


def post_to_webhook(payment: dict):
    """POST a settled payment to the webhook endpoint."""
    headers = {'Content-Type': 'application/json'}
    if WEBHOOK_SECRET:
        headers['x-webhook-secret'] = WEBHOOK_SECRET

    try:
        resp = requests.post(WEBHOOK_URL, json=payment, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            log.info(f'Webhook accepted payment {payment["payment_hash"][:16]}...')
        else:
            log.warning(f'Webhook returned {resp.status_code}: {resp.text[:200]}')
    except Exception as e:
        log.error(f'Webhook POST failed: {e}')


def monitor_node(creds: Credentials, node: dict):
    """
    Connect to a Greenlight node and check for new settled invoices.
    """
    gl_node_id = node.get('greenlight_node_id')
    last_pay_index = node.get('last_pay_index') or 0

    if not gl_node_id:
        log.warning(f'Node {node["id"]} has no greenlight_node_id, skipping')
        return

    try:
        # Connect via Greenlight scheduler
        scheduler = Scheduler(GL_NETWORK, creds)
        node_conn = scheduler.node()

        # List all invoices
        response = node_conn.call(
            'listinvoices',
            '{}'  # no filter — get all
        )

        # Parse response — CLN returns JSON
        import json
        data = json.loads(response) if isinstance(response, (str, bytes)) else response

        invoices = data.get('invoices', [])
        max_pay_index = last_pay_index
        new_payments = 0

        for inv in invoices:
            status = inv.get('status', '')
            pay_index = inv.get('pay_index', 0)

            # Only paid invoices after our watermark
            if status != 'paid' or pay_index <= last_pay_index:
                continue

            payment_hash = inv.get('payment_hash', '')
            preimage = inv.get('payment_preimage', '')
            amount_msat = inv.get('amount_received_msat', inv.get('msatoshi_received', 0))

            # Handle "Xmsat" string format
            if isinstance(amount_msat, str) and amount_msat.endswith('msat'):
                amount_msat = int(amount_msat[:-4])

            payment = {
                'node_id': node['id'],
                'business_id': node.get('business_id'),
                'payment_hash': payment_hash,
                'preimage': preimage,
                'amount_msat': amount_msat,
                'offer_id': inv.get('local_offer_id'),
                'payer_note': inv.get('description'),
            }

            post_to_webhook(payment)
            new_payments += 1

            if pay_index > max_pay_index:
                max_pay_index = pay_index

        if max_pay_index > last_pay_index:
            update_pay_index(node['id'], max_pay_index)
            log.info(f'Node {gl_node_id[:16]}...: {new_payments} new payments, pay_index → {max_pay_index}')

    except Exception as e:
        log.error(f'Error monitoring node {gl_node_id}: {e}')


def main():
    log.info('Lightning Payment Monitor starting...')
    log.info(f'Network: {GL_NETWORK}')
    log.info(f'Webhook: {WEBHOOK_URL}')
    log.info(f'Poll interval: {POLL_INTERVAL}s')

    creds = load_credentials()
    log.info('Greenlight credentials loaded')

    while running:
        nodes = get_active_nodes()

        if nodes:
            log.info(f'Monitoring {len(nodes)} active node(s)')
            for node in nodes:
                if not running:
                    break
                monitor_node(creds, node)
        else:
            log.debug('No active nodes to monitor')

        # Sleep in small increments for signal responsiveness
        for _ in range(POLL_INTERVAL):
            if not running:
                break
            time.sleep(1)

    log.info('Lightning Payment Monitor stopped')


if __name__ == '__main__':
    main()
