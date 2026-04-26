FROM oven/bun:1.3.12-alpine AS dependencies
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.12-alpine AS build
WORKDIR /app

COPY . .
COPY --from=dependencies /app/node_modules /app/node_modules
RUN bun run build

FROM oven/bun:1.3.12-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
RUN bun install --frozen-lockfile --production

COPY --from=build /app/build /app/build

CMD ["bun", "run", "start"]
