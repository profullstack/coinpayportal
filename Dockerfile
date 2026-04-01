# 1. Base image with Node 20
FROM node:20-alpine AS builder

# 2. Enable pnpm natively (no npm install required)
RUN corepack enable pnpm

# 3. Set the working directory
WORKDIR /app

# 4. Copy dependency files first (for caching)
COPY package.json pnpm-lock.yaml ./

# 5. Install dependencies
RUN pnpm install --frozen-lockfile

# 6. Copy the rest of the application code
COPY . .

# 7. Build the Next.js application
RUN pnpm build

# 7b. Remove dev dependencies before copying to production image
RUN pnpm prune --prod

# 8. Start a fresh, lightweight production image
FROM node:20-alpine AS runner
RUN corepack enable pnpm
WORKDIR /app

# 9. Set environment to production
ENV NODE_ENV=production

# 10. Copy only the necessary built files from the builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 11. Expose the port Next.js uses
EXPOSE 3000
ENV PORT=3000

# 12. Start the application
CMD ["pnpm", "start"]
