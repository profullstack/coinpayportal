#!/bin/sh
# Railway start script — ensures Python + GL certs are ready before Node starts

# 1. Ensure Python + glclient
sh scripts/ensure-python.sh

# 2. Write inline PEM env vars to files for the GL Rust binary
# The Rust binary reads GL_NOBODY_CRT/GL_NOBODY_KEY as file paths
mkdir -p /tmp/gl-certs
if [ -n "$GL_NOBODY_CRT" ] && echo "$GL_NOBODY_CRT" | grep -q "BEGIN CERTIFICATE"; then
  printf '%s\n' "$GL_NOBODY_CRT" > /tmp/gl-certs/nobody.crt
  export GL_NOBODY_CRT=/tmp/gl-certs/nobody.crt
  echo "[GL] Wrote cert to /tmp/gl-certs/nobody.crt"
fi
if [ -n "$GL_NOBODY_KEY" ] && echo "$GL_NOBODY_KEY" | grep -q "BEGIN"; then
  printf '%s\n' "$GL_NOBODY_KEY" > /tmp/gl-certs/nobody.key
  export GL_NOBODY_KEY=/tmp/gl-certs/nobody.key
  echo "[GL] Wrote key to /tmp/gl-certs/nobody.key"
fi

# 3. Start Node
export NODE_OPTIONS="--max-old-space-size=512"
exec pnpm start
