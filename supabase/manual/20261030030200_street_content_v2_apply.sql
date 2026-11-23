-- 第七階段第 9 批：夢想商店街內容 v2（3 項新商品、2 款新街道裝潢）。正式套用前須經站長確認。
-- 影響範圍：
--   1. street_cloud_spec：新增商品 taro（Lv.2）、pineapple（Lv.3）、yolkcake（Lv.5）與裝潢 parasols、stalls。
--      新商品單價與經驗都在原本各級上限內，所以營業上限檢查不用改。
--   2. street_cloud_build：街邊店與裝潢清單改成直接讀 street_cloud_spec 的鍵，其餘驗證邏輯一字不改。
--   3. street_cloud_row_json、get_my_street_save：回覆多帶 contentVersion = 2，前端看到才開放新內容。
--   4. street_decor_min_level、street_decor_slot（逛街展示）：認得兩款新裝潢。
-- 不改任何會員存檔、金幣、經驗、互助／偷貨紀錄；不碰 Pay 點數或 Inventory。

BEGIN;

DO $street_v2_precheck$
BEGIN
  IF to_regprocedure('public.street_cloud_spec()') IS NULL
     OR to_regprocedure('public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)') IS NULL
     OR to_regprocedure('public.street_cloud_row_json(public.member_street_saves)') IS NULL
     OR to_regprocedure('public.get_my_street_save()') IS NULL
     OR to_regprocedure('public.street_decor_min_level(text)') IS NULL
     OR to_regprocedure('public.street_decor_slot(text)') IS NULL THEN
    RAISE EXCEPTION '找不到商店街雲端存檔或逛街展示物件，不能套用 v2';
  END IF;
END
$street_v2_precheck$;

CREATE OR REPLACE FUNCTION public.street_cloud_spec()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT '{
    "levels": [
      {"cum": 0,    "rank": 1, "shelf": 3, "batch": 2, "stations": 1, "items": 2, "mul": 1.0, "price": 18, "xp": 6,  "make": 2200},
      {"cum": 150,  "rank": 2, "shelf": 4, "batch": 2, "stations": 2, "items": 2, "mul": 1.1, "price": 24, "xp": 8,  "make": 1980},
      {"cum": 570,  "rank": 4, "shelf": 5, "batch": 3, "stations": 2, "items": 3, "mul": 1.2, "price": 34, "xp": 11, "make": 1760},
      {"cum": 1570, "rank": 6, "shelf": 6, "batch": 3, "stations": 3, "items": 3, "mul": 1.3, "price": 46, "xp": 15, "make": 1584},
      {"cum": 3770, "rank": 9, "shelf": 8, "batch": 4, "stations": 3, "items": 3, "mul": 1.5, "price": 68, "xp": 22, "make": 1364}
    ],
    "buildings": {"tea": {"cost": 360, "rank": 3, "shop": 2}, "gift": {"cost": 980, "rank": 6, "shop": 4}},
    "decors": {
      "mat": {"cost": 60, "rank": 1, "shop": 1}, "lantern": {"cost": 90, "rank": 2, "shop": 1},
      "flower": {"cost": 150, "rank": 3, "shop": 2}, "bunting": {"cost": 120, "rank": 2, "shop": 1},
      "planters": {"cost": 170, "rank": 3, "shop": 2}, "lights": {"cost": 220, "rank": 4, "shop": 3},
      "parasols": {"cost": 260, "rank": 5, "shop": 3}, "stalls": {"cost": 340, "rank": 7, "shop": 4}
    },
    "products": {
      "croissant": 1, "milktea": 1, "cookie": 1, "cocoa": 1, "cake": 2, "macaron": 2, "lemonade": 2,
      "roll": 3, "tart": 3, "coffee": 3, "giftbox": 4, "parfait": 4, "sandwich": 4, "choco": 5, "wedding": 5,
      "taro": 2, "pineapple": 3, "yolkcake": 5
    }
  }'::jsonb
$$;

