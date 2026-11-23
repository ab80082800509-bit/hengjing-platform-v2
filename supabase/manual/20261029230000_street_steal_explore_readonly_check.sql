-- =============================================================================
-- 第七階段第 7 批（全民趣味偷貨、探索商店街）：正式套用前後的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不寫入任何資料。
-- 不讀會員內容、Email、點數餘額或存檔，只回傳結構、權限是否符合，以及既有資料表的列數。
--
-- 使用順序：
--   1. 執行本檔。batch7_gate 顯示可以套用時，執行 20261029230100_street_steal_explore_apply.sql。
--   2. 再執行本檔。batch7_gate 應顯示已套用。
--   兩次都把 existing_row_counts 記下來比對；第 7 批不應改變任何一列既有資料。
--   （會員在兩次執行之間自然註冊、按讚、拜訪或互助，列數會自然增加，這不代表本批改了資料。）
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN NOT (c.batch5_ready AND c.batch6_ready)
    THEN '要先完成第 5、6 批'
    WHEN NOT c.batch7_tables_any AND NOT c.batch7_functions_any AND c.has_gen_random_uuid
    THEN '可以套用 20261029230100_street_steal_explore_apply.sql'
    WHEN c.batch7_tables_all AND c.batch7_functions_all AND c.batch7_guards_all
      AND c.batch7_rls_all AND NOT c.batch7_direct_access AND NOT c.batch7_anon_execute
      AND c.steal_settings_rows = 1
    THEN '已套用，結構與權限正確，不要重跑'
    ELSE '第 7 批只套用一部分或權限不符，先停下來回報這一列'
  END AS batch7_gate,
  (
    SELECT jsonb_object_agg(t.rel, CASE WHEN to_regclass(t.rel) IS NOT NULL
      THEN (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', t.rel), false, true, '')))[1]::text::bigint
    END)
    FROM unnest(ARRAY[
      'auth.users',
      'public.profiles',
      'public.member_point_accounts',
      'public.member_point_entries',
      'public.reward_claims',
      'public.member_street_exhibits',
      'public.member_street_likes',
      'public.member_street_visits',
      'public.member_street_friends',
      'public.member_street_friend_requests',
      'public.member_street_helps',
      'public.member_street_help_claims'
    ]) AS t(rel)
  ) AS existing_row_counts
FROM (
  SELECT
    current_user AS run_as,
    to_regprocedure('gen_random_uuid()') IS NOT NULL AS has_gen_random_uuid,
    (
      to_regclass('public.member_street_exhibits') IS NOT NULL
      AND to_regprocedure('public.street_taipei_day(timestamptz)') IS NOT NULL
      AND to_regprocedure('public.street_public_identity(uuid)') IS NOT NULL
      AND to_regprocedure('public.street_social_counts(uuid)') IS NOT NULL
    ) AS batch5_ready,
    (
      to_regclass('public.member_street_friends') IS NOT NULL
      AND to_regprocedure('public.street_friend_status(uuid, uuid)') IS NOT NULL
      AND to_regprocedure('public.request_street_friend(uuid)') IS NOT NULL
      AND to_regprocedure('public.respond_street_friend(uuid, boolean)') IS NOT NULL
      AND to_regprocedure('public.help_street_friend(uuid, uuid)') IS NOT NULL
    ) AS batch6_ready,
    (
      to_regclass('public.street_steal_settings') IS NOT NULL
      OR to_regclass('public.member_street_steal_prefs') IS NOT NULL
      OR to_regclass('public.member_street_steals') IS NOT NULL
      OR to_regclass('public.member_street_steal_claims') IS NOT NULL
    ) AS batch7_tables_any,
    (
      to_regclass('public.street_steal_settings') IS NOT NULL
      AND to_regclass('public.member_street_steal_prefs') IS NOT NULL
      AND to_regclass('public.member_street_steals') IS NOT NULL
      AND to_regclass('public.member_street_steal_claims') IS NOT NULL
    ) AS batch7_tables_all,
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
        'guard_street_steal_write', 'street_steal_allowed', 'street_steal_status_json',
        'get_my_street_steal', 'set_my_street_steal', 'get_street_steal_target',
        'steal_street_goods', 'claim_my_street_steal_rewards', 'explore_public_streets'
      ])
    ) AS batch7_functions_any,
    (
      to_regprocedure('public.get_my_street_steal()') IS NOT NULL
      AND to_regprocedure('public.set_my_street_steal(boolean)') IS NOT NULL
      AND to_regprocedure('public.get_street_steal_target(uuid)') IS NOT NULL
      AND to_regprocedure('public.steal_street_goods(uuid, uuid)') IS NOT NULL
      AND to_regprocedure('public.claim_my_street_steal_rewards(uuid)') IS NOT NULL
      AND to_regprocedure('public.explore_public_streets(integer)') IS NOT NULL
    ) AS batch7_functions_all,
    (
      SELECT count(*) = 3 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'member_street_steal_prefs_guard', 'member_street_steals_guard', 'member_street_steal_claims_guard'
      )
    ) AS batch7_guards_all,
    (
      SELECT count(*) = 4 FROM pg_class
      WHERE oid IN (
        to_regclass('public.street_steal_settings'), to_regclass('public.member_street_steal_prefs'),
        to_regclass('public.member_street_steals'), to_regclass('public.member_street_steal_claims')
      ) AND relrowsecurity
    ) AS batch7_rls_all,
    EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.street_steal_settings', 'public.member_street_steal_prefs',
        'public.member_street_steals', 'public.member_street_steal_claims'
      ]) AS t(rel)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(actor)
      WHERE to_regclass(t.rel) IS NOT NULL
        AND (has_table_privilege(r.actor, t.rel, 'SELECT') OR has_table_privilege(r.actor, t.rel, 'INSERT')
          OR has_table_privilege(r.actor, t.rel, 'UPDATE') OR has_table_privilege(r.actor, t.rel, 'DELETE'))
    ) AS batch7_direct_access,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'public.get_my_street_steal()', 'public.set_my_street_steal(boolean)', 'public.get_street_steal_target(uuid)',
        'public.steal_street_goods(uuid, uuid)', 'public.claim_my_street_steal_rewards(uuid)', 'public.explore_public_streets(integer)'
      ]) AS f(sig)
      WHERE to_regprocedure(f.sig) IS NOT NULL AND has_function_privilege('anon', f.sig, 'EXECUTE')
    ) AS batch7_anon_execute,
    to_regclass('public.member_street_exhibits_published_time') IS NOT NULL AS explore_index_present,
    CASE WHEN to_regclass('public.street_steal_settings') IS NOT NULL
      THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.street_steal_settings', false, true, '')))[1]::text::integer
    END AS steal_settings_rows
) AS c;

ROLLBACK;
