#!/bin/sh
# Railway start script

# Keep process resilient and avoid frequent OOM exits under production load
export NODE_OPTIONS="--max-old-space-size=1024 --unhandled-rejections=warn"
exec pnpm start
