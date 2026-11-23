-- =============================================================================
-- 第七階段第 9 批：夢想商店街內容 v2 套用前唯讀預檢（對應 20261030030200_street_content_v2_apply.sql）。
-- 只讀，不建立物件，結尾 ROLLBACK。第一個結果第 0 列為「可以套用」才執行 v2。
--   可以套用：條件全部符合，且 v2 會覆寫的 6 個函式都還是套用檔裡的 v1。
--   已套用：條件全部符合，且 6 個函式都已是套用檔裡的 v2，尚未套用欄位修補。
--   已套用（含套用欄位修正）：同上，但 street_cloud_build 已是 20261030030210 的修正版。不要再重套舊 v2。
--   不可套用：列出未通過的項目與原因。缺表、缺欄位、缺函式或型別不符只讓該項失敗，不讓整份查詢中斷。
-- 函式指紋是 md5(replace(本文, CRLF, LF))，只吸收換行格式；字串常數裡的空白一律保留。
-- 指紋常數來自下列套用檔的函式本文，不是從待檢資料庫抄下來的：
--   v1：20261030010100_street_cloud_save_apply.sql、20261029220100_street_social_apply.sql
--   v2：20261030030200_street_content_v2_apply.sql
--   v2修正：20261030030210_street_equip_guard_apply.sql 的 street_cloud_build
-- 縮排、註解或字串外的空白若與套用檔不同，判為「未知版本」，因而不可套用。
-- 套用前後各跑一次，最後一個結果的存檔、獎勵與點數數字必須完全相同。
-- =============================================================================

BEGIN READ ONLY;

