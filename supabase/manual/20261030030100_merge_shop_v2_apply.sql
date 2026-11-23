-- 第七階段第 9 批：合成小舖內容 v2（商店 Lv.6、水果線）。正式套用前須經站長確認。
-- 影響範圍：
--   1. member_merge_shops.shop_level 上限 5 → 6（只換 CHECK，不改任何一列資料）。
--   2. 規則函式：解鎖線數、商品線編號、升級成本（Lv.5→6 需 600 遊戲金幣，待簽核）、合成下一階、商品格式。
--   3. merge_shop_snapshot 多回傳 contentVersion=2、maxShopLevel=6；apply_my_merge_shop_action 只換商品格式檢查並在 Lv.6 把 fruit-1 收進圖鑑。
-- Lv.1～5 的訂單、補貨與合成結果與 v1 完全相同，既有存檔不需轉換。
-- 不讀前端金幣／經驗，不呼叫點數帳本，不發 Pay 點；遊戲金幣與 Pay 點數分開。

BEGIN;

DO $merge_v2_precheck$
BEGIN
  IF to_regclass('public.member_merge_shops') IS NULL
     OR to_regprocedure('public.apply_my_merge_shop_action(text, text, jsonb)') IS NULL
     OR to_regprocedure('public.merge_shop_snapshot(public.member_merge_shops, boolean)') IS NULL THEN
    RAISE EXCEPTION '找不到第六階段合成小舖物件，不能套用 v2';
  END IF;
END
$merge_v2_precheck$;

