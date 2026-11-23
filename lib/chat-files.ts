/** 買賣家聊聊附件。上限對齊現有圖片桶 8MB，格式沿用圖片桶的 JPG／PNG／WEBP，另加私人證件桶已接受的 PDF。 */
export const CHAT_FILE_BUCKET = 'seller-chat-files'
export const CHAT_FILE_MAX_BYTES = 8 * 1024 * 1024
export const CHAT_FILE_MAX_COUNT = 3
export const CHAT_FILE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const CHAT_FILE_LIMIT_TEXT = 'JPG、PNG、WEBP 或 PDF，單檔 8MB，一次最多 3 個'

const EXT_MIME: Record<string, (typeof CHAT_FILE_MIMES)[number]> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

export function resolveChatFileMime(file: { name: string; type: string }): string {
  const type = file.type.toLowerCase().split(';')[0].trim()
  if ((CHAT_FILE_MIMES as readonly string[]).includes(type)) return type
  if (type && type !== 'application/octet-stream') return ''
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  return EXT_MIME[ext] ?? ''
}

export function chatFileIsImage(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
}

/** 空字串代表可以選取。其餘文字是畫面上要顯示的拒絕原因。 */
export function chatFileRefusal(file: { name: string; type: string; size: number }): string {
  if (!resolveChatFileMime(file)) return '只支援 JPG、PNG、WEBP 照片或 PDF 檔案'
  if (file.size <= 0) return '檔案是空的'
  if (file.size > CHAT_FILE_MAX_BYTES) return '單檔上限 8MB'
  return ''
}

export function formatChatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}
