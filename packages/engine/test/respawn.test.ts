/**
 * 文件重生点（respawn.ts）单元测试 —— Node 内置 node:test，零依赖。
 *
 * respawn.ts 是纯 Node fs 层（不依赖 Cordis），用临时目录验证：
 * 快照 / 回退（覆盖修改、恢复删除、删除新建）/ 排除目录 / manifest 往返 /
 * 清理。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshotWorkspace, restoreWorkspace, removeSnapshot, saveConversation, DEFAULT_EXCLUDES } from '../src/respawn.ts'

/** 建一个临时"工作区 + 备份目录"。 */
async function makeDirs() {
  const base = await mkdtemp(join(tmpdir(), 'survival-respawn-'))
  const cwd = join(base, 'workspace')
  const backup = join(base, 'backup')
  await mkdir(cwd, { recursive: true })
  return { base, cwd, backup }
}

test('默认排除列表：全是可再生生成物', () => {
  for (const name of ['node_modules', '.git', '.pnpm-store', 'dist', 'test-dist', '__pycache__']) {
    assert.ok(DEFAULT_EXCLUDES.includes(name), `${name} 在默认排除列表`)
  }
})

test('快照：复制排除列表外的文件并写 manifest', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await mkdir(join(cwd, 'src'), { recursive: true })
    await mkdir(join(cwd, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(cwd, 'README.md'), 'hi')
    await writeFile(join(cwd, 'src', 'index.ts'), 'code')
    await writeFile(join(cwd, 'node_modules', 'dep', 'index.js'), 'heavy')

    const result = await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, true)
    assert.equal(result.files, 2, '只备份 README.md 与 src/index.ts')

    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest.sort(), ['README.md', 'src/index.ts'])
    assert.equal(await readFile(join(backup, 'src', 'index.ts'), 'utf8'), 'code')
    // 排除目录不进备份
    await assert.rejects(readFile(join(backup, 'node_modules', 'dep', 'index.js')))
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('回退：修改的文件被还原', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    await writeFile(join(cwd, 'a.txt'), 'v2-modified')

    const result = await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, true)
    assert.equal(result.restored, 1)
    assert.equal(result.deleted, 0)
    assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'v1')
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('回退：重生点之后新建的文件被删除', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    await writeFile(join(cwd, 'new-file.md'), 'created after backup')
    await mkdir(join(cwd, 'new-dir'), { recursive: true })
    await writeFile(join(cwd, 'new-dir', 'x.txt'), 'also new')

    const result = await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, true)
    assert.equal(result.deleted, 2, '两个新建文件都被删除')
    await assert.rejects(readFile(join(cwd, 'new-file.md')))
    await assert.rejects(readFile(join(cwd, 'new-dir', 'x.txt')))
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('回退：删除的文件被恢复', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    await rm(join(cwd, 'a.txt'))

    const result = await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, true)
    assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'v1')
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('回退：排除目录不触碰（不回退也不删除）', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await mkdir(join(cwd, 'node_modules'), { recursive: true })
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    // 备份后：node_modules 装新包 + 新建文件
    await writeFile(join(cwd, 'node_modules', 'fresh-pkg.js'), 'new dep')
    await writeFile(join(cwd, 'b.txt'), 'new file')

    const result = await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, true)
    assert.equal(result.deleted, 1, '只删除 b.txt')
    // node_modules 保持现状
    assert.equal(await readFile(join(cwd, 'node_modules', 'fresh-pkg.js'), 'utf8'), 'new dep')
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('回退：快照缺失时返回错误而非破坏工作区', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    const result = await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /manifest/)
    assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'v1', '工作区未被破坏')
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('空排除列表 = 全量备份', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await mkdir(join(cwd, 'node_modules'), { recursive: true })
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await writeFile(join(cwd, 'node_modules', 'x.js'), 'dep')

    const result = await snapshotWorkspace(cwd, backup, [])
    assert.equal(result.ok, true)
    assert.equal(result.files, 2, 'node_modules 也被备份')
    assert.equal(await readFile(join(backup, 'node_modules', 'x.js'), 'utf8'), 'dep')
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('防护：备份目录位于工作区内时拒绝快照与回退', async () => {
  const { cwd } = await makeDirs()
  try {
    const inside = join(cwd, 'respawn-backup')
    await writeFile(join(cwd, 'a.txt'), 'v1')
    const snap = await snapshotWorkspace(cwd, inside, DEFAULT_EXCLUDES)
    assert.equal(snap.ok, false)
    assert.match(snap.error ?? '', /工作区内/)
    const rest = await restoreWorkspace(cwd, inside, DEFAULT_EXCLUDES)
    assert.equal(rest.ok, false)
    assert.match(rest.error ?? '', /工作区内/)
    assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'v1', '工作区未被破坏')
  } finally {
    await rm(join(cwd, '..'), { recursive: true, force: true })
  }
})

test('saveConversation：对话摘要写入快照目录，回退不影响它', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    const ok = await saveConversation(backup, '# 重生点对话摘要\n\n👤 你好\n')
    assert.equal(ok, true)
    const saved = await readFile(join(backup, 'conversation.md'), 'utf8')
    assert.match(saved, /重生点对话摘要/)
    // 回退后 conversation.md 仍在（不属于工作区，不参与回退）
    await restoreWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    assert.equal((await readFile(join(backup, 'conversation.md'), 'utf8')).includes('👤 你好'), true)
    // 工作区里没有 conversation.md（它只存在于快照目录）
    await assert.rejects(readFile(join(cwd, 'conversation.md')))
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})

test('removeSnapshot：清理备份目录', async () => {
  const { cwd, backup } = await makeDirs()
  try {
    await writeFile(join(cwd, 'a.txt'), 'v1')
    await snapshotWorkspace(cwd, backup, DEFAULT_EXCLUDES)
    await removeSnapshot(backup)
    await assert.rejects(readFile(join(backup, 'manifest.json')))
    // 重复清理不报错
    await removeSnapshot(backup)
  } finally {
    await rm(join(backup, '..'), { recursive: true, force: true })
  }
})
