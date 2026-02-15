#!/bin/sh
# Railway start script

export NODE_OPTIONS="--max-old-space-size=512"
exec pnpm start
