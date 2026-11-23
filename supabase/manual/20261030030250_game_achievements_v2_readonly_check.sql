-- =============================================================================
-- 第七階段第 9 批：三款遊戲成就整合（成就 v2）唯讀預檢。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不改任何資料。
-- 只回傳一列：apply_gate、結構檢查 checks、既有資料基準 baseline。
-- 第六階段成就物件沿用現有正式資料庫，不要重跑第六階段任何 SQL。
-- apply_gate 顯示可以套用時，再執行 20261030030300_game_achievements_v2_apply.sql。
-- 套用後再跑一次本檔：apply_gate 應顯示「已套用過」，baseline 的已解鎖成就與展示勳章數字不得減少。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

WITH v AS (
  SELECT ARRAY[
    'merge_level_six', 'merge_fruit_master', 'merge_codex_twenty',
    'street_first_guest', 'street_regulars', 'street_famous', 'street_level_three', 'street_flagship',
    'street_full_street', 'street_decorator', 'street_decor_all', 'street_earned_10k',
    'block_ranked_first', 'block_ranked_ten', 'block_score_3k', 'block_score_8k'
  ]::text[] AS v2_ids
),
c AS (
  SELECT
    -- 成就 v2 前置檢查要求的第六階段物件
    to_regclass('public.game_achievement_catalog') IS NOT NULL AS has_catalog,
    to_regclass('public.member_game_achievements') IS NOT NULL AS has_member_achievements,
    to_regclass('public.member_game_showcase') IS NOT NULL AS has_showcase,
    to_regprocedure('public.sync_my_game_achievements()') IS NOT NULL AS has_sync,
    to_regprocedure('public.game_achievement_metric(uuid, text)') IS NOT NULL AS has_metric,
    to_regprocedure('public.game_achievement_state_json(uuid, jsonb)') IS NOT NULL AS has_state_json,

    -- 成就目錄：欄位、ON CONFLICT (id) 需要的唯一鍵、新增 16 項需要通過的 CHECK
    (
      SELECT count(*) = 7 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'game_achievement_catalog'
        AND column_name IN ('id', 'game_id', 'metric', 'target', 'tier', 'sort', 'active')
    ) AS catalog_has_columns,
    EXISTS (
      SELECT 1 FROM pg_index AS i
      JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = to_regclass('public.game_achievement_catalog')
        AND i.indisunique AND i.indnkeyatts = 1 AND a.attname = 'id'
    ) AS catalog_id_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_achievement_catalog') AND contype = 'c'
        AND conname = 'game_achievement_catalog_game_check'
        AND pg_get_constraintdef(oid) LIKE '%merge_shop%'
        AND pg_get_constraintdef(oid) LIKE '%dream_street%'
        AND pg_get_constraintdef(oid) LIKE '%block_challenge%'
    ) AS catalog_game_check_ok,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_achievement_catalog') AND contype = 'c'
        AND conname = 'game_achievement_catalog_metric_check'
        AND position('^[a-z_]+\.[a-z_]+(:[a-z]+-[1-5])?$' IN pg_get_constraintdef(oid)) > 0
    ) AS catalog_metric_check_ok,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_achievement_catalog') AND contype = 'c'
        AND conname = 'game_achievement_catalog_target_check'
        AND pg_get_constraintdef(oid) LIKE '%100000%'
    ) AS catalog_target_check_ok,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_achievement_catalog') AND contype = 'c'
        AND conname = 'game_achievement_catalog_tier_check'
        AND pg_get_constraintdef(oid) LIKE '%legend%'
    ) AS catalog_tier_check_ok,
    (
      SELECT count(*) FROM pg_constraint
      WHERE conrelid = to_regclass('public.game_achievement_catalog') AND contype = 'c'
    ) AS catalog_check_count,

    -- 套用者權限：要能 CREATE OR REPLACE 成就函式、寫入成就目錄
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
    coalesce((
      SELECT bool_and(pg_has_role(current_user, p.proowner, 'MEMBER')) FROM pg_proc AS p
      WHERE p.oid IN (
        to_regprocedure('public.game_achievement_metric(uuid, text)'),
        to_regprocedure('public.game_achievement_state_json(uuid, jsonb)'),
        to_regprocedure('public.game_achievement_available(text)')
      )
    ), false) AS can_replace_functions,
    coalesce((
      SELECT pg_has_role(current_user, cl.relowner, 'MEMBER') AND NOT cl.relforcerowsecurity
      FROM pg_class AS cl WHERE cl.oid = to_regclass('public.game_achievement_catalog')
    ), false) AS catalog_insertable,

    -- 同步流程必須經過 metric 與 state_json，v2 換掉這兩個函式後才會生效
    coalesce(
      position('game_achievement_metric' IN pg_get_functiondef(to_regprocedure('public.sync_my_game_achievements()'))) > 0
      AND position('game_achievement_state_json' IN pg_get_functiondef(to_regprocedure('public.sync_my_game_achievements()'))) > 0,
      false
    ) AS sync_uses_metric_and_state,

    -- 成就守門：觸發器開著、沒有 preview 原檔留下的刪除後門
    (
      SELECT count(*) = 2 FROM pg_trigger
      WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND tgname IN ('member_game_achievements_guard', 'member_game_showcase_guard')
    ) AS achievement_guards_on,
    coalesce(position('reward_cleanup' IN pg_get_functiondef(to_regprocedure('public.guard_game_achievement_write()'))) = 0, false) AS guard_has_no_backdoor,

    -- 權限：內部函式不開放、同步只給登入會員
    NOT coalesce(has_function_privilege('authenticated', to_regprocedure('public.game_achievement_metric(uuid, text)'), 'EXECUTE'), true) AS metric_not_exposed,
    NOT coalesce(has_function_privilege('authenticated', to_regprocedure('public.game_achievement_state_json(uuid, jsonb)'), 'EXECUTE'), true) AS state_json_not_exposed,
    NOT coalesce(has_function_privilege('anon', to_regprocedure('public.sync_my_game_achievements()'), 'EXECUTE'), true) AS sync_not_anon,
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.sync_my_game_achievements()'), 'EXECUTE'), false) AS sync_authenticated_exec,

    -- 合成小舖資料來源（v2 metric 用 %ROWTYPE 直接讀，必須存在）
    (
      SELECT count(*) = 4 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_merge_shops'
        AND column_name IN ('user_id', 'lifetime_orders', 'shop_level', 'catalog')
    ) AS merge_shops_ok,
    (
      SELECT count(*) = 2 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_merge_shop_events'
        AND column_name IN ('user_id', 'action_type')
    ) AS merge_events_ok,

    -- 商店街、方塊資料來源（可以還沒套用；已存在就必須有 v2 讀的欄位）
    to_regclass('public.member_street_saves') IS NOT NULL AS street_saves_installed,
    (
      SELECT count(*) = 3 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_street_saves'
        AND ((column_name = 'progress' AND data_type = 'jsonb') OR column_name IN ('user_id', 'shop_level'))
    ) AS street_saves_columns_ok,
    to_regclass('public.block_ranked_runs') IS NOT NULL AS block_runs_installed,
    (
      SELECT count(*) = 3 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'block_ranked_runs'
        AND column_name IN ('user_id', 'status', 'score')
    ) AS block_runs_columns_ok,

    -- 成就 v2 是否已套用
    to_regprocedure('public.game_achievement_available(text)') IS NOT NULL AS v2_available_fn,
    coalesce(position('catalogVersion' IN pg_get_functiondef(to_regprocedure('public.game_achievement_state_json(uuid, jsonb)'))) > 0, false) AS v2_state_json,
    coalesce(position('street.%' IN pg_get_functiondef(to_regprocedure('public.game_achievement_metric(uuid, text)'))) > 0, false) AS v2_metric,
    CASE WHEN to_regclass('public.game_achievement_catalog') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml(
      format('SELECT count(*) AS n FROM public.game_achievement_catalog WHERE id = ANY (%L::text[])', (SELECT v2_ids FROM v)),
      false, true, '')))[1]::text::int END AS v2_ids_present,
    CASE WHEN to_regclass('public.game_achievement_catalog') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml(
      format('SELECT count(*) AS n FROM public.game_achievement_catalog WHERE active AND id <> ALL (%L::text[])', (SELECT v2_ids FROM v)),
      false, true, '')))[1]::text::int END AS legacy_active,

    -- 建議順序參考（不擋套用）：合成小舖 v2 已套用時，水果線與 Lv.6 成就才拿得到
    coalesce(position('fruit' IN pg_get_functiondef(to_regprocedure('public.merge_item_ok(text)'))) > 0, false) AS merge_v2_applied,
    CASE
      WHEN to_regprocedure('public.get_my_points_mall()') IS NULL THEN 'missing'
      WHEN position('catalogVersion' IN pg_get_functiondef(to_regprocedure('public.get_my_points_mall()'))) > 0 THEN 'v2'
      ELSE 'v1'
    END AS points_mall_version
),
b AS (
  SELECT
    CASE WHEN to_regclass('public.game_achievement_catalog') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.game_achievement_catalog', false, true, '')))[1]::text::bigint END AS catalog_rows,
    CASE WHEN to_regclass('public.member_game_achievements') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_game_achievements', false, true, '')))[1]::text::bigint END AS unlocked_achievements,
    CASE WHEN to_regclass('public.member_game_achievements') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(DISTINCT user_id) AS n FROM public.member_game_achievements', false, true, '')))[1]::text::bigint END AS members_with_achievements,
    CASE WHEN to_regclass('public.member_game_showcase') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_game_showcase', false, true, '')))[1]::text::bigint END AS showcase_rows,
    CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT coalesce(sum(balance), 0) AS n FROM public.member_point_accounts', false, true, '')))[1]::text::bigint END AS point_balance_total,
    CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN NULL ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_point_entries', false, true, '')))[1]::text::bigint END AS point_entries
)
SELECT
  CASE
    WHEN c.v2_available_fn AND c.v2_state_json AND c.v2_metric AND c.v2_ids_present = 16 THEN '成就 v2 已套用過，不要重跑'
    WHEN c.v2_available_fn OR c.v2_state_json OR c.v2_metric OR coalesce(c.v2_ids_present, 0) > 0
      THEN '先不要套用：成就 v2 只存在一部分，請回報'
    WHEN NOT c.guard_has_no_backdoor THEN '先不要套用：成就守門函式含 preview 刪除後門，請回報'
    WHEN c.has_catalog AND c.has_member_achievements AND c.has_showcase
      AND c.has_sync AND c.has_metric AND c.has_state_json
      AND c.catalog_has_columns AND c.catalog_id_unique
      AND c.catalog_game_check_ok AND c.catalog_metric_check_ok AND c.catalog_target_check_ok AND c.catalog_tier_check_ok
      AND c.catalog_check_count = 5
      AND c.can_create_in_public AND c.can_replace_functions AND c.catalog_insertable
      AND c.sync_uses_metric_and_state AND c.achievement_guards_on
      AND c.metric_not_exposed AND c.state_json_not_exposed AND c.sync_not_anon AND c.sync_authenticated_exec
      AND c.merge_shops_ok AND c.merge_events_ok
      AND (NOT c.street_saves_installed OR c.street_saves_columns_ok)
      AND (NOT c.block_runs_installed OR c.block_runs_columns_ok)
      AND c.legacy_active >= 11
    THEN '可以套用 20261030030300_game_achievements_v2_apply.sql'
    ELSE '先不要套用。看 checks 哪個條件是 false'
  END AS apply_gate,
  to_jsonb(c) AS checks,
  to_jsonb(b) AS baseline
FROM c, b;

ROLLBACK;
