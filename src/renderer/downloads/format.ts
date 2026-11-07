import { isActive } from "../../shared/downloads"
import type { DownloadInfo } from "../../shared/protocol"

/** 0..1, or null when the size is unknown. */
export const progressOf = (item: DownloadInfo): number | null =>
    item.totalBytes > 0 ? Math.min(1, item.receivedBytes / item.totalBytes) : null

/** Aggregate progress for the toolbar bar. Null means "indeterminate". */
export const overallProgress = (items: readonly DownloadInfo[]): number | null => {
    const active = items.filter(isActive)
    if (active.length === 0) return null
    let received = 0
    let total = 0
    for (const item of active) {
        if (item.totalBytes <= 0) return null
        received += item.receivedBytes
        total += item.totalBytes
    }
    return total > 0 ? Math.min(1, received / total) : null
}

export const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / 1024 ** exponent
    return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}
