# Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-single-host-deployment.md
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /src
RUN npm install --global pnpm@11.7.0 --ignore-scripts
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./
COPY patches ./patches
COPY packages ./packages
COPY apps/exam-web ./apps/exam-web
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build:shared && pnpm --filter @solveflow/db build && pnpm --filter @solveflow/exam-web build
# The standalone dependency graph does not include the mobile-only patched packages.
# Keep applying patches that are present, without treating absent mobile packages as an error.
RUN pnpm --config.allowUnusedPatches=true --filter @solveflow/exam-web deploy --prod --legacy /release

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production SOLVEFLOW_EXAM_HOST=0.0.0.0 SOLVEFLOW_EXAM_PORT=3190 SOLVEFLOW_EXAM_CONFIG=/run/secrets/exam_config
WORKDIR /app
COPY --from=build --chown=node:node /release ./
USER node
EXPOSE 3190
CMD ["node", "dist/server.mjs"]
