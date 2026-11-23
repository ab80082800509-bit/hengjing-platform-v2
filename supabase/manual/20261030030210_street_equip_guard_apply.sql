-- 第七階段第 9 批：夢想商店街套用欄位修補。只替換 street_cloud_build。
-- 正式庫已套用 20261030030200_street_content_v2_apply.sql，本檔不重建資料表、不重跑舊版套用檔，也不改既有存檔列。
-- 持有清單核定後，套用中的裝潢必須仍在該清單內，並符合商店等級、店長等級與槽位；不合法的值改回空值。
-- 既有異常存檔要等該會員下次正常存檔才會清掉，本檔不批次更新玩家資料。
-- 可重複執行。函式已是本檔版本時，再執行一次仍然不寫任何存檔。

BEGIN;

DO $equip_guard_precheck$
DECLARE
  fp text;
  known text[] := ARRAY[
    'street_cloud_spec()', '5a170498b46603661a2439563cb67d33',
    'street_cloud_row_json(public.member_street_saves)', 'e16250d4644b44450c3af5b745ecc877',
    'get_my_street_save()', '94102a0fe2b884254ae871a36925eee9',
    'street_decor_min_level(text)', '0843e958e392f3692ddb12f0d7b4ff7d',
    'street_decor_slot(text)', '3aef135d08d199d67798ff9ac1f8ebec'
  ];
  i integer;
  build_fp text;
  v2_build constant text := '838580cae35772373d7ea1315bdd9282';
  fix_build constant text := '13a1b2fe7cdded34dd0f61c786a3951e';
BEGIN
  IF to_regprocedure('public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)') IS NULL THEN
    RAISE EXCEPTION '不可修補：找不到 street_cloud_build';
  END IF;
  FOR i IN 1..5 LOOP
    SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO fp
    FROM pg_proc AS p
    WHERE p.oid = to_regprocedure('public.' || known[i * 2 - 1]);
    IF fp IS DISTINCT FROM known[i * 2] THEN
      RAISE EXCEPTION '不可修補：% 不是 v2 套用檔版本', known[i * 2 - 1];
    END IF;
  END LOOP;
  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO build_fp
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)');
  IF build_fp IS DISTINCT FROM v2_build AND build_fp IS DISTINCT FROM fix_build THEN
    RAISE EXCEPTION '不可修補：street_cloud_build 不是已知版本';
  END IF;
END
$equip_guard_precheck$;

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
  equipped jsonb;
  eq_src jsonb;
  equipped_shops jsonb;
  eq_id text;
  eq_shop text;
  eq_decor text;
  use_shops boolean;
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

  -- 持有清單與解鎖條件確定後才收套用欄位。不合法的值改回既有空值，不改金幣、經驗、持有物，也不另扣款或發獎。
  eq_src := CASE WHEN pg_catalog.jsonb_typeof(p_next -> 'equipped') = 'object' THEN p_next -> 'equipped' ELSE NULL END;
  IF eq_src IS NULL THEN
    equipped := pg_catalog.jsonb_build_object('street', 'null'::jsonb, 'shops', '{}'::jsonb);
  ELSE
    eq_id := eq_src ->> 'street';
    IF eq_id IS NULL
       OR NOT (eq_id = ANY (d_new))
       OR public.street_decor_slot(eq_id) IS DISTINCT FROM 'street'
       OR (spec -> 'decors' -> eq_id ->> 'shop')::integer > lv_new
       OR (spec -> 'decors' -> eq_id ->> 'rank')::integer > public.street_cloud_rank(v_xp) THEN
      eq_id := NULL;
    END IF;
    use_shops := ver >= 3 AND pg_catalog.jsonb_typeof(eq_src -> 'shops') = 'object';
    IF use_shops THEN
      equipped_shops := '{}'::jsonb;
      FOR eq_shop IN SELECT pg_catalog.jsonb_object_keys(eq_src -> 'shops') LOOP
        eq_decor := eq_src -> 'shops' ->> eq_shop;
        IF eq_shop IN ('main', 'tea', 'gift')
           AND eq_decor = ANY (d_new)
           AND public.street_decor_slot(eq_decor) = 'shop'
           AND (spec -> 'decors' -> eq_decor ->> 'shop')::integer <= lv_new
           AND (spec -> 'decors' -> eq_decor ->> 'rank')::integer <= public.street_cloud_rank(v_xp)
           AND (eq_shop = 'main' OR eq_shop = ANY (b_new)) THEN
          equipped_shops := equipped_shops || pg_catalog.jsonb_build_object(eq_shop, eq_decor);
        END IF;
      END LOOP;
      equipped := pg_catalog.jsonb_build_object('street', CASE WHEN eq_id IS NULL THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(eq_id) END, 'shops', equipped_shops);
    ELSE
      eq_decor := eq_src ->> 'shop';
      IF eq_decor IS NULL
         OR NOT (eq_decor = ANY (d_new))
         OR public.street_decor_slot(eq_decor) IS DISTINCT FROM 'shop'
         OR (spec -> 'decors' -> eq_decor ->> 'shop')::integer > lv_new
         OR (spec -> 'decors' -> eq_decor ->> 'rank')::integer > public.street_cloud_rank(v_xp) THEN
        eq_decor := NULL;
      END IF;
      equipped := pg_catalog.jsonb_build_object(
        'street', CASE WHEN eq_id IS NULL THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(eq_id) END,
        'shop', CASE WHEN eq_decor IS NULL THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(eq_decor) END
      );
    END IF;
  END IF;

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
      'stock', stock,
      'equipped', equipped
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

