-- =============================================================================
-- 第七階段第 5、6 批（夢想商店街公開街景、好友互助）：正式套用前後的唯讀檢查。
-- 在正式 Supabase SQL Editor 整份執行。交易為 READ ONLY，以 ROLLBACK 結束，不寫入任何資料。
-- 不讀會員內容、Email、點數餘額或存檔，只回傳結構、權限是否符合，以及既有資料表的列數。
--
-- 使用順序：
--   1. 執行本檔。第一段 batch5_gate 顯示可以套用時，執行 20261029220100_street_social_apply.sql。
--   2. 再執行本檔。batch5_gate 應顯示已套用，batch6_gate 顯示可以套用時，執行 20261029220200_street_friend_help_apply.sql。
--   3. 最後再執行本檔。兩個 gate 都應顯示已套用。
--   每次都把 existing_row_counts 記下來比對；第 5、6 批不應改變任何一列既有資料。
--   （auth.users 在兩次執行之間若有新會員註冊會自然增加，這不代表本批改了資料。）
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(c) AS checks,
  CASE
    WHEN c.pg14_or_newer AND c.has_auth_users AND c.has_auth_uid AND c.has_auth_jwt
      AND c.has_role_anon AND c.has_role_authenticated
      AND c.profiles_compatible AND c.has_gen_random_uuid
      AND NOT c.batch5_tables_any AND NOT c.batch5_functions_any
    THEN '可以套用 20261029220100_street_social_apply.sql'
    WHEN c.batch5_tables_all AND c.batch5_functions_all AND c.batch5_guards_all
      AND c.batch5_rls_all AND NOT c.batch5_direct_access AND NOT c.batch5_anon_execute
    THEN '已套用，結構與權限正確，不要重跑'
    WHEN c.batch5_tables_any OR c.batch5_functions_any
    THEN '第 5 批只套用一部分或權限不符，先停下來回報這一列'
    ELSE '先不要套用。看 checks 哪個條件不符合'
  END AS batch5_gate,
  CASE
    WHEN NOT (c.batch5_tables_all AND c.batch5_functions_all AND c.batch5_guards_all)
    THEN '要先完成第 5 批'
    WHEN NOT c.batch6_tables_any AND NOT c.batch6_functions_any
    THEN '可以套用 20261029220200_street_friend_help_apply.sql'
    WHEN c.batch6_tables_all AND c.batch6_functions_all AND c.batch6_guards_all
      AND c.batch6_rls_all AND NOT c.batch6_direct_access AND NOT c.batch6_anon_execute
      AND c.batch6_claim_has_key AND NOT c.batch6_claim_without_key
      AND c.help_settings_rows = 1
    THEN '已套用，結構與權限正確，不要重跑'
    ELSE '第 6 批只套用一部分或權限不符，先停下來回報這一列'
  END AS batch6_gate,
  (
    -- 既有資料列數（只數列數，不讀內容）。套用前後應完全相同；null 代表該表不存在。
    SELECT jsonb_object_agg(t.rel, CASE WHEN to_regclass(t.rel) IS NOT NULL
      THEN (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', t.rel), false, true, '')))[1]::text::bigint
    END)
    FROM unnest(ARRAY[
      'auth.users',
      'public.profiles',
      'public.member_invite_codes',
      'public.member_signup_invites',
      'public.member_invite_redemptions',
      'public.member_point_accounts',
      'public.member_point_entries',
      'public.reward_claims',
      'public.member_perk_holds',
      'public.member_coupon_holds',
      'public.member_merge_shops',
      'public.member_game_reward_claims',
      'public.member_game_achievements',
      'public.block_ranked_runs'
    ]) AS t(rel)
  ) AS existing_row_counts
FROM (
  SELECT
    current_setting('server_version_num')::integer >= 140000 AS pg14_or_newer,
    current_user AS run_as,
    to_regclass('auth.users') IS NOT NULL AS has_auth_users,
    to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid,
    to_regprocedure('auth.jwt()') IS NOT NULL AS has_auth_jwt,
    to_regprocedure('gen_random_uuid()') IS NOT NULL AS has_gen_random_uuid,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS has_role_anon,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS has_role_authenticated,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') AS has_role_auth_admin,
    (
      SELECT count(*) = 4 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
        AND (
          (column_name = 'id' AND data_type = 'uuid')
          OR (column_name = 'public_nickname' AND data_type = 'text')
          OR (column_name = 'avatar_url' AND data_type = 'text')
          OR (column_name = 'avatar_tone' AND data_type IN ('smallint', 'integer'))
        )
    ) AS profiles_compatible,

    -- 第 5 批
    (
      to_regclass('public.member_street_exhibits') IS NOT NULL
      OR to_regclass('public.member_street_likes') IS NOT NULL
      OR to_regclass('public.member_street_visits') IS NOT NULL
    ) AS batch5_tables_any,
    (
      to_regclass('public.member_street_exhibits') IS NOT NULL
      AND to_regclass('public.member_street_likes') IS NOT NULL
      AND to_regclass('public.member_street_visits') IS NOT NULL
    ) AS batch5_tables_all,
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
        'street_taipei_day', 'street_building_min_level', 'street_decor_min_level', 'street_decor_slot',
        'street_normalize_exhibit', 'street_social_counts', 'street_public_identity', 'street_exhibit_payload',
        'guard_street_social_write', 'get_my_street_social', 'set_my_street_exhibit', 'get_public_street',
        'toggle_street_like'
      ])
    ) AS batch5_functions_any,
    (
      to_regprocedure('public.street_taipei_day(timestamptz)') IS NOT NULL
      AND to_regprocedure('public.street_public_identity(uuid)') IS NOT NULL
      AND to_regprocedure('public.get_my_street_social()') IS NOT NULL
      AND to_regprocedure('public.set_my_street_exhibit(boolean, jsonb)') IS NOT NULL
      AND to_regprocedure('public.get_public_street(uuid)') IS NOT NULL
      AND to_regprocedure('public.toggle_street_like(uuid)') IS NOT NULL
    ) AS batch5_functions_all,
    (
      SELECT count(*) = 3 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN ('member_street_exhibits_guard', 'member_street_likes_guard', 'member_street_visits_guard')
    ) AS batch5_guards_all,
    (
      SELECT count(*) = 3 FROM pg_class
      WHERE oid IN (
        to_regclass('public.member_street_exhibits'), to_regclass('public.member_street_likes'), to_regclass('public.member_street_visits')
      ) AND relrowsecurity
    ) AS batch5_rls_all,
    EXISTS (
      SELECT 1
      FROM unnest(ARRAY['public.member_street_exhibits', 'public.member_street_likes', 'public.member_street_visits']) AS t(rel)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(actor)
      WHERE to_regclass(t.rel) IS NOT NULL
        AND (has_table_privilege(r.actor, t.rel, 'SELECT') OR has_table_privilege(r.actor, t.rel, 'INSERT')
          OR has_table_privilege(r.actor, t.rel, 'UPDATE') OR has_table_privilege(r.actor, t.rel, 'DELETE'))
    ) AS batch5_direct_access,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'public.get_my_street_social()', 'public.set_my_street_exhibit(boolean, jsonb)',
        'public.get_public_street(uuid)', 'public.toggle_street_like(uuid)'
      ]) AS f(sig)
      WHERE to_regprocedure(f.sig) IS NOT NULL AND has_function_privilege('anon', f.sig, 'EXECUTE')
    ) AS batch5_anon_execute,

    -- 第 6 批
    (
      to_regclass('public.street_help_settings') IS NOT NULL
      OR to_regclass('public.member_street_friends') IS NOT NULL
      OR to_regclass('public.member_street_friend_requests') IS NOT NULL
      OR to_regclass('public.member_street_helps') IS NOT NULL
      OR to_regclass('public.member_street_help_claims') IS NOT NULL
    ) AS batch6_tables_any,
    (
      to_regclass('public.street_help_settings') IS NOT NULL
      AND to_regclass('public.member_street_friends') IS NOT NULL
      AND to_regclass('public.member_street_friend_requests') IS NOT NULL
      AND to_regclass('public.member_street_helps') IS NOT NULL
      AND to_regclass('public.member_street_help_claims') IS NOT NULL
    ) AS batch6_tables_all,
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
        'guard_street_help_write', 'street_friend_status', 'street_help_status_json', 'street_friend_card',
        'get_my_street_friends', 'request_street_friend', 'respond_street_friend', 'remove_street_friend',
        'help_street_friend', 'claim_my_street_help_rewards'
      ])
    ) AS batch6_functions_any,
    (
      to_regprocedure('public.get_my_street_friends()') IS NOT NULL
      AND to_regprocedure('public.request_street_friend(uuid)') IS NOT NULL
      AND to_regprocedure('public.respond_street_friend(uuid, boolean)') IS NOT NULL
      AND to_regprocedure('public.remove_street_friend(uuid)') IS NOT NULL
      AND to_regprocedure('public.help_street_friend(uuid, uuid)') IS NOT NULL
      AND to_regprocedure('public.claim_my_street_help_rewards(uuid)') IS NOT NULL
    ) AS batch6_functions_all,
    to_regprocedure('public.claim_my_street_help_rewards(uuid)') IS NOT NULL AS batch6_claim_has_key,
    to_regprocedure('public.claim_my_street_help_rewards()') IS NOT NULL AS batch6_claim_without_key,
    (
      SELECT count(*) = 4 FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'member_street_friends_guard', 'member_street_friend_requests_guard',
        'member_street_helps_guard', 'member_street_help_claims_guard'
      )
    ) AS batch6_guards_all,
    (
      SELECT count(*) = 5 FROM pg_class
      WHERE oid IN (
        to_regclass('public.street_help_settings'), to_regclass('public.member_street_friends'),
        to_regclass('public.member_street_friend_requests'), to_regclass('public.member_street_helps'),
        to_regclass('public.member_street_help_claims')
      ) AND relrowsecurity
    ) AS batch6_rls_all,
    EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.street_help_settings', 'public.member_street_friends', 'public.member_street_friend_requests',
        'public.member_street_helps', 'public.member_street_help_claims'
      ]) AS t(rel)
      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(actor)
      WHERE to_regclass(t.rel) IS NOT NULL
        AND (has_table_privilege(r.actor, t.rel, 'SELECT') OR has_table_privilege(r.actor, t.rel, 'INSERT')
          OR has_table_privilege(r.actor, t.rel, 'UPDATE') OR has_table_privilege(r.actor, t.rel, 'DELETE'))
    ) AS batch6_direct_access,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'public.get_my_street_friends()', 'public.request_street_friend(uuid)', 'public.respond_street_friend(uuid, boolean)',
        'public.remove_street_friend(uuid)', 'public.help_street_friend(uuid, uuid)', 'public.claim_my_street_help_rewards(uuid)'
      ]) AS f(sig)
      WHERE to_regprocedure(f.sig) IS NOT NULL AND has_function_privilege('anon', f.sig, 'EXECUTE')
    ) AS batch6_anon_execute,
    CASE WHEN to_regclass('public.street_help_settings') IS NOT NULL
      THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.street_help_settings', false, true, '')))[1]::text::integer
    END AS help_settings_rows,

    EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'pgrst_ddl_watch') AS pgrst_ddl_watch_present
) AS c;

ROLLBACK;
