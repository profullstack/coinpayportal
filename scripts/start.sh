#!/bin/sh
# Railway start script

# Cap the heap well above steady-state so GC has headroom. 512 was too low:
# it OOM-killed production on 2026-08-29 (see entrypoint.sh).
export NODE_OPTIONS="--max-old-space-size=2048 --unhandled-rejections=warn"
exec pnpm start
