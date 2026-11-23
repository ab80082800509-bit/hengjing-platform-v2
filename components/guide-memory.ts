// 新手引導與免運說明的完成狀態。每位會員各自保存；未登入是另一份，互不沿用。

const WELCOME_KEY = 'hengjing:guide:welcome:v1:'
const TOUR_KEY = 'hengjing:guide:tours:v1:'

export type GuideRole = 'buyer' | 'seller'

export function guideOwner(userId: string | null) {
  return userId ?? 'guest'
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 無法寫入時只在這次頁面有效。
  }
}

export function welcomeDismissed(owner: string) {
  return read(WELCOME_KEY + owner) === '1'
}

export function dismissWelcome(owner: string) {
  write(WELCOME_KEY + owner, '1')
}

export function toursSeenFor(owner: string): GuideRole[] {
  try {
    const raw = JSON.parse(read(TOUR_KEY + owner) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is GuideRole => item === 'buyer' || item === 'seller')
  } catch {
    return []
  }
}

export function rememberTour(owner: string, role: GuideRole) {
  const next = [...new Set([...toursSeenFor(owner), role])]
  write(TOUR_KEY + owner, JSON.stringify(next))
  return next
}
