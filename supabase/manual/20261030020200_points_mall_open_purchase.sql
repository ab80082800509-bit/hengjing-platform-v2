-- =============================================================================
-- 第七階段第 9 批：開放 Pay 點數商城虛擬商品兌換（最小變更）
-- 前提：20261030020100_points_mall_v2_apply.sql 已套用，且站長已核准 40 件價格表。
-- 執行前先跑唯讀預檢 20261030020190_points_mall_open_purchase_readonly_check.sql。
--
-- 只做一件事：member_perk_settings.purchase_enabled 由 false 改為 true。
-- 不改價格、不改商品、不動任何會員點數、收藏或帳本；checkout_enabled 不受影響。
-- 前置檢查任一項不符就 RAISE，整個交易回滾，開關維持原狀。
-- 要再關閉時執行 20261030020300_points_mall_close_purchase.sql。
-- =============================================================================

BEGIN;

DO $require_open_purchase$
DECLARE
  purchase_def text;
  debit_def text;
  payout_open boolean;
  fn text;
  tbl text;
BEGIN
  IF to_regclass('public.member_perk_catalog') IS NULL
     OR to_regclass('public.member_perk_holds') IS NULL
     OR to_regclass('public.member_perk_loadout') IS NULL
     OR to_regclass('public.member_perk_settings') IS NULL
     OR to_regclass('public.member_perk_sale_windows') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL
     OR to_regclass('public.member_point_entries') IS NULL
     OR to_regclass('public.reward_claims') IS NULL
     OR to_regclass('public.commerce_settings') IS NULL
     OR to_regprocedure('public.purchase_my_perk(text)') IS NULL
     OR to_regprocedure('public.post_perk_unlock_debit(uuid, text, jsonb)') IS NULL
     OR to_regprocedure('public.perk_sale_open(text, date)') IS NULL
     OR to_regprocedure('public.perk_unlock_progress(uuid, text)') IS NULL
     OR to_regprocedure('public.perk_state_json(uuid)') IS NULL THEN
    RAISE EXCEPTION '請先套用點數商城 v2（缺少必要資料表或函式）';
  END IF;

  -- 40 件價格與設定
  IF (SELECT count(*) FROM public.member_perk_catalog) IS DISTINCT FROM 40
     OR (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog) IS DISTINCT FROM 5994
     OR EXISTS (SELECT 1 FROM public.member_perk_catalog WHERE cost IS NULL OR cost <= 0)
     OR EXISTS (SELECT 1 FROM public.member_perk_catalog WHERE active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION '40 件商品價格與核准版本不符（須 40 件、總額 5994、每件大於 0 且上架）';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_sale_windows) IS DISTINCT FROM 30
     OR (SELECT count(*) FROM public.member_perk_catalog WHERE sale_kind = 'festival') IS DISTINCT FROM 3
     OR EXISTS (SELECT 1 FROM public.member_perk_catalog AS c WHERE c.sale_kind = 'festival'
                AND (SELECT count(*) FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id) IS DISTINCT FROM 10)
     OR EXISTS (SELECT 1 FROM public.member_perk_sale_windows AS w
                JOIN public.member_perk_catalog AS c ON c.id = w.perk_id
                WHERE c.sale_kind IS DISTINCT FROM 'festival') THEN
    RAISE EXCEPTION '節慶販售期間與核准版本不符（須 3 件節慶商品、各 10 筆、共 30 筆）';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_catalog WHERE stock_limit IS NOT NULL) IS DISTINCT FROM 3
     OR EXISTS (SELECT 1 FROM public.member_perk_catalog WHERE stock_limit IS NOT NULL
                AND (sale_kind IS DISTINCT FROM 'festival' OR stock_limit IS DISTINCT FROM 500))
     OR (SELECT count(*) FROM public.member_perk_catalog WHERE unlock_metric IS NOT NULL) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '數量上限或解鎖條件與核准版本不符';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_settings) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM public.member_perk_settings WHERE id = true) THEN
    RAISE EXCEPTION '兌換開關設定列異常';
  END IF;

  -- 不影響結帳與遊戲 Pay 點數發放
  IF (SELECT count(*) FROM public.commerce_settings) IS DISTINCT FROM 1
     OR (SELECT checkout_enabled FROM public.commerce_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'checkout_enabled 必須維持 false，停止';
  END IF;
  IF to_regclass('public.game_reward_policies') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(bool_or(payout_enabled), false) FROM public.game_reward_policies' INTO payout_open;
    IF payout_open THEN
      RAISE EXCEPTION '遊戲 Pay 點數發放必須維持關閉，停止';
    END IF;
  END IF;

  -- 兌換入口：登入、開關、販售期間、解鎖、數量、扣點、入庫、防重複
  purchase_def := pg_get_functiondef('public.purchase_my_perk(text)'::regprocedure);
  debit_def := pg_get_functiondef('public.post_perk_unlock_debit(uuid, text, jsonb)'::regprocedure);
  IF position('auth.uid()' IN purchase_def) = 0
     OR position('請先登入' IN purchase_def) = 0
     OR position('member_perk_settings' IN purchase_def) = 0
     OR position('虛擬特權購買尚未開放' IN purchase_def) = 0
     OR position('perk_sale_open' IN purchase_def) = 0
     OR position('perk_unlock_progress' IN purchase_def) = 0
     OR position('stock_limit' IN purchase_def) = 0
     OR position('點數不足' IN purchase_def) = 0
     OR position('post_perk_unlock_debit' IN purchase_def) = 0
     OR position('INSERT INTO public.member_perk_holds (' IN purchase_def) = 0
     OR position('replayed' IN purchase_def) = 0
     OR position('pg_advisory_xact_lock' IN purchase_def) = 0
     OR position('post_member_reward' IN purchase_def) > 0
     OR purchase_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '兌換入口缺少登入、開關、扣點、入庫或防重複保護，停止';
  END IF;
  IF position('app.perk_purchase' IN debit_def) = 0
     OR position('member_perk_catalog' IN debit_def) = 0
     OR position('INSERT INTO public.member_point_entries (' IN debit_def) = 0
     OR position('INSERT INTO public.reward_claims (' IN debit_def) = 0
     OR position('UPDATE public.member_point_accounts' IN debit_def) = 0
     OR position('p_delta' IN debit_def) > 0 THEN
    RAISE EXCEPTION '扣點函式缺少點數流水或改為接受外部點數，停止';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.purchase_my_perk(text)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.post_perk_unlock_debit(uuid, text, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION '兌換與扣點函式必須是 SECURITY DEFINER';
  END IF;

  -- 防重複：同會員同商品、同領獎鍵只能一筆
  IF NOT EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = 'public.member_perk_holds'::regclass AND i.indisunique AND i.indpred IS NULL
                 AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['perk_id', 'user_id'])
     OR NOT EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = 'public.reward_claims'::regclass AND i.indisunique AND i.indpred IS NULL
                 AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['claim_key', 'user_id'])
     OR NOT EXISTS (SELECT 1 FROM pg_index AS i WHERE i.indrelid = 'public.member_point_entries'::regclass AND i.indisunique AND i.indpred IS NULL
                 AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute AS a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['claim_key', 'user_id']) THEN
    RAISE EXCEPTION '缺少防重複購買的唯一鍵，停止';
  END IF;

  -- 會員權限：只有登入會員能呼叫兌換入口，不能直接寫商城或點數資料表
  IF has_function_privilege('anon', 'public.purchase_my_perk(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.purchase_my_perk(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '兌換入口權限不正確';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.post_perk_unlock_debit(uuid, text, jsonb)',
    'public.perk_sale_open(text, date)',
    'public.perk_unlock_progress(uuid, text)',
    'public.perk_state_json(uuid)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '內部函式不能開放給 API：%', fn;
    END IF;
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY[
    'public.member_perk_catalog', 'public.member_perk_holds', 'public.member_perk_loadout',
    'public.member_perk_settings', 'public.member_perk_sale_windows',
    'public.member_point_accounts', 'public.member_point_entries', 'public.reward_claims'
  ] LOOP
    IF has_table_privilege('anon', tbl, 'INSERT') OR has_table_privilege('anon', tbl, 'UPDATE') OR has_table_privilege('anon', tbl, 'DELETE')
       OR has_table_privilege('authenticated', tbl, 'INSERT') OR has_table_privilege('authenticated', tbl, 'UPDATE') OR has_table_privilege('authenticated', tbl, 'DELETE') THEN
      RAISE EXCEPTION '會員不能直接寫入：%', tbl;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = tbl::regclass) THEN
      RAISE EXCEPTION '資料表必須啟用 RLS：%', tbl;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.member_perk_settings'::regclass AND NOT tgisinternal AND tgenabled <> 'D')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.member_perk_catalog'::regclass AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION '商城開關或目錄缺少保護觸發器';
  END IF;

  -- 記下開放前狀態，開放後比對
  PERFORM set_config('mall_open.catalog', (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.member_perk_catalog AS c), true);
  PERFORM set_config('mall_open.windows', (SELECT md5(string_agg(w::text, '|' ORDER BY w.perk_id, w.starts_on)) FROM public.member_perk_sale_windows AS w), true);
  PERFORM set_config('mall_open.ledger', (SELECT concat_ws(',',
    (SELECT count(*) FROM public.member_point_entries),
    (SELECT count(*) FROM public.reward_claims),
    (SELECT count(*) FROM public.member_perk_holds),
    (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts))), true);
