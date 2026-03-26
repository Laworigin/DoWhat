import * as fs from 'fs'
import * as path from 'path'
import archiver from 'archiver'

/**
 * 磁盘空间管理：归档并清理旧截图
 * 1. 查找 snapshots 目录下早于今天的日期目录
 * 2. 对每个目录进行压缩并存为 .zip
 * 3. 归档成功后删除原始目录
 * 4. 清理超过 30 天的归档文件 (可选)
 */
export async function runStorageMaintenance(): Promise<void> {
  const snapshotsDir = path.join(process.cwd(), 'snapshots')
  if (!fs.existsSync(snapshotsDir)) return

  const todayStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const dirs = fs.readdirSync(snapshotsDir).filter((d) => {
    const dirPath = path.join(snapshotsDir, d)
    // 匹配 YYYY-MM-DD 格式且不是今天的目录
    return fs.statSync(dirPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== todayStr
  })

  if (dirs.length === 0) {
    console.log('[Maintenance] 无需归档的旧目录')
    return
  }

  console.log(`[Maintenance] 发现 ${dirs.length} 个旧目录待归档...`)

  for (const dirName of dirs) {
    const sourceDir = path.join(snapshotsDir, dirName)
    const zipPath = path.join(snapshotsDir, `${dirName}.zip`)

    // 如果 zip 已存在，说明之前可能尝试过，这里直接删除旧目录或跳过
    if (fs.existsSync(zipPath)) {
      console.log(`[Maintenance] 归档 ${zipPath} 已存在，正在清理原始目录...`)
      fs.rmSync(sourceDir, { recursive: true, force: true })
      continue
    }

    try {
      await compressDirectory(sourceDir, zipPath)
      console.log(`[Maintenance] 成功归档目录: ${dirName} -> ${zipPath}`)
      // 归档成功后删除原目录
      fs.rmSync(sourceDir, { recursive: true, force: true })
    } catch (error) {
      console.error(`[Maintenance] 归档目录 ${dirName} 失败:`, error)
    }
  }

  // 额外清理：删除超过 30 天的 .zip 文件 (保留文字记录即可)
  cleanupOldZips(snapshotsDir, 30)
}

/**
 * 压缩目录为 ZIP
 */
function compressDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))

    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize()
  })
}

/**
 * 清理过期的 ZIP 归档 (默认 30 天)
 */
function cleanupOldZips(dir: string, days: number): void {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip'))
  const now = Date.now()
  const expirationMs = days * 24 * 60 * 60 * 1000

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const stats = fs.statSync(filePath)
    if (now - stats.mtimeMs > expirationMs) {
      console.log(`[Maintenance] 清理过期归档: ${file}`)
      fs.unlinkSync(filePath)
    }
  })
}
