import { supabase } from '@/lib/supabase'

export const MEMBER_AVATAR_BUCKET = 'member-avatars'
export const STORE_MEDIA_BUCKET = 'store-media'
export const REVIEW_IMAGE_BUCKET = 'review-images'

export type BuyerCloudProfile = {
  publicNickname: string
  nicknameInitialized: boolean
  nicknameChangedAt: string | null
  nextRenameAt: string | null
  canRename: boolean
  avatarUrl: string | null
  avatarTone: number
  dbNow: string
}

export type StorefrontSettings = {
  sellerUserId?: string
  storeName?: string
  bannerUrl: string | null
  logoUrl: string | null
  intro: string
  theme: StoreTheme
  featuredIds: string[]
  categories: string[]
  published?: boolean
  separated?: boolean
  publishedBannerUrl?: string | null
  publishedLogoUrl?: string | null
  certifiedAt?: string | null
}

export type StoreTheme = 'default' | 'ink' | 'forest' | 'ocean' | 'sand' | 'rose'

export type PublicReview = {
  id: string
  productId: string
  rating: number
  body: string
  createdAt: string
  nickname: string
  reply?: string
  repliedAt?: string
  photos: string[]
}

export type MyReview = {
  id: string
  productId: string
  productName: string
  rating: number
  body: string
  createdAt: string
}

export type SimilarHit = {
  id: string
  name: string
  price: number
  priceLabel: '售價' | '起價'
  image: string
  sellerId: string
  storeName: string
  specNote: string
  matchKind: 'same' | 'similar'
  matchScore: number
  purchasable: boolean
  stock: number
}

export type TicketRow = {
  id: string
  userId: string
  role: 'buyer' | 'seller'
  author: string
  category: string
  subject: string
  body: string
  status: 'pending' | 'processing' | 'replied' | 'closed'
  at: string
  reply?: string
  repliedAt?: string
  unread: boolean
}

type RpcError = { message?: string } | null

export function dbError(error: RpcError, fallback = '操作失敗') {
  const msg = error?.message?.trim() ?? ''
  if (!msg) return fallback
  if (/schema cache|could not find the function|does not exist|relation .* does not exist/i.test(msg)) {
    return '資料庫更新尚未套用。請先審查並執行 SQL migration 後再試。'
  }
  return msg
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg'
  const bin = atob(b64 || '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/${bucket}/`
  const index = url.indexOf(marker)
  if (index < 0) return null
  return decodeURIComponent(url.slice(index + marker.length).split('?')[0])
}

function mapProfile(value: unknown): BuyerCloudProfile {
  const row = asRecord(value) ?? {}
  return {
    publicNickname: typeof row.publicNickname === 'string' ? row.publicNickname : '',
    nicknameInitialized: row.nicknameInitialized === true,
    nicknameChangedAt: typeof row.nicknameChangedAt === 'string' ? row.nicknameChangedAt : null,
    nextRenameAt: typeof row.nextRenameAt === 'string' ? row.nextRenameAt : null,
    canRename: row.canRename !== false,
    avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : null,
    avatarTone: typeof row.avatarTone === 'number' ? row.avatarTone : 0,
    dbNow: typeof row.dbNow === 'string' ? row.dbNow : new Date().toISOString(),
  }
}

export async function fetchMyProfile(): Promise<{ profile: BuyerCloudProfile | null; error: string }> {
  const { data, error } = await supabase.rpc('get_my_profile')
  if (error) return { profile: null, error: dbError(error, '讀取個人資料失敗') }
  return { profile: mapProfile(data), error: '' }
}

export async function savePublicNickname(nickname: string): Promise<{ profile: BuyerCloudProfile | null; error: string }> {
  const { data, error } = await supabase.rpc('set_public_nickname', { p_nickname: nickname })
  if (error) return { profile: null, error: dbError(error, '暱稱更新失敗') }
  return { profile: mapProfile(data), error: '' }
}

export async function saveAvatarTone(tone: number): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return '請先登入'
  const { error } = await supabase.from('profiles').update({ avatar_tone: tone }).eq('id', uid)
  return error ? dbError(error, '頭像顏色儲存失敗') : ''
}

