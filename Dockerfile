# dsh-survival-mode 测试/构建镜像
#
# 用途：
#   1. 本地验证：docker build -t dsh-survival-test . && docker run --rm dsh-survival-test
#   2. CI 三端/多 Node 版本矩阵：node:20 / node:22 / node:24 各构建一次
#   3. 发布前回归：build + typecheck + test + pack 全闭环
#
# 阶段一：构建与测试（含完整 devDependencies）
FROM node:20-bookworm-slim AS build

WORKDIR /workspace

# 先装依赖层（利用 Docker 缓存：package.json 不变则跳过）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/tool-survival/package.json packages/tool-survival/
COPY packages/hud/package.json packages/hud/
# 固定 pnpm 版本：pnpm 10+ 需要 node:sqlite（Node ≥22.5），Node 20 镜像必须用 pnpm 9.x
RUN npm install -g pnpm@9.15.0 && pnpm install --frozen-lockfile

# 源码
COPY tsconfig.base.json ./
COPY LICENSE ./
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/engine/src packages/engine/src
COPY packages/engine/test packages/engine/test
COPY packages/engine/scripts packages/engine/scripts
COPY packages/tool-survival/tsconfig.json packages/tool-survival/
COPY packages/tool-survival/src packages/tool-survival/src
COPY packages/hud/tsconfig.json packages/hud/
COPY packages/hud/src packages/hud/src
COPY packages/hud/scripts packages/hud/scripts
COPY packages/hud/assets packages/hud/assets

# 完整验证闭环：构建 → 类型检查 → 单元测试
# （先 build：tool-survival 的 typecheck 依赖 engine 构建出的 lib/*.d.ts）
RUN pnpm run build && pnpm run typecheck && pnpm run test

# 打包 tgz 到 dist/
RUN pnpm run pack && ls -la dist/

# 阶段二：仅产物（无源码/devDeps，可作发布基线检查）
FROM node:20-bookworm-slim AS artifact

WORKDIR /artifacts
COPY --from=build /workspace/dist/ ./dist/
COPY --from=build /workspace/LICENSE ./

# 校验产物完整性：每个 tgz 必须是合法 tar 且含 package.json
RUN for f in dist/*.tgz; do \
      echo "== $f =="; \
      tar -tzf "$f" | grep -q 'package/package.json' && echo "  ✓ 含 package.json"; \
      tar -tzf "$f" | grep -q 'package/lib/index.js' && echo "  ✓ 含 lib/index.js"; \
    done && echo "--- artifact 校验通过 ---"

CMD ["ls", "-la", "/artifacts/dist"]
