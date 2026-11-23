-- 第六階段第一批預覽。只供本機隔離 Supabase 驗證，不是正式 migration。
-- 遊戲金幣與經驗由這支交易計算。不呼叫 post_member_reward，也不發 Pay 點。

BEGIN;

CREATE OR REPLACE FUNCTION public.game_taipei_day(instant timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT (instant AT TIME ZONE 'Asia/Taipei')::date
$$;

CREATE OR REPLACE FUNCTION public.merge_mix32(seq integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ((seq::bigint + 1) * 1664525 + 1013904223) % 4294967296
$$;

CREATE OR REPLACE FUNCTION public.merge_unlocked_count(shop_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
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
  SELECT CASE idx WHEN 0 THEN 'tea' WHEN 1 THEN 'snack' ELSE 'gift' END
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
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.merge_next_item(item text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  level integer;
BEGIN
  IF item IS NULL OR item !~ '^(tea|snack|gift)-[1-5]$' THEN
    RETURN NULL;
  END IF;
  level := split_part(item, '-', 2)::integer;
  IF level >= 5 THEN
    RETURN NULL;
  END IF;
  RETURN split_part(item, '-', 1) || '-' || (level + 1)::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_make_order(shop_level integer, serial integer, action_seq integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  chain_count integer := public.merge_unlocked_count(shop_level);
  chain text := public.merge_chain_id(serial % chain_count);
  max_ask integer := LEAST(5, shop_level + 1);
  ask integer := 1 + (serial % max_ask);
  qty integer := CASE WHEN ask = 1 THEN 2 ELSE 1 END;
  coin_table integer[] := ARRAY[0, 6, 12, 20, 32, 48];
  xp_table integer[] := ARRAY[0, 4, 8, 12, 18, 24];
BEGIN
  RETURN jsonb_build_object(
    'id', 'ord-' || action_seq::text || '-' || serial::text,
    'itemId', chain || '-' || ask::text,
    'qty', qty,
    'coins', coin_table[ask + 1] * qty,
    'xp', xp_table[ask + 1]
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_spawn_item(shop_level integer, action_seq integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  chain_count integer := public.merge_unlocked_count(shop_level);
  idx integer := (public.merge_mix32(action_seq) % chain_count)::integer;
BEGIN
  RETURN public.merge_chain_id(idx) || '-1';
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_cell(board jsonb, idx integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN idx < 0 OR idx >= jsonb_array_length(board) THEN NULL
    WHEN board -> idx IS NULL OR jsonb_typeof(board -> idx) = 'null' THEN NULL
    ELSE board ->> idx
  END
$$;

CREATE OR REPLACE FUNCTION public.merge_set_cell(board jsonb, idx integer, item text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_set(
    board,
    ARRAY[idx::text],
    CASE WHEN item IS NULL THEN 'null'::jsonb ELSE to_jsonb(item) END,
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.merge_add_catalog(catalog jsonb, item text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF catalog @> jsonb_build_array(item) THEN
    RETURN catalog;
  END IF;
  RETURN catalog || jsonb_build_array(item);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_json_int(payload jsonb, key text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  raw text;
BEGIN
  IF jsonb_typeof(payload -> key) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION '動作內容不正確';
  END IF;
  raw := payload ->> key;
  IF raw !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION '動作內容不正確';
  END IF;
  RETURN raw::integer;
END;
$$;

CREATE TABLE IF NOT EXISTS public.member_merge_shops (
  user_id uuid PRIMARY KEY,
  coins integer NOT NULL CHECK (coins >= 0),
  xp integer NOT NULL CHECK (xp >= 0),
  shop_level integer NOT NULL CHECK (shop_level BETWEEN 1 AND 5),
  board jsonb NOT NULL,
  catalog jsonb NOT NULL,
  orders jsonb NOT NULL,
  order_serial integer NOT NULL CHECK (order_serial >= 0),
  lifetime_orders integer NOT NULL CHECK (lifetime_orders >= 0),
  quest_day date NOT NULL,
  quest_orders integer NOT NULL CHECK (quest_orders >= 0),
  quest_claimed boolean NOT NULL,
  producer_charges integer NOT NULL CHECK (producer_charges >= 0),
  producer_anchor timestamptz NOT NULL,
  action_seq integer NOT NULL CHECK (action_seq >= 0),
  revision integer NOT NULL CHECK (revision >= 1),
  game_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_merge_shops_board_len CHECK (jsonb_typeof(board) = 'array' AND jsonb_array_length(board) = 30),
  CONSTRAINT member_merge_shops_catalog_array CHECK (jsonb_typeof(catalog) = 'array'),
  CONSTRAINT member_merge_shops_orders_array CHECK (jsonb_typeof(orders) = 'array')
);

CREATE TABLE IF NOT EXISTS public.member_merge_shop_events (
  user_id uuid NOT NULL,
  action_key text NOT NULL,
  action_type text NOT NULL,
  revision_after integer NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action_key)
);

CREATE TABLE IF NOT EXISTS public.game_reward_policies (
  id text PRIMARY KEY,
  payout_enabled boolean NOT NULL DEFAULT false,
  daily_cap integer NOT NULL,
  weekly_quest integer NOT NULL,
  weekly_cap integer NOT NULL,
  scratch_excluded boolean NOT NULL,
  approval text NOT NULL,
  CONSTRAINT game_reward_payout_closed CHECK (payout_enabled = false),
  CONSTRAINT game_reward_caps_pending CHECK (daily_cap = 10 AND weekly_quest = 10 AND weekly_cap = 80),
  CONSTRAINT game_reward_scratch_excluded CHECK (scratch_excluded = true),
  CONSTRAINT game_reward_approval_pending CHECK (approval = 'pending_approval')
);

INSERT INTO public.game_reward_policies (id, payout_enabled, daily_cap, weekly_quest, weekly_cap, scratch_excluded, approval)
VALUES ('stage6', false, 10, 10, 80, true, 'pending_approval')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_merge_shop_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_setting('merge.internal', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '遊戲進度只能由合成交易更新';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_merge_shops_guard ON public.member_merge_shops;
CREATE TRIGGER member_merge_shops_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_merge_shops
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_merge_shop_write();

DROP TRIGGER IF EXISTS member_merge_shop_events_guard ON public.member_merge_shop_events;
CREATE TRIGGER member_merge_shop_events_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_merge_shop_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_merge_shop_write();

ALTER TABLE public.member_merge_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_merge_shop_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_reward_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_merge_shops_select_own ON public.member_merge_shops;
CREATE POLICY member_merge_shops_select_own ON public.member_merge_shops
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS member_merge_shop_events_select_own ON public.member_merge_shop_events;
CREATE POLICY member_merge_shop_events_select_own ON public.member_merge_shop_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

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
    'updatedAt', shop.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_merge_shop()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  shop public.member_merge_shops%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO shop FROM public.member_merge_shops WHERE user_id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'exists', false,
      'replayed', false,
      'payPointsDelta', 0,
      'payoutEnabled', false,
      'tuningStatus', 'pending_approval',
      'taipeiDay', public.game_taipei_day(now()),
      'gameVersion', 'stage6-batch1'
    );
  END IF;
  RETURN public.merge_shop_snapshot(shop, false);
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
        IF source IS NULL OR target IS NULL OR source !~ '^(tea|snack|gift)-[1-5]$' OR target !~ '^(tea|snack|gift)-[1-5]$' THEN
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
      IF order_item !~ '^(tea|snack|gift)-[1-5]$' OR order_qty < 1 OR order_qty > 5 OR order_coins < 0 OR order_coins > 500 OR order_xp < 0 OR order_xp > 500 THEN
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

CREATE OR REPLACE FUNCTION public.get_my_game_reward_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  enabled boolean;
  daily_cap integer;
  weekly_quest integer;
  weekly_cap integer;
  scratch_excluded boolean;
  approval text;
BEGIN
  SELECT payout_enabled, game_reward_policies.daily_cap, game_reward_policies.weekly_quest,
         game_reward_policies.weekly_cap, game_reward_policies.scratch_excluded, game_reward_policies.approval
  INTO enabled, daily_cap, weekly_quest, weekly_cap, scratch_excluded, approval
  FROM public.game_reward_policies
  WHERE id = 'stage6';
  IF NOT FOUND OR enabled OR NOT scratch_excluded OR approval IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION '遊戲 Pay 點數尚未正式簽核，不能入帳';
  END IF;
  RETURN jsonb_build_object(
    'payoutEnabled', false,
    'approval', 'pending_approval',
    'issuedPayPoints', NULL,
    'dailyCap', daily_cap,
    'weeklyQuest', weekly_quest,
    'weeklyCap', weekly_cap,
    'scratchExcluded', true,
    'games', jsonb_build_array('merge_shop', 'block_challenge', 'dream_street'),
    'label', 'Pay 點數獎勵尚未正式簽核，目前不會發放'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_game_pay_points(p_points integer, p_claim_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '遊戲 Pay 點數尚未正式簽核，不能入帳';
END;
$$;

COMMENT ON FUNCTION public.apply_my_merge_shop_action(text, text, jsonb) IS
  '合成小舖進度交易。只讀 auth.uid()，不接受前端傳入的金幣、經驗或 Pay 點。不呼叫點數帳本。';
COMMENT ON FUNCTION public.grant_game_pay_points(integer, text) IS
  '第六階段第一批的關閉閘門。呼叫一定失敗，不會寫入第四階段點數帳本。';

REVOKE ALL ON TABLE public.member_merge_shops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_merge_shop_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.game_reward_policies FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.game_taipei_day(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_mix32(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_unlocked_count(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_chain_id(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_upgrade_cost(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_next_item(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_make_order(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_spawn_item(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_cell(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_set_cell(jsonb, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_add_catalog(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_json_int(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_merge_shop_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_shop_snapshot(public.member_merge_shops, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_merge_shop() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_my_merge_shop_action(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_game_pay_points(integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_merge_shop() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_my_merge_shop_action(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_game_reward_plan() TO anon, authenticated;

DO $revoke_merge_service$
DECLARE
  fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE public.member_merge_shops FROM service_role';
  EXECUTE 'REVOKE ALL ON TABLE public.member_merge_shop_events FROM service_role';
  EXECUTE 'REVOKE ALL ON TABLE public.game_reward_policies FROM service_role';
  FOREACH fn IN ARRAY ARRAY[
    'public.game_taipei_day(timestamptz)',
    'public.merge_mix32(integer)',
    'public.merge_make_order(integer, integer, integer)',
    'public.get_my_merge_shop()',
    'public.apply_my_merge_shop_action(text, text, jsonb)',
    'public.get_my_game_reward_plan()',
    'public.grant_game_pay_points(integer, text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', fn);
  END LOOP;
END
$revoke_merge_service$;

DO $merge_shop_self_check$
DECLARE
  def text := pg_get_functiondef('public.apply_my_merge_shop_action(text, text, jsonb)'::regprocedure);
  order_row jsonb;
BEGIN
  IF public.game_taipei_day('2026-10-21 16:00:00+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日應從 UTC 16:00 開始';
  END IF;
  IF public.game_taipei_day('2026-10-22 15:59:59+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日在 UTC 15:59 仍是同一天';
  END IF;
  IF public.game_taipei_day('2026-10-22 16:00:00+00'::timestamptz) <> DATE '2026-10-23' THEN
    RAISE EXCEPTION '台北日應在 UTC 16:00 換日';
  END IF;
  IF public.merge_mix32(0) <> 1015568748 OR public.merge_mix32(1) <> 1017233273 THEN
    RAISE EXCEPTION '合成亂數與規格不一致';
  END IF;
  order_row := public.merge_make_order(1, 0, 0);
  IF order_row ->> 'itemId' <> 'tea-1' OR (order_row ->> 'qty')::integer <> 2 OR (order_row ->> 'coins')::integer <> 12 OR (order_row ->> 'xp')::integer <> 4 THEN
    RAISE EXCEPTION '初始訂單與規格不一致';
  END IF;
  order_row := public.merge_make_order(1, 1, 0);
  IF order_row ->> 'itemId' <> 'tea-2' OR (order_row ->> 'coins')::integer <> 12 THEN
    RAISE EXCEPTION '第二張訂單與規格不一致';
  END IF;
  IF position('post_member_reward' IN def) > 0
     OR position('p_payload->>''coins''' IN def) > 0
     OR position('p_payload ->> ''coins''' IN def) > 0
     OR position('p_payload->>''xp''' IN def) > 0 THEN
    RAISE EXCEPTION '合成交易不能讀前端點數或呼叫點數帳本';
  END IF;
  BEGIN
    INSERT INTO public.member_merge_shops (
      user_id, coins, xp, shop_level, board, catalog, orders, order_serial, lifetime_orders,
      quest_day, quest_orders, quest_claimed, producer_charges, producer_anchor, action_seq, revision, game_version
    ) VALUES (
      '00000000-0000-4000-8000-000000000099', 1, 0, 1, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      0, 0, DATE '2026-10-25', 0, false, 0, now(), 0, 1, 'stage6-batch1'
    );
    RAISE EXCEPTION 'guard failed open';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM '遊戲進度只能由合成交易更新' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    UPDATE public.game_reward_policies SET payout_enabled = true WHERE id = 'stage6';
    RAISE EXCEPTION 'payout lock failed open';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
  BEGIN
    PERFORM public.grant_game_pay_points(10, 'game:merge_shop:test');
    RAISE EXCEPTION 'grant gate failed open';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM '遊戲 Pay 點數尚未正式簽核，不能入帳' THEN
        RAISE;
      END IF;
  END;
END
$merge_shop_self_check$;

COMMIT;
