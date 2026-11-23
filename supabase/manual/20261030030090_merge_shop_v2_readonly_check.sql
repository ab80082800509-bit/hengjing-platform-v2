-- =============================================================================
-- 第七階段第 9 批：合成小舖 v2 套用前唯讀預檢（對應 20261030030100_merge_shop_v2_apply.sql）。
-- 只讀，結尾 ROLLBACK，不改任何資料。第一列 gate 為「可以套用」才執行 v2。
-- 套用前後各跑一次，最後一個結果的存檔、事件與點數數字必須完全相同。
-- =============================================================================

BEGIN READ ONLY;

WITH defs AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.apply_my_merge_shop_action(text, text, jsonb)')) AS apply_def,
    pg_get_functiondef(to_regprocedure('public.merge_shop_snapshot(public.member_merge_shops, boolean)')) AS snapshot_def
),
v2 AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.member_merge_shops') AND conname = 'member_merge_shops_shop_level_v2')
    AND to_regprocedure('public.merge_item_ok(text)') IS NOT NULL
    AND coalesce(position('contentVersion' IN (SELECT snapshot_def FROM defs)) > 0, false) AS applied
),
checks(sort, item, ok) AS (
  VALUES
  (1, 'v1 資料表與函式',
    to_regclass('public.member_merge_shops') IS NOT NULL
    AND to_regclass('public.member_merge_shop_events') IS NOT NULL
    AND to_regprocedure('public.apply_my_merge_shop_action(text, text, jsonb)') IS NOT NULL
    AND to_regprocedure('public.merge_shop_snapshot(public.member_merge_shops, boolean)') IS NOT NULL
    AND to_regprocedure('public.get_my_merge_shop()') IS NOT NULL
    AND to_regprocedure('public.game_taipei_day(timestamptz)') IS NOT NULL
    AND to_regprocedure('public.merge_mix32(integer)') IS NOT NULL
    AND to_regprocedure('public.merge_make_order(integer, integer, integer)') IS NOT NULL
    AND to_regprocedure('public.merge_spawn_item(integer, integer)') IS NOT NULL
    AND to_regprocedure('public.merge_cell(jsonb, integer)') IS NOT NULL
    AND to_regprocedure('public.merge_set_cell(jsonb, integer, text)') IS NOT NULL
    AND to_regprocedure('public.merge_add_catalog(jsonb, text)') IS NOT NULL
    AND to_regprocedure('public.merge_json_int(jsonb, text)') IS NOT NULL
    AND to_regprocedure('public.merge_unlocked_count(integer)') IS NOT NULL
    AND to_regprocedure('public.merge_chain_id(integer)') IS NOT NULL
    AND to_regprocedure('public.merge_upgrade_cost(integer)') IS NOT NULL
    AND to_regprocedure('public.merge_next_item(text)') IS NOT NULL),
  (2, '存檔欄位齊全（v2 會讀寫的 17 欄）',
    (SELECT count(*) = 17 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'member_merge_shops'
       AND column_name IN ('user_id', 'coins', 'xp', 'shop_level', 'board', 'catalog', 'orders', 'order_serial', 'lifetime_orders',
                           'quest_day', 'quest_orders', 'quest_claimed', 'producer_charges', 'producer_anchor', 'action_seq', 'revision', 'game_version'))
    AND (SELECT count(*) = 5 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'member_merge_shop_events'
           AND column_name IN ('user_id', 'action_key', 'action_type', 'revision_after', 'result'))),
  (3, '商店等級限制只有一條，且是 v1（1～5）或 v2（1～6）',
    (SELECT count(*) = 1 AND bool_and(pg_get_constraintdef(oid) ~ '\(shop_level >= 1\) AND \(shop_level <= [56]\)')
     FROM pg_constraint WHERE conrelid = to_regclass('public.member_merge_shops') AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'shop_level')),
  (4, '合成交易是已知的 v1 或 v2 版本（v2 覆寫不會蓋掉其他改動）',
    (SELECT apply_def IS NOT NULL AND (
       (position('^(tea|snack|gift)-[1-5]$' IN apply_def) > 0 AND position('stage6-batch1' IN apply_def) > 0 AND position('merge_item_ok' IN apply_def) = 0)
       OR (position('merge_item_ok' IN apply_def) > 0 AND position('fruit-1' IN apply_def) > 0))
     FROM defs)),
  (5, '存檔等級在 1～6',
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN false ELSE coalesce((xpath('/row/ok/text()', query_to_xml(
      $q$SELECT coalesce(bool_and(shop_level BETWEEN 1 AND 6), true) AS ok FROM public.member_merge_shops$q$, false, true, '')))[1]::text = 'true', false) END),
  (6, '存檔盤面 30 格，商品都是 v2 認得的格式',
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN false ELSE coalesce((xpath('/row/ok/text()', query_to_xml(
      $q$SELECT NOT EXISTS (
           SELECT 1 FROM public.member_merge_shops AS s
           WHERE jsonb_typeof(s.board) IS DISTINCT FROM 'array' OR jsonb_array_length(s.board) <> 30
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.board) AS e
                         WHERE jsonb_typeof(e) <> 'null'
                           AND (jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^(tea|snack|gift|fruit)-[1-5]$'))
         ) AS ok$q$, false, true, '')))[1]::text = 'true', false) END),
  (7, '存檔圖鑑都是 v2 認得的格式',
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN false ELSE coalesce((xpath('/row/ok/text()', query_to_xml(
      $q$SELECT NOT EXISTS (
           SELECT 1 FROM public.member_merge_shops AS s
           WHERE jsonb_typeof(s.catalog) IS DISTINCT FROM 'array'
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.catalog) AS e
                         WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^(tea|snack|gift|fruit)-[1-5]$')
         ) AS ok$q$, false, true, '')))[1]::text = 'true', false) END),
  (8, '存檔訂單都能被 v2 交付（編號、商品、數量 1～5、金幣與經驗 0～500）',
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN false ELSE coalesce((xpath('/row/ok/text()', query_to_xml(
      $q$SELECT NOT EXISTS (
           SELECT 1 FROM public.member_merge_shops AS s
           WHERE jsonb_typeof(s.orders) IS DISTINCT FROM 'array'
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(s.orders) AS o
                         WHERE NOT CASE
                           WHEN jsonb_typeof(o) = 'object'
                                AND coalesce(o ->> 'id', '') ~ '^ord-[0-9]+-[0-9]+$'
                                AND coalesce(o ->> 'itemId', '') ~ '^(tea|snack|gift|fruit)-[1-5]$'
                                AND coalesce(o ->> 'qty', '') ~ '^[1-5]$'
                                AND coalesce(o ->> 'coins', '') ~ '^[0-9]{1,3}$'
                                AND coalesce(o ->> 'xp', '') ~ '^[0-9]{1,3}$'
                           THEN (o ->> 'coins')::integer <= 500 AND (o ->> 'xp')::integer <= 500
                           ELSE false END)
         ) AS ok$q$, false, true, '')))[1]::text = 'true', false) END),
  (9, '動作編號唯一（重送同一動作只回放、不重複給獎）',
    EXISTS (SELECT 1 FROM pg_index AS i
            WHERE i.indrelid = to_regclass('public.member_merge_shop_events') AND i.indisunique AND i.indpred IS NULL
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a
                   WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['action_key', 'user_id'])),
  (10, '合成交易與畫面資料不碰 Pay 點數',
    (SELECT apply_def IS NOT NULL AND snapshot_def IS NOT NULL
        AND position('post_member_reward' IN apply_def) = 0 AND position('member_point_entries' IN apply_def) = 0
        AND position('member_point_accounts' IN apply_def) = 0 AND position('reward_claims' IN apply_def) = 0
        AND position('''payPointsDelta'', 0' IN snapshot_def) > 0 AND position('''payoutEnabled'', false' IN snapshot_def) > 0
     FROM defs)),
  (11, '存檔與事件表的觸發器不寫點數',
    NOT EXISTS (SELECT 1 FROM pg_trigger AS t JOIN pg_proc AS p ON p.oid = t.tgfoid
                WHERE t.tgrelid IN (to_regclass('public.member_merge_shops'), to_regclass('public.member_merge_shop_events'))
                  AND NOT t.tgisinternal
                  AND (p.prosrc ~ 'member_point_entries|member_point_accounts|reward_claims|post_member_reward|member_game_reward_claims'))
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.member_merge_shops') AND NOT tgisinternal AND tgenabled <> 'D')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.member_merge_shop_events') AND NOT tgisinternal AND tgenabled <> 'D')),
  (12, '遊戲 Pay 點數發放關閉',
    to_regclass('public.game_reward_policies') IS NULL
    OR coalesce((xpath('/row/ok/text()', query_to_xml($q$SELECT NOT coalesce(bool_or(payout_enabled), false) AS ok FROM public.game_reward_policies$q$, false, true, '')))[1]::text, 'false') = 'true'),
  (13, '合成交易只給登入會員、會員不能直接寫存檔',
    to_regprocedure('public.apply_my_merge_shop_action(text, text, jsonb)') IS NOT NULL
    AND has_function_privilege('authenticated', 'public.apply_my_merge_shop_action(text, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.apply_my_merge_shop_action(text, text, jsonb)', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.member_merge_shops', 'public.member_merge_shop_events']) AS t
                    WHERE to_regclass(t) IS NULL
                       OR has_table_privilege('anon', t, 'INSERT') OR has_table_privilege('anon', t, 'UPDATE') OR has_table_privilege('anon', t, 'DELETE')
                       OR has_table_privilege('authenticated', t, 'INSERT') OR has_table_privilege('authenticated', t, 'UPDATE') OR has_table_privilege('authenticated', t, 'DELETE')
                       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t))))
)
SELECT 0 AS sort,
       CASE
         WHEN NOT bool_and(coalesce(ok, false)) THEN '不可套用：' || string_agg(item, '、' ORDER BY sort) FILTER (WHERE ok IS NOT TRUE)
         WHEN (SELECT applied FROM v2) THEN '已套用 v2'
         ELSE '可以套用'
       END AS item,
       bool_and(coalesce(ok, false)) AS ok
