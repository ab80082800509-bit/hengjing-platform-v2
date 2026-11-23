-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 把 20261029220200_street_friend_help_apply.sql 本體（去掉 BEGIN/COMMIT）接在本檔前面，整段包在一個交易裡，最後 ROLLBACK。
-- 三位測試會員只存在這個交易；不碰既有會員、點數或街景。

INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'help-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'help-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('cccccccc-0000-4000-8000-00000000000c', 'help-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

CREATE TEMP TABLE t_before AS
SELECT
  (SELECT count(*) FROM public.member_point_entries) AS entries,
  (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) AS balance;
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

DO $t$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  c uuid := 'cccccccc-0000-4000-8000-00000000000c';
  v jsonb := '{"shopLevel":1,"buildings":[],"equipped":{"street":null,"shops":{}}}';
  r jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_my_street_friends();
    RAISE EXCEPTION 'FAIL 訪客竟然讀到好友';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 訪客不能讀好友';
  END;
  BEGIN
    PERFORM public.help_street_friend(a, gen_random_uuid());
    RAISE EXCEPTION 'FAIL 訪客竟然能幫忙';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 訪客不能幫忙';
  END;

  PERFORM pg_temp.as_member(a); PERFORM public.set_my_street_exhibit(true, v);
  PERFORM pg_temp.as_member(b); PERFORM public.set_my_street_exhibit(true, v);
  PERFORM pg_temp.as_member(c); PERFORM public.set_my_street_exhibit(true, v);

  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('不能加自己好友', public.request_street_friend(a), 'reason', 'self');
  PERFORM pg_temp.expect('送出邀請', public.request_street_friend(b), 'status', 'outgoing');
  PERFORM pg_temp.expect('重複邀請被擋', public.request_street_friend(b), 'reason', 'pending');
  PERFORM pg_temp.expect('還不是好友不能幫忙', public.help_street_friend(b, gen_random_uuid()), 'reason', 'not_friend');
  PERFORM pg_temp.expect('邀請者不能自己接受', public.respond_street_friend(b, true), 'reason', 'missing');

  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('對方接受', public.respond_street_friend(a, true), 'status', 'accepted');
  PERFORM pg_temp.expect('不能幫自己', public.help_street_friend(b, gen_random_uuid()), 'reason', 'self');

  PERFORM pg_temp.as_member(a);
  r := public.help_street_friend(b, 'dddddddd-0000-4000-8000-000000000001');
  PERFORM pg_temp.expect('第一次幫忙成功', r, 'duplicate', 'false');
  PERFORM pg_temp.expect('幫忙次數加一', r -> 'help', 'usedToday', '1');
  PERFORM pg_temp.expect('同一把請求鍵重送不重記', public.help_street_friend(b, 'dddddddd-0000-4000-8000-000000000001'), 'duplicate', 'true');
  PERFORM pg_temp.expect('同日同好友只能幫一次', public.help_street_friend(b, gen_random_uuid()), 'reason', 'already');
  PERFORM pg_temp.expect('重送後次數不變', public.get_my_street_friends() -> 'help', 'usedToday', '1');

  PERFORM pg_temp.expect('邀請 C', public.request_street_friend(c), 'status', 'outgoing');
  PERFORM pg_temp.as_member(c);
  PERFORM pg_temp.expect('C 拒絕', public.respond_street_friend(a, false), 'status', 'none');
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('被拒當天不能重送', public.request_street_friend(c), 'reason', 'duplicate');
  PERFORM pg_temp.as_member(c);
  PERFORM pg_temp.expect('C 主動邀請 A', public.request_street_friend(a), 'status', 'outgoing');
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('A 回邀即成好友', public.request_street_friend(c), 'status', 'accepted');
  PERFORM pg_temp.expect('冷卻中不能再幫', public.help_street_friend(c, gen_random_uuid()), 'reason', 'cooldown');

  EXECUTE 'RESET ROLE';
  UPDATE public.street_help_settings SET help_cooldown_seconds = 0, daily_help_limit = 1;
  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('每日次數上限', public.help_street_friend(c, gen_random_uuid()), 'reason', 'limit');

  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('B 幫 A', public.help_street_friend(a, gen_random_uuid()), 'duplicate', 'false');
  PERFORM pg_temp.expect('B 不是 C 的好友', public.help_street_friend(c, gen_random_uuid()), 'reason', 'not_friend');

  PERFORM pg_temp.as_member(a);
  PERFORM pg_temp.expect('沒有領取鍵被擋', public.claim_my_street_help_rewards(NULL), 'reason', 'invalid');
  r := public.claim_my_street_help_rewards('eeeeeeee-0000-4000-8000-000000000001');
  PERFORM pg_temp.expect('A 領到幫手 30 + 屋主 20', r, 'coins', '50');
  PERFORM pg_temp.expect('A 領到經驗 8', r, 'xp', '8');
  PERFORM pg_temp.expect('第一次領取不是回放', r, 'replay', 'false');
  r := public.claim_my_street_help_rewards('eeeeeeee-0000-4000-8000-000000000001');
  PERFORM pg_temp.expect('回覆遺失後同一把鍵重領，回放同一筆金幣', r, 'coins', '50');
  PERFORM pg_temp.expect('回覆遺失後同一把鍵重領，回放同一筆經驗', r, 'xp', '8');
  PERFORM pg_temp.expect('重領標記為回放', r, 'replay', 'true');
  PERFORM pg_temp.expect('回放不會讓待領變多', r -> 'help', 'unclaimedCount', '0');
  PERFORM pg_temp.expect('換新鍵再領為 0', public.claim_my_street_help_rewards(gen_random_uuid()), 'coins', '0');
  PERFORM pg_temp.as_member(c);
  PERFORM pg_temp.expect('C 沒有可領', public.claim_my_street_help_rewards(gen_random_uuid()), 'coins', '0');
  PERFORM pg_temp.expect('別人的領取鍵不能回放', public.claim_my_street_help_rewards('eeeeeeee-0000-4000-8000-000000000001'), 'coins', '0');
  PERFORM pg_temp.as_member(b);
  PERFORM pg_temp.expect('B 領到 50', public.claim_my_street_help_rewards(gen_random_uuid()), 'coins', '50');

  BEGIN
    PERFORM 1 FROM public.member_street_helps;
    RAISE EXCEPTION 'FAIL 會員直接讀到互助表';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接讀互助表';
  END;
  BEGIN
    UPDATE public.street_help_settings SET helper_coins = 1000;
    RAISE EXCEPTION 'FAIL 會員改得動參數';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能改參數';
  END;
  BEGIN
    UPDATE public.member_street_helps SET owner_claimed_at = NULL;
    RAISE EXCEPTION 'FAIL 會員改得動領取紀錄';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能重設領取';
  END;
  BEGIN
    PERFORM 1 FROM public.member_street_help_claims;
    RAISE EXCEPTION 'FAIL 會員直接讀到領取紀錄';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接讀領取紀錄';
  END;

  EXECUTE 'RESET ROLE';
  BEGIN
    UPDATE public.member_street_helps SET owner_claimed_at = NULL;
    RAISE EXCEPTION 'FAIL 繞過守衛重設領取';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '好友互助只能由商店街交易更新%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 擁有者連線也不能繞過守衛';
  END;
  PERFORM set_config('street.internal', 'on', true);
  BEGIN
    UPDATE public.member_street_helps SET owner_claimed_at = NULL WHERE owner_claimed_at IS NOT NULL;
    RAISE EXCEPTION 'FAIL 已領的紀錄被重設';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '互助紀錄只能標記領取一次%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 已領的紀錄不能重設';
  END;
  BEGIN
    UPDATE public.member_street_helps SET owner_claim_key = gen_random_uuid() WHERE owner_claimed_at IS NOT NULL;
    RAISE EXCEPTION 'FAIL 已領的領取鍵被改掉';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '互助紀錄只能標記領取一次%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 已領的領取鍵不能改';
  END;
  BEGIN
    UPDATE public.member_street_help_claims SET coins = coins + 1;
    RAISE EXCEPTION 'FAIL 領取紀錄被改';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '互助紀錄不可修改%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 領取紀錄不能改';
  END;
  BEGIN
    DELETE FROM public.member_street_help_claims;
    RAISE EXCEPTION 'FAIL 領取紀錄被刪';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '互助紀錄不可刪除%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS 領取紀錄不能刪';
  END;
  PERFORM set_config('street.internal', 'off', true);

  IF (SELECT count(*) FROM public.member_point_entries) <> (SELECT entries FROM t_before)
     OR (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) <> (SELECT balance FROM t_before) THEN
    RAISE EXCEPTION 'FAIL Pay 點數有變動';
  END IF;
  RAISE NOTICE 'PASS Pay 點數帳本與餘額未變';

  DELETE FROM auth.users WHERE id = c;
  DELETE FROM auth.users WHERE id = a;
  IF EXISTS (SELECT 1 FROM public.member_street_help_claims WHERE user_id = a) THEN
    RAISE EXCEPTION 'FAIL 刪除會員後領取紀錄殘留';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_street_friends WHERE user_low = c OR user_high = c)
     OR EXISTS (SELECT 1 FROM public.member_street_helps WHERE helper_id = c OR owner_id = c) THEN
    RAISE EXCEPTION 'FAIL 刪除會員後殘留';
  END IF;
  RAISE NOTICE 'PASS 刪除會員時外鍵連動清除';
END
$t$;
