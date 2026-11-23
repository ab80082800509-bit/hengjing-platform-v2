-- =============================================================================
-- 第七階段第 8 批（社交排行榜）：正式套用前後的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不寫入任何資料。
-- 不讀會員內容、Email、暱稱、點數餘額或存檔，只回傳結構、權限是否符合，以及相關資料表的列數。
--
-- 使用順序：
--   1. 執行本檔。batch8_gate 顯示可以套用時，執行 20261030000100_street_leaderboard_apply.sql。
--   2. 再執行本檔。batch8_gate 應顯示已套用。
--   兩次都把 existing_row_counts 記下來比對；第 8 批只新增一個唯讀函式，不應改變任何一列資料。
--   （會員在兩次執行之間自然互助、偷貨或加好友，列數會自然增加，這不代表本批改了資料。）
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN NOT (c.batch5_ready AND c.batch6_ready AND c.batch7_ready)
    THEN '要先完成第 5、6、7 批'
    WHEN c.needed_columns <> 13
    THEN '第 5～7 批欄位與排行榜不相容，先停下來回報這一列'
    WHEN NOT c.board_function_any
    THEN '可以套用 20261030000100_street_leaderboard_apply.sql'
    WHEN c.board_function_ok AND NOT c.board_anon_execute AND c.board_authenticated_execute
    THEN '已套用，結構與權限正確，不要重跑'
    ELSE '第 8 批函式存在但設定不符，先停下來回報這一列'
  END AS batch8_gate,
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
      'public.member_street_friends',
      'public.member_street_helps',
      'public.member_street_help_claims',
      'public.member_street_steals',
      'public.member_street_steal_claims'
    ]) AS t(rel)
  ) AS existing_row_counts,
  CASE WHEN to_regclass('public.member_street_steals') IS NOT NULL THEN (
    SELECT jsonb_object_agg(x.outcome, x.n)
    FROM (
      SELECT o.outcome, (xpath('/row/n/text()', query_to_xml(
        format('SELECT count(*) AS n FROM public.member_street_steals WHERE outcome = %L', o.outcome), false, true, ''
      )))[1]::text::bigint AS n
      FROM unnest(ARRAY['success', 'miss']) AS o(outcome)
    ) AS x
  ) END AS steal_outcome_counts,
  (now() AT TIME ZONE 'Asia/Taipei')::date AS taipei_today,
  (now() AT TIME ZONE 'Asia/Taipei')::date - (extract(isodow FROM (now() AT TIME ZONE 'Asia/Taipei')::date)::integer - 1) AS taipei_week_start
FROM (
  SELECT
    current_user AS run_as,
    (
      to_regclass('public.member_street_exhibits') IS NOT NULL
      AND to_regprocedure('public.street_taipei_day(timestamptz)') IS NOT NULL
      AND to_regprocedure('public.street_public_identity(uuid)') IS NOT NULL
    ) AS batch5_ready,
    (
      to_regclass('public.member_street_friends') IS NOT NULL
      AND to_regclass('public.member_street_helps') IS NOT NULL
      AND to_regprocedure('public.help_street_friend(uuid, uuid)') IS NOT NULL
    ) AS batch6_ready,
    (
      to_regclass('public.member_street_steals') IS NOT NULL
      AND to_regprocedure('public.steal_street_goods(uuid, uuid)') IS NOT NULL
    ) AS batch7_ready,
    (
      SELECT count(*)::integer FROM information_schema.columns AS col
      WHERE col.table_schema = 'public'
        AND (
          (col.table_name = 'member_street_helps' AND col.column_name IN ('helper_id', 'owner_id', 'help_day', 'created_at'))
          OR (col.table_name = 'member_street_steals' AND col.column_name IN ('thief_id', 'steal_day', 'outcome', 'created_at'))
          OR (col.table_name = 'member_street_friends' AND col.column_name IN ('user_low', 'user_high', 'status'))
          OR (col.table_name = 'member_street_exhibits' AND col.column_name IN ('user_id', 'published'))
        )
    ) AS needed_columns,
    (
      SELECT count(*) = 2 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN ('member_street_helps_guard', 'member_street_steals_guard')
    ) AS source_guards_present,
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_street_leaderboard'
    ) AS board_function_any,
    EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.get_street_leaderboard(text, text, text)')
        AND p.prosecdef AND p.provolatile = 's'
        AND 'search_path=pg_catalog' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    ) AS board_function_ok,
    COALESCE(
      has_function_privilege('anon', to_regprocedure('public.get_street_leaderboard(text, text, text)')::oid, 'EXECUTE'),
      false
    ) AS board_anon_execute,
    COALESCE(
      has_function_privilege('authenticated', to_regprocedure('public.get_street_leaderboard(text, text, text)')::oid, 'EXECUTE'),
      false
    ) AS board_authenticated_execute
) AS c;

ROLLBACK;
