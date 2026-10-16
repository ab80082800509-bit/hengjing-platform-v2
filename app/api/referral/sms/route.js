import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, type, customMessage } = body;

    if (!phone) {
      return NextResponse.json({ success: false, error: '缺少手機號碼' }, { status: 400 });
    }

    let message = '';
    let otpCode = null;

    // 根據不同業務類型生成對應的簡訊內容
    switch (type) {
      case 'otp': {
        otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        message = `【買個PAY服】您的驗證碼為：${otpCode}，有效時間為 5 分鐘。`;

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const { error: dbError } = await supabase
          .from('otps')
          .insert([{ phone, code: otpCode, type: 'verify', expires_at: expiresAt, used: false }]);

        if (dbError) throw dbError;
        break;
      }
      case 'logistic': {
        message = `【買個PAY服】您的超商取貨包裹已送達指定門市，請於 7 天內前往取貨。`;
        break;
      }
      case 'renewal': {
        message = `【買個PAY服】您的賣家權益月費將於 3 天後到期，請盡速完成續費。`;
        break;
      }
      default:
        return NextResponse.json({ success: false, error: '不支援的簡訊類型' }, { status: 400 });
    }

    console.log(`[SMS Gateway] 成功發送至 ${phone} | 類型: ${type} | 內容: ${message}`);

    return NextResponse.json({ 
      success: true, 
      message: '簡訊發送成功',
      debugOtp: otpCode || undefined 
    }, { status: 200 });

  } catch (error) {
    console.error('簡訊發送 API 發生錯誤:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}