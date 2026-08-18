/**
 * `@dsh-survival/engine/respawn`：文件重生点（Node fs 层，不依赖 Cordis）。
 *
 * 每个会话是一条独立的命，也是独立存档：会话开始时把工作区快照到
 * `${DSH_HOME}/survival-respawns/<sessionId>/`（出生点）；每次睡觉覆盖快照
 * （新重生点）。死亡时把工作区回退到最近一次快照——重生点之后新建/修改/删除
 * 的文件全部丢失。
 *
 * 排除列表（默认可再生生成物：node_modules/.git/dist 等）不备份也不回退：
 * 回退后如需一致产物，重新 install/build 即可；排除项可经 settings
 * `respawnExcludes` 覆盖（空数组 = 全量备份）。
 *
 * 快照目录内写入 manifest.json（相对路径清单），回退时：
 *   1. 快照文件全部复制回工作区（覆盖修改、恢复删除）；
 *   2. 工作区里 manifest 之外的文件删除（重生点之后新建的）；
 *   3. 排除目录整体跳过——不删不改。
 * @module @dsh-survival/engine/respawn
 */

import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** 快照目录里的对话摘要文件名（与 manifest.json 同级，不属于工作区）。 */
export const CONVERSATION_FILE = 'conversation.md'
/** 快照目录里的世界状态文件名（同一会话重启后恢复进度用）。 */
export const WORLD_FILE = 'world.json'

/** 默认排除的目录名（任意深度按 basename 匹配）：全部是可再生生成物。 */
export const DEFAULT_EXCLUDES: string[] = [
  'node_modules',
  '.git',
  '.pnpm-store',
  'dist',
  'test-dist',
  '__pycache__',
]

export interface SnapshotResult {
  ok: boolean
  /** 备份的文件数。 */
  files: number
  error?: string
}

export interface RestoreResult {
  ok: boolean
  /** 从快照恢复（覆盖修改/恢复删除）的文件数。 */
  restored: number
  /** 删除的重生点之后新建的文件数。 */
  deleted: number
  error?: string
}

/** 相对路径是否命中排除表（按路径各段的 basename 匹配，任意深度）。 */
function isExcluded(relPath: string, excludes: readonly string[]): boolean {
  if (excludes.length === 0) return false
  return relPath.split('/').some((segment) => excludes.includes(segment))
}

/**
 * 递归枚举目录树中所有文件（排除命中目录），返回 '/' 分隔的相对路径。
 * 符号链接按文件处理（copyFile 跟随链接复制目标内容）。
 */
async function walkFiles(root: string, excludes: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isDirectory()) {
        if (isExcluded(rel, excludes)) continue
        await visit(abs)
      } else {
        out.push(rel)
      }
    }
  }
  await visit(root)
  return out
}

/** 备份目录必须在工作区之外（否则快照会自我复制、回退会自删）。 */
function backupInsideCwd(cwd: string, backupDir: string): boolean {
  const rel = relative(cwd, backupDir)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(`../`))
}

/**
 * 快照工作区到备份目录（先清空旧备份再重建，保证与当前状态一致）。
 * 备份目录位于工作区之外（${DSH_HOME}/survival-respawns/），不会污染工作区。
 */
export async function snapshotWorkspace(
  cwd: string,
  backupDir: string,
  excludes: readonly string[],
): Promise<SnapshotResult> {
  if (backupInsideCwd(cwd, backupDir)) {
    return { ok: false, files: 0, error: '备份目录位于工作区内，已拒绝快照。' }
  }
  try {
    await rm(backupDir, { recursive: true, force: true })
    await mkdir(backupDir, { recursive: true })
    const files = await walkFiles(cwd, excludes)
    for (const rel of files) {
      const dest = join(backupDir, rel)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(join(cwd, rel), dest)
    }
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(files, null, 0), 'utf8')
    return { ok: true, files: files.length }
  } catch (error) {
    return { ok: false, files: 0, error: String(error) }
  }
}

/**
 * 把工作区回退到快照状态：
 * 恢复被修改/删除的文件，删除重生点之后新建的文件；排除目录不触碰。
 * 返回恢复与删除的文件数。
 */
export async function restoreWorkspace(
  cwd: string,
  backupDir: string,
  excludes: readonly string[],
): Promise<RestoreResult> {
  if (backupInsideCwd(cwd, backupDir)) {
    return { ok: false, restored: 0, deleted: 0, error: '备份目录位于工作区内，已拒绝回退。' }
  }
  try {
    let manifest: string[] = []
    try {
      const raw = await readFile(join(backupDir, 'manifest.json'), 'utf8')
      manifest = JSON.parse(raw) as string[]
    } catch {
      return { ok: false, restored: 0, deleted: 0, error: '快照不完整（缺 manifest.json）——无法回退文件。' }
    }
    // 1. 快照文件全部复制回工作区（覆盖修改、恢复删除）
    for (const rel of manifest) {
      const dest = join(cwd, rel)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(join(backupDir, rel), dest)
    }
    // 2. 工作区里 manifest 之外的文件删除（重生点之后新建的）；排除目录整体跳过
    const snapshotSet = new Set(manifest)
    const current = await walkFiles(cwd, excludes)
    let deleted = 0
    for (const rel of current) {
      if (snapshotSet.has(rel)) continue
      if (isExcluded(rel, excludes)) continue
      await rm(join(cwd, rel), { force: true })
      deleted += 1
    }
    return { ok: true, restored: manifest.length, deleted }
  } catch (error) {
    return { ok: false, restored: 0, deleted: 0, error: String(error) }
  }
}

/** 删除会话的备份目录（会话结束清理）。 */
export async function removeSnapshot(backupDir: string): Promise<void> {
  try {
    await rm(backupDir, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响会话 */
  }
}

/**
 * 把对话摘要写入快照目录（conversation.md）。重生点 = 文件 + 对话一起存档；
 * 该文件不属于工作区，死亡回退时不会被删除——随快照保留到会话结束。
 * 注意：snapshotWorkspace 会先清空备份目录，本函数必须在快照之后调用。
 */
export async function saveConversation(backupDir: string, markdown: string): Promise<boolean> {
  try {
    await mkdir(backupDir, { recursive: true })
    await writeFile(join(backupDir, CONVERSATION_FILE), markdown, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 把世界状态写入快照目录（world.json）：同一会话重启后恢复进度用。
 * 独立存档语义不变——新会话仍从零开始，存档跟随会话 id 走。
 * 同样必须在 snapshotWorkspace 之后调用。
 */
export async function saveWorld<T>(backupDir: string, data: T): Promise<boolean> {
  try {
    await mkdir(backupDir, { recursive: true })
    await writeFile(join(backupDir, WORLD_FILE), JSON.stringify(data), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 同步读取 world.json（小文件，session-start 时一次性加载）；缺失/损坏返回 undefined。 */
export function loadWorldSync<T>(backupDir: string): T | undefined {
  try {
    const raw = readFileSync(join(backupDir, WORLD_FILE), 'utf8')
    const parsed = JSON.parse(raw) as T
    return parsed ?? undefined
  } catch {
    return undefined
  }
}

/** 快照根目录（${DSH_HOME}/survival-respawns/），供引擎拼装 per-session 路径。 */
export function backupRoot(dshHome: string): string {
  return join(resolve(dshHome), 'survival-respawns')
}
