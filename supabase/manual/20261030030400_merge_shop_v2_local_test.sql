-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-merge-shop-v2-local-test.mjs 組合：BEGIN；合成 v2 本體；本檔；ROLLBACK。
-- 先在 v2 前建立一筆 Lv.3 的舊存檔（runner 先跑），驗證套用後舊存檔照常可玩。

CREATE FUNCTION pg_temp.as_member(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE FUNCTION pg_temp.ok(label text, cond boolean, detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL %: %', label, detail;
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

CREATE FUNCTION pg_temp.fails(label text, stmt text, want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
  END;
  IF msg IS NULL OR position(want IN msg) = 0 THEN
    RAISE EXCEPTION 'FAIL %: got %', label, coalesce(msg, '沒有錯誤');
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

CREATE FUNCTION pg_temp.act(kind text, payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.apply_my_merge_shop_action(gen_random_uuid()::text, kind, payload)
$$;

-- 舊存檔：v1 時代建立的 Lv.3 商店（runner 在套用 v2 之前就寫入），套用後讀回不變。
SELECT pg_temp.as_member('cccccccc-0000-4000-8000-0000000000e1');
DO $$
DECLARE s jsonb := public.get_my_merge_shop();
BEGIN
  PERFORM pg_temp.ok('舊存檔讀回', (s ->> 'shopLevel')::int = 3 AND (s ->> 'contentVersion')::int = 2 AND (s ->> 'upgradeCost')::int = 160, s::text);
  PERFORM pg_temp.ok('舊存檔訂單沿用', s -> 'orders' = current_setting('test.v1_orders')::jsonb, s ->> 'orders');
  PERFORM pg_temp.ok('舊存檔圖鑑不動', s -> 'catalog' = current_setting('test.v1_catalog')::jsonb, s ->> 'catalog');
END $$;
SELECT pg_temp.ok('舊存檔照常補貨', (pg_temp.act('spawn', jsonb_build_object('to', 29)) -> 'cells' ->> 29) ~ '^(tea|snack|gift)-1$');

-- 新會員：Lv.5 → Lv.6 解鎖水果線。
SELECT pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
SELECT pg_temp.ok('新會員開張', (pg_temp.act('start') ->> 'shopLevel')::int = 1);
RESET ROLE;
SELECT set_config('merge.internal', 'on', true);
UPDATE public.member_merge_shops SET shop_level = 5, coins = 599 WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
SELECT set_config('merge.internal', 'off', true);
SELECT pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
SELECT pg_temp.ok('Lv.5 顯示 600 升級成本', (public.get_my_merge_shop() ->> 'upgradeCost')::int = 600);
SELECT pg_temp.fails('金幣不足不能升 Lv.6', $q$SELECT pg_temp.act('upgrade')$q$, '遊戲金幣不足');
RESET ROLE;
SELECT set_config('merge.internal', 'on', true);
UPDATE public.member_merge_shops SET coins = 650 WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
SELECT set_config('merge.internal', 'off', true);
SELECT pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
DO $$
DECLARE s jsonb := pg_temp.act('upgrade');
BEGIN
  PERFORM pg_temp.ok('升到 Lv.6', (s ->> 'shopLevel')::int = 6 AND (s ->> 'coins')::int = 50, s::text);
  PERFORM pg_temp.ok('水果線收進圖鑑', s -> 'catalog' @> '["fruit-1"]'::jsonb, s ->> 'catalog');
  PERFORM pg_temp.ok('Lv.6 是最高級', s -> 'upgradeCost' = 'null'::jsonb AND (s ->> 'maxShopLevel')::int = 6);
  PERFORM pg_temp.ok('Lv.6 原料箱上限 10', (s ->> 'producerCap')::int = 10);
  PERFORM pg_temp.ok('不發 Pay 點', (s ->> 'payPointsDelta')::int = 0 AND (s ->> 'payoutEnabled')::boolean = false);
END $$;
SELECT pg_temp.fails('Lv.6 不能再升', $q$SELECT pg_temp.act('upgrade')$q$, '商店已經升到目前開放的最高級');

-- 補貨四條線輪流出現，水果一定會出現；水果可以合成。
DO $$
DECLARE
  s jsonb;
  seen text[] := ARRAY[]::text[];
  i int;
BEGIN
  RESET ROLE;
  PERFORM set_config('merge.internal', 'on', true);
  UPDATE public.member_merge_shops
  SET board = (SELECT jsonb_agg('null'::jsonb) FROM generate_series(1, 30)), producer_charges = 10, producer_anchor = now()
  WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
  PERFORM set_config('merge.internal', 'off', true);
  PERFORM pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
  FOR i IN 0..9 LOOP
    s := pg_temp.act('spawn', jsonb_build_object('to', i));
    seen := array_append(seen, s -> 'cells' ->> i);
  END LOOP;
  PERFORM pg_temp.ok('Lv.6 補貨會出水果', 'fruit-1' = ANY(seen), array_to_string(seen, ','));
END $$;
DO $$
DECLARE
  s jsonb;
BEGIN
  RESET ROLE;
  PERFORM set_config('merge.internal', 'on', true);
  UPDATE public.member_merge_shops SET board = jsonb_set(jsonb_set(board, '{20}', '"fruit-4"'), '{21}', '"fruit-4"') WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
  PERFORM set_config('merge.internal', 'off', true);
  PERFORM pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
  s := pg_temp.act('merge', jsonb_build_object('from', 20, 'to', 21));
  PERFORM pg_temp.ok('芒果冰合成水果禮籃', s -> 'cells' ->> 21 = 'fruit-5' AND s -> 'catalog' @> '["fruit-5"]'::jsonb, s ->> 'cells');
END $$;
DO $$
BEGIN
  RESET ROLE;
  PERFORM set_config('merge.internal', 'on', true);
  UPDATE public.member_merge_shops SET board = jsonb_set(jsonb_set(board, '{22}', '"fruit-5"'), '{23}', '"fruit-5"') WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
  UPDATE public.member_merge_shops SET board = jsonb_set(jsonb_set(board, '{24}', '"melon-1"'), '{26}', '"melon-1"') WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
  PERFORM set_config('merge.internal', 'off', true);
END $$;
SELECT pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
SELECT pg_temp.fails('水果禮籃已是最高階', $q$SELECT pg_temp.act('merge', '{"from":22,"to":23}')$q$, '這件商品已經是最高階');
SELECT pg_temp.fails('不明商品不能合成', $q$SELECT pg_temp.act('merge', '{"from":24,"to":26}')$q$, '商品資料不正確');

-- 水果訂單可以交付。
DO $$
DECLARE
  s jsonb := public.get_my_merge_shop();
  o jsonb;
BEGIN
  RESET ROLE;
  PERFORM set_config('merge.internal', 'on', true);
  UPDATE public.member_merge_shops
  SET orders = jsonb_build_array(public.merge_make_order(6, 3, 0), orders -> 1),
      board = jsonb_set(board, '{25}', '"fruit-4"')
  WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2';
  PERFORM set_config('merge.internal', 'off', true);
  PERFORM pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
  s := public.get_my_merge_shop();
  o := s -> 'orders' -> 0;
  PERFORM pg_temp.ok('Lv.6 出現水果訂單', o ->> 'itemId' = 'fruit-4', o::text);
  s := pg_temp.act('serve', jsonb_build_object('orderId', o ->> 'id', 'cells', jsonb_build_array(25)));
  PERFORM pg_temp.ok('水果訂單交付', (s ->> 'lifetimeOrders')::int = 1 AND s -> 'cells' ->> 25 IS NULL, s::text);
END $$;

-- 資料表仍擋 Lv.7 與直接寫入。
RESET ROLE;
SELECT pg_temp.fails('資料表擋 Lv.7', $q$SELECT set_config('merge.internal','on',true); UPDATE public.member_merge_shops SET shop_level = 7 WHERE user_id = 'dddddddd-0000-4000-8000-0000000000e2'$q$, 'member_merge_shops_shop_level_v2');
SELECT set_config('merge.internal', 'off', true);
SELECT pg_temp.as_member('dddddddd-0000-4000-8000-0000000000e2');
SELECT pg_temp.fails('會員不能直接改等級', $q$UPDATE public.member_merge_shops SET shop_level = 6$q$, 'permission denied');
RESET ROLE;
SELECT pg_temp.ok('只有一條 shop_level 限制', (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.member_merge_shops'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'shop_level') = 1);
