FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS builder
WORKDIR /app
COPY code/ ./
RUN node .yarn/releases/yarn-4.18.0.cjs install --immutable \
    && node .yarn/releases/yarn-4.18.0.cjs test --runInBand \
    && node .yarn/releases/yarn-4.18.0.cjs build:deployment \
    && node .yarn/releases/yarn-4.18.0.cjs workspaces focus --production

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "--env-file=.env", "dist/main.js"]
