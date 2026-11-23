-- =============================================================================
-- 第七階段第 9 批：開放點數商城兌換前的唯讀預檢。只讀，結尾 ROLLBACK，不改任何資料。
-- 第一個結果的 gate 為「可以開放」才執行 20261030020200_points_mall_open_purchase.sql。
-- 各項條件與開放 SQL 的前置檢查相同；任一項 false 即不可開放。
-- 目錄接受兩種合法上架狀態，編號、分類、價格、解鎖、販售方式、數量與排序都要對到套用檔：
--   停售前：40 筆全部上架。
--   20261030031000 停售後：仍是 40 筆，只有 sticker-party 下架，其餘 39 件維持上架。
-- =============================================================================

BEGIN READ ONLY;

WITH defs AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.purchase_my_perk(text)')) AS purchase_def,
    pg_get_functiondef(to_regprocedure('public.post_perk_unlock_debit(uuid, text, jsonb)')) AS debit_def
),
uniq AS (
  SELECT i.indrelid::regclass::text AS tbl,
         (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) AS cols
  FROM pg_index AS i
  WHERE i.indisunique AND i.indpred IS NULL
    AND i.indrelid IN (SELECT to_regclass(t) FROM unnest(ARRAY['public.member_perk_holds', 'public.reward_claims', 'public.member_point_entries']) AS t)
),
checks(sort, item, ok) AS (
  VALUES
  (1, '必要資料表與函式',
    to_regclass('public.member_perk_catalog') IS NOT NULL AND to_regclass('public.member_perk_holds') IS NOT NULL
    AND to_regclass('public.member_perk_loadout') IS NOT NULL AND to_regclass('public.member_perk_settings') IS NOT NULL
    AND to_regclass('public.member_perk_sale_windows') IS NOT NULL AND to_regclass('public.member_point_accounts') IS NOT NULL
    AND to_regclass('public.member_point_entries') IS NOT NULL AND to_regclass('public.reward_claims') IS NOT NULL
    AND to_regclass('public.commerce_settings') IS NOT NULL
    AND to_regprocedure('public.purchase_my_perk(text)') IS NOT NULL
    AND to_regprocedure('public.post_perk_unlock_debit(uuid, text, jsonb)') IS NOT NULL
    AND to_regprocedure('public.perk_sale_open(text, date)') IS NOT NULL
    AND to_regprocedure('public.perk_unlock_progress(uuid, text)') IS NOT NULL
    AND to_regprocedure('public.perk_state_json(uuid)') IS NOT NULL),
  (2, '40 筆目錄、總額 5994；停售前 40 件上架，或僅 sticker-party 下架後 39 件有效',
    (SELECT count(*) = 40 AND coalesce(sum(cost), 0) = 5994 AND bool_and(cost IS NOT NULL AND cost > 0)
        AND (
          bool_and(active)
          OR (
            count(*) FILTER (WHERE active IS NOT TRUE) = 1
            AND bool_and(active OR id = 'sticker-party')
            AND bool_and(id <> 'sticker-party' OR (cost = 150 AND active IS NOT TRUE))
          )
        )
     FROM public.member_perk_catalog)
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_perk_catalog AS c
      FULL JOIN (VALUES
        ('frame-founder', 'frame', 100, NULL::text, NULL::integer, 'always', NULL::integer, 10),
        ('frame-blackdiamond', 'frame', 150, NULL, NULL, 'always', NULL, 20),
        ('frame-koi', 'frame', 80, NULL, NULL, 'always', NULL, 30),
        ('frame-cyber', 'frame', 120, NULL, NULL, 'always', NULL, 40),
        ('frame-flame', 'frame', 200, NULL, NULL, 'always', NULL, 50),
        ('badge-honest', 'badge', 80, NULL, NULL, 'always', NULL, 60),
        ('badge-detail', 'badge', 60, NULL, NULL, 'always', NULL, 70),
        ('badge-fivestar', 'badge', 120, NULL, NULL, 'always', NULL, 80),
        ('badge-referee', 'badge', 150, NULL, NULL, 'always', NULL, 90),
        ('title-saver', 'title', 150, NULL, NULL, 'always', NULL, 100),
        ('title-flash', 'title', 120, NULL, NULL, 'always', NULL, 110),
        ('title-cart', 'title', 100, NULL, NULL, 'always', NULL, 120),
        ('title-hunter', 'title', 250, NULL, NULL, 'always', NULL, 130),
        ('skin-cyber', 'skin', 200, NULL, NULL, 'always', NULL, 140),
        ('skin-ink', 'skin', 300, NULL, NULL, 'always', NULL, 150),
        ('bubble-milktea', 'bubble', 80, NULL, NULL, 'always', NULL, 160),
        ('bubble-memo', 'bubble', 100, NULL, NULL, 'always', NULL, 170),
        ('bubble-neon', 'bubble', 150, NULL, NULL, 'always', NULL, 180),
        ('frame-sakura', 'frame', 160, NULL, NULL, 'always', NULL, 190),
        ('title-merge-boss', 'title', 180, 'merge.shop_level', 5, 'always', NULL, 200),
        ('title-street-star', 'title', 220, 'street.rank', 10, 'always', NULL, 210),
        ('pet-cat', 'pet', 120, NULL, NULL, 'always', NULL, 220),
        ('pet-shiba', 'pet', 120, NULL, NULL, 'always', NULL, 230),
        ('pet-penguin', 'pet', 200, NULL, NULL, 'always', NULL, 240),
        ('decor-balloon', 'decor', 120, 'street.shop_level', 2, 'always', NULL, 250),
        ('decor-neon', 'decor', 180, 'street.shop_level', 3, 'always', NULL, 260),
        ('decor-fountain', 'decor', 260, 'street.shop_level', 4, 'always', NULL, 270),
        ('board-wood', 'board', 90, NULL, NULL, 'always', NULL, 280),
        ('board-arcade', 'board', 140, NULL, NULL, 'always', NULL, 290),
        ('board-jade', 'board', 220, NULL, NULL, 'always', NULL, 300),
        ('scene-sakura', 'scene', 100, NULL, NULL, 'always', NULL, 310),
        ('scene-harbor', 'scene', 120, NULL, NULL, 'always', NULL, 320),
        ('scene-night', 'scene', 180, NULL, NULL, 'always', NULL, 330),
        ('effect-snow', 'effect', 100, NULL, NULL, 'always', NULL, 340),
        ('effect-hearts', 'effect', 120, NULL, NULL, 'always', NULL, 350),
        ('effect-coins', 'effect', 200, NULL, NULL, 'always', NULL, 360),
        ('collect-newyear', 'collection', 168, NULL, NULL, 'festival', 500, 370),
        ('collect-moon', 'collection', 168, NULL, NULL, 'festival', 500, 380),
        ('collect-snowman', 'collection', 168, NULL, NULL, 'festival', 500, 390),
        ('sticker-party', 'sticker', 150, NULL, NULL, 'always', NULL, 400)
      ) AS e(id, category, cost, unlock_metric, unlock_target, sale_kind, stock_limit, sort)
        ON c.id = e.id
      WHERE c.id IS NULL OR e.id IS NULL
         OR c.category IS DISTINCT FROM e.category
         OR c.cost IS DISTINCT FROM e.cost
         OR c.unlock_metric IS DISTINCT FROM e.unlock_metric
         OR c.unlock_target IS DISTINCT FROM e.unlock_target
         OR c.sale_kind IS DISTINCT FROM e.sale_kind
         OR c.stock_limit IS DISTINCT FROM e.stock_limit
         OR c.sort IS DISTINCT FROM e.sort
    )),
  (3, '節慶商品 3 件；販售期間為原版各 10 筆共 30 筆，或補到 2050 年各 25 筆共 75 筆',
    (SELECT count(*) = 3 FROM public.member_perk_catalog WHERE sale_kind = 'festival')
    AND NOT EXISTS (SELECT 1 FROM public.member_perk_sale_windows AS w JOIN public.member_perk_catalog AS c ON c.id = w.perk_id
                    WHERE c.sale_kind IS DISTINCT FROM 'festival')
    AND (
      (
        (SELECT count(*) = 30 FROM public.member_perk_sale_windows)
        AND NOT EXISTS (SELECT 1 FROM public.member_perk_catalog AS c WHERE c.sale_kind = 'festival'
                        AND (SELECT count(*) FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id) <> 10)
      )
      OR (
        (SELECT count(*) = 75 FROM public.member_perk_sale_windows)
        AND (SELECT count(*) = 30 FROM public.member_perk_sale_windows WHERE starts_on < DATE '2036-01-01')
        AND NOT EXISTS (SELECT 1 FROM public.member_perk_catalog AS c WHERE c.sale_kind = 'festival'
                        AND (SELECT count(*) FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id) <> 25)
        AND NOT EXISTS (SELECT 1 FROM public.member_perk_catalog AS c WHERE c.sale_kind = 'festival'
                        AND (SELECT count(*) FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id AND w.starts_on < DATE '2036-01-01') <> 10)
      )
    )),
  (4, '數量上限 3 件各 500、解鎖條件 5 件',
    (SELECT count(*) FILTER (WHERE stock_limit IS NOT NULL) = 3
        AND count(*) FILTER (WHERE stock_limit IS NOT NULL AND (sale_kind IS DISTINCT FROM 'festival' OR stock_limit <> 500)) = 0
        AND count(*) FILTER (WHERE unlock_metric IS NOT NULL) = 5
     FROM public.member_perk_catalog)),
  (5, '兌換開關只有一列',
    (SELECT count(*) = 1 AND bool_and(id) FROM public.member_perk_settings)),
  (6, 'checkout_enabled = false',
    to_regclass('public.commerce_settings') IS NOT NULL
    AND (xpath('/row/ok/text()', query_to_xml('SELECT count(*) = 1 AND bool_and(checkout_enabled = false) AS ok FROM public.commerce_settings', false, true, '')))[1]::text = 'true'),
  (7, '遊戲 Pay 點數發放關閉',
    to_regclass('public.game_reward_policies') IS NULL
    OR coalesce((xpath('/row/ok/text()', query_to_xml('SELECT NOT coalesce(bool_or(payout_enabled), false) AS ok FROM public.game_reward_policies', false, true, '')))[1]::text, 'false') = 'true'),
  (8, '兌換入口：登入、開關、販售期間、解鎖、數量、扣點、入庫、防重複',
    (SELECT purchase_def IS NOT NULL
        AND position('auth.uid()' IN purchase_def) > 0 AND position('請先登入' IN purchase_def) > 0
        AND position('member_perk_settings' IN purchase_def) > 0 AND position('虛擬特權購買尚未開放' IN purchase_def) > 0
        AND position('perk_sale_open' IN purchase_def) > 0 AND position('perk_unlock_progress' IN purchase_def) > 0
        AND position('stock_limit' IN purchase_def) > 0 AND position('點數不足' IN purchase_def) > 0
        AND position('post_perk_unlock_debit' IN purchase_def) > 0 AND position('INSERT INTO public.member_perk_holds (' IN purchase_def) > 0
        AND position('replayed' IN purchase_def) > 0 AND position('pg_advisory_xact_lock' IN purchase_def) > 0
        AND position('post_member_reward' IN purchase_def) = 0
        AND purchase_def !~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)'
     FROM defs)),
  (9, '扣點函式：讀目錄價格、寫點數流水與領獎紀錄',
    (SELECT debit_def IS NOT NULL
        AND position('app.perk_purchase' IN debit_def) > 0 AND position('member_perk_catalog' IN debit_def) > 0
        AND position('INSERT INTO public.member_point_entries (' IN debit_def) > 0 AND position('INSERT INTO public.reward_claims (' IN debit_def) > 0
        AND position('UPDATE public.member_point_accounts' IN debit_def) > 0 AND position('p_delta' IN debit_def) = 0
     FROM defs)),
  (10, '兌換與扣點函式為 SECURITY DEFINER',
    coalesce((SELECT bool_and(prosecdef) AND count(*) = 2 FROM pg_proc
              WHERE oid IN (to_regprocedure('public.purchase_my_perk(text)'), to_regprocedure('public.post_perk_unlock_debit(uuid, text, jsonb)'))), false)),
  (11, '防重複唯一鍵',
    EXISTS (SELECT 1 FROM uniq WHERE tbl = 'member_perk_holds' AND cols = ARRAY['perk_id', 'user_id'])
    AND EXISTS (SELECT 1 FROM uniq WHERE tbl = 'reward_claims' AND cols = ARRAY['claim_key', 'user_id'])
    AND EXISTS (SELECT 1 FROM uniq WHERE tbl = 'member_point_entries' AND cols = ARRAY['claim_key', 'user_id'])),
  (12, '兌換入口只給登入會員',
    to_regprocedure('public.purchase_my_perk(text)') IS NOT NULL
    AND NOT has_function_privilege('anon', 'public.purchase_my_perk(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.purchase_my_perk(text)', 'EXECUTE')),
  (13, '內部函式不對 API 開放',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.post_perk_unlock_debit(uuid, text, jsonb)', 'public.perk_sale_open(text, date)',
                                           'public.perk_unlock_progress(uuid, text)', 'public.perk_state_json(uuid)']) AS f
                WHERE to_regprocedure(f) IS NULL
                   OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE'))),
  (14, '會員不能直接寫商城與點數資料表、且已啟用 RLS',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.member_perk_catalog', 'public.member_perk_holds', 'public.member_perk_loadout',
                                           'public.member_perk_settings', 'public.member_perk_sale_windows',
                                           'public.member_point_accounts', 'public.member_point_entries', 'public.reward_claims']) AS t
                WHERE to_regclass(t) IS NULL
                   OR has_table_privilege('anon', t, 'INSERT') OR has_table_privilege('anon', t, 'UPDATE') OR has_table_privilege('anon', t, 'DELETE')
                   OR has_table_privilege('authenticated', t, 'INSERT') OR has_table_privilege('authenticated', t, 'UPDATE') OR has_table_privilege('authenticated', t, 'DELETE')
                   OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t)))),
  (15, '開關與目錄保護觸發器',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.member_perk_settings') AND NOT tgisinternal AND tgenabled <> 'D')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.member_perk_catalog') AND NOT tgisinternal AND tgenabled <> 'D'))
)
SELECT 0 AS sort,
       CASE
         WHEN bool_and(coalesce(ok, false)) AND (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS TRUE THEN '已開放'
         WHEN bool_and(coalesce(ok, false)) THEN '可以開放'
         ELSE '不可開放：' || string_agg(item, '、' ORDER BY sort) FILTER (WHERE ok IS NOT TRUE)
       END AS item,
       bool_and(coalesce(ok, false)) AS ok
FROM checks
UNION ALL
SELECT sort, item, coalesce(ok, false) FROM checks
ORDER BY sort;

-- 開放前後比對用：開放 SQL 不應改變以下任何數字。
SELECT
  (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) AS purchase_enabled,
  (SELECT count(*) FROM public.member_perk_catalog) AS catalog_rows,
  (SELECT sum(cost) FROM public.member_perk_catalog) AS catalog_cost_total,
  (SELECT count(*) FROM public.member_perk_sale_windows) AS sale_windows,
  (SELECT count(*) FROM public.member_perk_holds) AS hold_rows,
  (SELECT count(*) FROM public.member_point_accounts) AS point_accounts,
  (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) AS point_balance_total,
  (SELECT count(*) FROM public.member_point_entries) AS point_entries,
  (SELECT count(*) FROM public.reward_claims) AS reward_claims;

ROLLBACK;
