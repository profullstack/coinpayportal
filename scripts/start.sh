#!/bin/sh
# Railway start script

# Limit heap to 512MB — forces GC earlier, prevents runaway memory
export NODE_OPTIONS="--max-old-space-size=512 --unhandled-rejections=warn"
exec pnpm start