WITH RECURSIVE fn(name, sig, v1, v2) AS (
  VALUES
  ('street_cloud_spec', 'public.street_cloud_spec()', '0ca3702fb6b118171aefd9d34e35a368', '5a170498b46603661a2439563cb67d33'),
  ('street_cloud_build', 'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)', 'ab3332a8dc61e69d27ae52d3f32cbe89', '838580cae35772373d7ea1315bdd9282'),
  ('street_cloud_row_json', 'public.street_cloud_row_json(public.member_street_saves)', 'c11e90ee3794c9e7af36e5adaa7ee11f', 'e16250d4644b44450c3af5b745ecc877'),
  ('get_my_street_save', 'public.get_my_street_save()', '66b4af4ebf0bc3c287a62c8bc28c80f7', '94102a0fe2b884254ae871a36925eee9'),
  ('street_decor_min_level', 'public.street_decor_min_level(text)', '2693336ed7f70501258d1fe42fe488f4', '0843e958e392f3692ddb12f0d7b4ff7d'),
  ('street_decor_slot', 'public.street_decor_slot(text)', '337ead6149afabbedc1509100bb6f627', '3aef135d08d199d67798ff9ac1f8ebec')
),
fix(name, fp) AS (
  VALUES ('street_cloud_build', '13a1b2fe7cdded34dd0f61c786a3951e')
),
fn_state AS (
  SELECT fn.name,
         CASE
           WHEN p.oid IS NULL THEN '缺少'
           WHEN md5(replace(p.prosrc, E'\r\n', E'\n')) = fn.v1 THEN 'v1'
           WHEN md5(replace(p.prosrc, E'\r\n', E'\n')) = fn.v2 THEN 'v2'
           WHEN fn.name = (SELECT fix.name FROM fix) AND md5(replace(p.prosrc, E'\r\n', E'\n')) = (SELECT fix.fp FROM fix) THEN 'v2修正'
           ELSE '未知版本'
         END AS state
  FROM fn
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(fn.sig)
),
ver AS (
  SELECT coalesce(bool_and(state = 'v1'), false) AS all_v1,
         coalesce(bool_and(state = 'v2'), false) AS all_v2,
         coalesce(bool_and(CASE WHEN name = 'street_cloud_build' THEN state = 'v2修正' ELSE state = 'v2' END), false) AS fixed
  FROM fn_state
),
need_col(table_name, column_name, data_type) AS (
  VALUES
  ('member_street_saves', 'user_id', 'uuid'),
  ('member_street_saves', 'revision', 'bigint'),
  ('member_street_saves', 'progress', 'jsonb'),
  ('member_street_saves', 'coins', 'bigint'),
  ('member_street_saves', 'xp', 'bigint'),
  ('member_street_saves', 'shop_level', 'smallint'),
  ('member_street_saves', 'import_source', 'text'),
  ('member_street_saves', 'import_adjusted', 'boolean'),
  ('member_street_saves', 'updated_at', 'timestamp with time zone'),
  ('street_cloud_settings', 'id', 'boolean'),
  ('street_cloud_settings', 'enabled', 'boolean'),
  ('street_cloud_settings', 'save_burst_guests', 'integer'),
  ('street_cloud_settings', 'import_earned_cap', 'bigint')
),
col_state AS (
  SELECT n.table_name, n.column_name, n.data_type,
         c.data_type AS actual_type, c.is_nullable
  FROM need_col AS n
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public' AND c.table_name = n.table_name AND c.column_name = n.column_name
),
need_obj(kind, name) AS (
  VALUES
  ('表', 'public.street_cloud_settings'),
  ('表', 'public.member_street_saves'),
  ('表', 'public.member_street_save_credits'),
  ('表', 'public.member_street_save_log'),
  ('表', 'public.member_street_help_claims'),
  ('表', 'public.member_street_steal_claims'),
  ('表', 'public.member_street_exhibits'),
  ('函式', 'public.street_cloud_int(jsonb, bigint, bigint)'),
  ('函式', 'public.street_cloud_ids(jsonb, text[])'),
  ('函式', 'public.street_cloud_rank(bigint)'),
  ('函式', 'public.import_my_street_save(jsonb, uuid)'),
  ('函式', 'public.save_my_street(bigint, jsonb, uuid)'),
  ('函式', 'public.street_normalize_exhibit(jsonb)')
),
obj_state AS (
  SELECT kind, name,
         CASE kind
           WHEN '表' THEN to_regclass(name) IS NOT NULL
           ELSE to_regprocedure(name) IS NOT NULL
         END AS ok
  FROM need_obj
),
roots AS (
  SELECT p.oid
  FROM (VALUES
    ('public.save_my_street(bigint, jsonb, uuid)'),
    ('public.import_my_street_save(jsonb, uuid)'),
    ('public.get_my_street_save()')
  ) AS s(sig)
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(s.sig)
),
trigger_fn AS (
  SELECT t.tgfoid AS oid
  FROM pg_trigger AS t
  WHERE NOT t.tgisinternal
    AND t.tgrelid = ANY (ARRAY[
      to_regclass('public.member_street_saves'),
      to_regclass('public.member_street_save_credits'),
      to_regclass('public.member_street_save_log')
    ]::regclass[])
),
chain AS (
  SELECT r.oid, ARRAY[r.oid] AS path
  FROM (SELECT oid FROM roots WHERE oid IS NOT NULL UNION SELECT oid FROM trigger_fn) AS r
  UNION ALL
  SELECT callee.oid, chain.path || callee.oid
  FROM chain
  JOIN pg_proc AS caller ON caller.oid = chain.oid
  JOIN LATERAL regexp_matches(caller.prosrc, 'public\.([a-z_][a-z0-9_]*)\s*\(', 'g') AS m(hit) ON true
  JOIN pg_proc AS callee
    ON callee.pronamespace = 'public'::regnamespace AND callee.proname = m.hit[1]
  WHERE cardinality(chain.path) < 8 AND NOT callee.oid = ANY (chain.path)
),
unresolved AS (
  SELECT DISTINCT caller.proname || ' → public.' || m.hit[1] AS ref
  FROM chain
  JOIN pg_proc AS caller ON caller.oid = chain.oid
  CROSS JOIN LATERAL regexp_matches(caller.prosrc, 'public\.([a-z_][a-z0-9_]*)\s*\(', 'g') AS m(hit)
  WHERE to_regclass('public.' || m.hit[1]) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_proc AS callee
      WHERE callee.pronamespace = 'public'::regnamespace AND callee.proname = m.hit[1]
    )
),
unsafe AS (
  SELECT format('%s.%s：%s', n.nspname, caller.proname,
           CASE
             WHEN l.lanname NOT IN ('sql', 'plpgsql') THEN '語言 ' || l.lanname || ' 無法確認是否寫入點數'
             WHEN caller.prosrc ~ '\mEXECUTE\M' THEN '含動態 SQL，無法確認寫入目標'
             ELSE '會碰到 Pay 點數帳本'
           END) AS problem
  FROM chain
  JOIN pg_proc AS caller ON caller.oid = chain.oid
  JOIN pg_namespace AS n ON n.oid = caller.pronamespace
  JOIN pg_language AS l ON l.oid = caller.prolang
  WHERE l.lanname NOT IN ('sql', 'plpgsql')
     OR caller.prosrc ~ '\mEXECUTE\M'
     OR caller.prosrc ~ 'member_point_entries|member_point_accounts|post_member_reward|post_perk_unlock_debit|\mreward_claims\M'
),
saves_readable AS (
  SELECT to_regclass('public.member_street_saves') IS NOT NULL
     AND EXISTS (SELECT 1 FROM col_state WHERE table_name = 'member_street_saves' AND column_name = 'progress' AND actual_type = 'jsonb')
     AND EXISTS (SELECT 1 FROM col_state WHERE table_name = 'member_street_saves' AND column_name = 'shop_level' AND actual_type IN ('smallint', 'integer', 'bigint'))
     AND EXISTS (SELECT 1 FROM col_state WHERE table_name = 'member_street_saves' AND column_name = 'coins' AND actual_type IN ('smallint', 'integer', 'bigint'))
     AND EXISTS (SELECT 1 FROM col_state WHERE table_name = 'member_street_saves' AND column_name = 'xp' AND actual_type IN ('smallint', 'integer', 'bigint'))
     AND EXISTS (SELECT 1 FROM col_state WHERE table_name = 'member_street_saves' AND column_name = 'revision' AND actual_type IN ('smallint', 'integer', 'bigint'))
    AS ok
),
member_fn(sig) AS (
  VALUES ('public.save_my_street(bigint, jsonb, uuid)'), ('public.import_my_street_save(jsonb, uuid)')
),
member_fn_state AS (
  SELECT s.sig, p.oid, p.prosecdef, p.prosrc
  FROM member_fn AS s
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(s.sig)
),
checks(sort, item, ok, detail) AS (
  SELECT 1, '商店街雲端存檔資料表與函式',
         coalesce((SELECT bool_and(ok) FROM obj_state), false),
         (SELECT string_agg(kind || ' ' || name, '、' ORDER BY kind, name) FROM obj_state WHERE NOT ok)
  UNION ALL
  SELECT 2, '存檔欄位型別與非空條件',
         coalesce((SELECT bool_and(coalesce(actual_type = data_type AND is_nullable = 'NO', false)) FROM col_state), false),
         (SELECT string_agg(table_name || '.' || column_name || ' 應為 ' || data_type || ' NOT NULL，目前是 ' ||
                            coalesce(actual_type || CASE WHEN is_nullable = 'YES' THEN ' 可為空' ELSE ' NOT NULL' END, '缺少'),
                            '、' ORDER BY table_name, column_name)
          FROM col_state WHERE actual_type IS DISTINCT FROM data_type OR is_nullable IS DISTINCT FROM 'NO')
  UNION ALL
  SELECT 3, 'v2 會覆寫的 6 個函式都是套用檔裡的 v1，或都已是 v2（含套用欄位修正）',
         (SELECT all_v1 OR all_v2 OR fixed FROM ver),
         (SELECT string_agg(name || ' ' || state, '、' ORDER BY name) FROM fn_state WHERE state NOT IN ('v1', 'v2', 'v2修正'))
  UNION ALL
  SELECT 4, '存檔等級 1～5、金幣與經驗在範圍內、版本號有效',
         CASE WHEN NOT (SELECT ok FROM saves_readable) THEN false
              ELSE coalesce((xpath('/row/ok/text()', query_to_xml($q$
                SELECT coalesce(bool_and(shop_level BETWEEN 1 AND 5 AND coins BETWEEN 0 AND 1000000000
                                         AND xp BETWEEN 0 AND 1000000000 AND revision >= 1
                                         AND jsonb_typeof(progress) = 'object'), true) AS ok
                FROM public.member_street_saves$q$, false, true, '')))[1]::text = 'true', false) END,
         NULL
  UNION ALL
  SELECT 5, '存檔內容與欄位一致',
         CASE WHEN NOT (SELECT ok FROM saves_readable) THEN false
              ELSE coalesce((xpath('/row/ok/text()', query_to_xml($q$
                SELECT NOT EXISTS (
                  SELECT 1 FROM public.member_street_saves AS s
                  WHERE (s.progress ->> 'shopLevel') IS DISTINCT FROM s.shop_level::text
                     OR (s.progress ->> 'coins') IS DISTINCT FROM s.coins::text
                     OR (s.progress ->> 'xp') IS DISTINCT FROM s.xp::text
                ) AS ok$q$, false, true, '')))[1]::text = 'true', false) END,
         NULL
  UNION ALL
  SELECT 6, '存檔裡的商店與裝潢是陣列且 v2 都認得',
         CASE WHEN NOT (SELECT ok FROM saves_readable) THEN false
              ELSE coalesce((xpath('/row/ok/text()', query_to_xml($q$
                SELECT NOT EXISTS (
                  SELECT 1 FROM public.member_street_saves AS s
                  WHERE CASE
                          WHEN NOT (s.progress ? 'buildings') THEN false
                          WHEN jsonb_typeof(s.progress -> 'buildings') IS DISTINCT FROM 'array' THEN true
                          WHEN EXISTS (
                            SELECT 1 FROM jsonb_array_elements(s.progress -> 'buildings') AS e
                            WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('tea', 'gift')
                          ) THEN true
                          ELSE false
                        END
                     OR CASE
                          WHEN NOT (s.progress ? 'ownedDecors') THEN false
                          WHEN jsonb_typeof(s.progress -> 'ownedDecors') IS DISTINCT FROM 'array' THEN true
                          WHEN EXISTS (
                            SELECT 1 FROM jsonb_array_elements(s.progress -> 'ownedDecors') AS e
                            WHERE jsonb_typeof(e) <> 'string'
                               OR (e #>> '{}') NOT IN ('mat', 'lantern', 'flower', 'bunting', 'planters', 'lights', 'parasols', 'stalls')
                          ) THEN true
                          ELSE false
                        END
                ) AS ok$q$, false, true, '')))[1]::text = 'true', false) END,
         NULL
  UNION ALL
  SELECT 7, '防重複主鍵',
         to_regclass('public.member_street_saves') IS NOT NULL
         AND to_regclass('public.member_street_save_credits') IS NOT NULL
         AND to_regclass('public.member_street_save_log') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = to_regclass('public.member_street_saves') AND i.indisunique AND i.indpred IS NULL
                     AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['user_id'])
         AND EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = to_regclass('public.member_street_save_credits') AND i.indisunique AND i.indpred IS NULL
                     AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['claim_key', 'source', 'user_id'])
         AND EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = to_regclass('public.member_street_save_log') AND i.indisunique AND i.indpred IS NULL
                     AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['revision', 'user_id']),
         NULL
  UNION ALL
  SELECT 8, '存檔呼叫鏈不寫 Pay 點數且依賴都可確認',
         (SELECT count(*) = 3 AND bool_and(oid IS NOT NULL) FROM roots)
         AND NOT EXISTS (SELECT 1 FROM unresolved)
         AND NOT EXISTS (SELECT 1 FROM unsafe),
         concat_ws('、',
           (SELECT string_agg(s.sig, '、') FROM (VALUES
              ('public.save_my_street(bigint, jsonb, uuid)'),
              ('public.import_my_street_save(jsonb, uuid)'),
              ('public.get_my_street_save()')) AS s(sig)
            WHERE to_regprocedure(s.sig) IS NULL),
           (SELECT string_agg(ref, '、') FROM unresolved),
           (SELECT string_agg(problem, '、') FROM unsafe))
  UNION ALL
  SELECT 9, '遊戲 Pay 點數發放關閉',
         CASE
           WHEN to_regclass('public.game_reward_policies') IS NULL THEN false
           ELSE coalesce((xpath('/row/ok/text()', query_to_xml($q$SELECT NOT coalesce(bool_or(payout_enabled), false) AS ok FROM public.game_reward_policies$q$, false, true, '')))[1]::text = 'true', false)
         END,
         NULL
  UNION ALL
  SELECT 10, '存檔只給登入會員讀寫、內部函式不對 API 開放、資料表已啟用 RLS',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
             OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN false
           WHEN to_regprocedure('public.get_my_street_save()') IS NULL THEN false
           WHEN has_function_privilege('anon', 'public.get_my_street_save()', 'EXECUTE')
             OR NOT has_function_privilege('authenticated', 'public.get_my_street_save()', 'EXECUTE') THEN false
           ELSE NOT EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'public.street_cloud_spec()',
               'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)',
               'public.street_cloud_row_json(public.member_street_saves)',
               'public.street_decor_min_level(text)',
               'public.street_decor_slot(text)'
             ]) AS f(sig)
             WHERE CASE
                     WHEN to_regprocedure(f.sig) IS NULL THEN true
                     WHEN has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE') THEN true
                     WHEN has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE') THEN true
                     ELSE false
                   END
           )
           AND NOT EXISTS (
             SELECT 1 FROM unnest(ARRAY[
               'public.street_cloud_settings', 'public.member_street_saves',
               'public.member_street_save_credits', 'public.member_street_save_log'
             ]) AS t(name)
             WHERE CASE
                     WHEN to_regclass(t.name) IS NULL THEN true
                     WHEN NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t.name)) THEN true
                     WHEN has_table_privilege('anon', t.name, 'SELECT') OR has_table_privilege('anon', t.name, 'INSERT')
                       OR has_table_privilege('anon', t.name, 'UPDATE') OR has_table_privilege('anon', t.name, 'DELETE') THEN true
                     WHEN has_table_privilege('authenticated', t.name, 'SELECT') OR has_table_privilege('authenticated', t.name, 'INSERT')
                       OR has_table_privilege('authenticated', t.name, 'UPDATE') OR has_table_privilege('authenticated', t.name, 'DELETE') THEN true
                     ELSE false
                   END
           )
         END,
         NULL
  UNION ALL
  SELECT 11, '合成小舖 Lv.6 維持已安裝',
         to_regclass('public.member_merge_shops') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.member_merge_shops') AND conname = 'member_merge_shops_shop_level_v2')
         AND to_regprocedure('public.merge_item_ok(text)') IS NOT NULL
         AND coalesce(position('contentVersion' IN pg_get_functiondef(to_regprocedure('public.merge_shop_snapshot(public.member_merge_shops, boolean)'))) > 0, false),
         NULL
  UNION ALL
  SELECT 12, '點數商城 40 件維持開放',
         CASE
           WHEN to_regclass('public.member_perk_catalog') IS NULL OR to_regclass('public.member_perk_settings') IS NULL THEN false
           ELSE coalesce((xpath('/row/ok/text()', query_to_xml($q$
             SELECT (SELECT count(*) = 40 AND sum(cost) = 5994 FROM public.member_perk_catalog)
                AND (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS TRUE AS ok$q$, false, true, '')))[1]::text = 'true', false)
         END,
         NULL
  UNION ALL
  SELECT 13, '存檔與轉移只給登入會員且會驗證登入身分',
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
         AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
         AND coalesce((SELECT bool_and(
              CASE
                WHEN oid IS NULL THEN false
                WHEN prosecdef IS NOT TRUE THEN false
                WHEN position('auth.uid()' IN prosrc) = 0 OR position('請先登入' IN prosrc) = 0 THEN false
                WHEN position('user_id = v_uid' IN prosrc) = 0 THEN false
                WHEN has_function_privilege('anon', oid, 'EXECUTE') THEN false
                WHEN NOT has_function_privilege('authenticated', oid, 'EXECUTE') THEN false
                ELSE true
              END)
            FROM member_fn_state), false),
         (SELECT string_agg(sig, '、') FROM member_fn_state
          WHERE oid IS NULL OR prosecdef IS NOT TRUE OR position('auth.uid()' IN prosrc) = 0
             OR position('請先登入' IN prosrc) = 0 OR position('user_id = v_uid' IN prosrc) = 0
             OR CASE WHEN oid IS NULL THEN true
                     WHEN has_function_privilege('anon', oid, 'EXECUTE') THEN true
                     WHEN NOT has_function_privilege('authenticated', oid, 'EXECUTE') THEN true
                     ELSE false END)
)
SELECT 0 AS sort,
       CASE
         WHEN NOT bool_and(coalesce(ok, false)) THEN '不可套用：' || string_agg(
           item || coalesce('（' || nullif(detail, '') || '）', ''), '、' ORDER BY sort) FILTER (WHERE ok IS NOT TRUE)
         WHEN (SELECT fixed FROM ver) THEN '已套用（含套用欄位修正）'
         WHEN (SELECT all_v2 FROM ver) THEN '已套用'
         ELSE '可以套用'
       END AS item,
       bool_and(coalesce(ok, false)) AS ok
