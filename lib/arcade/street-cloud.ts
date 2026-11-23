/**
 * 夢想商店街雲端存檔的純函式：解析資料庫回覆、本機同步紀錄與存檔後的金幣對帳。
 *
 * 資料庫不採用前端送出的金幣與經驗，而是用 stats 的累計增量、規則花費與互助／偷貨領取紀錄重算。
 * 送出後到回覆之前玩家可能又賺了錢，所以回覆後的畫面金幣 = 資料庫金幣 + (現在 − 送出時)。
 */
import { parseStreet, type StreetProgress } from './street-rules'

export type CloudRow = {
  revision: number
  progress: StreetProgress
  importSource: 'browser' | 'fresh' | null
  importAdjusted: boolean
  /** 資料庫認得的商店街內容版本；舊資料庫沒有這個欄位，視為 1。 */
  contentVersion: 1 | 2
}

/** 送出中的存檔：回覆遺失時原封不動重送同一份內容與同一把鍵，資料庫會回放而不是重算。 */
export type CloudInflight = { key: string; base: number; payload: StreetProgress }

/** 每位會員每台裝置一份，記著目前根據哪一版雲端存檔、有沒有還沒同步的變更。 */
export type CloudCache = {
  rev: number | null
  dirty: boolean
  sig: string | null
  inflight: CloudInflight | null
  importKey: string | null
}

export const EMPTY_CLOUD_CACHE: CloudCache = { rev: null, dirty: false, sig: null, inflight: null, importKey: null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const asObject = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)
const revision = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null)
const uuid = (value: unknown) => (typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null)

export function parseCloudRow(raw: unknown): CloudRow | null {
  const src = asObject(raw)
  const rev = revision(src?.revision)
  const progress = parseStreet(src?.progress)
  if (!src || rev == null || !progress) return null
  return {
    revision: rev,
    progress,
    importSource: src.importSource === 'browser' || src.importSource === 'fresh' ? src.importSource : null,
    importAdjusted: src.importAdjusted === true,
    contentVersion: src.contentVersion === 2 ? 2 : 1,
  }
}

export function parseCloudCache(raw: unknown): CloudCache {
  const src = asObject(raw)
  if (!src) return EMPTY_CLOUD_CACHE
  const fly = asObject(src.inflight)
  const flyKey = uuid(fly?.key)
  const flyBase = revision(fly?.base)
  const flyPayload = parseStreet(fly?.payload)
  return {
    rev: revision(src.rev),
    dirty: src.dirty === true,
    sig: typeof src.sig === 'string' ? src.sig : null,
    inflight: flyKey && flyBase != null && flyPayload ? { key: flyKey, base: flyBase, payload: flyPayload } : null,
    importKey: uuid(src.importKey),
  }
}

/** 判斷有沒有值得同步的變更。製作中的剩餘毫秒每秒都在變，不算變更；
 * 金幣與經驗由資料庫從 stats 與花費重算，只有它們不同也不需要重送。 */
export function progressSig(progress: StreetProgress) {
  return JSON.stringify({ ...progress, coins: 0, xp: 0, jobs: progress.jobs.map((job) => [job.product, job.count]) })
}

const nonNegative = (n: number) => Math.max(0, Math.floor(n))

/** 存檔回覆後的對帳：資產以資料庫為準，送出後才發生的營業變動保留下來。 */
export function rebaseProgress(local: StreetProgress, sent: StreetProgress, server: StreetProgress): StreetProgress {
  return {
    ...local,
    coins: nonNegative(server.coins + (local.coins - sent.coins)),
    xp: nonNegative(server.xp + (local.xp - sent.xp)),
  }
}

/** 資料庫拒收或版本衝突時，只顯示這些原因；任何一種都改用雲端版本，本機那份另存備份。 */
export const CLOUD_REASON: Record<string, string> = {
  conflict: '另一台裝置有較新的進度，已載入雲端最新進度',
  implausible: '這段時間的營業數字超過遊戲規則上限，已改回雲端進度',
  regress: '這份存檔比雲端舊，已改回雲端進度',
  coins: '金幣不足以支付這次的升級或購買，已改回雲端進度',
  rank: '店長等級不足以完成這次的升級或購買，已改回雲端進度',
  invalid: '存檔格式不正確，已改回雲端進度',
  too_large: '存檔太大，已改回雲端進度',
  exists: '這個帳號已經從其他裝置轉移過進度，已載入雲端進度',
  import_inconsistent: '這台裝置的舊存檔數字前後不一致，無法驗證，暫時無法轉移',
  import_cap: '這台裝置的舊存檔營收超過可轉移上限，請聯絡客服協助',
}

export const cloudReasonText = (reason: unknown) =>
  (typeof reason === 'string' && CLOUD_REASON[reason]) || '雲端存檔暫時沒有完成，進度先保留在這台裝置'

/** 轉移被拒時不改本機進度，只能等客服或之後再試。 */
export const IMPORT_BLOCKED = new Set(['import_inconsistent', 'import_cap', 'invalid', 'too_large'])

export const progressSummary = (p: StreetProgress) => `店面 Lv.${p.shopLevel}・${p.coins.toLocaleString()} 金幣・${1 + p.buildings.length} 間店・${p.ownedDecors.length} 件裝潢`
