# Production image for the API, with its in-process scheduler and email queue.
# Debian-based so the Prisma query engine (debian-openssl-3.0.x) runs as built.
# Mirrors how Render runs it today: `yarn build` then `node dist/app.js`, with
# the generated Prisma client kept at src/generated (where Prisma looks for
# its engine).
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false
COPY . .
RUN yarn build \
  # Drop dev dependencies, but keep the Prisma CLI for `migrate deploy`.
  && yarn install --frozen-lockfile --production=true --ignore-scripts \
  && yarn add prisma@6.19 --ignore-scripts \
  && yarn cache clean

ENV NODE_ENV=production
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/app.js"]
