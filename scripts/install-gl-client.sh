#!/bin/sh
# Install Greenlight Python SDK (non-fatal but verbose)

echo "=== GL SDK Install: Start ==="

if command -v apt-get >/dev/null 2>&1; then
  echo "Installing python3-pip python3-venv via apt..."
  apt-get update -qq && apt-get install -y -qq python3-pip python3-venv 2>&1 || echo "WARN: apt install failed (non-fatal)"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "WARN: python3 not found, skipping GL SDK"
  echo "=== GL SDK Install: Skipped ==="
  exit 0
fi

echo "Python3 found: $(python3 --version)"

VENV_DIR=""
if python3 -m venv /app/.venv 2>&1; then
  VENV_DIR="/app/.venv"
elif python3 -m venv .venv 2>&1; then
  VENV_DIR=".venv"
else
  echo "WARN: Failed to create venv"
  echo "=== GL SDK Install: Failed (venv) ==="
  exit 0
fi

echo "Venv created at: $VENV_DIR"
PIP="$VENV_DIR/bin/pip"

echo "Installing glclient..."
$PIP install --upgrade pip 2>&1 | tail -1
$PIP install gl-client requests 2>&1 | tail -5

if $VENV_DIR/bin/python3 -c "import glclient; print('glclient version:', glclient.__version__)" 2>&1; then
  echo "=== GL SDK Install: SUCCESS ==="
else
  echo "WARN: glclient import failed"
  echo "=== GL SDK Install: Failed (import) ==="
fi
