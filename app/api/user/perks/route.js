import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qfbupfnrvzgwbvdgwvh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少 user_id 參數' }, { status: 400 });
    }

    // 查詢用戶目前在背包中「已裝備 (equipped = true)」的特權或裝備
    const { data: equippedItems, error } = await supabase
      .from('user_inventory')
      .select(`
        id,
        item_code,
        item_name,
        category,
        css_style_config
      `)
      .eq('user_id', userId)
      .eq('is_equipped', true);

    if (error) {
      throw new Error('查詢用戶裝備失敗: ' + error.message);
    }

    return NextResponse.json({
      success: true,
      user_id: userId,
      equipped_perks: equippedItems || []
    });

  } catch (err) {
    console.error('取得特權裝備發生錯誤:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}