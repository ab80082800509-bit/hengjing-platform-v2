import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { success: false, error: '虛擬特權只能由登入會員透過自己的帳號讀取' },
    { status: 410 },
  )
}
