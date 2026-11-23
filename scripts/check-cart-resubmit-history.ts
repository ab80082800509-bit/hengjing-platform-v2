import {
  cartCounts,
  cartSellerKey,
  findSellerForMember,
  legacyLinesToImport,
  migrationToken,
  parseCartPlan,
  parseLegacyCart,
  type RemoteCartLine,
} from '../lib/commerce-cart'
import { mergePointHistory } from '../lib/rewards/point-history'
import { ownRejectedResubmit } from '../lib/seller-resubmit'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const product = (id: string, qty = 1): RemoteCartLine => ({
  key: id,
  productId: id,
  variant: { 顏色: '紅' },
  qty,
})

const fiveProducts = ['a', 'b', 'c', 'd', 'e'].map((id) => product(id))
const fivePieces = [product('a', 5)]
assert(cartCounts(fiveProducts).items === 5 && cartCounts(fiveProducts).pieces === 5, '五個不同商品應是 5 項、共 5 件')
assert(cartCounts(fivePieces).items === 1 && cartCounts(fivePieces).pieces === 5, '同一商品五件應是 1 項、共 5 件')
assert(cartCounts(fiveProducts).label !== cartCounts(fivePieces).label, '兩種購物車的標示必須不同')

const remote = [product('a', 2)]
const localDup = [product('a', 2), product('b', 1), { ...product('b', 3), variant: { 顏色: '紅' } }, { ...product('c', 1), variant: { 尺寸: 'S' } }]
const pending = legacyLinesToImport(localDup, remote)
assert(pending.length === 2, '伺服器已有的商品不能再匯入')
assert(!pending.some((line) => line.productId === 'a'), '同一商品不能重複加入')
assert(pending.find((line) => line.productId === 'b')?.qty === 4, '舊清單裡同一規格的重複列只合併一次')
assert(pending.some((line) => line.productId === 'c'), '不同規格要保留')

const raw = JSON.stringify([product('a', 2), product('b', 1)])
assert(parseLegacyCart(raw).length === 2, '舊 hj-cart 要能讀回')
assert(parseLegacyCart('not-json').length === 0, '壞掉的舊購物車不能變成空寫入')
assert(migrationToken('user-1', raw) === migrationToken('user-1', raw), '同一份舊資料只轉換一次')
assert(migrationToken('user-1', raw) !== migrationToken('user-1', `${raw} `), '舊資料有變才需要再轉換')
assert(migrationToken('user-1', raw) !== migrationToken('user-2', raw), '轉換標記要綁會員')

const plan = parseCartPlan({
  ok: false,
  lines: [
    {
      cartItemId: 'item-1',
      productId: 'a',
      sellerId: 'member-1',
      variant: { 顏色: '紅' },
      qty: 5,
      purchasable: false,
      issues: [{ message: '此商品已下架，不能結帳' }],
    },
  ],
  sellers: [],
})
assert(plan?.lines.length === 1 && plan.lines[0]?.qty === 5, '同一商品五件要留在回傳清單')
assert(plan?.lines[0]?.purchasable === false && plan.lines[0]?.unavailableReason === '此商品已下架，不能結帳', '下架商品要保留不可結帳原因')
assert(parseCartPlan({ ok: true }) === null, '缺少 lines 不能當成空購物車')

const sellers = [
  { id: 'application-1', userId: 'member-1', verify: 'approved' },
  { id: 'member-1', userId: 'member-1', verify: 'pending', name: '重複列' },
]
const matched = findSellerForMember(sellers, 'member-1')
assert(matched?.id === 'application-1', '商品的會員編號要對到賣家申請，不能因為 id 不同就丟掉')
assert(cartSellerKey(matched!, 'member-1') === 'member-1', '分組鍵要用會員編號，購物車才不會把商品藏起來')
assert(!findSellerForMember(sellers, 'member-2'), '沒有關聯賣家時不能亂配')

assert(ownRejectedResubmit('member-1', { id: 'application-1', userId: 'member-1', verify: 'rejected' })?.status === 'pending', '被拒的本人申請可以改回待審')
assert(ownRejectedResubmit('member-2', { id: 'application-1', userId: 'member-1', verify: 'rejected' }) === null, '不能改別人的申請')
assert(ownRejectedResubmit('member-1', { id: 'application-1', userId: 'member-1', verify: 'approved' }) === null, '不能把自己改成或維持已通過')
assert(ownRejectedResubmit('member-1', { id: 'application-1', userId: 'member-1', verify: 'pending' }) === null, '待審申請不能再送一次')

const history = mergePointHistory({
  checkin: [{ id: 'checkin-1', delta: 10, label: '每日簽到（第 1 天）', at: '2026-10-27' }],
  pointCoupons: [{ id: 'hold-1', code: 'SHOP50', claimedAt: '2026-10-26' }],
  perkIds: ['frame-founder', 'not-a-perk'],
  scratch: { id: 'play-1', points: 20, at: '2026-10-27', outcomeKind: 'points' },
})
assert(history.some((row) => row.delta === 10 && row.label.includes('簽到')), '簽到列要保留')
assert(history.some((row) => row.delta === -100 && row.label.includes('SHOP50')), '點數換券要顯示扣 100')
assert(history.some((row) => row.delta === -100 && row.label.includes('創始會員光環')), '特權購買要顯示目錄售價')
assert(!history.some((row) => row.id.includes('not-a-perk')), '目錄沒有的特權不能編成一筆流水')
assert(history.some((row) => row.delta === 20 && row.label === '刮刮卡點數'), '今日已揭曉的刮卡點數要列出來')
assert(mergePointHistory({
  checkin: [],
  pointCoupons: [],
  perkIds: [],
  scratch: { id: 'play-2', points: 20, at: '2026-10-27', outcomeKind: 'coupon' },
}).length === 0, '刮到優惠券時不能再記一筆點數')

console.log('cart, resubmit and point history checks ok')
