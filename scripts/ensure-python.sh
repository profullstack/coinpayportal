#!/bin/sh
# Ensure Python + glclient are available at runtime
# Railway build and deploy images may differ

if command -v python3 >/dev/null 2>&1 && python3 -c "import glclient" 2>/dev/null; then
  echo "[GL] Python + glclient already available"
  exit 0
fi

echo "[GL] Installing python3 + glclient at runtime..."

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq python3 python3-venv python3-pip 2>&1 | tail -3
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache python3 py3-pip 2>&1 | tail -3
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[GL] WARN: python3 not available, Lightning bridge disabled"
  exit 0
fi

python3 -m venv /opt/gl-venv 2>&1 || python3 -m venv --without-pip /opt/gl-venv 2>&1
if [ -f /opt/gl-venv/bin/pip ]; then
  /opt/gl-venv/bin/pip install gl-client requests 2>&1 | tail -3
else
  python3 -m pip install gl-client requests 2>&1 | tail -3
fi

if /opt/gl-venv/bin/python3 -c "import glclient" 2>/dev/null; then
  echo "[GL] glclient ready at /opt/gl-venv/bin/python3"
else
  echo "[GL] WARN: glclient install failed"
fi

# GL cert files written by gl-bridge.py at runtime
