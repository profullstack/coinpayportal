# Coinpay + Tor hidden service in one container (Railway deploys this Dockerfile).
# Mirrors the qrypt.chat pattern: Next.js app on $PORT, Tor exposes it as a .onion.
FROM node:24-bookworm-slim

# System deps: tor + tini for clean PID 1 + gettext for envsubst
RUN apt-get update && apt-get install -y --no-install-recommends \
    tor ca-certificates tini gettext-base \
 && rm -rf /var/lib/apt/lists/*

# Prepare Tor dirs. DataDirectory is ephemeral (/var/lib/tor); the hidden
# service keys live on the existing Railway volume at /mnt/files/tor (created
# at runtime by entrypoint.sh) so the .onion address stays stable.
RUN mkdir -p /var/lib/tor /var/log/tor \
 && chown -R debian-tor:debian-tor /var/lib/tor /var/log/tor

# Build-time public env vars (inlined into the Next.js bundle at `pnpm build`)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_DOMAIN
ARG NEXT_PUBLIC_LNBITS_URL
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_ONION_URL
ARG NODE_ENV

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_DOMAIN=$NEXT_PUBLIC_DOMAIN
ENV NEXT_PUBLIC_LNBITS_URL=$NEXT_PUBLIC_LNBITS_URL
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_ONION_URL=$NEXT_PUBLIC_ONION_URL

# App build
WORKDIR /app
# Pin pnpm to a known-good version (avoid `pnpm@latest` surprises on Railway).
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
# Copy the whole repo before install: the root package.json depends on the
# workspace package @profullstack/coinpay (packages/*), so pnpm needs those
# manifests present at install time.
COPY . .

# L-03: installs from the lockfile, not around it.
#
# This was `--no-frozen-lockfile`, justified by a comment saying the lockfile
# drifts. That flag lets pnpm resolve versions the lockfile does not record, so
# two builds of the same commit can ship different dependency trees and a
# changed — or compromised — transitive dependency reaches production without
# appearing in any diff. For a payments platform that is the whole supply-chain
# argument for having a lockfile at all.
#
# The premise was also out of date: `pnpm install --frozen-lockfile` passes
# against the current tree, checked before making this change. If it drifts
# again the build now fails loudly, which is the point — a drifted lockfile is
# something to fix in a commit, not to route around on every deploy.
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Runtime env
ENV HOST=0.0.0.0
ENV PORT=8080

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
# Tor requires root at startup (chown /var/lib/tor, run tor daemon); entrypoint
# drops to debian-tor for the tor process. A non-root USER here would break it.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/bin/tini","--"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["/entrypoint.sh"]
