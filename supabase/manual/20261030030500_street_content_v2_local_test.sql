-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-street-content-v2-local-test.mjs 組合：BEGIN；（本機缺少時）商店街前置本體；商店街 v2 本體；本檔；ROLLBACK。
-- 本檔只驗轉移、存檔夾住與展示。高等級解鎖必須先呼叫 upgrade() 再存檔，見 scripts/run-street-unlock-local-test.ts。

INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'street-v2-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

CREATE FUNCTION pg_temp.street(p_level integer, p_coins bigint, p_xp bigint, p_served bigint, p_items bigint, p_earned bigint, p_xp_earned bigint,
  p_decors jsonb DEFAULT '[]', p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'v', 3, 'createdAt', 1761700000000, 'shopLevel', p_level, 'coins', p_coins, 'xp', p_xp, 'open', true,
    'stock', jsonb_build_object('croissant', 2, 'taro', 3, 'pineapple', 2, 'yolkcake', 4),
    'jobs', '[]'::jsonb,
    'stats', jsonb_build_object('served', p_served, 'missed', 0, 'itemsSold', p_items, 'earned', p_earned, 'tips', 0, 'streak', 0, 'bestStreak', 0, 'xpEarned', p_xp_earned),
    'today', jsonb_build_object('day', '2026-10-30', 'served', 0, 'missed', 0, 'earned', 0),
    'log', '[]'::jsonb, 'tutorial', 4,
    'buildings', '[]'::jsonb, 'ownedDecors', p_decors, 'equipped', jsonb_build_object('street', null, 'shops', '{}'::jsonb),
    'helpClaimPending', null, 'helpClaimsApplied', '[]'::jsonb, 'stealClaimPending', null, 'stealClaimsApplied', '[]'::jsonb
  ) || p_extra
$$;

DO $t$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000f1';
  r jsonb;
  v jsonb;
BEGIN
  PERFORM pg_temp.as_member(a);
  r := public.get_my_street_save();
  PERFORM pg_temp.ok('還沒存檔也回 contentVersion 2', r ->> 'exists' = 'false' AND (r ->> 'contentVersion')::int = 2, r::text);

  -- Lv.3、店長 Lv.5（440 經驗）、營收 1000：花費 = 升級 570 + 遮陽傘 260 = 830，剩 170。
  r := public.import_my_street_save(pg_temp.street(3, 999, 440, 20, 40, 1000, 440, '["mat","parasols","stalls"]'), gen_random_uuid());
  PERFORM pg_temp.ok('轉移接受', r ->> 'ok' = 'true', r::text);
  PERFORM pg_temp.ok('轉移帶 contentVersion 2', (r ->> 'contentVersion')::int = 2);
  PERFORM pg_temp.ok('遮陽傘保留、夜市攤車未達 Lv.4 不保留', r -> 'progress' -> 'ownedDecors' = '["mat","parasols"]'::jsonb, r #>> '{progress,ownedDecors}');
  PERFORM pg_temp.ok('新裝潢有算進花費', (r #>> '{progress,coins}')::int = 1000 - 570 - 60 - 260, r #>> '{progress,coins}');
  PERFORM pg_temp.ok('Lv.3 新商品庫存保留、Lv.5 商品歸零',
    (r #>> '{progress,stock,taro}')::int = 3 AND (r #>> '{progress,stock,pineapple}')::int = 2 AND (r #>> '{progress,stock,yolkcake}')::int = 0, r #>> '{progress,stock}');

  -- 一般存檔：營業一段時間後仍可存，新商品庫存照常保留。
  r := public.save_my_street((r ->> 'revision')::bigint,
    pg_temp.street(3, 110, 440, 20, 40, 1000, 440, '["mat","parasols"]', '{"stock":{"taro":1,"pineapple":0}}'::jsonb), gen_random_uuid());
  PERFORM pg_temp.ok('一般存檔接受', r ->> 'ok' = 'true' AND (r ->> 'revision')::int = 2, r::text);
  PERFORM pg_temp.ok('存檔後新商品庫存', (r #>> '{progress,stock,taro}')::int = 1 AND (r #>> '{progress,stock,pineapple}')::int = 0, r #>> '{progress,stock}');
  PERFORM pg_temp.ok('裝潢不能消失', r -> 'progress' -> 'ownedDecors' @> '["parasols"]'::jsonb);

  -- 偷加一款沒有付錢的新裝潢：金幣不夠時要拒收。
  v := pg_temp.street(3, 110, 440, 20, 40, 1000, 440, '["mat","parasols","lights","planters"]');
  r := public.save_my_street((r ->> 'revision')::bigint, v, gen_random_uuid());
  PERFORM pg_temp.ok('沒錢買的裝潢要拒收', r ->> 'ok' = 'false' AND r ->> 'reason' IN ('coins', 'rank'), r::text);

  RESET ROLE;
  -- 逛街展示：新街道裝潢依店面等級顯示。
  v := public.street_normalize_exhibit('{"shopLevel":4,"buildings":[],"equipped":{"street":"stalls","shops":{}}}'::jsonb);
  PERFORM pg_temp.ok('逛街看得到夜市攤車', v::text LIKE '%stalls%', v::text);
  v := public.street_normalize_exhibit('{"shopLevel":2,"buildings":[],"equipped":{"street":"parasols","shops":{}}}'::jsonb);
  PERFORM pg_temp.ok('等級不夠的遮陽傘不展示', v::text NOT LIKE '%parasols%', v::text);
  PERFORM pg_temp.ok('舊裝潢展示不變', public.street_decor_slot('bunting') = 'street' AND public.street_decor_min_level('flower') = 2);
END
$t$;
