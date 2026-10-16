import { NextResponse } from 'next/server';

// 綠界物流地圖測試環境 URL
const EC_MAP_URL = 'https://logistics-stage.ecpay.com.tw/Express/map';

export async function POST(request) {
  try {
    const body = await request.json();
    const { merchantId = '2000132', clientBackURL } = body;

    // 模擬組合綠界物流地圖需要的參數
    const params = {
      MerchantID: merchantId,
      MerchantTradeNo: 'TEST' + Date.now(),
      LogisticsType: 'CVS', // 超商物流
      CVSType: 'C2C',       // 超商 C2C
      ServerReplyURL: `${clientBackURL}/api/logistic/callback`,
    };

    return NextResponse.json({ success: true, mapUrl: EC_MAP_URL, params });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}