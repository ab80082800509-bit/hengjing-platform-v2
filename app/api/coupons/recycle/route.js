import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客戶端（正式上線或本機容錯）
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qfbupfnrvzgwbvdgwvh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request) {
  try {
    const { user_id, coupon_id } = await request.json();

    if (!user_id || !coupon_id) {
      return NextResponse.json({ success: false, error: '缺少必要的參數 (user_id 或 coupon_id)' }, { status: 400 });
    }

    // 1. 執行刪除優惠券（確保該優惠券確實屬於該用戶）
    const { error: deleteError, count } = await supabase
      .from('user_coupons')
      .delete({ count: 'exact' })
      .match({ id: coupon_id, user_id: user_id });

    if (deleteError) {
      throw new Error('刪除優惠券失敗: ' + deleteError.message);
    }

    // 2. 更新用戶點數（增加 3 點）
    // 先取得目前點數再增加，或者透過 SQL 增量更新
    const { data: profileData, error: fetchError } = await supabase
      .from('profiles')
      .select('points')
      .eq('id', user_id)
      .single();

    if (fetchError) {
      throw new Error('讀取用戶點數失敗');
    }

    const currentPoints = profileData?.points || 0;
    const newPoints = currentPoints + 3;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ points: newPoints })
      .eq('id', user_id);

    if (updateError) {
      throw new Error('更新用戶點數失敗: ' + updateError.message);
    }

    // 3. 寫入點數流水帳記錄
    const { error: txError } = await supabase
      .from('point_transactions')
      .insert([
        {
          user_id: user_id,
          amount: 3,
          type: 'recycle',
          description: `分解優惠券 (ID: ${coupon_id}) 獲得 3 點`,
        }
      ]);

    if (txError) {
      console.error('寫入流水帳失敗:', txError.message);
    }

    return NextResponse.json({
      success: true,
      message: '廢券分解成功，已獲得 3 點！',
      new_points: newPoints
    });

  } catch (err) {
    console.error('廢券分解發生錯誤:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}