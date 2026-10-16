export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_RULE_TEXT = '支援 JPG / PNG / WEBP，單張檔案不超過 5MB'

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return '格式不支援，請選擇 JPG、PNG 或 WEBP 圖片'
  if (file.size > MAX_IMAGE_BYTES) {
    return `檔案過大（${(file.size / 1024 / 1024).toFixed(1)}MB），請選擇 5MB 以下的圖片`
  }
  return null
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('讀取圖片失敗'))
    reader.readAsDataURL(file)
  })
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('無法解析圖片'))
    img.src = src
  })
}

export async function downscaleImage(file: File, maxEdge = 1280, quality = 0.85): Promise<string> {
  const img = await loadImage(await readFileAsDataUrl(file))
  const ratio = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * ratio)
  canvas.height = Math.round(img.naturalHeight * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('瀏覽器不支援圖片處理')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}
