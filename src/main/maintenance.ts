import * as fs from 'fs'
import * as path from 'path'

const SNAPSHOT_RETENTION_DAYS = 3

let maintenanceBasePath: string | null = null

/**
 * Set the base path for maintenance operations (must use app.getPath('userData')).
 * MUST be called before runStorageMaintenance.
 */
export function setMaintenanceBasePath(basePath: string): void {
  maintenanceBasePath = basePath
  console.log(`[Maintenance] Base path set to: ${maintenanceBasePath}`)
}

/**
 * Disk space management: delete old screenshot directories.
 * Keeps only the last SNAPSHOT_RETENTION_DAYS days of screenshots.
 * Also cleans up any legacy .zip archives.
 */
export async function runStorageMaintenance(): Promise<void> {
  if (!maintenanceBasePath) {
    console.warn('[Maintenance] Base path not set, skipping maintenance')
    return
  }

  const snapshotsDir = path.join(maintenanceBasePath, 'snapshots')
  if (!fs.existsSync(snapshotsDir)) return

  const now = new Date()
  const retentionCutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const cutoffDateStr = retentionCutoff.toISOString().split('T')[0]

  const entries = fs.readdirSync(snapshotsDir)

  // Delete old date directories (YYYY-MM-DD format, older than retention cutoff)
  const expiredDirs = entries.filter((entry) => {
    const entryPath = path.join(snapshotsDir, entry)
    return (
      fs.statSync(entryPath).isDirectory() &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry) &&
      entry < cutoffDateStr
    )
  })

  if (expiredDirs.length > 0) {
    console.log(`[Maintenance] Deleting ${expiredDirs.length} expired snapshot directories (older than ${SNAPSHOT_RETENTION_DAYS} days)...`)
    for (const dirName of expiredDirs) {
      try {
        fs.rmSync(path.join(snapshotsDir, dirName), { recursive: true, force: true })
        console.log(`[Maintenance] Deleted: ${dirName}`)
      } catch (error) {
        console.error(`[Maintenance] Failed to delete ${dirName}:`, error)
      }
    }
  }

  // Clean up any legacy .zip archives
  const zipFiles = entries.filter((entry) => entry.endsWith('.zip'))
  for (const zipFile of zipFiles) {
    try {
      fs.unlinkSync(path.join(snapshotsDir, zipFile))
      console.log(`[Maintenance] Deleted legacy archive: ${zipFile}`)
    } catch (error) {
      console.error(`[Maintenance] Failed to delete archive ${zipFile}:`, error)
    }
  }
}
