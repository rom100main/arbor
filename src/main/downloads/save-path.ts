import path from "node:path"

/** A name that is safe as one path segment. Never empty, never contains a separator. */
export const sanitizeFilename = (suggested: string): string => {
    const base = path.basename(suggested.replaceAll("\\", "/"))
    const cleaned = base
        // oxlint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/^\.+/, "")
        .trim()
    return cleaned.length > 0 ? cleaned : "download"
}

/** `dir/name.ext`, or `dir/name (1).ext`, `dir/name (2).ext`, … when taken. */
export const uniqueSavePath = (
    dir: string,
    filename: string,
    exists: (candidate: string) => boolean,
): string => {
    const first = path.join(dir, filename)
    if (!exists(first)) return first
    const extension = path.extname(filename)
    const stem = filename.slice(0, filename.length - extension.length)
    for (let index = 1; ; index += 1) {
        const candidate = path.join(dir, `${stem} (${index})${extension}`)
        if (!exists(candidate)) return candidate
    }
}
