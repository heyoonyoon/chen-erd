# syntax=docker/dockerfile:1

# ── 1단계: 빌드 ──────────────────────────────────────────────
# 결과물이 자바스크립트뿐이라 빌드는 항상 빌드 머신의 아키텍처에서 돌린다(arm64 이미지를 만들 때도 빠르다).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# ── 2단계: 실행 ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app

# 서버 번들은 의존성을 포함하지 않으므로(esbuild --packages=external) 실행용 의존성만 설치한다.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build /app/dist ./dist

# 다이어그램이 저장되는 곳. 비루트 사용자(node, uid 1000)가 쓸 수 있어야 한다.
# VOLUME 선언보다 먼저 소유권을 바꿔야 새로 만들어지는 볼륨에 그대로 반영된다.
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