END
$require_open_purchase$;

UPDATE public.member_perk_settings SET purchase_enabled = true WHERE id = true;

DO $open_purchase_check$
DECLARE
  payout_open boolean;
BEGIN
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '兌換開關沒有打開';
  END IF;
  IF (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.member_perk_catalog AS c) IS DISTINCT FROM current_setting('mall_open.catalog', true)
     OR (SELECT md5(string_agg(w::text, '|' ORDER BY w.perk_id, w.starts_on)) FROM public.member_perk_sale_windows AS w) IS DISTINCT FROM current_setting('mall_open.windows', true)
     OR (SELECT concat_ws(',',
          (SELECT count(*) FROM public.member_point_entries),
          (SELECT count(*) FROM public.reward_claims),
          (SELECT count(*) FROM public.member_perk_holds),
          (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts))) IS DISTINCT FROM current_setting('mall_open.ledger', true) THEN
    RAISE EXCEPTION '開放過程改動了商品、販售期間、點數或收藏，回滾';
  END IF;
  IF (SELECT checkout_enabled FROM public.commerce_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'checkout_enabled 被改動，回滾';
  END IF;
  IF to_regclass('public.game_reward_policies') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(bool_or(payout_enabled), false) FROM public.game_reward_policies' INTO payout_open;
    IF payout_open THEN
      RAISE EXCEPTION '遊戲 Pay 點數發放被改動，回滾';
    END IF;
  END IF;
END
$open_purchase_check$;

COMMIT;