CREATE OR REPLACE FUNCTION public.street_cloud_build(
  p_prev jsonb,
  p_next jsonb,
  p_elapsed_s numeric,
  p_burst integer,
  p_credit_coins bigint,
  p_credit_xp bigint,
  p_reward_coins bigint,
  p_reward_xp bigint,
  p_import_cap bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  big constant bigint := 1000000000;
  spec jsonb := public.street_cloud_spec();
  is_import boolean := p_prev IS NULL;
  ver integer;
  lv_old integer := 1;
  lv_new integer;
  lvl jsonb;
  b_all text[] := ARRAY(SELECT pg_catalog.jsonb_object_keys(public.street_cloud_spec() -> 'buildings'));
  d_all text[] := ARRAY(SELECT pg_catalog.jsonb_object_keys(public.street_cloud_spec() -> 'decors'));
  b_old text[] := ARRAY[]::text[];
  b_new text[];
  d_old text[] := ARRAY[]::text[];
  d_new text[];
  b_keep text[] := ARRAY[]::text[];
  d_keep text[] := ARRAY[]::text[];
  item text;
  spent bigint := 0;
  need_rank integer := 1;
  s_old jsonb := '{}'::jsonb;
  s_src jsonb;
  stats jsonb := '{}'::jsonb;
  stat_key text;
  n_new bigint;
  n_old bigint;
  d_served bigint;
  d_items bigint;
  d_earned bigint;
  d_xp bigint;
  shops integer;
  stations integer;
  elapsed numeric := GREATEST(coalesce(p_elapsed_s, 0), 0);
  unit numeric;
  max_items numeric;
  budget bigint;
  v_coins bigint;
  v_xp bigint;
  adjusted boolean := false;
  shelf integer;
  stock jsonb := '{}'::jsonb;
  stock_src jsonb;
  prod record;
BEGIN
  IF p_next IS NULL OR pg_catalog.jsonb_typeof(p_next) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF pg_catalog.pg_column_size(p_next) > 32768 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'too_large');
  END IF;
  IF coalesce(pg_catalog.jsonb_typeof(p_next -> 'v'), '') <> 'number' OR (p_next ->> 'v') NOT IN ('1', '2', '3') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  ver := (p_next ->> 'v')::integer;

  lv_new := public.street_cloud_int(p_next -> 'shopLevel', 1, 5);
  lvl := spec -> 'levels' -> (lv_new - 1);
  IF ver >= 2 THEN
    FOREACH item IN ARRAY public.street_cloud_ids(p_next -> 'buildings', b_all) LOOP
      IF (spec -> 'buildings' -> item ->> 'shop')::integer <= lv_new THEN b_keep := b_keep || item; END IF;
    END LOOP;
    FOREACH item IN ARRAY public.street_cloud_ids(p_next -> 'ownedDecors', d_all) LOOP
      IF (spec -> 'decors' -> item ->> 'shop')::integer <= lv_new THEN d_keep := d_keep || item; END IF;
    END LOOP;
  END IF;
  b_new := b_keep;
  d_new := d_keep;

  IF NOT is_import THEN
    lv_old := public.street_cloud_int(p_prev -> 'shopLevel', 1, 5);
    b_old := public.street_cloud_ids(p_prev -> 'buildings', b_all);
    d_old := public.street_cloud_ids(p_prev -> 'ownedDecors', d_all);
    s_old := coalesce(p_prev -> 'stats', '{}'::jsonb);
    IF lv_new < lv_old OR NOT (b_old <@ b_new) OR NOT (d_old <@ d_new) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'regress');
    END IF;
  END IF;

  -- 依規則計算花費：只算這次新增的等級、街邊店與裝潢。
  spent := (lvl ->> 'cum')::bigint - (spec -> 'levels' -> (lv_old - 1) ->> 'cum')::bigint;
  IF lv_new > lv_old THEN need_rank := (lvl ->> 'rank')::integer; END IF;
  FOREACH item IN ARRAY b_new LOOP
    IF NOT (item = ANY (b_old)) THEN
      spent := spent + (spec -> 'buildings' -> item ->> 'cost')::bigint;
      need_rank := GREATEST(need_rank, (spec -> 'buildings' -> item ->> 'rank')::integer);
    END IF;
  END LOOP;
  FOREACH item IN ARRAY d_new LOOP
    IF NOT (item = ANY (d_old)) THEN
      spent := spent + (spec -> 'decors' -> item ->> 'cost')::bigint;
      need_rank := GREATEST(need_rank, (spec -> 'decors' -> item ->> 'rank')::integer);
    END IF;
  END LOOP;

  -- 統計：累計值只增不減。
  s_src := CASE WHEN pg_catalog.jsonb_typeof(p_next -> 'stats') = 'object' THEN p_next -> 'stats' ELSE '{}'::jsonb END;
  FOREACH stat_key IN ARRAY ARRAY['served', 'missed', 'itemsSold', 'earned', 'tips', 'streak', 'bestStreak', 'xpEarned'] LOOP
    n_new := public.street_cloud_int(s_src -> stat_key, 0, big);
    IF NOT is_import AND stat_key IN ('served', 'missed', 'itemsSold', 'earned', 'tips', 'xpEarned') THEN
      n_old := public.street_cloud_int(s_old -> stat_key, 0, big);
      IF n_new < n_old THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'regress');
      END IF;
    END IF;
    stats := stats || pg_catalog.jsonb_build_object(stat_key, n_new);
  END LOOP;
  stats := stats || pg_catalog.jsonb_build_object('bestStreak', GREATEST((stats ->> 'bestStreak')::bigint, (stats ->> 'streak')::bigint));

  d_served := (stats ->> 'served')::bigint - public.street_cloud_int(s_old -> 'served', 0, big);
  d_items := (stats ->> 'itemsSold')::bigint - public.street_cloud_int(s_old -> 'itemsSold', 0, big);
  d_earned := (stats ->> 'earned')::bigint - public.street_cloud_int(s_old -> 'earned', 0, big);
  d_xp := (stats ->> 'xpEarned')::bigint - public.street_cloud_int(s_old -> 'xpEarned', 0, big);

  -- 營業上限：件數不超過每單上限，營收不超過件數 × 最高單價（含禮盒加成、快速小費與連續好評）。
  unit := pg_catalog.ceil((lvl ->> 'price')::numeric * (lvl ->> 'mul')::numeric * 1.12);
  IF d_items > d_served * (lvl ->> 'items')::bigint
     OR d_earned > pg_catalog.ceil(d_items * unit * 1.2) + d_served * 12 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', CASE WHEN is_import THEN 'import_inconsistent' ELSE 'implausible' END);
  END IF;

  IF is_import THEN
    IF (stats ->> 'earned')::bigint > p_import_cap THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_cap');
    END IF;
    v_xp := public.street_cloud_int(p_next -> 'xp', 0, big);
    IF v_xp > (stats ->> 'itemsSold')::bigint * (lvl ->> 'xp')::bigint + coalesce(p_reward_xp, 0) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_inconsistent');
    END IF;
    budget := (stats ->> 'earned')::bigint + coalesce(p_reward_coins, 0);
    IF spent > budget THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_inconsistent');
    END IF;
    v_coins := public.street_cloud_int(p_next -> 'coins', 0, big);
    IF v_coins > budget - spent THEN
      v_coins := budget - spent;
      adjusted := true;
    END IF;
    v_coins := LEAST(big, v_coins + coalesce(p_credit_coins, 0));
    v_xp := LEAST(big, v_xp + coalesce(p_credit_xp, 0));
    -- 轉移時店面等級本身也要符合經驗；不只看新增的部分。
    need_rank := (lvl ->> 'rank')::integer;
    FOREACH item IN ARRAY b_new LOOP need_rank := GREATEST(need_rank, (spec -> 'buildings' -> item ->> 'rank')::integer); END LOOP;
    FOREACH item IN ARRAY d_new LOOP need_rank := GREATEST(need_rank, (spec -> 'decors' -> item ->> 'rank')::integer); END LOOP;
  ELSE
    -- 以伺服器時間檢查來客與製作速度：每間店最快約 1.8 秒來一位客人，工作台最快產能照規則推算。
    shops := 1 + coalesce(pg_catalog.array_length(b_new, 1), 0);
    stations := LEAST(4, (lvl ->> 'stations')::integer + CASE WHEN 'tea' = ANY (b_new) THEN 1 ELSE 0 END);
    max_items := LEAST(
      d_served * (lvl ->> 'items')::numeric,
      pg_catalog.ceil(stations * (lvl ->> 'batch')::numeric * elapsed * 1000 / (lvl ->> 'make')::numeric) + p_burst * 3
    );
    IF d_served > pg_catalog.ceil(shops * elapsed / 1.8) + p_burst OR d_items > max_items
       OR d_xp > d_items * (lvl ->> 'xp')::bigint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'implausible');
    END IF;
    v_coins := public.street_cloud_int(p_prev -> 'coins', 0, big) + d_earned + coalesce(p_credit_coins, 0) - spent;
    v_xp := LEAST(big, public.street_cloud_int(p_prev -> 'xp', 0, big) + d_xp + coalesce(p_credit_xp, 0));
    IF v_coins < 0 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'coins');
    END IF;
    v_coins := LEAST(big, v_coins);
  END IF;

  IF public.street_cloud_rank(v_xp) < need_rank THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', CASE WHEN is_import THEN 'import_inconsistent' ELSE 'rank' END);
  END IF;

  -- 庫存夾在貨架上限內，未解鎖的商品歸零。
  shelf := (lvl ->> 'shelf')::integer + coalesce(pg_catalog.array_length(b_new, 1), 0);
  stock_src := CASE WHEN pg_catalog.jsonb_typeof(p_next -> 'stock') = 'object' THEN p_next -> 'stock' ELSE '{}'::jsonb END;
  FOR prod IN SELECT key, value::text::integer AS unlock FROM pg_catalog.jsonb_each(spec -> 'products') LOOP
    stock := stock || pg_catalog.jsonb_build_object(prod.key,
      CASE WHEN prod.unlock <= lv_new THEN public.street_cloud_int(stock_src -> prod.key, 0, shelf) ELSE 0 END);
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'progress', p_next || pg_catalog.jsonb_build_object(
      'v', 3,
      'shopLevel', lv_new,
      'coins', v_coins,
      'xp', v_xp,
      'buildings', pg_catalog.to_jsonb(b_new),
      'ownedDecors', pg_catalog.to_jsonb(d_new),
      'stats', stats,
      'stock', stock
    ),
    'coins', v_coins,
    'xp', v_xp,
    'shopLevel', lv_new,
    'spent', spent,
    'dServed', d_served,
    'dItems', d_items,
    'dEarned', d_earned,
    'dXp', d_xp,
    'adjusted', adjusted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.street_cloud_row_json(p_row public.member_street_saves)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'revision', p_row.revision,
    'progress', p_row.progress,
    'updatedAt', p_row.updated_at,
    'importSource', p_row.import_source,
    'importAdjusted', p_row.import_adjusted,
    'contentVersion', 2
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_street_save()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.member_street_saves%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT coalesce((SELECT s.enabled FROM public.street_cloud_settings AS s WHERE s.id), false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT * INTO v_row FROM public.member_street_saves AS m WHERE m.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'exists', false, 'contentVersion', 2);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'exists', true) || public.street_cloud_row_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.street_decor_min_level(p_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_id
    WHEN 'mat' THEN 1
    WHEN 'lantern' THEN 1
    WHEN 'flower' THEN 2
    WHEN 'bunting' THEN 1
    WHEN 'planters' THEN 2
    WHEN 'lights' THEN 3
    WHEN 'parasols' THEN 3
    WHEN 'stalls' THEN 4
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.street_decor_slot(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_id
    WHEN 'mat' THEN 'shop'
    WHEN 'lantern' THEN 'shop'
    WHEN 'flower' THEN 'shop'
    WHEN 'bunting' THEN 'street'
    WHEN 'planters' THEN 'street'
    WHEN 'lights' THEN 'street'
    WHEN 'parasols' THEN 'street'
    WHEN 'stalls' THEN 'street'
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.street_cloud_spec() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_row_json(public.member_street_saves) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_street_save() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_street_save() TO authenticated;

DO $street_v2_self_check$
DECLARE
  s jsonb := public.street_cloud_spec();
  r jsonb;
  base jsonb := '{"v":3,"shopLevel":3,"coins":0,"xp":440,"buildings":[],"ownedDecors":[],"stats":{"served":20,"itemsSold":40,"earned":600,"xpEarned":440},"stock":{}}'::jsonb;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(s -> 'decors')) <> 8 OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(s -> 'products')) <> 18 THEN
    RAISE EXCEPTION '商店街 v2 規格數量錯誤';
  END IF;
  IF public.street_decor_slot('stalls') IS DISTINCT FROM 'street' OR public.street_decor_min_level('parasols') IS DISTINCT FROM 3 OR public.street_decor_slot('lights') IS DISTINCT FROM 'street' THEN
    RAISE EXCEPTION '逛街展示裝潢清單錯誤';
  END IF;
  -- 轉移驗證：營收 600 只夠升到 Lv.3（570），遮陽傘 260 要算進花費所以拒收。
  r := public.street_cloud_build(NULL, base || '{"ownedDecors":["parasols","stalls"]}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '營收不夠的轉移不能擁有新裝潢：%', r;
  END IF;
  r := public.street_cloud_build(NULL, base || '{"stock":{"taro":2,"pineapple":1,"yolkcake":3}}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,stock,taro}' <> '2' OR r #>> '{progress,stock,pineapple}' <> '1' OR r #>> '{progress,stock,yolkcake}' <> '0' THEN
    RAISE EXCEPTION '新商品庫存要依等級保留：%', r;
  END IF;
END
$street_v2_self_check$;

COMMIT;
