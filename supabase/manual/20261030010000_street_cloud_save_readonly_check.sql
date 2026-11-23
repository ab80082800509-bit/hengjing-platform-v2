-- =============================================================================
-- 第七階段第 9 批（夢想商店街雲端存檔）：正式套用前後的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不寫入任何資料。
-- 不讀會員內容、Email、暱稱、點數餘額或存檔內容，只回傳結構、權限是否符合，以及相關資料表的列數。
--
-- 使用順序：
--   1. 執行本檔。batch9_gate 顯示可以套用時，執行 20261030010100_street_cloud_save_apply.sql。
--   2. 再執行本檔。batch9_gate 應顯示已套用，existing_row_counts 中既有資料表列數不變
--      （會員在兩次執行之間自然互助、偷貨，列數會自然增加，這不代表本批改了資料）。
--      新增的 member_street_saves 等表剛套用時應為 0 列，會員進遊戲後才會逐步建立。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN NOT (c.batch6_ready AND c.batch7_ready)
    THEN '要先完成第 6、7 批'
    WHEN c.claim_columns <> 8
    THEN '第 6、7 批領取紀錄欄位與雲端存檔不相容，先停下來回報這一列'
    WHEN NOT c.batch9_tables_any AND NOT c.batch9_functions_any
    THEN '可以套用 20261030010100_street_cloud_save_apply.sql'
    WHEN c.batch9_tables_all AND c.batch9_rls_all AND NOT c.member_table_access
      AND c.member_functions_ok AND NOT c.member_functions_anon AND c.member_functions_authenticated
      AND NOT c.internal_functions_open
    THEN '已套用，結構與權限正確，不要重跑'
    ELSE '第 9 批物件存在但設定不符，先停下來回報這一列'
  END AS batch9_gate,
  (
    SELECT jsonb_object_agg(t.rel, CASE WHEN to_regclass(t.rel) IS NOT NULL
      THEN (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', t.rel), false, true, '')))[1]::text::bigint
    END)
    FROM unnest(ARRAY[
      'auth.users',
      'public.member_point_accounts',
      'public.member_point_entries',
      'public.reward_claims',
      'public.member_street_exhibits',
      'public.member_street_helps',
      'public.member_street_help_claims',
      'public.member_street_steals',
      'public.member_street_steal_claims',
      'public.member_street_saves',
      'public.member_street_save_credits',
      'public.member_street_save_log'
    ]) AS t(rel)
  ) AS existing_row_counts,
  CASE WHEN to_regclass('public.member_street_saves') IS NOT NULL THEN (
    SELECT jsonb_build_object(
      'browser', (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_street_saves WHERE import_source = ''browser''', false, true, '')))[1]::text::bigint,
      'fresh', (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_street_saves WHERE import_source = ''fresh''', false, true, '')))[1]::text::bigint,
      'adjusted', (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_street_saves WHERE import_adjusted', false, true, '')))[1]::text::bigint
    )
  ) END AS save_import_counts
FROM (
  SELECT
    current_user AS run_as,
    (
      to_regclass('public.member_street_help_claims') IS NOT NULL
      AND to_regprocedure('public.claim_my_street_help_rewards(uuid)') IS NOT NULL
    ) AS batch6_ready,
    (
      to_regclass('public.member_street_steal_claims') IS NOT NULL
      AND to_regprocedure('public.claim_my_street_steal_rewards(uuid)') IS NOT NULL
    ) AS batch7_ready,
    (
      SELECT count(*)::integer FROM information_schema.columns AS col
      WHERE col.table_schema = 'public'
        AND col.table_name IN ('member_street_help_claims', 'member_street_steal_claims')
        AND col.column_name IN ('user_id', 'claim_key', 'coins', 'xp')
    ) AS claim_columns,
    (
      to_regclass('public.street_cloud_settings') IS NOT NULL
      OR to_regclass('public.member_street_saves') IS NOT NULL
      OR to_regclass('public.member_street_save_credits') IS NOT NULL
      OR to_regclass('public.member_street_save_log') IS NOT NULL
    ) AS batch9_tables_any,
    (
      to_regclass('public.street_cloud_settings') IS NOT NULL
      AND to_regclass('public.member_street_saves') IS NOT NULL
      AND to_regclass('public.member_street_save_credits') IS NOT NULL
      AND to_regclass('public.member_street_save_log') IS NOT NULL
    ) AS batch9_tables_all,
    (
      SELECT count(*) = 4 FROM pg_class
      WHERE oid IN (
        to_regclass('public.street_cloud_settings'), to_regclass('public.member_street_saves'),
        to_regclass('public.member_street_save_credits'), to_regclass('public.member_street_save_log')
      ) AND relrowsecurity
    ) AS batch9_rls_all,
    (
      SELECT coalesce(bool_or(
        has_table_privilege(r.role, t.rel, 'SELECT') OR has_table_privilege(r.role, t.rel, 'INSERT')
        OR has_table_privilege(r.role, t.rel, 'UPDATE') OR has_table_privilege(r.role, t.rel, 'DELETE')
      ), false)
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY[
        'public.street_cloud_settings', 'public.member_street_saves',
        'public.member_street_save_credits', 'public.member_street_save_log'
      ]) AS t(rel)
      WHERE to_regclass(t.rel) IS NOT NULL
    ) AS member_table_access,
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
        'street_cloud_spec', 'street_cloud_int', 'street_cloud_ids', 'street_cloud_rank', 'street_cloud_build',
        'street_cloud_row_json', 'get_my_street_save', 'import_my_street_save', 'save_my_street'
      ])
    ) AS batch9_functions_any,
    (
      SELECT count(*) = 3 FROM pg_proc p
      WHERE p.oid IN (
        to_regprocedure('public.get_my_street_save()'),
        to_regprocedure('public.import_my_street_save(jsonb, uuid)'),
        to_regprocedure('public.save_my_street(bigint, jsonb, uuid)')
      ) AND p.prosecdef AND 'search_path=pg_catalog' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    ) AS member_functions_ok,
    (
      SELECT coalesce(bool_or(has_function_privilege('anon', f.oid, 'EXECUTE')), false)
      FROM unnest(ARRAY[
        to_regprocedure('public.get_my_street_save()'),
        to_regprocedure('public.import_my_street_save(jsonb, uuid)'),
        to_regprocedure('public.save_my_street(bigint, jsonb, uuid)')
      ]) AS f(oid) WHERE f.oid IS NOT NULL
    ) AS member_functions_anon,
    (
      SELECT count(*) = 3 AND bool_and(has_function_privilege('authenticated', f.oid, 'EXECUTE'))
      FROM unnest(ARRAY[
        to_regprocedure('public.get_my_street_save()'),
        to_regprocedure('public.import_my_street_save(jsonb, uuid)'),
        to_regprocedure('public.save_my_street(bigint, jsonb, uuid)')
      ]) AS f(oid) WHERE f.oid IS NOT NULL
    ) AS member_functions_authenticated,
    (
      SELECT coalesce(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')), false)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
        'street_cloud_spec', 'street_cloud_int', 'street_cloud_ids', 'street_cloud_rank', 'street_cloud_build', 'street_cloud_row_json'
      ])
    ) AS internal_functions_open
) AS c;

ROLLBACK;
