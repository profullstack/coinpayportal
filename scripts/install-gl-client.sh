#!/bin/sh
# Install Greenlight Python SDK (non-fatal but verbose)

echo "=== GL SDK Install: Start ==="
echo "PWD: $(pwd)"
echo "whoami: $(whoami 2>/dev/null || echo unknown)"

# Install python3 + venv if apt is available
if command -v apt-get >/dev/null 2>&1; then
  echo "Installing python3-pip python3-venv via apt..."
  apt-get update -qq && apt-get install -y -qq python3-pip python3-venv 2>&1 || echo "WARN: apt install failed (non-fatal)"
elif command -v apk >/dev/null 2>&1; then
  echo "Installing python3 via apk..."
  apk add --no-cache python3 py3-pip 2>&1 || echo "WARN: apk install failed"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "WARN: python3 not found, skipping GL SDK"
  echo "=== GL SDK Install: Skipped (no python3) ==="
  exit 0
fi

echo "Python3 found: $(python3 --version)"

# Create venv OUTSIDE the project directory to avoid Turbopack symlink issues
VENV_DIR="/opt/gl-venv"
echo "Creating venv at: $VENV_DIR"

if ! python3 -m venv "$VENV_DIR" 2>&1; then
  # Try ensurepip workaround
  python3 -m venv --without-pip "$VENV_DIR" 2>&1 || {
    echo "WARN: Failed to create venv"
    echo "=== GL SDK Install: Failed (venv) ==="
    exit 0
  }
  # Bootstrap pip manually
  "$VENV_DIR/bin/python3" -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')" 2>&1
  "$VENV_DIR/bin/python3" /tmp/get-pip.py 2>&1 | tail -3
fi

PIP="$VENV_DIR/bin/pip"
if [ ! -f "$PIP" ]; then
  echo "WARN: pip not found at $PIP"
  echo "=== GL SDK Install: Failed (no pip) ==="
  exit 0
fi

echo "Installing glclient..."
$PIP install --upgrade pip 2>&1 | tail -1
$PIP install gl-client requests 2>&1 | tail -5

if "$VENV_DIR/bin/python3" -c "import glclient; print('glclient OK')" 2>&1; then
  echo "=== GL SDK Install: SUCCESS ==="
  echo "Venv size: $(du -sh "$VENV_DIR" 2>/dev/null | cut -f1)"
else
  echo "WARN: glclient import failed"
  # Show what went wrong
  "$VENV_DIR/bin/python3" -c "import glclient" 2>&1
  echo "=== GL SDK Install: Failed (import) ==="
fi
