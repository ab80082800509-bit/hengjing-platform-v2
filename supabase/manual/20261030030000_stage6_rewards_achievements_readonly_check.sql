-- =============================================================================
-- 第七階段第 9 批：第六階段遊戲獎勵與成就（正式安全版）唯讀預檢。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不改任何資料。
-- 只回傳一列：apply_gate、結構檢查 checks、既有資料基準 baseline。
-- apply_gate 顯示可以套用時，再執行 20261030030010_stage6_rewards_achievements_apply.sql。
-- 套用後再跑一次本檔：baseline 的會員、點數、流水、Inventory、優惠券、遊戲存檔數字必須與套用前相同
-- （套用期間若有會員正常使用網站，數字可能因正常交易增加，但不會因本次套用減少）。
--
-- 不要執行 20261026160000_stage6_rewards_achievements_preview.sql 原檔：
--   它會把 get_my_points_mall 重建回 v1（若商城 v2 已套用會被蓋掉）、解除 10/10/80 額度鎖、
--   預設開啟合成小舖任務，並在守門觸發器留下刪除後門。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

WITH c AS (
  SELECT
    to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid,
    to_regprocedure('public.taipei_today(timestamptz)') IS NOT NULL AS has_taipei_today,
    to_regprocedure('gen_random_uuid()') IS NOT NULL AS has_gen_random_uuid,
    to_regprocedure('hashtextextended(text, bigint)') IS NOT NULL AS has_hashtextextended,

    -- 第六階段第一批（合成小舖）
    to_regclass('public.member_merge_shops') IS NOT NULL AS has_merge_shops,
    (
      SELECT count(*) = 4 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_merge_shops'
        AND column_name IN ('user_id', 'shop_level', 'catalog', 'lifetime_orders')
    ) AS merge_shops_have_columns,
    to_regclass('public.member_merge_shop_events') IS NOT NULL AS has_merge_shop_events,
    (
      SELECT count(*) = 3 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_merge_shop_events'
        AND column_name IN ('user_id', 'action_type', 'created_at')
    ) AS merge_events_have_columns,
    to_regclass('public.game_reward_policies') IS NOT NULL AS has_reward_policies,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_reward_policies')
        AND conname = 'game_reward_payout_closed'
        AND pg_get_constraintdef(oid) LIKE '%payout_enabled = false%'
    ) AS payout_lock_constraint,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_reward_policies')
        AND conname = 'game_reward_caps_pending'
    ) AS caps_pending_constraint,
    CASE WHEN to_regclass('public.game_reward_policies') IS NULL THEN false ELSE coalesce((xpath('/row/ok/text()', query_to_xml(
      'SELECT (payout_enabled = false AND scratch_excluded AND approval = ''pending_approval'') AS ok FROM public.game_reward_policies WHERE id = ''stage6''',
      false, true, '')))[1]::text = 'true', false) END AS policy_stage6_closed,

    -- 第五階段（preview 前置檢查要求的物件）
    to_regclass('public.member_perk_settings') IS NOT NULL AS has_perk_settings,
    to_regclass('public.seller_coupons') IS NOT NULL AS has_seller_coupons,
    to_regclass('public.member_coupon_holds') IS NOT NULL AS has_coupon_holds,
    to_regclass('public.member_point_accounts') IS NOT NULL AS has_point_accounts,

    -- 本次要新增的物件：全部不存在才可套用
    (
      (to_regclass('public.game_reward_tasks') IS NOT NULL)::int
      + (to_regclass('public.member_game_reward_claims') IS NOT NULL)::int
      + (to_regclass('public.game_achievement_catalog') IS NOT NULL)::int
      + (to_regclass('public.member_game_achievements') IS NOT NULL)::int
      + (to_regclass('public.member_game_showcase') IS NOT NULL)::int
      + (to_regprocedure('public.game_reward_period(text, timestamp with time zone)') IS NOT NULL)::int
      + (to_regprocedure('public.game_reward_metric(uuid, text, timestamp with time zone, timestamp with time zone)') IS NOT NULL)::int
      + (to_regprocedure('public.game_reward_state_json(uuid)') IS NOT NULL)::int
      + (to_regprocedure('public.get_game_reward_rules()') IS NOT NULL)::int
      + (to_regprocedure('public.get_my_game_rewards()') IS NOT NULL)::int
      + (to_regprocedure('public.claim_my_game_reward(text)') IS NOT NULL)::int
      + (to_regprocedure('public.game_achievement_metric(uuid, text)') IS NOT NULL)::int
      + (to_regprocedure('public.game_achievement_state_json(uuid, jsonb)') IS NOT NULL)::int
      + (to_regprocedure('public.sync_my_game_achievements()') IS NOT NULL)::int
      + (to_regprocedure('public.set_my_game_badge(text)') IS NOT NULL)::int
      + (to_regprocedure('public.public_game_badges(uuid[])') IS NOT NULL)::int
    ) AS stage6_objects_present,

    -- 點數商城現況（本次不會改動，只記錄）
    to_regprocedure('public.get_my_points_mall()') IS NOT NULL AS points_mall_exists,
    CASE
      WHEN to_regprocedure('public.get_my_points_mall()') IS NULL THEN 'missing'
      WHEN position('catalogVersion' IN pg_get_functiondef(to_regprocedure('public.get_my_points_mall()'))) > 0 THEN 'v2'
      ELSE 'v1'
    END AS points_mall_version,
    md5(pg_get_functiondef(to_regprocedure('public.get_my_points_mall()'))) AS points_mall_def_md5,
    has_function_privilege('authenticated', to_regprocedure('public.get_my_points_mall()'), 'EXECUTE') AS points_mall_authenticated_exec,
    has_function_privilege('anon', to_regprocedure('public.get_my_points_mall()'), 'EXECUTE') AS points_mall_anon_exec,
    to_regclass('public.seller_coupon_point_offers') IS NOT NULL AS seller_point_offers_installed,
    to_regprocedure('public.list_point_offer_coupons()') IS NOT NULL AS seller_point_offer_list_installed,

    EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname = 'pgrst_ddl_watch') AS pgrst_ddl_watch_present
),
b AS (
  SELECT
    (SELECT count(*) FROM auth.users) AS auth_users,
    CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_point_accounts', false, true, '')))[1]::text::bigint END AS point_accounts,
    CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT coalesce(sum(balance), 0) AS n FROM public.member_point_accounts', false, true, '')))[1]::text::bigint END AS point_balance_total,
    CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_point_entries', false, true, '')))[1]::text::bigint END AS point_entries,
    CASE WHEN to_regclass('public.reward_claims') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.reward_claims', false, true, '')))[1]::text::bigint END AS reward_claims,
    CASE WHEN to_regclass('public.member_perk_holds') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_perk_holds', false, true, '')))[1]::text::bigint END AS perk_holds,
    CASE WHEN to_regclass('public.member_perk_loadout') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_perk_loadout', false, true, '')))[1]::text::bigint END AS perk_loadout,
    CASE WHEN to_regclass('public.member_coupon_holds') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_coupon_holds', false, true, '')))[1]::text::bigint END AS coupon_holds,
    CASE WHEN to_regclass('public.seller_coupons') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.seller_coupons', false, true, '')))[1]::text::bigint END AS seller_coupons,
    CASE WHEN to_regclass('public.seller_coupon_point_offers') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.seller_coupon_point_offers', false, true, '')))[1]::text::bigint END AS seller_point_offers,
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_merge_shops', false, true, '')))[1]::text::bigint END AS merge_shop_saves,
    CASE WHEN to_regclass('public.member_merge_shop_events') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_merge_shop_events', false, true, '')))[1]::text::bigint END AS merge_shop_events,
    CASE WHEN to_regclass('public.member_street_saves') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_street_saves', false, true, '')))[1]::text::bigint END AS street_saves,
    CASE WHEN to_regclass('public.block_ranked_runs') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.block_ranked_runs', false, true, '')))[1]::text::bigint END AS block_ranked_runs,
    CASE WHEN to_regclass('public.member_perk_settings') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml('SELECT purchase_enabled AS v FROM public.member_perk_settings WHERE id = true', false, true, '')))[1]::text END AS perk_purchase_enabled,
    CASE WHEN to_regclass('public.commerce_settings') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml('SELECT checkout_enabled AS v FROM public.commerce_settings WHERE id = true', false, true, '')))[1]::text END AS checkout_enabled
)
SELECT
  CASE
    WHEN c.stage6_objects_present = 16 THEN '已套用過，不要重跑'
    WHEN c.stage6_objects_present > 0 THEN '先不要套用：第六階段物件只存在一部分（' || c.stage6_objects_present || '/16），請回報'
    WHEN c.has_auth_uid AND c.has_taipei_today AND c.has_gen_random_uuid AND c.has_hashtextextended
      AND c.has_merge_shops AND c.merge_shops_have_columns
      AND c.has_merge_shop_events AND c.merge_events_have_columns
      AND c.has_reward_policies AND c.payout_lock_constraint AND c.policy_stage6_closed
      AND c.has_perk_settings AND c.has_seller_coupons AND c.has_coupon_holds AND c.has_point_accounts
      AND c.points_mall_exists
    THEN '可以套用 20261030030010_stage6_rewards_achievements_apply.sql'
    ELSE '先不要套用。看 checks 哪個條件是 false'
  END AS apply_gate,
  to_jsonb(c) AS checks,
  to_jsonb(b) AS baseline
FROM c, b;

ROLLBACK;
