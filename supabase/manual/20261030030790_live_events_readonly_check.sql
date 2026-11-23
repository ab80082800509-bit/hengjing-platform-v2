-- =============================================================================
-- 第七階段第 9 批：活動輪替套用前的唯讀預檢（對應 20261030030700_live_events_apply.sql）。
-- 只讀，不建立、不修改任何物件，結尾 ROLLBACK。結果只有一列。
--   已安裝且相容：函式本文、欄位、列級安全、正好三欄的領獎防重主鍵、
--                 會員／匿名／PUBLIC 權限、活動列與套用檔一致。
--                 節慶窗口接受原版，或原版再加上 20261030031200 補上的兩筆清明。
--                 必要依賴 member_merge_shop_events 就緒，而且已確認遊戲 Pay 點數發放關閉。
--   尚未安裝：活動物件完全未安裝，或部分安裝。原因欄會寫明是哪一種。
--             這個判定只描述現況，不是執行套用檔的指示。
--   版本不相容：已存在的物件與套用檔不同，防重主鍵多出欄位，權限超過套用檔，
--               或無法確認遊戲 Pay 點數發放關閉。
-- 函式指紋與目錄指紋都取自套用檔，不是從待檢資料庫抄下來的。
-- 目錄指紋是每一列的題目、目標、遊戲、週期、節慶、勳章、點數、active 或起訖日期，
-- 依固定順序串成一行再取 md5。筆數相同但任一欄不同，指紋就不同。
-- 動態查詢先確認欄位與型別；缺少或型別不符時只把原因寫進結果，不中斷整份預檢。
-- 本查詢不呼叫 live_event_state / live_event_claim，避免預檢順便寫入活動紀錄。
-- =============================================================================

BEGIN READ ONLY;

