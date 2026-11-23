-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-street-steal-local-test.mjs 組合：BEGIN；第 6 批本體（本機若尚未套用）；第 7 批本體；本檔；ROLLBACK。
-- 四位測試會員只存在這個交易；不碰既有會員、點數或街景。

INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a7', 'steal-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000b7', 'steal-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('cccccccc-0000-4000-8000-0000000000c7', 'steal-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('dddddddd-0000-4000-8000-0000000000d7', 'steal-d@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

CREATE TEMP TABLE t_before AS
SELECT
  (SELECT count(*) FROM public.member_point_entries) AS entries,
  (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) AS balance,
  (SELECT count(*) FROM public.member_street_helps) AS helps;
GRANT SELECT ON t_before TO authenticated;

CREATE FUNCTION pg_temp.as_member(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE FUNCTION pg_temp.expect(label text, got jsonb, key text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got ->> key IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: % = % (want %) in %', label, key, got ->> key, want, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

CREATE FUNCTION pg_temp.settings(p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  EXECUTE 'UPDATE public.street_steal_settings SET ' || p_sql || ' WHERE id';
END
$$;

DO $t$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000a7';
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000b7';
  c uuid := 'cccccccc-0000-4000-8000-0000000000c7';
  d uuid := 'dddddddd-0000-4000-8000-0000000000d7';
  v jsonb := '{"shopLevel":2,"buildings":["tea"],"equipped":{"street":"bunting","shops":{"main":"mat"}}}';
  k1 uuid := gen_random_uuid();
  ck uuid := gen_random_uuid();
  r jsonb;
  r2 jsonb;
  before_b public.member_street_exhibits%ROWTYPE;
  after_b public.member_street_exhibits%ROWTYPE;
  ids text;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.explore_public_streets(0);
    RAISE EXCEPTION 'FAIL 訪客竟然能探索';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 訪客不能探索';
  END;
  BEGIN
    PERFORM public.steal_street_goods(b, gen_random_uuid());
    RAISE EXCEPTION 'FAIL 訪客竟然能偷貨';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 訪客不能偷貨';
  END;

  PERFORM pg_temp.as_member(a); PERFORM public.set_my_street_exhibit(true, v);
  PERFORM pg_temp.as_member(b); PERFORM public.set_my_street_exhibit(true, v);
  PERFORM pg_temp.as_member(d); PERFORM public.set_my_street_exhibit(true, v);
  -- c 沒有建立商店街（資料庫沒有 c 的展示列）。

  EXECUTE 'RESET ROLE';
  SELECT * INTO before_b FROM public.member_street_exhibits WHERE user_id = b;
  PERFORM pg_temp.settings('success_percent = 100, steal_cooldown_seconds = 0');

  -- 探索
  PERFORM pg_temp.as_member(a);
  r := public.explore_public_streets(0);
  PERFORM pg_temp.expect('探索回傳成功', r, 'ok', 'true');
  SELECT string_agg(x ->> 'ownerId', ',') INTO ids FROM jsonb_array_elements(r -> 'streets') AS x;
  IF position(b::text IN ids) = 0 OR position(d::text IN ids) = 0 THEN RAISE EXCEPTION 'FAIL 探索找不到公開的商店街 %', ids; END IF;
  IF position(a::text IN ids) > 0 THEN RAISE EXCEPTION 'FAIL 探索不該列出自己'; END IF;
  IF position(c::text IN ids) > 0 THEN RAISE EXCEPTION 'FAIL 探索不該列出未公開的會員'; END IF;
  IF position('@' IN (r -> 'streets')::text) > 0 OR position('example.invalid' IN (r -> 'streets')::text) > 0 THEN
    RAISE EXCEPTION 'FAIL 探索不能帶出 Email';
  END IF;
  SELECT x INTO r2 FROM jsonb_array_elements(r -> 'streets') AS x WHERE x ->> 'ownerId' = b::text;
  PERFORM pg_temp.expect('探索帶好友狀態', r2, 'friend', 'none');
  PERFORM pg_temp.expect('探索帶偷貨開關', r2, 'allowSteal', 'true');
  PERFORM pg_temp.expect('探索帶展示等級', r2, 'shopLevel', '2');
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(r2) AS k WHERE k NOT IN (
    'ownerId', 'shopLevel', 'buildings', 'likes', 'todayVisitors', 'friend', 'allowSteal', 'triedToday', 'updatedAt',
    'nickname', 'avatarUrl', 'avatarTone'
  )) THEN RAISE EXCEPTION 'FAIL 探索多出不該公開的欄位 %', r2; END IF;
  PERFORM pg_temp.expect('探索分頁從 0 開始', public.explore_public_streets(-5), 'offset', '0');

  -- 不可偷自己、未參與者不能偷、未公開不能偷
  PERFORM pg_temp.expect('不能偷自己', public.steal_street_goods(a, gen_random_uuid()), 'reason', 'self');
  PERFORM pg_temp.expect('未公開不能偷', public.steal_street_goods(c, gen_random_uuid()), 'reason', 'closed');
  PERFORM pg_temp.expect('未公開的目標回 closed', public.get_street_steal_target(c), 'reason', 'closed');
  PERFORM pg_temp.as_member(c);
  PERFORM pg_temp.expect('沒有商店街的會員不能偷', public.steal_street_goods(b, gen_random_uuid()), 'reason', 'not_player');
  PERFORM pg_temp.expect('目標頁標示未參與', public.get_street_steal_target(b), 'player', 'false');

  -- 非好友可以偷；同一把鍵重送回放同一筆
  PERFORM pg_temp.as_member(a);
  r := public.steal_street_goods(b, k1);
  PERFORM pg_temp.expect('非好友可以偷貨', r, 'outcome', 'success');
  PERFORM pg_temp.expect('第一次不是回放', r, 'replay', 'false');
  r2 := public.steal_street_goods(b, k1);
  PERFORM pg_temp.expect('同一把鍵回放', r2, 'replay', 'true');
  PERFORM pg_temp.expect('回放同樣金幣', r2, 'coins', r ->> 'coins');
  IF (r ->> 'coins')::integer NOT BETWEEN 8 AND 20 THEN RAISE EXCEPTION 'FAIL 金幣超出範圍 %', r; END IF;
  PERFORM pg_temp.expect('同一把鍵換對象要拒絕', public.steal_street_goods(d, k1), 'reason', 'invalid');
  EXECUTE 'RESET ROLE';
  IF (SELECT count(*) FROM public.member_street_steals WHERE thief_id = a) <> 1 THEN RAISE EXCEPTION 'FAIL 回放後應只記一筆'; END IF;
  RAISE NOTICE 'PASS 回放後只記一筆';
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('同屋主每日一次', public.steal_street_goods(b, gen_random_uuid()), 'reason', 'already');
  PERFORM pg_temp.expect('今日已用一次', public.get_street_steal_target(b) -> 'steal', 'usedToday', '1');
  PERFORM pg_temp.expect('目標頁記得今天偷過', public.get_street_steal_target(b), 'triedToday', '1');

  -- 非好友不能幫忙打理（好友互助規則不變）
  PERFORM pg_temp.expect('非好友不能幫忙', public.help_street_friend(b, gen_random_uuid()), 'reason', 'not_friend');

  -- 屋主不會被扣東西
  EXECUTE 'RESET ROLE';
  SELECT * INTO after_b FROM public.member_street_exhibits WHERE user_id = b;
  IF (after_b.shop_level, after_b.buildings, after_b.equipped, after_b.revision)
     IS DISTINCT FROM (before_b.shop_level, before_b.buildings, before_b.equipped, before_b.revision) THEN
    RAISE EXCEPTION 'FAIL 偷貨改到了屋主的商店街';
  END IF;
  RAISE NOTICE 'PASS 屋主商店街沒有被扣';

  -- 屋主紀錄與開關
  PERFORM pg_temp.as_member(b);
  r := public.get_my_street_steal();
  PERFORM pg_temp.expect('屋主看得到被偷次數', r, 'stolenToday', '1');
  PERFORM pg_temp.expect('屋主紀錄有偷貨者暱稱', r -> 'log' -> 0, 'outcome', 'success');
  IF (r -> 'log' -> 0 ->> 'nickname') IS NULL THEN RAISE EXCEPTION 'FAIL 紀錄缺暱稱'; END IF;
  PERFORM pg_temp.expect('屋主關閉偷貨', public.set_my_street_steal(false), 'allowSteal', 'false');
  PERFORM pg_temp.as_member(d);
  PERFORM pg_temp.expect('屋主關閉後不能偷', public.steal_street_goods(b, gen_random_uuid()), 'reason', 'owner_off');
  PERFORM pg_temp.expect('目標頁顯示已關閉', public.get_street_steal_target(b), 'allowSteal', 'false');

  -- 關閉偷貨不影響好友互助；直接加好友沿用第 6 批
  PERFORM pg_temp.expect('d 送出邀請', public.request_street_friend(b), 'status', 'outgoing');
  PERFORM pg_temp.expect('不能重複邀請', public.request_street_friend(b), 'reason', 'pending');
  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('b 接受邀請', public.respond_street_friend(d, true), 'status', 'accepted');
  PERFORM pg_temp.as_member(d);
  r := public.explore_public_streets(0);
  SELECT x INTO r2 FROM jsonb_array_elements(r -> 'streets') AS x WHERE x ->> 'ownerId' = b::text;
  PERFORM pg_temp.expect('探索顯示已是好友', r2, 'friend', 'accepted');
  PERFORM pg_temp.expect('關閉偷貨後好友仍可幫忙', public.help_street_friend(b, gen_random_uuid()), 'duplicate', 'false');
  PERFORM pg_temp.expect('好友仍受偷貨開關限制', public.steal_street_goods(b, gen_random_uuid()), 'reason', 'owner_off');

  -- 冷卻、每日上限、屋主上限
  PERFORM pg_temp.as_member(d);
  PERFORM pg_temp.expect('d 偷 a 成功', public.steal_street_goods(a, gen_random_uuid()), 'outcome', 'success');
  PERFORM pg_temp.settings('steal_cooldown_seconds = 600');
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('冷卻中', public.steal_street_goods(d, gen_random_uuid()), 'reason', 'cooldown');
  PERFORM pg_temp.settings('steal_cooldown_seconds = 0, daily_steal_limit = 1');
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('每日次數用盡', public.steal_street_goods(d, gen_random_uuid()), 'reason', 'limit');
  PERFORM pg_temp.settings('daily_steal_limit = 8, owner_daily_limit = 1');
  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('屋主今日被偷已滿', public.steal_street_goods(a, gen_random_uuid()), 'reason', 'owner_full');
  PERFORM pg_temp.settings('owner_daily_limit = 20, success_percent = 0');
  PERFORM pg_temp.as_member(a);
  r := public.steal_street_goods(d, gen_random_uuid());
  PERFORM pg_temp.expect('失敗也算一次', r, 'outcome', 'miss');
  PERFORM pg_temp.expect('失敗沒有金幣', r, 'coins', '0');
  PERFORM pg_temp.settings('enabled = false');
  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('總開關關閉', public.steal_street_goods(d, gen_random_uuid()), 'reason', 'disabled');
  PERFORM pg_temp.settings('enabled = true');

  -- 領取：同一把鍵回放，不重複入帳
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('a 有一筆待領', public.get_my_street_steal() -> 'steal', 'unclaimedCount', '1');
  r := public.claim_my_street_steal_rewards(ck);
  PERFORM pg_temp.expect('第一次領取', r, 'replay', 'false');
  IF (r ->> 'coins')::integer NOT BETWEEN 8 AND 20 OR (r ->> 'xp')::integer <> 3 THEN RAISE EXCEPTION 'FAIL 領取金額不對 %', r; END IF;
  r2 := public.claim_my_street_steal_rewards(ck);
  PERFORM pg_temp.expect('同一把鍵回放領取', r2, 'replay', 'true');
  PERFORM pg_temp.expect('回放金額相同', r2, 'coins', r ->> 'coins');
  PERFORM pg_temp.expect('新鍵領不到第二次', public.claim_my_street_steal_rewards(gen_random_uuid()), 'coins', '0');
  PERFORM pg_temp.expect('領完沒有待領', public.get_my_street_steal() -> 'steal', 'unclaimedCount', '0');
  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('別人的領取鍵領不到 a 的獎勵', public.claim_my_street_steal_rewards(ck), 'coins', '0');

  -- 直接碰表
  PERFORM pg_temp.as_member(a);
  BEGIN
    PERFORM 1 FROM public.member_street_steals LIMIT 1;
    RAISE EXCEPTION 'FAIL 會員竟然能直接讀偷貨表';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接讀偷貨表';
  END;
  BEGIN
    INSERT INTO public.member_street_steals (thief_id, owner_id, steal_day, request_key, outcome, coins, xp)
    VALUES (a, b, current_date, gen_random_uuid(), 'success', 999, 999);
    RAISE EXCEPTION 'FAIL 會員竟然能直接寫偷貨表';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接寫偷貨表';
  END;
  BEGIN
    UPDATE public.street_steal_settings SET success_percent = 100;
    RAISE EXCEPTION 'FAIL 會員竟然能改參數';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能改參數';
  END;

  EXECUTE 'RESET ROLE';
  BEGIN
    DELETE FROM public.member_street_steals WHERE thief_id = a;
    RAISE EXCEPTION 'FAIL 偷貨紀錄竟然能刪';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 偷貨紀錄不能刪';
  END;
  BEGIN
    UPDATE public.member_street_steals SET coins = 999 WHERE thief_id = a;
    RAISE EXCEPTION 'FAIL 偷貨紀錄竟然能改';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 偷貨紀錄不能改';
  END;

  IF (SELECT count(*) FROM public.member_point_entries) <> (SELECT entries FROM t_before)
     OR (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) <> (SELECT balance FROM t_before) THEN
    RAISE EXCEPTION 'FAIL 偷貨動到了 Pay 點數';
  END IF;
  RAISE NOTICE 'PASS Pay 點數沒有變動';
  IF (SELECT count(*) FROM public.member_street_helps) <> (SELECT helps FROM t_before) + 1 THEN
    RAISE EXCEPTION 'FAIL 互助紀錄數不對（只應多 d 幫 b 的一筆）';
  END IF;
  RAISE NOTICE 'PASS 偷貨沒有寫入互助紀錄';

  -- 會員刪除時外鍵連動要能清掉
  DELETE FROM auth.users WHERE id = c;
  DELETE FROM auth.users WHERE id = a;
  IF EXISTS (SELECT 1 FROM public.member_street_steals WHERE thief_id = a OR owner_id = a) THEN
    RAISE EXCEPTION 'FAIL 刪除會員後偷貨紀錄沒有清掉';
  END IF;
  RAISE NOTICE 'PASS 刪除會員時偷貨紀錄連動清除';
END
$t$;
