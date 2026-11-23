-- =============================================================================
-- 特權商城（get_my_points_mall）正式套用前的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束。
-- 不讀會員資料、點數餘額或優惠券內容，只回傳結構是否存在與權限。
-- 先跑 20261025190000_stage5_apply_readonly_check.sql 並套用第五階段 migration，再跑本檔。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN c.has_auth_uid AND c.has_taipei_today AND c.has_point_accounts
      AND c.has_perk_settings AND c.perk_settings_rows = 1
      AND c.has_seller_coupons AND c.coupons_have_game_pool AND c.coupons_have_mall_columns
      AND c.has_coupon_holds AND c.holds_have_source
      AND c.has_seller_coupon_json AND c.has_coupon_seller_name
      AND NOT c.mall_function_exists
    THEN '可以套用 20261028040000_points_mall_read_apply.sql'
    ELSE '先不要套用。看同一列哪個條件不符合'
  END AS apply_gate
FROM (
  SELECT
    to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid,
    to_regprocedure('public.taipei_today(timestamptz)') IS NOT NULL AS has_taipei_today,
    to_regclass('public.member_point_accounts') IS NOT NULL AS has_point_accounts,
    to_regclass('public.member_perk_settings') IS NOT NULL AS has_perk_settings,
    CASE WHEN to_regclass('public.member_perk_settings') IS NULL THEN 0 ELSE (
      xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_perk_settings', false, true, ''))
    )[1]::text::integer END AS perk_settings_rows,
    CASE WHEN to_regclass('public.member_perk_settings') IS NULL THEN false ELSE coalesce((
      xpath('/row/v/text()', query_to_xml('SELECT purchase_enabled AS v FROM public.member_perk_settings WHERE id = true', false, true, ''))
    )[1]::text = 'false', false) END AS purchase_enabled_is_false,
    to_regclass('public.seller_coupons') IS NOT NULL AS has_seller_coupons,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'seller_coupons' AND column_name = 'game_pool'
    ) AS coupons_have_game_pool,
    (
      SELECT count(*) = 7 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'seller_coupons'
        AND column_name IN ('active', 'deleted_at', 'start_on', 'end_on', 'issued_count', 'qty', 'created_at')
    ) AS coupons_have_mall_columns,
    to_regclass('public.member_coupon_holds') IS NOT NULL AS has_coupon_holds,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_coupon_holds' AND column_name = 'source'
    ) AS holds_have_source,
    to_regprocedure('public.seller_coupon_json(public.seller_coupons)') IS NOT NULL AS has_seller_coupon_json,
    to_regprocedure('public.coupon_seller_name(uuid)') IS NOT NULL AS has_coupon_seller_name,
    to_regprocedure('public.get_my_points_mall()') IS NOT NULL AS mall_function_exists,
    EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'pgrst_ddl_watch') AS pgrst_ddl_watch_present
) AS c;

ROLLBACK;
