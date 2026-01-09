# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Stage 2: Build the application
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (need dummy DATABASE_URL for generate only)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN bunx prisma generate

# Stage 3: Production runner
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/data ./data
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/type.ts ./type.ts
COPY --from=builder /app/index.ts ./index.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

CMD ["bun", "run", "index.ts"]
