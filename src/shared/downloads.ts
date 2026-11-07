// Should be Effect free

import type { DownloadInfo } from "./protocol"

export const isActive = (item: DownloadInfo): boolean =>
    item.state === "pending" || item.state === "progressing"