FROM checks
UNION ALL
SELECT sort, item || coalesce('（' || nullif(detail, '') || '）', ''), coalesce(ok, false) FROM checks
UNION ALL
SELECT 20 + row_number() OVER (ORDER BY name), '函式 ' || name || '：' || state, state IN ('v1', 'v2', 'v2修正') FROM fn_state
ORDER BY sort;

-- 套用前後比對。欄位不齊時這列是空值，不讓查詢中斷；欄位齊全時數字必須與套用後完全相同。
SELECT
  CASE
    WHEN NOT (to_regclass('public.member_street_saves') IS NOT NULL
              AND (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'member_street_saves'
                     AND column_name IN ('user_id', 'revision', 'coins', 'xp', 'shop_level', 'progress', 'updated_at')) = 7)
      THEN NULL
    ELSE (xpath('/row/v/text()', query_to_xml($q$
      SELECT concat_ws(' / ', count(*), coalesce(min(shop_level), 0) || '～' || coalesce(max(shop_level), 0),
                       coalesce(sum(coins), 0), coalesce(sum(xp), 0), coalesce(sum(revision), 0),
                       md5(coalesce(string_agg(concat_ws(',', user_id, revision, coins, xp, shop_level, md5(progress::text), updated_at), '|' ORDER BY user_id), ''))) AS v
      FROM public.member_street_saves$q$, false, true, '')))[1]::text
  END AS street_saves_count_levels_coins_xp_revision_md5,
  CASE WHEN to_regclass('public.member_street_save_credits') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', count(*), coalesce(sum(coins), 0), coalesce(sum(xp), 0)) AS v FROM public.member_street_save_credits$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_street_save_log') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_street_save_log$q$, false, true, '')))[1]::text::bigint END,
  CASE WHEN to_regclass('public.member_street_help_claims') IS NULL OR to_regclass('public.member_street_steal_claims') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', (SELECT count(*) FROM public.member_street_help_claims), (SELECT count(*) FROM public.member_street_steal_claims)) AS v$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', count(*), coalesce(sum(balance), 0)) AS v FROM public.member_point_accounts$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_point_entries$q$, false, true, '')))[1]::text::bigint END,
  CASE WHEN to_regclass('public.reward_claims') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.reward_claims$q$, false, true, '')))[1]::text::bigint END,
  CASE WHEN to_regclass('public.member_perk_holds') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_perk_holds$q$, false, true, '')))[1]::text::bigint END,
  CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', count(*), md5(coalesce(string_agg(s::text, '|' ORDER BY user_id), ''))) AS v FROM public.member_merge_shops AS s$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_game_reward_claims') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_game_reward_claims$q$, false, true, '')))[1]::text::bigint END,
  CASE WHEN to_regclass('public.member_game_achievements') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_game_achievements$q$, false, true, '')))[1]::text::bigint END;

ROLLBACK;
