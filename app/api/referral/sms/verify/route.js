import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    const { phone, code } = await request.json();

    if (!phone || !code) {
      return NextResponse.json({ success: false, error: '請輸入手機號碼與驗證碼' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('otps')
      .select('*')
      .eq('phone', phone)
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return NextResponse.json({ success: false, error: '驗證碼錯誤或已過期' }, { status: 400 });
    }

    await supabase
      .from('otps')
      .update({ used: true })
      .eq('id', data[0].id);

    return NextResponse.json({ 
      success: true, 
      message: '手機驗證成功！' 
    }, { status: 200 });

  } catch (error) {
    console.error('OTP 驗證失敗:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}