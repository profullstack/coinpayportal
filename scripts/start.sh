#!/bin/sh
# Railway start script — ensures Python + GL certs are ready before Node starts

# 1. Ensure Python + glclient
sh scripts/ensure-python.sh

# 2. Write GL certs to files for the Rust binary
# The GL Rust binary reads GL_NOBODY_CRT/GL_NOBODY_KEY as FILE PATHS.
# If they contain inline PEM, write to files and update env vars.
# Also supports GL_NOBODY_CRT_INLINE / GL_NOBODY_KEY_INLINE as separate vars.
mkdir -p /tmp/gl-certs

# Handle inline PEM in GL_NOBODY_CRT
if [ -n "$GL_NOBODY_CRT_INLINE" ]; then
  echo "$GL_NOBODY_CRT_INLINE" > /tmp/gl-certs/nobody.crt
  export GL_NOBODY_CRT=/tmp/gl-certs/nobody.crt
  echo "[GL] Wrote CRT from GL_NOBODY_CRT_INLINE"
elif [ -n "$GL_NOBODY_CRT" ]; then
  case "$GL_NOBODY_CRT" in
    -----BEGIN*)
      echo "$GL_NOBODY_CRT" > /tmp/gl-certs/nobody.crt
      export GL_NOBODY_CRT=/tmp/gl-certs/nobody.crt
      echo "[GL] Wrote CRT from inline env var"
      ;;
    *)
      echo "[GL] GL_NOBODY_CRT is a file path: $GL_NOBODY_CRT"
      ;;
  esac
fi

# Handle inline PEM in GL_NOBODY_KEY
if [ -n "$GL_NOBODY_KEY_INLINE" ]; then
  echo "$GL_NOBODY_KEY_INLINE" > /tmp/gl-certs/nobody.key
  export GL_NOBODY_KEY=/tmp/gl-certs/nobody.key
  echo "[GL] Wrote KEY from GL_NOBODY_KEY_INLINE"
elif [ -n "$GL_NOBODY_KEY" ]; then
  case "$GL_NOBODY_KEY" in
    -----BEGIN*)
      echo "$GL_NOBODY_KEY" > /tmp/gl-certs/nobody.key
      export GL_NOBODY_KEY=/tmp/gl-certs/nobody.key
      echo "[GL] Wrote KEY from inline env var"
      ;;
    *)
      echo "[GL] GL_NOBODY_KEY is a file path: $GL_NOBODY_KEY"
      ;;
  esac
fi

# Verify files exist
ls -la /tmp/gl-certs/ 2>/dev/null

# 3. Start Node
export NODE_OPTIONS="--max-old-space-size=512"
exec pnpm start