export async function uploadMemberAvatar(dataUrl: string, previousUrl?: string | null): Promise<{ url: string | null; error: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return { url: null, error: '請先登入' }
  const blob = dataUrlToBlob(dataUrl)
  if (blob.size > 5 * 1024 * 1024) return { url: null, error: '檔案過大，請選擇 5MB 以下的圖片' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    return { url: null, error: '只支援 JPG、PNG 或 WEBP' }
  }
  const path = `${uid}/${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage.from(MEMBER_AVATAR_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  if (uploadError) return { url: null, error: dbError(uploadError, '頭像上傳失敗') }
  const url = supabase.storage.from(MEMBER_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid)
  if (error) {
    await supabase.storage.from(MEMBER_AVATAR_BUCKET).remove([path])
    return { url: null, error: dbError(error, '頭像已上傳，但個人資料沒有儲存成功') }
  }
  const previous = previousUrl ? storagePathFromPublicUrl(previousUrl, MEMBER_AVATAR_BUCKET) : null
  if (previous && previous !== path && previous.startsWith(`${uid}/`)) {
    await supabase.storage.from(MEMBER_AVATAR_BUCKET).remove([previous])
  }
  return { url, error: '' }
}

export async function removeMemberAvatar(currentUrl?: string | null): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return '請先登入'
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid)
  if (error) return dbError(error, '移除頭像失敗')
  const previous = currentUrl ? storagePathFromPublicUrl(currentUrl, MEMBER_AVATAR_BUCKET) : null
  if (previous && previous.startsWith(`${uid}/`)) {
    await supabase.storage.from(MEMBER_AVATAR_BUCKET).remove([previous])
  }
  return ''
}

export async function listFavoriteIds(): Promise<{ ids: string[]; error: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return { ids: [], error: '' }
  const { data, error } = await supabase.from('product_favorites').select('product_id').eq('user_id', uid)
  if (error) return { ids: [], error: dbError(error, '讀取收藏失敗') }
  return { ids: (data ?? []).map((row) => String(row.product_id)), error: '' }
}

export async function addFavorite(productId: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return '請先登入'
  const { error } = await supabase.from('product_favorites').insert({ user_id: uid, product_id: productId })
  if (error && !/duplicate key|already exists/i.test(error.message)) return dbError(error, '收藏失敗')
  return ''
}

export async function removeFavorite(productId: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return '請先登入'
  const { error } = await supabase.from('product_favorites').delete().eq('user_id', uid).eq('product_id', productId)
  return error ? dbError(error, '取消收藏失敗') : ''
}

export async function listFollowedSellerIds(): Promise<{ ids: string[]; error: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return { ids: [], error: '' }
  const { data, error } = await supabase.from('seller_follows').select('seller_user_id').eq('user_id', uid)
  if (error) return { ids: [], error: dbError(error, '讀取關注失敗') }
  return { ids: (data ?? []).map((row) => String(row.seller_user_id)), error: '' }
}

export async function followSeller(sellerUserId: string): Promise<string> {
  const { error } = await supabase.rpc('follow_seller', { p_seller_user_id: sellerUserId })
  return error ? dbError(error, '關注失敗') : ''
}

export async function unfollowSeller(sellerUserId: string): Promise<string> {
  const { error } = await supabase.rpc('unfollow_seller', { p_seller_user_id: sellerUserId })
  return error ? dbError(error, '取消關注失敗') : ''
}

export async function fetchFollowCounts(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {}
  const { data, error } = await supabase.rpc('public_follow_counts', { p_ids: ids })
  if (error || !Array.isArray(data)) return {}
  const out: Record<string, number> = {}
  data.forEach((row) => {
    const item = asRecord(row)
    if (!item) return
    const id = String(item.seller_user_id ?? '')
    if (id) out[id] = Number(item.followers ?? 0) || 0
  })
  return out
}

function mapTicket(value: unknown, fallbackAuthor = '會員'): TicketRow | null {
  const row = asRecord(value)
  if (!row || typeof row.id !== 'string') return null
  const status = row.status
  const safeStatus = status === 'processing' || status === 'replied' || status === 'closed' ? status : 'pending'
  const repliedAt = typeof row.replied_at === 'string' ? row.replied_at : undefined
  const readAt = typeof row.buyer_last_read_at === 'string' ? row.buyer_last_read_at : ''
  const reply = typeof row.reply === 'string' && row.reply.trim() ? row.reply : undefined
  return {
    id: row.id,
    userId: String(row.user_id ?? ''),
    role: row.role === 'seller' ? 'seller' : 'buyer',
    author: typeof row.author === 'string' && row.author ? row.author : fallbackAuthor,
    category: String(row.category ?? ''),
    subject: String(row.subject ?? ''),
    body: String(row.body ?? ''),
    status: safeStatus,
    at: typeof row.created_at === 'string' ? row.created_at : '',
    reply,
    repliedAt,
    unread: typeof row.unread === 'boolean' ? row.unread : Boolean(reply && repliedAt && repliedAt > readAt),
  }
}

export async function fetchMyTickets(author: string): Promise<{ tickets: TicketRow[]; error: string }> {
  const { data, error } = await supabase.rpc('list_my_tickets')
  if (error) return { tickets: [], error: dbError(error, '讀取客服工單失敗') }
  return { tickets: asArray(data).map((row) => mapTicket(row, author)).filter((row): row is TicketRow => !!row), error: '' }
}

export async function fetchAdminTickets(): Promise<{ tickets: TicketRow[]; error: string }> {
  const { data, error } = await supabase.rpc('admin_list_tickets')
  if (error) return { tickets: [], error: dbError(error, '讀取客服工單失敗') }
  return { tickets: asArray(data).map((row) => mapTicket(row)).filter((row): row is TicketRow => !!row), error: '' }
}

export async function createSupportTicket(input: {
  role: 'buyer' | 'seller'
  category: string
  subject: string
  body: string
}): Promise<string> {
  const { error } = await supabase.rpc('create_support_ticket', {
    p_role: input.role,
    p_category: input.category,
    p_subject: input.subject,
    p_body: input.body,
    p_order_ref: null,
  })
  return error ? dbError(error, '送出客服工單失敗') : ''
}

export async function markTicketRead(id: string): Promise<string> {
  const { error } = await supabase.rpc('mark_ticket_read', { p_id: id })
  return error ? dbError(error, '更新已讀狀態失敗') : ''
}

export async function adminUpdateTicket(id: string, status: TicketRow['status'], reply: string): Promise<string> {
  const { error } = await supabase.rpc('admin_update_ticket', {
    p_id: id,
    p_status: status,
    p_reply: reply,
  })
  return error ? dbError(error, '更新工單失敗') : ''
}

export async function fetchVerifiedSales(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {}
  const { data, error } = await supabase.rpc('public_verified_sales', { p_ids: ids })
  if (error || !Array.isArray(data)) return {}
  const out: Record<string, number> = {}
  data.forEach((row) => {
    const item = asRecord(row)
    if (!item) return
    const id = String(item.product_id ?? '')
    if (id) out[id] = Number(item.units ?? 0) || 0
  })
  return out
}

function reviewPhotoUrl(path: string) {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return supabase.storage.from(REVIEW_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function fetchPublicReviews(ids: string[]): Promise<PublicReview[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('list_public_reviews', { p_ids: ids })
  if (error || !Array.isArray(data)) return []
  return data.flatMap((value) => {
    const row = asRecord(value)
    if (!row || typeof row.id !== 'string') return []
    return [{
      id: row.id,
      productId: String(row.product_id ?? ''),
      rating: Number(row.rating ?? 0) || 0,
      body: String(row.body ?? ''),
      createdAt: String(row.created_at ?? ''),
      nickname: String(row.nickname ?? '買家'),
      reply: typeof row.seller_reply === 'string' ? row.seller_reply : undefined,
      repliedAt: typeof row.seller_replied_at === 'string' ? row.seller_replied_at : undefined,
      photos: asArray(row.photos).map((path) => reviewPhotoUrl(String(path))).filter(Boolean),
    }]
  })
}

export async function fetchMyReviews(): Promise<MyReview[]> {
  const { data, error } = await supabase.rpc('list_my_reviews')
  if (error || !Array.isArray(data)) return []
  return data.flatMap((value) => {
    const row = asRecord(value)
    if (!row || typeof row.id !== 'string') return []
    return [{
      id: row.id,
      productId: String(row.product_id ?? ''),
      productName: String(row.product_name ?? '商品'),
      rating: Number(row.rating ?? 0) || 0,
      body: String(row.body ?? ''),
      createdAt: String(row.created_at ?? ''),
    }]
  })
}

export async function createProductReview(
  orderItemId: string,
  productId: string,
  rating: number,
  body: string,
): Promise<{ id: string | null; error: string }> {
  const { data, error } = await supabase.rpc('create_product_review', {
    p_order_item_id: orderItemId,
    p_product_id: productId,
    p_rating: rating,
    p_body: body,
  })
  if (error || data == null) return { id: null, error: dbError(error, '評價送出失敗') }
  return { id: String(data), error: '' }
}

export async function uploadReviewPhoto(reviewId: string, file: Blob): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return '請先登入'
  if (file.size > 5 * 1024 * 1024) return '檔案過大，請選擇 5MB 以下的圖片'
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '只支援 JPG、PNG 或 WEBP'
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${uid}/${reviewId}/${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage.from(REVIEW_IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) return dbError(uploadError, '評價照片上傳失敗')
  const { error } = await supabase.rpc('attach_review_photo', { p_review_id: reviewId, p_path: path })
  if (error) {
    await supabase.storage.from(REVIEW_IMAGE_BUCKET).remove([path])
    return dbError(error, '評價照片沒有保存成功')
  }
  return ''
}

export async function replyToProductReview(reviewId: string, text: string): Promise<string> {
  const { error } = await supabase.rpc('reply_to_product_review', { p_review_id: reviewId, p_text: text })
  return error ? dbError(error, '回覆評價失敗') : ''
}

export async function findSimilarProducts(productId: string, offset = 0): Promise<{ items: SimilarHit[]; error: string }> {
  const { data, error } = await supabase.rpc('find_similar_products', {
    p_product_id: productId,
    p_limit: 12,
    p_offset: offset,
  })
  if (error) return { items: [], error: dbError(error, '找相似商品失敗') }
  const items = asArray(data).flatMap((value) => {
    const row = asRecord(value)
    if (!row || row.id == null) return []
    const kind = row.match_kind === 'same' ? 'same' : 'similar'
    return [{
      id: String(row.id),
      name: String(row.name ?? '商品'),
      price: Number(row.price ?? 0) || 0,
      priceLabel: row.price_label === '起價' ? '起價' as const : '售價' as const,
      image: String(row.image ?? ''),
      sellerId: String(row.seller_id ?? ''),
      storeName: String(row.store_name ?? '賣場'),
      specNote: String(row.spec_note ?? ''),
      matchKind: kind as SimilarHit['matchKind'],
      matchScore: Number(row.match_score ?? 0) || 0,
      purchasable: row.purchasable === true,
      stock: Number(row.stock ?? 0) || 0,
    }]
  })
  return { items, error: '' }
}

function mapStorefront(value: unknown): StorefrontSettings | null {
  const row = asRecord(value)
  if (!row) return null
  const theme = row.theme
  const safeTheme: StoreTheme = theme === 'ink' || theme === 'forest' || theme === 'ocean' || theme === 'sand' || theme === 'rose' ? theme : 'default'
  const bannerUrl = typeof row.bannerUrl === 'string' ? row.bannerUrl : null
  const logoUrl = typeof row.logoUrl === 'string' ? row.logoUrl : null
  const intro = typeof row.intro === 'string' ? row.intro : ''
  const featuredIds = asArray(row.featuredIds).map(String)
  const categories = asArray(row.categories).map(String)
  const hasContent = !!bannerUrl || !!logoUrl || !!intro.trim() || safeTheme !== 'default' || featuredIds.length > 0 || categories.length > 0
  return {
    sellerUserId: typeof row.sellerUserId === 'string' ? row.sellerUserId : undefined,
    storeName: typeof row.storeName === 'string' ? row.storeName : undefined,
    bannerUrl,
    logoUrl,
    intro,
    theme: safeTheme,
    featuredIds,
    categories,
    published: typeof row.published === 'boolean' ? row.published : hasContent,
    separated: row.separated === true,
    publishedBannerUrl: typeof row.publishedBannerUrl === 'string' ? row.publishedBannerUrl : null,
    publishedLogoUrl: typeof row.publishedLogoUrl === 'string' ? row.publishedLogoUrl : null,
    certifiedAt: typeof row.certifiedAt === 'string' && row.certifiedAt.trim() ? row.certifiedAt : null,
  }
}

export async function fetchMyStorefront(): Promise<{ storefront: StorefrontSettings | null; error: string }> {
  const { data, error } = await supabase.rpc('get_my_storefront')
  if (error) return { storefront: null, error: dbError(error, '讀取賣場裝潢失敗') }
  return { storefront: mapStorefront(data), error: '' }
}

export type PublicStoreIdentity = {
  name: string
  certifiedAt: string | null
}

export async function fetchPublicStoreNames(ids: string[]): Promise<Record<string, PublicStoreIdentity>> {
  if (!ids.length) return {}
  const { data, error } = await supabase.rpc('public_store_names', { p_ids: ids })
  if (error || !Array.isArray(data)) return {}
  const out: Record<string, PublicStoreIdentity> = {}
  data.forEach((value) => {
    const row = asRecord(value)
    const id = String(row?.seller_user_id ?? '')
    const name = String(row?.store_name ?? '').trim()
    const certifiedAt = typeof row?.certified_at === 'string' && row.certified_at.trim() ? row.certified_at : null
    if (id && name) out[id] = { name, certifiedAt }
  })
  return out
}

export async function fetchPublicStorefront(sellerUserId: string): Promise<StorefrontSettings | null> {
  const { data, error } = await supabase.rpc('public_storefront', { p_seller_user_id: sellerUserId })
  if (error || !data) return null
  return mapStorefront(data)
}

export async function uploadStoreMedia(file: File, kind: 'banner' | 'logo'): Promise<{ url: string | null; error: string }> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return { url: null, error: '請先登入' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { url: null, error: '只支援 JPG、PNG 或 WEBP' }
  if (file.size > 5 * 1024 * 1024) return { url: null, error: '圖片需在 5MB 以內' }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${uid}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(STORE_MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { url: null, error: dbError(error, '賣場圖片上傳失敗') }
  return { url: supabase.storage.from(STORE_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl, error: '' }
}

function storefrontPayload(input: StorefrontSettings) {
  return {
    p_intro: input.intro,
    p_theme: input.theme,
    p_banner_url: input.bannerUrl ?? '',
    p_logo_url: input.logoUrl ?? '',
    p_featured: input.featuredIds,
    p_categories: input.categories,
  }
}

export async function saveStorefront(input: StorefrontSettings): Promise<string> {
  const { error } = await supabase.rpc('save_storefront', storefrontPayload(input))
  return error ? dbError(error, '儲存賣場草稿失敗') : ''
}

export async function publishStorefront(input: StorefrontSettings): Promise<string> {
  const { error } = await supabase.rpc('publish_storefront', storefrontPayload(input))
  return error ? dbError(error, '發布賣場失敗') : ''
}

export async function removeStoreMedia(url: string | null): Promise<void> {
  if (!url) return
  const path = storagePathFromPublicUrl(url, STORE_MEDIA_BUCKET)
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!path || !uid || !path.startsWith(`${uid}/`)) return
  await supabase.storage.from(STORE_MEDIA_BUCKET).remove([path])
}

export type StoreThemeStyle = {
  id: StoreTheme
  label: string
  banner: string
  page: string
  ink: string
  muted: string
  line: string
  chipOn: string
  chipOff: string
  action: string
  decor: string
  logoRing: string
}

export const STORE_THEMES: StoreThemeStyle[] = [
  {
    id: 'default',
    label: '石色',
    banner: 'from-stone-400 via-stone-600 to-stone-800',
    page: 'bg-[#3c3832]',
    ink: 'text-stone-50',
    muted: 'text-stone-300',
    line: 'border-stone-400/70',
    chipOn: 'bg-stone-100 text-stone-900',
    chipOff: 'bg-stone-800/80 text-stone-100 ring-1 ring-stone-400/70',
    action: 'bg-stone-100 text-stone-900 hover:bg-white',
    decor: 'bg-stone-200',
    logoRing: 'border-stone-200',
  },
  {
    id: 'ink',
    label: '墨黑',
    banner: 'from-zinc-800 via-black to-amber-950',
    page: 'bg-[#100e0c]',
    ink: 'text-amber-50',
    muted: 'text-amber-200/80',
    line: 'border-amber-400/60',
    chipOn: 'bg-amber-400 text-black',
    chipOff: 'bg-black/70 text-amber-100 ring-1 ring-amber-400/60',
    action: 'bg-amber-400 text-black hover:bg-amber-300',
    decor: 'bg-amber-400',
    logoRing: 'border-amber-300',
  },
  {
    id: 'forest',
    label: '森綠',
    banner: 'from-emerald-400 via-emerald-700 to-emerald-950',
    page: 'bg-[#0c241c]',
    ink: 'text-emerald-50',
    muted: 'text-emerald-200/85',
    line: 'border-emerald-400/60',
    chipOn: 'bg-emerald-300 text-emerald-950',
    chipOff: 'bg-emerald-950/80 text-emerald-50 ring-1 ring-emerald-400/60',
    action: 'bg-emerald-300 text-emerald-950 hover:bg-emerald-200',
    decor: 'bg-emerald-300',
    logoRing: 'border-emerald-200',
  },
  {
    id: 'ocean',
    label: '海藍',
    banner: 'from-sky-400 via-blue-700 to-blue-950',
    page: 'bg-[#0c1c33]',
    ink: 'text-sky-50',
    muted: 'text-sky-200/85',
    line: 'border-sky-400/60',
    chipOn: 'bg-sky-300 text-sky-950',
    chipOff: 'bg-blue-950/80 text-sky-50 ring-1 ring-sky-400/60',
    action: 'bg-sky-300 text-sky-950 hover:bg-sky-200',
    decor: 'bg-sky-300',
    logoRing: 'border-sky-200',
  },
  {
    id: 'sand',
    label: '沙金',
    banner: 'from-amber-300 via-orange-600 to-orange-950',
    page: 'bg-[#3a2412]',
    ink: 'text-amber-50',
    muted: 'text-amber-200/85',
    line: 'border-amber-400/65',
    chipOn: 'bg-amber-300 text-amber-950',
    chipOff: 'bg-orange-950/80 text-amber-50 ring-1 ring-amber-400/60',
    action: 'bg-amber-300 text-amber-950 hover:bg-amber-200',
    decor: 'bg-amber-300',
    logoRing: 'border-amber-200',
  },
  {
    id: 'rose',
    label: '玫紅',
    banner: 'from-rose-300 via-rose-600 to-rose-950',
    page: 'bg-[#3a1520]',
    ink: 'text-rose-50',
    muted: 'text-rose-200/85',
    line: 'border-rose-400/65',
    chipOn: 'bg-rose-300 text-rose-950',
    chipOff: 'bg-rose-950/80 text-rose-50 ring-1 ring-rose-300/60',
    action: 'bg-rose-300 text-rose-950 hover:bg-rose-200',
    decor: 'bg-rose-300',
    logoRing: 'border-rose-200',
  },
]

const NEW_STORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function isNewStore(certifiedAt: string | null | undefined, now = Date.now()) {
  if (!certifiedAt) return false
  const at = Date.parse(certifiedAt)
  if (!Number.isFinite(at)) return false
  const age = now - at
  return age >= 0 && age < NEW_STORE_WINDOW_MS
}

export type StoreReputation = {
  average: number
  count: number
  label: string
}

/** 店家評價只接受已驗證成交的賣場評價。商品評價與頁面展示星等都不是這個來源，因此目前維持尚無評價。 */
export function storeReputation(certifiedAt: string | null | undefined, now = Date.now()): StoreReputation {
  return {
    average: 0,
    count: 0,
    label: isNewStore(certifiedAt, now) ? '新店・尚無評價' : '尚無評價',
  }
}

export function storeThemeStyle(theme: string | undefined) {
  return STORE_THEMES.find((item) => item.id === theme) ?? STORE_THEMES[0]
}

export function storeThemeBanner(theme: string | undefined) {
  return storeThemeStyle(theme).banner
}

export type SellerChatThread = {
  id: string
  buyerId: string
  sellerUserId: string
  productId: string | null
  productName: string | null
  productImage: string | null
  productPrice: number | null
  productVisible: boolean
  peerName: string
  peerAvatar: string | null
  lastBody: string | null
  lastAt: string | null
  unread: number
}

export type SellerChatMessage = {
  id: string
  chatId: string
  senderId: string
  body: string
  createdAt: string
}

function mapChat(value: unknown): SellerChatThread | null {
  const row = asRecord(value)
  if (!row || row.id == null) return null
  return {
    id: String(row.id),
    buyerId: String(row.buyer_id ?? ''),
    sellerUserId: String(row.seller_user_id ?? ''),
    productId: row.product_id == null ? null : String(row.product_id),
    productName: row.product_name == null ? null : String(row.product_name),
    productImage: row.product_image == null ? null : String(row.product_image),
    productPrice: row.product_price == null ? null : Number(row.product_price) || 0,
    productVisible: row.product_visible === true,
    peerName: String(row.peer_name ?? '會員'),
    peerAvatar: row.peer_avatar == null ? null : String(row.peer_avatar),
    lastBody: row.last_body == null ? null : String(row.last_body),
    lastAt: row.last_at == null ? null : String(row.last_at),
    unread: Number(row.unread ?? 0) || 0,
  }
}

function mapChatMessage(value: unknown): SellerChatMessage | null {
  const row = asRecord(value)
  if (!row || row.id == null) return null
  return {
    id: String(row.id),
    chatId: String(row.chat_id ?? ''),
    senderId: String(row.sender_id ?? ''),
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

export async function fetchSellerChats(): Promise<{ chats: SellerChatThread[]; error: string }> {
  const { data, error } = await supabase.rpc('list_seller_chats')
  if (error) return { chats: [], error: dbError(error, '讀取對話失敗') }
  return { chats: asArray(data).flatMap((item) => { const chat = mapChat(item); return chat ? [chat] : [] }), error: '' }
}

export async function openSellerChat(sellerUserId: string, productId?: string | null): Promise<{ id: string | null; error: string }> {
  const { data, error } = await supabase.rpc('open_seller_chat', {
    p_seller_user_id: sellerUserId,
    p_product_id: productId ?? null,
  })
  if (error || data == null) return { id: null, error: dbError(error, '無法開啟對話') }
  return { id: String(data), error: '' }
}

export async function fetchSellerChatMessages(chatId: string): Promise<{ messages: SellerChatMessage[]; error: string }> {
  const { data, error } = await supabase.rpc('list_seller_chat_messages', { p_chat_id: chatId })
  if (error) return { messages: [], error: dbError(error, '讀取訊息失敗') }
  return {
    messages: asArray(data).flatMap((item) => { const message = mapChatMessage(item); return message ? [message] : [] }),
    error: '',
  }
}

export async function sendSellerChatMessage(chatId: string, body: string): Promise<{ message: SellerChatMessage | null; error: string }> {
  const { data, error } = await supabase.rpc('send_seller_chat_message', { p_chat_id: chatId, p_body: body })
  if (error) return { message: null, error: dbError(error, '傳送失敗') }
  return { message: mapChatMessage(data), error: '' }
}

export async function markSellerChatRead(chatId: string): Promise<string> {
  const { error } = await supabase.rpc('mark_seller_chat_read', { p_chat_id: chatId })
  return error ? dbError(error, '已讀狀態更新失敗') : ''
}