DO $equip_guard_self_check$
DECLARE
  r jsonb;
  kept jsonb;
BEGIN
  r := public.street_cloud_build(NULL, '{"v":3,"shopLevel":3,"coins":0,"xp":440,"buildings":[],"ownedDecors":[],"equipped":{"street":"parasols","shops":{"main":"stalls"}},"stats":{"served":20,"itemsSold":40,"earned":600,"xpEarned":440},"stock":{}}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,equipped,street}' IS NOT NULL OR r #> '{progress,equipped,shops}' IS DISTINCT FROM '{}'::jsonb OR r #> '{progress,ownedDecors}' IS DISTINCT FROM '[]'::jsonb OR (r #>> '{progress,coins}')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '店面或未持有的套用沒有清成空值：%', r -> 'progress' -> 'equipped';
  END IF;
  r := public.street_cloud_build(NULL, '{"v":3,"shopLevel":3,"coins":0,"xp":270,"buildings":[],"ownedDecors":[],"equipped":{"street":"parasols","shops":{}},"stats":{"served":13,"itemsSold":25,"earned":600,"xpEarned":270},"stock":{}}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,equipped,street}' IS NOT NULL OR (r #>> '{progress,xp}')::int IS DISTINCT FROM 270 THEN
    RAISE EXCEPTION '店長不足的偽造套用沒有清掉：%', r;
  END IF;
  r := public.street_cloud_build(NULL, '{"v":3,"shopLevel":2,"coins":70,"xp":50,"buildings":[],"ownedDecors":["mat","bunting"],"equipped":{"street":"bunting","shops":{"main":"mat","tea":"mat"}},"stats":{"served":10,"itemsSold":10,"earned":400,"xpEarned":50},"stock":{}}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,equipped,street}' IS DISTINCT FROM 'bunting' OR r #> '{progress,equipped,shops}' IS DISTINCT FROM '{"main":"mat"}'::jsonb OR r #> '{progress,ownedDecors}' IS DISTINCT FROM '["mat","bunting"]'::jsonb OR (r #>> '{progress,coins}')::int IS DISTINCT FROM 70 THEN
    RAISE EXCEPTION '合法套用或未開幕店面沒有正確保留：%', r -> 'progress';
  END IF;
  kept := r -> 'progress';
  r := public.street_cloud_build(kept, kept || '{"equipped":{"street":"mat","shops":{"main":"bunting"}}}'::jsonb, 0, 0, 0, 0, 0, 0, 0);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,equipped,street}' IS NOT NULL OR r #> '{progress,equipped,shops}' IS DISTINCT FROM '{}'::jsonb OR (r #>> '{progress,coins}')::int IS DISTINCT FROM 70 OR r #> '{progress,ownedDecors}' IS DISTINCT FROM '["mat","bunting"]'::jsonb THEN
    RAISE EXCEPTION '槽位不符的偽造套用改到持有物或金幣：%', r -> 'progress';
  END IF;
  r := public.street_cloud_build(NULL, '{"v":2,"shopLevel":2,"coins":70,"xp":50,"buildings":[],"ownedDecors":["mat","bunting"],"equipped":{"shop":"bunting","street":"mat"},"stats":{"served":10,"itemsSold":10,"earned":400,"xpEarned":50},"stock":{}}'::jsonb, 0, 0, 0, 0, 0, 0, 100000);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR r #>> '{progress,equipped,street}' IS NOT NULL OR r #>> '{progress,equipped,shop}' IS NOT NULL OR r #> '{progress,equipped}' ? 'shops' THEN
    RAISE EXCEPTION '舊版套用欄位沒有依原格式清成空值：%', r -> 'progress' -> 'equipped';
  END IF;
END
$equip_guard_self_check$;

COMMIT;
