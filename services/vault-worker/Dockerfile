# The vault worker: a small always-on service that owns the git clone and mirrors
# git -> S3 -> Knowledge Base. Needs git in the image; runs TypeScript via tsx.

FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY tsconfig.json ./

ENV VAULT_WORK_DIR=/data/vault
EXPOSE 8080

CMD ["npx", "tsx", "src/index.ts"]
