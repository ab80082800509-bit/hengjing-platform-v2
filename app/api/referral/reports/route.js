import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 記憶體頻率限制記錄（防止短時間內瘋狂洗版）
const ipRequestMap = new Map();

export async function POST(request) {
  try {
    // 取得請求者的 IP 
    const forwardedFor = request.headers.get('x-forwarded-for');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0] : '127.0.0.1';
    
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 分鐘的時間窗口
    const maxRequests = 3; // 1 分鐘內最多只能檢舉 3 次

    // 檢查頻率限制 (Rate Limiting)
    if (!ipRequestMap.has(clientIp)) {
      ipRequestMap.set(clientIp, []);
    }
    const timestamps = ipRequestMap.get(clientIp);
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    if (validTimestamps.length >= maxRequests) {
      return NextResponse.json(
        { success: false, error: '您提交檢舉的頻率過快，請稍後再試（防洗版保護中）。' }, 
        { status: 429 }
      );
    }

    validTimestamps.push(now);
    ipRequestMap.set(clientIp, validTimestamps);

    // 接收前端傳來的檢舉資料
    const { targetId, targetType, reason, description } = await request.json();

    if (!targetId || !reason) {
      return NextResponse.json({ success: false, error: '檢舉目標與原因為必填項' }, { status: 400 });
    }

    // 寫入 Supabase reports 資料表
    const { error } = await supabase
      .from('reports')
      .insert([
        { 
          target_id: targetId, 
          target_type: targetType || 'product', 
          reason, 
          description,
          status: 'pending'
        }
      ]);

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      message: '檢舉已成功送出，站長將進行審核。' 
    }, { status: 200 });

  } catch (error) {
    console.error('送出檢舉失敗:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}