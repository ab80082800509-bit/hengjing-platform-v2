const STORAGE_KEY = 'bgpf-visitor-id'
let memoryId: string | null = null

function randomId() {
  return crypto.randomUUID().replace(/-/g, '')
}

export function getVisitorId() {
  if (memoryId) return memoryId
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && /^[a-f0-9]{32}$/.test(saved)) {
      memoryId = saved
      return saved
    }
    const fresh = randomId()
    window.localStorage.setItem(STORAGE_KEY, fresh)
    memoryId = fresh
    return fresh
  } catch {
    memoryId = randomId()
    return memoryId
  }
}
