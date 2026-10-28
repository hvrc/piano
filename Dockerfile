# Build the client, then run the TypeScript server directly (Node strips types natively).
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.18.0 --no-fund --no-audit
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STORE=firestore FIRESTORE_DATABASE=piano
RUN npm install -g pnpm@11.18.0 --no-fund --no-audit
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY server/ ./server/
# The server shares the track model and limits with the client.
COPY src/model/ ./src/model/
COPY src/music/ ./src/music/
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "server/index.ts"]
