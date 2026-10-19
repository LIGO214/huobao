# syntax=docker/dockerfile:1

# ===== 前端构建：Nuxt generate 产出静态站点 =====
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
ARG NUXT_APP_BASE_URL=/huobao/
COPY frontend/package.json frontend/package-lock.json ./
# lockfile 的 resolved 可能指向带鉴权的私有 registry（开发者本机 .npmrc），镜像内会 401。
# 构建期删除 resolved 字段（integrity 校验不受影响），让 npm 统一走公共 registry
RUN node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync('package-lock.json'));for(const p of Object.values(l.packages||{}))delete p.resolved;fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2))" \
  && npm ci --no-audit --no-fund --registry=https://registry.npmjs.org
COPY frontend/ ./
RUN NUXT_APP_BASE_URL=${NUXT_APP_BASE_URL} npm run generate

# ===== 后端构建：安装依赖（含原生模块编译） =====
FROM node:22-bookworm-slim AS backend-build
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
ARG SKIP_FFMPEG_STATIC_DOWNLOAD=false
COPY backend/package.json backend/package-lock.json ./
# Some constrained deployment networks cannot reach ffmpeg-static's release
# binary. Keep normal images unchanged; those deployments can opt in to skip it.
RUN node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync('package-lock.json'));for(const p of Object.values(l.packages||{}))delete p.resolved;fs.writeFileSync('package-lock.json',JSON.stringify(l,null,2))" \
  && if [ "$SKIP_FFMPEG_STATIC_DOWNLOAD" = "true" ]; then \
       npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org \
       && npm rebuild better-sqlite3 sharp --no-audit --no-fund --registry=https://registry.npmjs.org; \
     else \
       npm ci --no-audit --no-fund --registry=https://registry.npmjs.org; \
     fi
COPY backend/ ./
RUN npm run typecheck && npm run test:unit
# Keep tsx and the PostgreSQL driver for startup and migrations.
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# ===== 运行时 =====
FROM node:22-bookworm-slim
ARG HUOBAO_VERSION=dev
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HUOBAO_VERSION=${HUOBAO_VERSION} \
    PORT=5679 \
    HUOBAO_DATA_DIR=/app/data \
    FRONTEND_DIST=/app/frontend-dist \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    FFPROBE_BIN=/usr/bin/ffprobe

WORKDIR /app
COPY --from=backend-build /build/backend/src ./backend/src
COPY --from=backend-build /build/backend/node_modules ./backend/node_modules
COPY --from=backend-build /build/backend/package.json ./backend/package.json
COPY --from=backend-build /build/backend/tsconfig.json ./backend/tsconfig.json
COPY --from=backend-build /build/backend/scripts/migrate-postgres.ts ./backend/scripts/migrate-postgres.ts
# Built-in text is versioned and never copied to the writable data volume.
COPY backend/workspace ./backend/workspace
COPY --from=frontend-build /build/frontend/.output/public ./frontend-dist
COPY docker/entrypoint.sh ./entrypoint.sh
RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh \
  && mkdir -p /app/data && chown node:node /app/data \
  && chmod -R a-w ./backend/workspace
USER node

# Only user media and necessary runtime files are writable.
VOLUME ["/app/data"]
EXPOSE 5679

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5679)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
