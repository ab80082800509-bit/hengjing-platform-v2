import { createHash, randomInt } from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const CODE_PATTERN = /^[A-Z0-9]{8}$/
export const VISITOR_PATTERN = /^[a-f0-9]{32}$/

export function generateCode() {
  let code = ''
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

export function hashIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(`referral:${ip}`).digest('hex')
}

export function taipeiDayStart(now = new Date()) {
  const shifted = now.getTime() + TAIPEI_OFFSET_MS
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS)
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
