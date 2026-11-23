-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-street-cloud-local-test.mjs 組合：BEGIN；第 6、7 批本體（本機若尚未套用）；第 9 批本體；本檔；ROLLBACK。
-- 三位測試會員只存在這個交易；不碰既有會員、點數或街景。

INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a9', 'cloud-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000b9', 'cloud-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('cccccccc-0000-4000-8000-0000000000c9', 'cloud-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

CREATE TEMP TABLE t_before AS
SELECT
  (SELECT count(*) FROM public.member_street_help_claims) AS help_claims,
  (SELECT count(*) FROM public.member_street_steal_claims) AS steal_claims,
  CASE WHEN to_regclass('public.member_point_entries') IS NOT NULL
    THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_point_entries', false, true, '')))[1]::text::bigint END AS point_entries;

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
  IF got #>> string_to_array(key, '.') IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL %: % = % (want %) in %', label, key, got #>> string_to_array(key, '.'), want, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

-- 第 6、7 批的領取紀錄只能由商店街交易寫入；測試用同一個交易旗標放入固定的領取資料。
CREATE FUNCTION pg_temp.claim(p_table text, p_user uuid, p_key uuid, p_coins integer, p_xp integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('street.internal', 'on', true);
  EXECUTE format('INSERT INTO public.%I (user_id, claim_key, coins, xp, entries) VALUES ($1, $2, $3, $4, ''[]''::jsonb)', p_table)
    USING p_user, p_key, p_coins, p_xp;
  PERFORM set_config('street.internal', 'off', true);
END
$$;

CREATE FUNCTION pg_temp.street(p_level integer, p_coins bigint, p_xp bigint, p_served bigint, p_items bigint, p_earned bigint, p_xp_earned bigint,
  p_buildings jsonb DEFAULT '[]', p_decors jsonb DEFAULT '[]', p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'v', 3, 'createdAt', 1761700000000, 'shopLevel', p_level, 'coins', p_coins, 'xp', p_xp, 'open', true,
    'stock', jsonb_build_object('croissant', 99, 'milktea', 1, 'wedding', 5),
    'jobs', '[]'::jsonb,
    'stats', jsonb_build_object('served', p_served, 'missed', 0, 'itemsSold', p_items, 'earned', p_earned, 'tips', 0, 'streak', 0, 'bestStreak', 0, 'xpEarned', p_xp_earned),
    'today', jsonb_build_object('day', '2026-10-29', 'served', 0, 'missed', 0, 'earned', 0),
    'log', '[]'::jsonb, 'tutorial', 4,
    'buildings', p_buildings, 'ownedDecors', p_decors, 'equipped', jsonb_build_object('street', null, 'shops', '{}'::jsonb),
    'helpClaimPending', null, 'helpClaimsApplied', '[]'::jsonb, 'stealClaimPending', null, 'stealClaimsApplied', '[]'::jsonb
  ) || p_extra
$$;

GRANT SELECT ON t_before TO authenticated;

DO $t$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000a9';
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000b9';
  c uuid := 'cccccccc-0000-4000-8000-0000000000c9';
  k1 uuid := '11111111-0000-4000-8000-000000000001';
  k2 uuid := '11111111-0000-4000-8000-000000000002';
  k3 uuid := '11111111-0000-4000-8000-000000000003';
  k4 uuid := '11111111-0000-4000-8000-000000000004';
  ia uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  r jsonb;
  a_before jsonb;
  n bigint;
BEGIN
  -- 權限：訪客不能呼叫，會員不能直接讀寫資料表。
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_my_street_save();
    RAISE EXCEPTION 'FAIL anon get';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 訪客不能讀雲端存檔';
  END;
  PERFORM pg_temp.as_member(a);
  BEGIN
    PERFORM 1 FROM public.member_street_saves;
    RAISE EXCEPTION 'FAIL direct select';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接讀存檔表';
  END;
  BEGIN
    INSERT INTO public.member_street_saves (user_id, progress, coins, xp, shop_level, import_source, last_request_key)
    VALUES (a, '{}', 999999, 0, 5, 'fresh', gen_random_uuid());
    RAISE EXCEPTION 'FAIL direct insert';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接寫存檔表';
  END;
  BEGIN
    PERFORM public.street_cloud_build(NULL, '{}', 0, 0, 0, 0, 0, 0, 0);
    RAISE EXCEPTION 'FAIL internal build';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 會員不能直接呼叫內部驗證函式';
  END;

  r := public.get_my_street_save();
  PERFORM pg_temp.expect('還沒有雲端存檔', r, 'exists', 'false');

  -- 舊存檔轉移：k1 已在舊存檔入帳、k2 送出未入帳、k3 不在舊存檔紀錄（視為已在其他地方入帳）。
  PERFORM pg_temp.claim('member_street_help_claims', a, k1, 30, 8);
  PERFORM pg_temp.claim('member_street_help_claims', a, k2, 20, 0);
  PERFORM pg_temp.claim('member_street_steal_claims', a, k3, 15, 3);
  PERFORM pg_temp.as_member(a);
  -- 營收 900 + 已入帳 k1 30 − 升級 150 − 腳踏墊 60 = 720。
  r := public.import_my_street_save(pg_temp.street(2, 720, 300, 40, 60, 900, 0, '[]', '["mat"]',
    jsonb_build_object('helpClaimPending', k2, 'helpClaimsApplied', jsonb_build_array(k1))), ia);
  PERFORM pg_temp.expect('正常舊存檔轉移成功', r, 'ok', 'true');
  PERFORM pg_temp.expect('轉移後 revision 1', r, 'revision', '1');
  PERFORM pg_temp.expect('未入帳的 k2 在轉移時入帳一次', r, 'progress.coins', '740');
  PERFORM pg_temp.expect('經驗保留', r, 'progress.xp', '300');
  PERFORM pg_temp.expect('等級保留', r, 'progress.shopLevel', '2');
  PERFORM pg_temp.expect('裝潢保留', r, 'progress.ownedDecors.0', 'mat');
  PERFORM pg_temp.expect('正常存檔不調整', r, 'importAdjusted', 'false');
  PERFORM pg_temp.expect('來源為瀏覽器舊存檔', r, 'importSource', 'browser');
  PERFORM pg_temp.expect('庫存夾在貨架上限', r, 'progress.stock.croissant', '4');
  PERFORM pg_temp.expect('未解鎖商品庫存歸零', r, 'progress.stock.wedding', '0');

  r := public.import_my_street_save(pg_temp.street(2, 720, 300, 40, 60, 900, 0), ia);
  PERFORM pg_temp.expect('轉移重送回放', r, 'replay', 'true');
  PERFORM pg_temp.expect('轉移重送不重複入帳', r, 'progress.coins', '740');
  r := public.import_my_street_save(pg_temp.street(5, 999999, 99999, 9, 9, 9, 0), gen_random_uuid());
  PERFORM pg_temp.expect('不能第二次轉移', r, 'reason', 'exists');
  PERFORM pg_temp.expect('第二次轉移不改存檔', r, 'progress.coins', '740');

  -- 偽造金幣：B 營收 100 卻宣稱 999999 金幣，調降為 100。
  PERFORM pg_temp.as_member(b);
  r := public.import_my_street_save(pg_temp.street(1, 999999, 20, 5, 5, 100, 0), gen_random_uuid());
  PERFORM pg_temp.expect('偽造金幣被調降', r, 'progress.coins', '100');
  PERFORM pg_temp.expect('調降有標記', r, 'importAdjusted', 'true');
  r := public.get_my_street_save();
  PERFORM pg_temp.expect('B 只讀到自己的存檔', r, 'progress.coins', '100');

  -- C：不一致與超過上限的舊存檔被拒，之後仍可用新店轉移。
  PERFORM pg_temp.as_member(c);
  r := public.import_my_street_save(pg_temp.street(1, 0, 0, 1, 1, 10000, 0), gen_random_uuid());
  PERFORM pg_temp.expect('營收超過賣出件數上限被拒', r, 'reason', 'import_inconsistent');
  r := public.import_my_street_save(pg_temp.street(5, 0, 0, 1, 1, 0, 0), gen_random_uuid());
  PERFORM pg_temp.expect('沒有營收卻有 Lv.5 店面被拒', r, 'reason', 'import_inconsistent');
  r := public.import_my_street_save(pg_temp.street(1, 0, 70, 10, 10, 100, 0), gen_random_uuid());
  PERFORM pg_temp.expect('經驗超過賣出件數上限被拒', r, 'reason', 'import_inconsistent');
  r := public.import_my_street_save(pg_temp.street(5, 0, 20000, 600000, 1800000, 2000000, 0), gen_random_uuid());
  PERFORM pg_temp.expect('累計營收超過轉移上限被拒', r, 'reason', 'import_cap');
  r := public.import_my_street_save('{"v": 9}'::jsonb, gen_random_uuid());
  PERFORM pg_temp.expect('不認得的版本被拒', r, 'reason', 'invalid');
  r := public.import_my_street_save(pg_temp.street(1, 0, 0, 0, 0, 0, 0), gen_random_uuid());
  PERFORM pg_temp.expect('新店轉移', r, 'importSource', 'fresh');

  -- 一般存檔與版本控制。
  PERFORM pg_temp.as_member(a);
  r := public.save_my_street(0, pg_temp.street(2, 0, 300, 40, 60, 900, 0), s1);
  PERFORM pg_temp.expect('舊 revision 存檔回 conflict', r, 'reason', 'conflict');
  PERFORM pg_temp.expect('conflict 附上雲端最新版', r, 'revision', '1');
  -- 營業 +5 位、+8 件、+100 金、+40 經驗；前端宣稱 999999 金幣不被採用。
  r := public.save_my_street(1, pg_temp.street(2, 999999, 999999, 45, 68, 1000, 40, '[]', '["mat"]'), s1);
  PERFORM pg_temp.expect('存檔成功', r, 'ok', 'true');
  PERFORM pg_temp.expect('revision 前進', r, 'revision', '2');
  PERFORM pg_temp.expect('金幣由資料庫重算', r, 'progress.coins', '840');
  PERFORM pg_temp.expect('經驗由資料庫重算', r, 'progress.xp', '340');
  r := public.save_my_street(1, pg_temp.street(2, 999999, 999999, 99, 99, 9999, 99, '[]', '["mat"]'), s1);
  PERFORM pg_temp.expect('同一把鍵重送回放', r, 'replay', 'true');
  PERFORM pg_temp.expect('重送不重算', r, 'progress.coins', '840');
  r := public.save_my_street(1, pg_temp.street(2, 0, 0, 46, 69, 1010, 41, '[]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('另一台舊裝置不能覆蓋', r, 'reason', 'conflict');
  PERFORM pg_temp.expect('舊裝置拿到新版', r, 'progress.coins', '840');

  -- 速度上限：同一刻多出 1000 位客人不合理。
  r := public.save_my_street(2, pg_temp.street(2, 0, 0, 1045, 2068, 31000, 8040, '[]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('營業速度超過上限被拒', r, 'reason', 'implausible');
  r := public.save_my_street(2, pg_temp.street(2, 0, 0, 45, 68, 1000, 40, '[]', '[]'), gen_random_uuid());
  PERFORM pg_temp.expect('收藏的裝潢不能消失', r, 'reason', 'regress');
  r := public.save_my_street(2, pg_temp.street(1, 0, 0, 45, 68, 1000, 40, '[]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('店面不能降級', r, 'reason', 'regress');
  r := public.save_my_street(2, pg_temp.street(2, 0, 0, 44, 68, 1000, 40, '[]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('累計統計不能倒退', r, 'reason', 'regress');

  -- 經過一小時：正常營業量可以存。
  EXECUTE 'RESET ROLE';
  UPDATE public.member_street_saves SET updated_at = updated_at - interval '1 hour' WHERE user_id = a;
  PERFORM pg_temp.as_member(a);
  r := public.save_my_street(2, pg_temp.street(2, 0, 0, 445, 868, 25000, 6440, '[]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('一小時內合理營業量可以存', r, 'progress.coins', '24840');
  PERFORM pg_temp.expect('一小時內的經驗', r, 'progress.xp', '6740');

  -- 升級花費由資料庫扣：Lv.3（420）＋暖暖茶飲館（360）。
  r := public.save_my_street(3, pg_temp.street(3, 0, 0, 445, 868, 25000, 6440, '["tea"]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('升級與開店扣金幣', r, 'progress.coins', '24060');
  PERFORM pg_temp.expect('街邊店保存', r, 'progress.buildings.0', 'tea');

  -- 存檔後才領到的偷貨獎勵：下一次存檔入帳一次，再存不會重複。
  PERFORM pg_temp.claim('member_street_steal_claims', a, k4, 12, 2);
  PERFORM pg_temp.as_member(a);
  r := public.save_my_street(4, pg_temp.street(3, 0, 0, 445, 868, 25000, 6440, '["tea"]', '["mat"]'), s2);
  PERFORM pg_temp.expect('新的偷貨獎勵入帳', r, 'progress.coins', '24072');
  PERFORM pg_temp.expect('入帳金額回報', r, 'credited.coins', '12');
  r := public.save_my_street(4, pg_temp.street(3, 0, 0, 445, 868, 25000, 6440, '["tea"]', '["mat"]'), s2);
  PERFORM pg_temp.expect('斷線重送不重複發獎', r, 'progress.coins', '24072');
  r := public.save_my_street(5, pg_temp.street(3, 0, 0, 445, 868, 25000, 6440, '["tea"]', '["mat"]'), gen_random_uuid());
  PERFORM pg_temp.expect('再存一次不重複入帳', r, 'progress.coins', '24072');
  PERFORM pg_temp.expect('再存一次沒有新的入帳', r, 'credited.coins', '0');

  -- B 金幣不夠買升級；B 的動作不影響 A。
  a_before := public.get_my_street_save();
  PERFORM pg_temp.as_member(b);
  r := public.save_my_street(1, pg_temp.street(2, 999999, 999, 5, 5, 100, 0), gen_random_uuid());
  PERFORM pg_temp.expect('金幣不足不能升級', r, 'reason', 'coins');
  r := public.save_my_street(1, pg_temp.street(1, 0, 0, 5, 5, 100, 0, '[]', '["lantern"]'), gen_random_uuid());
  PERFORM pg_temp.expect('店長等級不夠不能買裝潢', r, 'reason', 'rank');
  PERFORM pg_temp.as_member(a);
  r := public.get_my_street_save();
  IF r IS DISTINCT FROM a_before THEN
    RAISE EXCEPTION 'FAIL B 的存檔動作改到 A：% vs %', r, a_before;
  END IF;
  RAISE NOTICE 'PASS 不同會員的存檔完全隔離';

  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.member_street_save_credits WHERE user_id = a;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL A 入帳紀錄應為 4 筆，實際 %', n; END IF;
  SELECT count(*) INTO n FROM public.member_street_save_credits WHERE user_id = a AND credited;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL A 實際加金幣的入帳應為 2 筆（k2、k4），實際 %', n; END IF;
  RAISE NOTICE 'PASS 每把領取鍵只入帳一次';
  SELECT count(*) INTO n FROM public.member_street_save_log WHERE user_id = a;
  IF n <> 6 THEN RAISE EXCEPTION 'FAIL A 應有 6 筆存檔紀錄（轉移 1、存檔 5），實際 %', n; END IF;
  RAISE NOTICE 'PASS 每次接受的存檔都有紀錄';
  IF (SELECT help_claims FROM t_before) + 2 <> (SELECT count(*) FROM public.member_street_help_claims)
     OR (SELECT steal_claims FROM t_before) + 2 <> (SELECT count(*) FROM public.member_street_steal_claims) THEN
    RAISE EXCEPTION 'FAIL 雲端存檔不應新增或修改第 6、7 批領取紀錄';
  END IF;
  RAISE NOTICE 'PASS 第 6、7 批領取紀錄只讀不改';
  IF (SELECT point_entries FROM t_before) IS NOT NULL
     AND (SELECT point_entries FROM t_before) <> (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.member_point_entries', false, true, '')))[1]::text::bigint THEN
    RAISE EXCEPTION 'FAIL Pay 點數帳本被改動';
  END IF;
  RAISE NOTICE 'PASS Pay 點數帳本未改動';
END
$t$;