WITH fn(name, sig, fingerprint, secdef, volatility) AS (
  VALUES
  ('live_event_period', 'public.live_event_period(text,timestamptz)', 'fb4bae7e652fccb5c201bed4c70e5ef4', false, 's'),
  ('live_event_available', 'public.live_event_available(text)', '4426baa27c7f6b85e4dcab1083460f66', false, 's'),
  ('live_event_metric', 'public.live_event_metric(uuid,text,timestamptz,timestamptz)', 'a19a35a8d6650e77be6585def297e340', false, 's'),
  ('live_event_state', 'public.live_event_state(uuid,timestamptz)', '6d20260c226a3309da51bd4ce9a5139f', true, 'v'),
  ('live_event_claim', 'public.live_event_claim(uuid,text,timestamptz)', '2b84e60ccab88ea4708e76152c337b81', true, 'v'),
  ('get_my_live_events', 'public.get_my_live_events()', '519d565a8e669d0f6bff11c7f65419b8', true, 'v'),
  ('claim_my_live_event', 'public.claim_my_live_event(text)', '783d943a672a09eae4732611b8547e04', true, 'v')
),
fingerprint(kind, md5) AS (
  VALUES
  ('events', 'abbeb85cee78aa9d5fa3343f65c09f94'),
  ('windows', 'f8acaae3b8c2ea3d3af9f0b791b82b76'),
  ('windows_completed', '5524c3eda2565dc47df464d5346838d5')
),
fn_state AS (
  SELECT fn.name,
         CASE
           WHEN p.oid IS NULL THEN '缺少'
           WHEN md5(replace(p.prosrc, E'\r\n', E'\n')) = fn.fingerprint
             AND p.prosecdef = fn.secdef
             AND p.provolatile = fn.volatility::"char"
             AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog']
           THEN '相容'
           ELSE '未知版本'
         END AS state
  FROM fn
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(fn.sig)
),
cols(tbl, col, typ, nullable) AS (
  VALUES
  ('game_live_events', 'id', 'text', 'NO'),
  ('game_live_events', 'game_id', 'text', 'NO'),
  ('game_live_events', 'cadence', 'text', 'NO'),
  ('game_live_events', 'festival_id', 'text', 'YES'),
  ('game_live_events', 'variants', 'jsonb', 'NO'),
  ('game_live_events', 'medal', 'text', 'NO'),
  ('game_live_events', 'pay_points', 'integer', 'NO'),
  ('game_live_events', 'active', 'boolean', 'NO'),
  ('game_live_festival_windows', 'festival_id', 'text', 'NO'),
  ('game_live_festival_windows', 'starts_on', 'date', 'NO'),
  ('game_live_festival_windows', 'ends_on', 'date', 'NO'),
  ('member_live_event_entries', 'user_id', 'uuid', 'NO'),
  ('member_live_event_entries', 'event_id', 'text', 'NO'),
  ('member_live_event_entries', 'period_key', 'text', 'NO'),
  ('member_live_event_entries', 'variant', 'integer', 'NO'),
  ('member_live_event_entries', 'baseline', 'integer', 'NO'),
  ('member_live_event_entries', 'joined_at', 'timestamp with time zone', 'NO'),
  ('member_live_event_entries', 'claimed_at', 'timestamp with time zone', 'YES')
),
col_state AS (
  SELECT v.tbl, v.col,
         CASE
           WHEN to_regclass('public.' || v.tbl) IS NULL THEN '缺少資料表'
           WHEN c.column_name IS NULL THEN '缺少欄位'
           WHEN c.data_type IS DISTINCT FROM v.typ OR c.is_nullable IS DISTINCT FROM v.nullable THEN '型別不符'
           ELSE '相容'
         END AS state
  FROM cols AS v
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public' AND c.table_name = v.tbl AND c.column_name = v.col
),
tables(name) AS (
  VALUES ('game_live_events'), ('game_live_festival_windows'), ('member_live_event_entries')
),
rls AS (
  SELECT CASE
           WHEN EXISTS (
             SELECT 1 FROM tables AS t
             JOIN pg_class AS c ON c.oid = to_regclass('public.' || t.name)
             WHERE NOT c.relrowsecurity
           ) THEN '未開列級安全'
           WHEN EXISTS (SELECT 1 FROM tables AS t WHERE to_regclass('public.' || t.name) IS NULL) THEN '缺少'
           ELSE '已開'
         END AS state
),
guard AS (
  SELECT CASE
           WHEN to_regclass('public.member_live_event_entries') IS NULL THEN '缺少'
           WHEN NOT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('public.member_live_event_entries') AND contype = 'p'
           ) THEN '主鍵缺少'
           ELSE (
             SELECT CASE
                      WHEN cols = ARRAY['event_id', 'period_key', 'user_id']::text[] THEN '防重主鍵在'
                      WHEN cols @> ARRAY['event_id', 'period_key', 'user_id']::text[] THEN '主鍵範圍不符'
                      ELSE '主鍵缺少'
                    END
             FROM (
               SELECT coalesce(array_agg(att.attname::text ORDER BY att.attname), ARRAY[]::text[]) AS cols
               FROM pg_constraint AS c
               CROSS JOIN LATERAL unnest(c.conkey) AS u(attnum)
               JOIN pg_attribute AS att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
               WHERE c.conrelid = to_regclass('public.member_live_event_entries') AND c.contype = 'p'
             ) AS pk
           )
         END AS state
),
pay_gate AS (
  SELECT CASE
           WHEN to_regclass('public.game_live_events') IS NULL THEN '缺少'
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'game_live_events' AND column_name = 'pay_points'
           ) THEN '缺少'
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'game_live_events'
               AND column_name = 'pay_points' AND data_type = 'integer' AND is_nullable = 'NO'
           ) THEN '型別不符'
           WHEN NOT EXISTS (
             SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('public.game_live_events')
               AND contype = 'c'
               AND pg_get_constraintdef(oid) ILIKE '%pay_points = 0%'
           ) THEN '檢查缺少'
           WHEN coalesce((xpath('/row/v/text()', query_to_xml(
             $q$SELECT (count(*) FILTER (WHERE pay_points <> 0))::text AS v FROM public.game_live_events$q$,
             false, true, '')))[1]::text, '1') <> '0' THEN '已開啟'
           ELSE '關閉'
         END AS state
),
fn_priv(sig, role, allow) AS (
  VALUES
  ('public.live_event_period(text,timestamptz)', 'public', false),
  ('public.live_event_period(text,timestamptz)', 'anon', false),
  ('public.live_event_period(text,timestamptz)', 'authenticated', false),
  ('public.live_event_available(text)', 'public', false),
  ('public.live_event_available(text)', 'anon', false),
  ('public.live_event_available(text)', 'authenticated', false),
  ('public.live_event_metric(uuid,text,timestamptz,timestamptz)', 'public', false),
  ('public.live_event_metric(uuid,text,timestamptz,timestamptz)', 'anon', false),
  ('public.live_event_metric(uuid,text,timestamptz,timestamptz)', 'authenticated', false),
  ('public.live_event_state(uuid,timestamptz)', 'public', false),
  ('public.live_event_state(uuid,timestamptz)', 'anon', false),
  ('public.live_event_state(uuid,timestamptz)', 'authenticated', false),
  ('public.live_event_claim(uuid,text,timestamptz)', 'public', false),
  ('public.live_event_claim(uuid,text,timestamptz)', 'anon', false),
  ('public.live_event_claim(uuid,text,timestamptz)', 'authenticated', false),
  ('public.get_my_live_events()', 'public', false),
  ('public.get_my_live_events()', 'anon', false),
  ('public.get_my_live_events()', 'authenticated', true),
  ('public.claim_my_live_event(text)', 'public', false),
  ('public.claim_my_live_event(text)', 'anon', false),
  ('public.claim_my_live_event(text)', 'authenticated', true)
),
tbl_priv(role, priv) AS (
  VALUES
  ('public', 'SELECT'), ('public', 'INSERT'), ('public', 'UPDATE'), ('public', 'DELETE'), ('public', 'TRUNCATE'), ('public', 'REFERENCES'), ('public', 'TRIGGER'),
  ('anon', 'SELECT'), ('anon', 'INSERT'), ('anon', 'UPDATE'), ('anon', 'DELETE'), ('anon', 'TRUNCATE'), ('anon', 'REFERENCES'), ('anon', 'TRIGGER'),
  ('authenticated', 'SELECT'), ('authenticated', 'INSERT'), ('authenticated', 'UPDATE'), ('authenticated', 'DELETE'), ('authenticated', 'TRUNCATE'), ('authenticated', 'REFERENCES'), ('authenticated', 'TRIGGER')
),
member_gate AS (
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
             OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
           THEN '缺少'
           WHEN EXISTS (
             SELECT 1 FROM fn_priv AS v
             WHERE CASE
                     WHEN to_regprocedure(v.sig) IS NULL THEN false
                     ELSE has_function_privilege(v.role, v.sig, 'EXECUTE') IS DISTINCT FROM v.allow
                   END
           ) OR EXISTS (
             SELECT 1 FROM tables AS t
             CROSS JOIN tbl_priv AS v
             WHERE CASE
                     WHEN to_regclass('public.' || t.name) IS NULL THEN false
                     ELSE has_table_privilege(v.role, 'public.' || t.name, v.priv)
                   END
           )
           THEN '權限過寬'
           WHEN EXISTS (SELECT 1 FROM fn_state WHERE state = '缺少')
             OR EXISTS (SELECT 1 FROM tables AS t WHERE to_regclass('public.' || t.name) IS NULL)
           THEN '缺少'
           WHEN NOT has_function_privilege('authenticated', 'public.get_my_live_events()', 'EXECUTE')
             OR NOT has_function_privilege('authenticated', 'public.claim_my_live_event(text)', 'EXECUTE')
           THEN '會員不能領'
           ELSE '僅會員入口'
         END AS state
),
catalog_ready AS (
  SELECT
    bool_or(tbl IN ('game_live_events', 'game_live_festival_windows') AND state = '缺少資料表') AS missing_table,
    bool_or(tbl IN ('game_live_events', 'game_live_festival_windows') AND state = '型別不符') AS bad_type,
    bool_or(tbl IN ('game_live_events', 'game_live_festival_windows') AND state = '缺少欄位') AS missing_col,
    bool_and(tbl NOT IN ('game_live_events', 'game_live_festival_windows') OR state = '相容') AS ready
  FROM col_state
),
catalog_pack AS (
  SELECT CASE
           WHEN NOT COALESCE((SELECT ready FROM catalog_ready), false) THEN NULL
           ELSE (xpath('/row/v/text()', query_to_xml($q$
             SELECT concat_ws('~',
               (SELECT count(*)::text FROM public.game_live_events),
               (SELECT md5(coalesce(string_agg(
                  id || '|' || game_id || '|' || cadence || '|' || coalesce(festival_id, '') || '|' || coalesce((
                    SELECT string_agg((elem ->> 'metric') || ':' || (elem ->> 'target'), ',' ORDER BY n)
                    FROM jsonb_array_elements(variants) WITH ORDINALITY AS variant_item(elem, n)
                  ), '') || '|' || medal || '|' || pay_points::text || '|' || active::text,
                  E'\n' ORDER BY id COLLATE "C"
                ), '')) FROM public.game_live_events),
               (SELECT count(*)::text FROM public.game_live_festival_windows),
               (SELECT md5(coalesce(string_agg(
                  festival_id || '|' || to_char(starts_on, 'YYYY-MM-DD') || '|' || to_char(ends_on, 'YYYY-MM-DD'),
                  E'\n' ORDER BY festival_id COLLATE "C", starts_on, ends_on
                ), '')) FROM public.game_live_festival_windows)
             ) AS v
           $q$, false, true, '')))[1]::text
         END AS packed
),
catalog AS (
  SELECT CASE
           WHEN COALESCE((SELECT missing_table FROM catalog_ready), true) THEN '缺少'
           WHEN COALESCE((SELECT bad_type FROM catalog_ready), false) THEN '型別不符'
           WHEN COALESCE((SELECT missing_col FROM catalog_ready), false) THEN '缺少欄位'
           WHEN packed IS NULL
             OR split_part(packed, '~', 1) = '0'
             OR split_part(packed, '~', 3) = '0' THEN '尚未寫入'
           WHEN split_part(packed, '~', 2) IS DISTINCT FROM (SELECT md5 FROM fingerprint WHERE kind = 'events')
             OR (
               split_part(packed, '~', 4) IS DISTINCT FROM (SELECT md5 FROM fingerprint WHERE kind = 'windows')
               AND split_part(packed, '~', 4) IS DISTINCT FROM (SELECT md5 FROM fingerprint WHERE kind = 'windows_completed')
             ) THEN '內容不符'
           ELSE '相容'
         END AS state
  FROM catalog_pack
),
payout AS (
  SELECT CASE
           WHEN to_regclass('public.game_reward_policies') IS NULL THEN '缺少資料表'
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'game_reward_policies' AND column_name = 'payout_enabled'
           ) THEN '缺少欄位'
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'game_reward_policies'
               AND column_name = 'payout_enabled' AND data_type = 'boolean'
           ) THEN '型別不符'
           ELSE coalesce((xpath('/row/v/text()', query_to_xml($q$
             SELECT CASE
               WHEN count(*) = 0 THEN '無法確認'
               WHEN coalesce(bool_or(payout_enabled), false) THEN '已開啟'
               ELSE '關閉'
             END AS v
             FROM public.game_reward_policies
           $q$, false, true, '')))[1]::text, '無法確認')
         END AS state
),
src(kind, tbl, col, typ, nullable) AS (
  VALUES
  ('merge', 'member_merge_shop_events', 'user_id', 'uuid', 'NO'),
  ('merge', 'member_merge_shop_events', 'action_type', 'text', 'NO'),
  ('merge', 'member_merge_shop_events', 'created_at', 'timestamp with time zone', 'NO'),
  ('street', 'member_street_saves', 'user_id', 'uuid', 'NO'),
  ('street', 'member_street_saves', 'progress', 'jsonb', 'NO'),
  ('block', 'block_ranked_runs', 'user_id', 'uuid', 'NO'),
  ('block', 'block_ranked_runs', 'status', 'text', 'NO'),
  ('block', 'block_ranked_runs', 'submitted_at', 'timestamp with time zone', 'YES'),
  ('block', 'block_ranked_runs', 'score', 'integer', 'YES')
),
src_state AS (
  SELECT s.kind,
         CASE
           WHEN to_regclass('public.' || min(s.tbl)) IS NULL AND s.kind = 'merge' THEN '缺少資料表'
           WHEN to_regclass('public.' || min(s.tbl)) IS NULL THEN '未就緒'
           WHEN bool_or(c.column_name IS NULL) THEN '缺少欄位'
           WHEN bool_or(c.data_type IS DISTINCT FROM s.typ OR c.is_nullable IS DISTINCT FROM s.nullable) THEN '型別不符'
           ELSE '就緒'
         END AS state
  FROM src AS s
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public' AND c.table_name = s.tbl AND c.column_name = s.col
  GROUP BY s.kind
),
snap_need(tbl, col, typ) AS (
  VALUES
  ('member_point_accounts', 'balance', 'integer'),
  ('member_street_saves', 'coins', 'bigint'),
  ('member_street_saves', 'xp', 'bigint')
),
snap AS (
  SELECT
    CASE
      WHEN to_regclass('public.game_live_events') IS NULL THEN '缺少資料表'
      WHEN EXISTS (SELECT 1 FROM col_state WHERE tbl = 'game_live_events' AND col = 'pay_points' AND state = '缺少欄位') THEN '欄位缺少'
      WHEN EXISTS (SELECT 1 FROM col_state WHERE tbl = 'game_live_events' AND col = 'pay_points' AND state = '型別不符') THEN '型別不符'
      ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws('/', count(*), coalesce(sum(pay_points), 0)) AS v FROM public.game_live_events$q$, false, true, '')))[1]::text
    END AS live_events,
    CASE
      WHEN to_regclass('public.member_live_event_entries') IS NULL THEN '缺少資料表'
      WHEN EXISTS (SELECT 1 FROM col_state WHERE tbl = 'member_live_event_entries' AND col = 'claimed_at' AND state = '缺少欄位') THEN '欄位缺少'
      WHEN EXISTS (SELECT 1 FROM col_state WHERE tbl = 'member_live_event_entries' AND col = 'claimed_at' AND state = '型別不符') THEN '型別不符'
      ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws('/', count(*), count(*) FILTER (WHERE claimed_at IS NOT NULL)) AS v FROM public.member_live_event_entries$q$, false, true, '')))[1]::text
    END AS live_entries,
    CASE WHEN to_regclass('public.game_live_festival_windows') IS NULL THEN '缺少資料表'
         ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*)::text AS v FROM public.game_live_festival_windows$q$, false, true, '')))[1]::text
    END AS festival_windows,
    CASE
      WHEN to_regclass('public.member_point_accounts') IS NULL THEN '缺少資料表'
      WHEN NOT EXISTS (SELECT 1 FROM snap_need AS n JOIN information_schema.columns AS c ON c.table_schema = 'public' AND c.table_name = n.tbl AND c.column_name = n.col WHERE n.tbl = 'member_point_accounts') THEN '欄位缺少'
      WHEN EXISTS (SELECT 1 FROM snap_need AS n JOIN information_schema.columns AS c ON c.table_schema = 'public' AND c.table_name = n.tbl AND c.column_name = n.col WHERE n.tbl = 'member_point_accounts' AND c.data_type IS DISTINCT FROM n.typ) THEN '型別不符'
      ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws('/', count(*), coalesce(sum(balance), 0)) AS v FROM public.member_point_accounts$q$, false, true, '')))[1]::text
    END AS point_accounts,
    CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN '缺少資料表'
         ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*)::text AS v FROM public.member_point_entries$q$, false, true, '')))[1]::text
    END AS point_entries,
    CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN '缺少資料表'
         ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*)::text AS v FROM public.member_merge_shops$q$, false, true, '')))[1]::text
    END AS merge_shops,
    CASE
      WHEN to_regclass('public.member_street_saves') IS NULL THEN '缺少資料表'
      WHEN EXISTS (SELECT 1 FROM snap_need AS n WHERE n.tbl = 'member_street_saves' AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS c WHERE c.table_schema = 'public' AND c.table_name = n.tbl AND c.column_name = n.col)) THEN '欄位缺少'
      WHEN EXISTS (SELECT 1 FROM snap_need AS n JOIN information_schema.columns AS c ON c.table_schema = 'public' AND c.table_name = n.tbl AND c.column_name = n.col WHERE n.tbl = 'member_street_saves' AND c.data_type IS DISTINCT FROM n.typ) THEN '型別不符'
      ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws('/', count(*), coalesce(sum(coins), 0), coalesce(sum(xp), 0)) AS v FROM public.member_street_saves$q$, false, true, '')))[1]::text
    END AS street_saves,
    CASE WHEN to_regclass('public.block_ranked_runs') IS NULL THEN '缺少資料表'
         ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*)::text AS v FROM public.block_ranked_runs$q$, false, true, '')))[1]::text
    END AS block_runs
),
scope AS (
  SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM fn_state WHERE state <> '缺少')
            AND NOT EXISTS (SELECT 1 FROM col_state WHERE state <> '缺少資料表')
           THEN '完全未安裝'
           WHEN EXISTS (SELECT 1 FROM fn_state WHERE state = '缺少')
             OR EXISTS (SELECT 1 FROM col_state WHERE state IN ('缺少資料表', '缺少欄位'))
             OR (SELECT state FROM catalog) IN ('缺少', '尚未寫入', '缺少欄位')
           THEN '部分安裝'
           ELSE NULL
         END AS state
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM fn_state WHERE state = '未知版本')
      OR EXISTS (SELECT 1 FROM col_state WHERE state = '型別不符')
      OR (SELECT state FROM rls) = '未開列級安全'
      OR (SELECT state FROM guard) IN ('主鍵缺少', '主鍵範圍不符')
      OR (SELECT state FROM pay_gate) IN ('檢查缺少', '已開啟', '型別不符')
      OR (SELECT state FROM member_gate) IN ('權限過寬', '會員不能領')
      OR (SELECT state FROM catalog) IN ('內容不符', '型別不符')
      OR (SELECT state FROM payout) IN ('已開啟', '型別不符')
    THEN '版本不相容'
    WHEN EXISTS (SELECT 1 FROM fn_state WHERE state = '缺少')
      OR EXISTS (SELECT 1 FROM col_state WHERE state IN ('缺少資料表', '缺少欄位'))
      OR (SELECT state FROM rls) = '缺少'
      OR (SELECT state FROM guard) = '缺少'
      OR (SELECT state FROM pay_gate) = '缺少'
      OR (SELECT state FROM member_gate) = '缺少'
      OR (SELECT state FROM catalog) IN ('缺少', '尚未寫入', '缺少欄位')
    THEN '尚未安裝'
    WHEN (SELECT state FROM payout) IS DISTINCT FROM '關閉'
      OR (SELECT state FROM src_state WHERE kind = 'merge') IS DISTINCT FROM '就緒'
    THEN '版本不相容'
    ELSE '已安裝且相容'
  END AS judgment,
  coalesce(nullif(concat_ws('；',
    (SELECT state FROM scope),
    (SELECT string_agg(name || ' ' || state, '、' ORDER BY name) FROM fn_state WHERE state <> '相容'),
    (SELECT string_agg(msg, '、' ORDER BY msg) FROM (
       SELECT DISTINCT CASE WHEN state = '缺少資料表' THEN tbl || ' 缺少資料表' ELSE tbl || '.' || col || ' ' || state END AS msg
       FROM col_state WHERE state <> '相容'
     ) AS bad_cols),
    (SELECT CASE WHEN state <> '已開' THEN '列級安全 ' || state END FROM rls),
    (SELECT CASE WHEN state <> '防重主鍵在' THEN '領獎防重 ' || state END FROM guard),
    (SELECT CASE WHEN state <> '關閉' THEN '活動 Pay 點數 ' || state END FROM pay_gate),
    (SELECT CASE WHEN state <> '僅會員入口' THEN '會員權限 ' || state END FROM member_gate),
    (SELECT CASE WHEN state <> '相容' THEN '活動目錄 ' || state END FROM catalog),
    (SELECT CASE
              WHEN state = '已開啟' THEN '遊戲 Pay 點數發放已開啟'
              WHEN state = '關閉' THEN NULL
              ELSE '遊戲 Pay 點數發放設定' || state || '，無法確認關閉'
            END FROM payout),
    (SELECT CASE WHEN state <> '就緒' THEN '必要依賴 member_merge_shop_events ' || state END FROM src_state WHERE kind = 'merge')
  ), ''), '無') AS reasons,
  (SELECT state FROM fn_state WHERE name = 'live_event_period') AS fn_live_event_period,
  (SELECT state FROM fn_state WHERE name = 'live_event_available') AS fn_live_event_available,
  (SELECT state FROM fn_state WHERE name = 'live_event_metric') AS fn_live_event_metric,
  (SELECT state FROM fn_state WHERE name = 'live_event_state') AS fn_live_event_state,
  (SELECT state FROM fn_state WHERE name = 'live_event_claim') AS fn_live_event_claim,
  (SELECT state FROM fn_state WHERE name = 'get_my_live_events') AS fn_get_my_live_events,
  (SELECT state FROM fn_state WHERE name = 'claim_my_live_event') AS fn_claim_my_live_event,
  coalesce((SELECT string_agg(msg, '、' ORDER BY msg) FROM (
     SELECT DISTINCT CASE WHEN state = '缺少資料表' THEN tbl || ' 缺少資料表' ELSE tbl || '.' || col || ' ' || state END AS msg
     FROM col_state WHERE state <> '相容'
   ) AS shown), '相容') AS tables_columns,
  (SELECT state FROM rls) AS rls_state,
  (SELECT state FROM guard) AS claim_guard,
  (SELECT state FROM pay_gate) AS pay_points_gate,
  (SELECT state FROM member_gate) AS member_access,
  (SELECT state FROM catalog) AS catalog_state,
  (SELECT live_events FROM snap) AS snap_live_events,
  (SELECT live_entries FROM snap) AS snap_live_entries,
  (SELECT festival_windows FROM snap) AS snap_festival_windows,
  (SELECT point_accounts FROM snap) AS snap_point_accounts,
  (SELECT point_entries FROM snap) AS snap_point_entries,
  (SELECT merge_shops FROM snap) AS snap_merge_shops,
  (SELECT street_saves FROM snap) AS snap_street_saves,
  (SELECT block_runs FROM snap) AS snap_block_runs,
  (SELECT state FROM payout) AS snap_game_reward_payout,
  (SELECT state FROM src_state WHERE kind = 'merge') AS source_merge_events,
  (SELECT state FROM src_state WHERE kind = 'street') AS source_street_saves,
  (SELECT state FROM src_state WHERE kind = 'block') AS source_block_runs;

ROLLBACK;
