import { NextResponse } from 'next/server'

// 舊路由會用 service role 刪 user_coupons、改 profiles.points，並寫入 point_transactions。
// 第四階段帳本沒有這三張表。沒有現行畫面呼叫這條路徑，這裡直接停用，避免以後繞過帳本。
export async function POST() {
  return NextResponse.json(
    { success: false, error: '廢券分解已停用，不會變更點數或優惠券。' },
    { status: 410 },
  )
}
