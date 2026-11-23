-- =============================================================================
-- 特權商城最小修復：只建立唯讀總覽 get_my_points_mall()。
-- 函式內容與 20261026160000_stage6_rewards_achievements_preview.sql 第三批完全相同，
-- 之後若整份套用第六階段，CREATE OR REPLACE 會得到同一版本。
--
-- 需要先套用 supabase/migrations/20261024230000_member_perk_inventory.sql。
-- 不新增商品、優惠券或兌換交易；不扣點、不寫帳本；不改 member_perk_settings.purchase_enabled。
-- 兌換仍走 purchase_my_perk / exchange_my_coupon，由後端驗證開關與點數。
-- =============================================================================

BEGIN;

DO $require_points_mall$
BEGIN
  IF to_regclass('public.member_perk_settings') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL
     OR to_regclass('public.seller_coupons') IS NULL
     OR to_regclass('public.member_coupon_holds') IS NULL
     OR to_regprocedure('public.seller_coupon_json(public.seller_coupons)') IS NULL
     OR to_regprocedure('public.coupon_seller_name(uuid)') IS NULL
     OR to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '需要先套用第四、五階段';
  END IF;
  IF to_regprocedure('public.get_my_points_mall()') IS NOT NULL THEN
    RAISE EXCEPTION '點數商城總覽已存在，本檔不覆蓋';
  END IF;
END
$require_points_mall$;

CREATE OR REPLACE FUNCTION public.get_my_points_mall()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  bal integer := 0;
  perk_open boolean := false;
  coupons jsonb;
  held integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT balance INTO bal FROM public.member_point_accounts WHERE user_id = uid;
  bal := coalesce(bal, 0);
  SELECT settings.purchase_enabled INTO perk_open FROM public.member_perk_settings AS settings WHERE settings.id = true;
  SELECT coalesce(jsonb_agg(item.data ORDER BY item.created_at DESC), '[]'::jsonb)
  INTO coupons
  FROM (
    SELECT
      public.seller_coupon_json(coupon) || jsonb_build_object(
        'sellerName', public.coupon_seller_name(coupon.seller_id),
        'held', EXISTS (
          SELECT 1 FROM public.member_coupon_holds AS hold
          WHERE hold.user_id = uid AND hold.coupon_id = coupon.id
        )
      ) AS data,
      coupon.created_at
    FROM public.seller_coupons AS coupon
    WHERE coupon.game_pool
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.start_on <= day
      AND coupon.end_on >= day
      AND coupon.issued_count < coupon.qty
    ORDER BY coupon.created_at DESC
    LIMIT 60
  ) AS item;
  SELECT count(*)::integer INTO held
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = uid AND hold.source = 'points';
  RETURN jsonb_build_object(
    'balance', bal,
    'perkPurchaseEnabled', coalesce(perk_open, false),
    'couponExchangeCost', 100,
    'coupons', coupons,
    'pointsCouponCount', held,
    'benefitsOpen', false,
    'taipeiDay', day
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_points_mall() IS
  '點數商城唯讀總覽。沿用虛擬特權開關與既有遊戲曝光券，兌換仍走 purchase_my_perk / exchange_my_coupon。不扣點。';

REVOKE ALL ON FUNCTION public.get_my_points_mall() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_points_mall() TO authenticated;

DO $revoke_mall_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.get_my_points_mall() FROM service_role;
  END IF;
END
$revoke_mall_service$;

DO $points_mall_self_check$
DECLARE
  mall_def text := pg_get_functiondef('public.get_my_points_mall()'::regprocedure);
BEGIN
  IF position('INSERT' IN mall_def) > 0 OR position('UPDATE' IN mall_def) > 0 OR position('DELETE' IN mall_def) > 0 THEN
    RAISE EXCEPTION '點數商城總覽只能讀取';
  END IF;
  IF has_function_privilege('anon', 'public.get_my_points_mall()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_points_mall()', 'EXECUTE') THEN
    RAISE EXCEPTION '點數商城總覽權限不正確';
  END IF;
END
$points_mall_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
