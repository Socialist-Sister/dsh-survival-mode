// 转译 engine 单元测试（TS → ESM）供 node --test 运行
// esbuild 从 pnpm store 绝对路径解析（engine 包自身未声明 esbuild 依赖，
// 避免重复安装；hud 的构建链路已把 esbuild@0.27.7 装进 store）。
import { mkdirSync, rmSync } from 'fs'

// 定位 store 中的 esbuild（从仓库根或任意包目录向上找 .pnpm）
import { pathToFileURL } from 'url'
let esbuild
const candidates = [
  new URL('../../node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/package.json', import.meta.url).pathname,
  new URL('../../hud/node_modules/esbuild/package.json', import.meta.url).pathname,
]
for (const c of candidates) {
  try {
    const mod = await import(pathToFileURL(c.replace(/package\.json$/, 'lib/main.js')).href)
    esbuild = mod.default ?? mod
    break
  } catch {
    /* 下一个候选 */
  }
}
if (esbuild === undefined) {
  console.error('找不到 esbuild——请先 pnpm install（hud 包依赖含 esbuild@0.27.7）')
  process.exit(1)
}

rmSync('test-dist', { recursive: true, force: true })
mkdirSync('test-dist', { recursive: true })

const entries = [
  { in: 'test/game.test.ts', out: 'test-dist/game.test.mjs' },
  { in: 'test/respawn.test.ts', out: 'test-dist/respawn.test.mjs' },
]

for (const { in: input, out } of entries) {
  await esbuild.build({
    entryPoints: [input],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    loader: { '.ts': 'ts' },
    resolveExtensions: ['.ts', '.js', '.mjs'],
    outfile: out,
    sourcemap: false,
    logLevel: 'error',
  })
  console.log(`${out} 转译完成`)
}