FROM checks
UNION ALL
SELECT sort, item, coalesce(ok, false) FROM checks
ORDER BY sort;

-- 套用前後比對：v2 只換規則與 CHECK，以下數字必須完全相同。
SELECT
  CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT concat_ws(' / ', count(*), coalesce(min(shop_level), 0) || '～' || coalesce(max(shop_level), 0), coalesce(sum(coins), 0), coalesce(sum(xp), 0), coalesce(sum(revision), 0), md5(coalesce(string_agg(s::text, '|' ORDER BY user_id), ''))) AS v FROM public.member_merge_shops AS s$q$, false, true, '')))[1]::text END
    AS merge_saves_count_levels_coins_xp_revision_md5,
  CASE WHEN to_regclass('public.member_merge_shop_events') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM public.member_merge_shop_events$q$, false, true, '')))[1]::text::bigint END AS merge_events,
  CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT concat_ws(' / ', count(*), coalesce(sum(balance), 0)) AS v FROM public.member_point_accounts$q$, false, true, '')))[1]::text END AS point_accounts_and_balance,
  CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM public.member_point_entries$q$, false, true, '')))[1]::text::bigint END AS point_entries,
  CASE WHEN to_regclass('public.reward_claims') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM public.reward_claims$q$, false, true, '')))[1]::text::bigint END AS reward_claims,
  CASE WHEN to_regclass('public.member_game_reward_claims') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM public.member_game_reward_claims$q$, false, true, '')))[1]::text::bigint END AS game_reward_claims,
  CASE WHEN to_regclass('public.member_game_achievements') IS NULL THEN NULL ELSE (xpath('/row/v/text()', query_to_xml(
    $q$SELECT count(*) AS v FROM public.member_game_achievements$q$, false, true, '')))[1]::text::bigint END AS game_achievements;

ROLLBACK;
