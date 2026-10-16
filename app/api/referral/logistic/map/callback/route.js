import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    // 接收綠界 POST 回傳的物流狀態資料
    const formData = await request.formData();
    const logisticsStatus = formData.get('RtnCode'); // 回傳代號
    const tradeNo = formData.get('MerchantTradeNo'); // 訂單編號
    const logisticId = formData.get('LogisticsID'); // 綠界物流單號

    console.log(`收到綠界物流通知 - 訂單: ${tradeNo}, 狀態代碼: ${logisticsStatus}, 物流單號: ${logisticId}`);

    // 這裡可以透過 Supabase 更新資料庫中的訂單物流狀態
    // 例如：當 RtnCode 代表已取貨時，記錄取貨時間並啟動 7 天倒數

    // 綠界規定接收成功後必須回傳 '1|OK'
    return new Response('1|OK', { status: 200 });
  } catch (error) {
    console.error('Webhook 處理失敗:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}