DO $merge_v2_level$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.member_merge_shops'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'shop_level' AND conname <> 'member_merge_shops_shop_level_v2'
  LOOP
    EXECUTE format('ALTER TABLE public.member_merge_shops DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$merge_v2_level$;
ALTER TABLE public.member_merge_shops DROP CONSTRAINT IF EXISTS member_merge_shops_shop_level_v2;
ALTER TABLE public.member_merge_shops ADD CONSTRAINT member_merge_shops_shop_level_v2 CHECK (shop_level BETWEEN 1 AND 6);

CREATE OR REPLACE FUNCTION public.merge_item_ok(item text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT item IS NOT NULL AND item ~ '^(tea|snack|gift|fruit)-[1-5]$'
$$;

CREATE OR REPLACE FUNCTION public.merge_unlocked_count(shop_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN shop_level >= 6 THEN 4
    WHEN shop_level >= 3 THEN 3
    WHEN shop_level >= 2 THEN 2
    ELSE 1
  END
$$;

CREATE OR REPLACE FUNCTION public.merge_chain_id(idx integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE idx WHEN 0 THEN 'tea' WHEN 1 THEN 'snack' WHEN 2 THEN 'gift' ELSE 'fruit' END
$$;

CREATE OR REPLACE FUNCTION public.merge_upgrade_cost(shop_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE shop_level
    WHEN 1 THEN 30
    WHEN 2 THEN 80
    WHEN 3 THEN 160
    WHEN 4 THEN 320
    WHEN 5 THEN 600
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.merge_next_item(item text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  level integer;
BEGIN
  IF NOT public.merge_item_ok(item) THEN
    RETURN NULL;
  END IF;
  level := split_part(item, '-', 2)::integer;
  IF level >= 5 THEN
    RETURN NULL;
  END IF;
  RETURN split_part(item, '-', 1) || '-' || (level + 1)::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_shop_snapshot(shop public.member_merge_shops, p_replayed boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  today date := public.game_taipei_day(now());
  quest_orders integer := shop.quest_orders;
  quest_claimed boolean := shop.quest_claimed;
  cost integer := public.merge_upgrade_cost(shop.shop_level);
BEGIN
  IF shop.quest_day IS DISTINCT FROM today THEN
    quest_orders := 0;
    quest_claimed := false;
  END IF;
  RETURN jsonb_build_object(
    'exists', true,
    'replayed', p_replayed,
    'gameVersion', shop.game_version,
    'revision', shop.revision,
    'coins', shop.coins,
    'xp', shop.xp,
    'shopLevel', shop.shop_level,
    'cells', shop.board,
    'catalog', shop.catalog,
    'orders', shop.orders,
    'orderSerial', shop.order_serial,
    'lifetimeOrders', shop.lifetime_orders,
    'ordersCompletedToday', quest_orders,
    'questTarget', 3,
    'questClaimed', quest_claimed,
    'questRewardCoins', 24,
    'questRewardXp', 12,
    'producerCharges', shop.producer_charges,
    'producerCap', 4 + shop.shop_level,
    'producerAnchor', shop.producer_anchor,
    'serverNow', now(),
    'regenSeconds', 30,
    'taipeiDay', today,
    'payPointsDelta', 0,
    'payoutEnabled', false,
    'tuningStatus', 'pending_approval',
    'upgradeCost', cost,
    'contentVersion', 2,
    'maxShopLevel', 6,
    'updatedAt', shop.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_my_merge_shop_action(
  p_action_key text,
  p_action_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  shop public.member_merge_shops%ROWTYPE;
  has_shop boolean := false;
  prior jsonb;
  snapshot jsonb;
  from_i integer;
  to_i integer;
  source text;
  target text;
  produced text;
  cap integer;
  gained integer;
  used integer;
  elapsed integer;
  order_row jsonb;
  order_id text;
  order_item text;
  order_qty integer;
  order_coins integer;
  order_xp integer;
  indexes integer[];
  cell_index integer;
  fresh_orders jsonb;
  cost integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_action_key IS NULL OR p_action_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '動作編號不正確';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text) > 2048 THEN
    RAISE EXCEPTION '動作內容不正確';
  END IF;
  IF p_action_type NOT IN ('start', 'move', 'merge', 'spawn', 'serve', 'upgrade', 'claim_quest') THEN
    RAISE EXCEPTION '這個動作不能使用';
  END IF;

  PERFORM set_config('merge.internal', 'on', true);
  PERFORM pg_advisory_xact_lock(hashtext('merge-shop:' || uid::text));

  SELECT events.result INTO prior
  FROM public.member_merge_shop_events AS events
  WHERE events.user_id = uid AND events.action_key = p_action_key;
  IF FOUND THEN
    RETURN prior || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO shop
  FROM public.member_merge_shops
  WHERE user_id = uid
  FOR UPDATE;
  has_shop := FOUND;

  IF has_shop AND p_action_type = 'start' THEN
    snapshot := public.merge_shop_snapshot(shop, false);
    INSERT INTO public.member_merge_shop_events (user_id, action_key, action_type, revision_after, result)
    VALUES (uid, p_action_key, p_action_type, shop.revision, snapshot);
    RETURN snapshot;
  END IF;

  IF NOT has_shop AND p_action_type <> 'start' THEN
    RAISE EXCEPTION '請先開始營業';
  END IF;

  IF has_shop AND p_payload ? 'expectedRevision' THEN
    IF public.merge_json_int(p_payload, 'expectedRevision') IS DISTINCT FROM shop.revision THEN
      RAISE EXCEPTION '遊戲進度已更新，請重新整理';
    END IF;
  END IF;

  IF p_action_type = 'start' THEN
    INSERT INTO public.member_merge_shops (
      user_id, coins, xp, shop_level, board, catalog, orders, order_serial, lifetime_orders,
      quest_day, quest_orders, quest_claimed, producer_charges, producer_anchor, action_seq, revision, game_version
    )
    VALUES (
      uid, 0, 0, 1,
      (
        SELECT jsonb_agg(CASE WHEN ord <= 3 THEN to_jsonb('tea-1'::text) ELSE 'null'::jsonb END ORDER BY ord)
        FROM generate_series(1, 30) AS ord
      ),
      jsonb_build_array('tea-1'),
      jsonb_build_array(public.merge_make_order(1, 0, 0), public.merge_make_order(1, 1, 0)),
      2, 0, public.game_taipei_day(now()), 0, false, 5, now(), 0, 1, 'stage6-batch1'
    )
    RETURNING * INTO shop;
  ELSE
    IF public.game_taipei_day(now()) IS DISTINCT FROM shop.quest_day THEN
      shop.quest_day := public.game_taipei_day(now());
      shop.quest_orders := 0;
      shop.quest_claimed := false;
    END IF;

    cap := 4 + shop.shop_level;
    elapsed := floor(extract(epoch FROM (now() - shop.producer_anchor)))::integer;
    gained := floor(elapsed / 30.0)::integer;
    IF gained > 0 THEN
      IF shop.producer_charges >= cap THEN
        shop.producer_charges := cap;
        shop.producer_anchor := now();
      ELSE
        used := LEAST(gained, cap - shop.producer_charges);
        shop.producer_charges := shop.producer_charges + used;
        IF shop.producer_charges >= cap THEN
          shop.producer_anchor := now();
        ELSE
          shop.producer_anchor := shop.producer_anchor + make_interval(secs => used * 30);
        END IF;
      END IF;
    END IF;

    shop.action_seq := shop.action_seq + 1;
    shop.revision := shop.revision + 1;

    IF p_action_type = 'move' OR p_action_type = 'merge' THEN
      from_i := public.merge_json_int(p_payload, 'from');
      to_i := public.merge_json_int(p_payload, 'to');
      IF from_i < 0 OR from_i > 29 OR to_i < 0 OR to_i > 29 THEN
        RAISE EXCEPTION '動作內容不正確';
      END IF;
      IF from_i = to_i THEN
        RAISE EXCEPTION '要選兩個不同位置';
      END IF;
      source := public.merge_cell(shop.board, from_i);
      target := public.merge_cell(shop.board, to_i);
      IF p_action_type = 'move' THEN
        IF source IS NULL THEN
          RAISE EXCEPTION '這裡沒有商品';
        END IF;
        shop.board := public.merge_set_cell(shop.board, from_i, target);
        shop.board := public.merge_set_cell(shop.board, to_i, source);
      ELSE
        IF source IS NULL OR target IS NULL OR NOT public.merge_item_ok(source) OR NOT public.merge_item_ok(target) THEN
          IF source IS NULL OR target IS NULL OR source <> target THEN
            RAISE EXCEPTION '要兩件相同商品才能合成';
          END IF;
          RAISE EXCEPTION '商品資料不正確';
        END IF;
        IF source <> target THEN
          RAISE EXCEPTION '要兩件相同商品才能合成';
        END IF;
        produced := public.merge_next_item(source);
        IF produced IS NULL THEN
          RAISE EXCEPTION '這件商品已經是最高階';
        END IF;
        shop.board := public.merge_set_cell(shop.board, from_i, NULL);
        shop.board := public.merge_set_cell(shop.board, to_i, produced);
        shop.catalog := public.merge_add_catalog(shop.catalog, produced);
      END IF;
    ELSIF p_action_type = 'spawn' THEN
      to_i := public.merge_json_int(p_payload, 'to');
      IF to_i < 0 OR to_i > 29 THEN
        RAISE EXCEPTION '動作內容不正確';
      END IF;
      IF public.merge_cell(shop.board, to_i) IS NOT NULL THEN
        RAISE EXCEPTION '這個位置已經有商品';
      END IF;
      IF shop.producer_charges >= cap THEN
        shop.producer_anchor := now();
      END IF;
      IF shop.producer_charges < 1 THEN
        RAISE EXCEPTION '原料補貨還沒準備好';
      END IF;
      shop.producer_charges := shop.producer_charges - 1;
      produced := public.merge_spawn_item(shop.shop_level, shop.action_seq);
      shop.board := public.merge_set_cell(shop.board, to_i, produced);
      shop.catalog := public.merge_add_catalog(shop.catalog, produced);
    ELSIF p_action_type = 'serve' THEN
      IF jsonb_typeof(p_payload -> 'orderId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload -> 'cells') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION '動作內容不正確';
      END IF;
      order_id := p_payload ->> 'orderId';
      IF order_id !~ '^ord-[0-9]+-[0-9]+$' THEN
        RAISE EXCEPTION '動作內容不正確';
      END IF;
      SELECT elem INTO order_row
      FROM jsonb_array_elements(shop.orders) AS elem
      WHERE elem ->> 'id' = order_id
      LIMIT 1;
      IF order_row IS NULL THEN
        RAISE EXCEPTION '找不到這張顧客訂單';
      END IF;
      order_item := order_row ->> 'itemId';
      order_qty := (order_row ->> 'qty')::integer;
      order_coins := (order_row ->> 'coins')::integer;
      order_xp := (order_row ->> 'xp')::integer;
      IF NOT public.merge_item_ok(order_item) OR order_qty < 1 OR order_qty > 5 OR order_coins < 0 OR order_coins > 500 OR order_xp < 0 OR order_xp > 500 THEN
        RAISE EXCEPTION '顧客訂單不正確';
      END IF;
      SELECT coalesce(array_agg((value #>> '{}')::integer), ARRAY[]::integer[])
      INTO indexes
      FROM jsonb_array_elements(p_payload -> 'cells') AS value
      WHERE jsonb_typeof(value) = 'number' AND (value #>> '{}') ~ '^[0-9]+$';
      IF coalesce(jsonb_array_length(p_payload -> 'cells'), 0) <> coalesce(cardinality(indexes), 0) OR cardinality(indexes) <> order_qty THEN
        RAISE EXCEPTION '交付數量不對';
      END IF;
      IF cardinality(indexes) <> (SELECT count(DISTINCT item) FROM unnest(indexes) AS item) THEN
        RAISE EXCEPTION '交付位置重複';
      END IF;
      FOREACH cell_index IN ARRAY indexes LOOP
        IF cell_index < 0 OR cell_index > 29 THEN
          RAISE EXCEPTION '動作內容不正確';
        END IF;
        IF public.merge_cell(shop.board, cell_index) IS DISTINCT FROM order_item THEN
          RAISE EXCEPTION '交付的商品不符合訂單';
        END IF;
        shop.board := public.merge_set_cell(shop.board, cell_index, NULL);
      END LOOP;
      SELECT coalesce(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      INTO fresh_orders
      FROM jsonb_array_elements(shop.orders) WITH ORDINALITY AS listed(elem, ord)
      WHERE elem ->> 'id' IS DISTINCT FROM order_id;
      shop.orders := fresh_orders || jsonb_build_array(public.merge_make_order(shop.shop_level, shop.order_serial, shop.action_seq));
      shop.order_serial := shop.order_serial + 1;
      shop.lifetime_orders := shop.lifetime_orders + 1;
      shop.quest_orders := shop.quest_orders + 1;
      shop.coins := shop.coins + order_coins;
      shop.xp := shop.xp + order_xp;
    ELSIF p_action_type = 'upgrade' THEN
      cost := public.merge_upgrade_cost(shop.shop_level);
      IF cost IS NULL THEN
        RAISE EXCEPTION '商店已經升到目前開放的最高級';
      END IF;
      IF shop.coins < cost THEN
        RAISE EXCEPTION '遊戲金幣不足';
      END IF;
      shop.coins := shop.coins - cost;
      shop.shop_level := shop.shop_level + 1;
      IF shop.shop_level = 2 THEN
        shop.catalog := public.merge_add_catalog(shop.catalog, 'snack-1');
      ELSIF shop.shop_level = 3 THEN
        shop.catalog := public.merge_add_catalog(shop.catalog, 'gift-1');
      ELSIF shop.shop_level = 6 THEN
        shop.catalog := public.merge_add_catalog(shop.catalog, 'fruit-1');
      END IF;
    ELSIF p_action_type = 'claim_quest' THEN
      IF shop.quest_claimed THEN
        RAISE EXCEPTION '今天的顧客任務已經領過';
      END IF;
      IF shop.quest_orders < 3 THEN
        RAISE EXCEPTION '今日顧客任務還沒完成';
      END IF;
      shop.coins := shop.coins + 24;
      shop.xp := shop.xp + 12;
      shop.quest_claimed := true;
    END IF;

    UPDATE public.member_merge_shops
    SET coins = shop.coins,
        xp = shop.xp,
        shop_level = shop.shop_level,
        board = shop.board,
        catalog = shop.catalog,
        orders = shop.orders,
        order_serial = shop.order_serial,
        lifetime_orders = shop.lifetime_orders,
        quest_day = shop.quest_day,
        quest_orders = shop.quest_orders,
        quest_claimed = shop.quest_claimed,
        producer_charges = shop.producer_charges,
        producer_anchor = shop.producer_anchor,
        action_seq = shop.action_seq,
        revision = shop.revision,
        game_version = shop.game_version,
        updated_at = now()
    WHERE user_id = uid
    RETURNING * INTO shop;
  END IF;

  snapshot := public.merge_shop_snapshot(shop, false);
  INSERT INTO public.member_merge_shop_events (user_id, action_key, action_type, revision_after, result)
  VALUES (uid, p_action_key, p_action_type, shop.revision, snapshot);
  RETURN snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_item_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_unlocked_count(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_chain_id(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_upgrade_cost(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_next_item(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_shop_snapshot(public.member_merge_shops, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_my_merge_shop_action(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_my_merge_shop_action(text, text, jsonb) TO authenticated;

DO $merge_v2_self_check$
DECLARE
  def text := pg_get_functiondef('public.apply_my_merge_shop_action(text, text, jsonb)'::regprocedure);
  order_row jsonb;
BEGIN
  IF public.merge_next_item('fruit-4') IS DISTINCT FROM 'fruit-5' OR public.merge_next_item('fruit-5') IS NOT NULL OR public.merge_next_item('melon-1') IS NOT NULL THEN
    RAISE EXCEPTION '水果線合成規則錯誤';
  END IF;
  IF public.merge_upgrade_cost(4) <> 320 OR public.merge_upgrade_cost(5) <> 600 OR public.merge_upgrade_cost(6) IS NOT NULL THEN
    RAISE EXCEPTION '升級成本錯誤';
  END IF;
  IF public.merge_unlocked_count(5) <> 3 OR public.merge_unlocked_count(6) <> 4 OR public.merge_chain_id(2) <> 'gift' OR public.merge_chain_id(3) <> 'fruit' THEN
    RAISE EXCEPTION '商品線解鎖錯誤';
  END IF;
  order_row := public.merge_make_order(1, 0, 0);
  IF order_row ->> 'itemId' <> 'tea-1' OR (order_row ->> 'coins')::integer <> 12 THEN
    RAISE EXCEPTION 'Lv.1 訂單與 v1 不一致';
  END IF;
  order_row := public.merge_make_order(5, 2, 7);
  IF order_row ->> 'itemId' <> 'gift-3' THEN
    RAISE EXCEPTION 'Lv.5 訂單與 v1 不一致';
  END IF;
  order_row := public.merge_make_order(6, 3, 0);
  IF order_row ->> 'itemId' <> 'fruit-4' THEN
    RAISE EXCEPTION 'Lv.6 水果訂單錯誤';
  END IF;
  IF position('post_member_reward' IN def) > 0 OR position('fruit-1' IN def) = 0 OR position('merge_item_ok' IN def) = 0
     OR position('p_payload ->> ''coins''' IN def) > 0 OR position('p_payload->>''coins''' IN def) > 0 THEN
    RAISE EXCEPTION '合成交易 v2 內容不正確';
  END IF;
END
$merge_v2_self_check$;

COMMIT;
