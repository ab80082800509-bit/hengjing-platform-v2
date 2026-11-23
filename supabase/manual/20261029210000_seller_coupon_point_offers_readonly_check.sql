-- =============================================================================
-- 賣家授權 Pay 點數兌換券：正式套用前的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束。
-- 不讀會員、點數餘額或優惠券內容，只回傳結構、觸發器與權限是否符合。
-- apply_gate 顯示可以套用時，再執行 20261029210000_seller_coupon_point_offers_apply.sql。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN c.has_auth_uid AND c.has_taipei_today AND c.has_is_approved_seller
      AND c.has_seller_applications_status
      AND c.has_seller_coupons AND c.coupons_have_columns AND c.has_seller_coupons_guard
      AND c.has_coupon_holds AND c.holds_have_columns AND c.holds_accept_points_source AND c.has_coupon_holds_guard
      AND c.has_point_accounts AND c.has_point_entries AND c.has_reward_claims
      AND c.ledger_accepts_coupon_exchange_key AND c.has_point_account_guard
      AND c.has_coupon_seller_name AND c.has_coupon_hold_expiry
      AND c.has_seller_coupon_json AND c.has_member_coupon_hold_json
      AND c.points_mall_function_exists
      AND NOT c.offer_table_exists AND NOT c.offer_functions_exist
    THEN '可以套用 20261029210000_seller_coupon_point_offers_apply.sql'
    WHEN c.offer_table_exists AND c.offer_functions_exist
    THEN '已套用過，不要重跑'
    ELSE '先不要套用。看同一列哪個條件不符合'
  END AS apply_gate
FROM (
  SELECT
    to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid,
    to_regprocedure('public.taipei_today(timestamptz)') IS NOT NULL AS has_taipei_today,
    to_regprocedure('public.is_approved_seller()') IS NOT NULL AS has_is_approved_seller,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'seller_applications' AND column_name IN ('user_id', 'status')
      GROUP BY table_name HAVING count(*) = 2
    ) AS has_seller_applications_status,
    to_regclass('public.seller_coupons') IS NOT NULL AS has_seller_coupons,
    (
      SELECT count(*) = 12 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'seller_coupons'
        AND column_name IN ('id', 'seller_id', 'code', 'name', 'qty', 'issued_count', 'active', 'start_on', 'end_on', 'deleted_at', 'min_spend', 'kind')
    ) AS coupons_have_columns,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname = 'seller_coupons_guard'
        AND tgrelid = to_regclass('public.seller_coupons')
    ) AS has_seller_coupons_guard,
    to_regclass('public.member_coupon_holds') IS NOT NULL AS has_coupon_holds,
    (
      SELECT count(*) = 6 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_coupon_holds'
        AND column_name IN ('user_id', 'coupon_id', 'seller_id', 'source', 'request_key', 'expires_on')
    ) AS holds_have_columns,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.member_coupon_holds')
        AND conname = 'member_coupon_holds_link_check'
        AND pg_get_constraintdef(oid) LIKE '%points:%'
    ) AS holds_accept_points_source,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname = 'member_coupon_holds_guard'
        AND tgrelid = to_regclass('public.member_coupon_holds')
    ) AS has_coupon_holds_guard,
    to_regclass('public.member_point_accounts') IS NOT NULL AS has_point_accounts,
    to_regclass('public.member_point_entries') IS NOT NULL AS has_point_entries,
    to_regclass('public.reward_claims') IS NOT NULL AS has_reward_claims,
    (
      SELECT count(*) = 2 FROM pg_constraint
      WHERE conrelid IN (to_regclass('public.member_point_entries'), to_regclass('public.reward_claims'))
        AND conname IN ('member_point_entries_key_shape', 'reward_claims_key_shape')
        AND pg_get_constraintdef(oid) LIKE '%coupon_exchange:[A-Za-z0-9:_-]{1,120}%'
    ) AS ledger_accepts_coupon_exchange_key,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname = 'member_point_accounts_guard'
        AND tgrelid = to_regclass('public.member_point_accounts')
    ) AS has_point_account_guard,
    to_regprocedure('public.coupon_seller_name(uuid)') IS NOT NULL AS has_coupon_seller_name,
    to_regprocedure('public.coupon_hold_expiry(date, date)') IS NOT NULL AS has_coupon_hold_expiry,
    to_regprocedure('public.seller_coupon_json(public.seller_coupons)') IS NOT NULL AS has_seller_coupon_json,
    to_regprocedure('public.member_coupon_hold_json(public.member_coupon_holds)') IS NOT NULL AS has_member_coupon_hold_json,
    to_regprocedure('public.get_my_points_mall()') IS NOT NULL AS points_mall_function_exists,
    to_regclass('public.seller_coupon_point_offers') IS NOT NULL AS offer_table_exists,
    (
      to_regprocedure('public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date)') IS NOT NULL
      OR to_regprocedure('public.list_my_coupon_point_offers()') IS NOT NULL
      OR to_regprocedure('public.list_point_offer_coupons()') IS NOT NULL
      OR to_regprocedure('public.exchange_my_point_offer(uuid, integer)') IS NOT NULL
    ) AS offer_functions_exist,
    EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'pgrst_ddl_watch') AS pgrst_ddl_watch_present
) AS c;

ROLLBACK;
