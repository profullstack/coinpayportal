#!/bin/sh
# Install Greenlight Python SDK if possible (non-fatal)
set -e

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq python3-pip python3-venv >/dev/null 2>&1 || true
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -m venv /app/.venv 2>/dev/null || python3 -m venv .venv 2>/dev/null || exit 0
  VENV_PIP="/app/.venv/bin/pip"
  [ -f "$VENV_PIP" ] || VENV_PIP=".venv/bin/pip"
  [ -f "$VENV_PIP" ] || exit 0
  $VENV_PIP install gl-client requests 2>&1 || true
  echo "GL SDK installed"
else
  echo "Python3 not found, skipping GL SDK"
fi
