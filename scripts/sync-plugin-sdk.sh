#!/usr/bin/env bash
# Copy the canonical CoinPay PHP client from packages/coinpay-php/src/ into
# each plugin's vendored lib/CoinPay/ directory.
#
# WordPress and WHMCS install plugin zips directly, so we can't rely on
# `composer install` at deploy time. Source of truth lives in
# packages/coinpay-php/; plugins hold vendored copies. Run this script after
# editing the shared client.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/packages/coinpay-php/src"

TARGETS=(
    "${ROOT_DIR}/plugins/woocommerce/coinpay-woocommerce/lib/CoinPay"
    "${ROOT_DIR}/plugins/whmcs/modules/gateways/coinpay/lib/CoinPay"
)

if [ ! -d "${SRC_DIR}" ]; then
    echo "error: shared PHP source not found at ${SRC_DIR}" >&2
    exit 1
fi

for target in "${TARGETS[@]}"; do
    echo "→ syncing to ${target#${ROOT_DIR}/}"
    mkdir -p "${target}"
    # Clean and repopulate so deletions in source propagate.
    rm -f "${target}"/*.php
    cp "${SRC_DIR}"/*.php "${target}/"
done

echo "✓ synced $(ls "${SRC_DIR}"/*.php | wc -l) files to ${#TARGETS[@]} plugin(s)"
