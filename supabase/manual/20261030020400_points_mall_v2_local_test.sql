-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-points-mall-v2-local-test.mjs 組合：BEGIN；（本機缺少時）雲端存檔本體；商城 v2 本體；開放兌換本體；本檔；ROLLBACK。
-- 測試會員只存在這個交易；結尾整個回復，不留任何資料。

INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'mall-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000d2', 'mall-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

-- 測試點數：關掉觸發器放入一筆種子流水與帳戶餘額（只在這個交易裡）。
SET LOCAL session_replication_role = replica;
WITH seed AS (
  INSERT INTO public.member_point_entries (user_id, delta, balance_after, kind, claim_key, taipei_day, metadata)
  VALUES
    ('aaaaaaaa-0000-4000-8000-0000000000d1', 1000, 1000, 'scratch', 'scratch:mall-v2-seed', public.taipei_today(), '{}'::jsonb),
    ('bbbbbbbb-0000-4000-8000-0000000000d2', 100, 100, 'scratch', 'scratch:mall-v2-seed', public.taipei_today(), '{}'::jsonb)
  RETURNING id, user_id, delta, balance_after, kind, claim_key, taipei_day
)
INSERT INTO public.reward_claims (user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata)
SELECT user_id, kind, claim_key, taipei_day, delta, balance_after, id, '{}'::jsonb FROM seed;
INSERT INTO public.member_point_accounts (user_id, balance)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000d1', 1000), ('bbbbbbbb-0000-4000-8000-0000000000d2', 100);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_member(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE FUNCTION pg_temp.item(p_mall jsonb, p_id text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_mall -> 'perks') AS t(e) WHERE e ->> 'id' = p_id
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

DO $t$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000d1';
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000d2';
  mall jsonb;
  res jsonb;
  bal integer;
BEGIN
  PERFORM pg_temp.as_member(a);
  mall := public.get_my_points_mall();
  PERFORM pg_temp.ok('總覽回傳 40 件', jsonb_array_length(mall -> 'perks') = 40, mall::text);
  PERFORM pg_temp.ok('總覽版本 2', (mall ->> 'catalogVersion') = '2');
  PERFORM pg_temp.ok('兌換已開放', (mall ->> 'perkPurchaseEnabled') = 'true');
  PERFORM pg_temp.ok('一般商品可兌換', pg_temp.item(mall, 'bubble-milktea') ->> 'state' = 'available');
  PERFORM pg_temp.ok('未達合成等級顯示未解鎖', pg_temp.item(mall, 'title-merge-boss') ->> 'state' = 'locked'
    AND pg_temp.item(mall, 'title-merge-boss') ->> 'unlockTarget' = '5');
  PERFORM pg_temp.ok('節慶收藏不在期間', pg_temp.item(mall, 'collect-snowman') ->> 'state' IN ('not_started', 'available'));

  -- 正常兌換：扣點、帳本與入庫同一筆
  res := public.purchase_my_perk('bubble-milktea');
  PERFORM pg_temp.ok('兌換成功扣 80 點', (res ->> 'balance')::integer = 920 AND res -> 'owned' ? 'bubble-milktea' AND (res ->> 'replayed') = 'false', res::text);
  -- 重複送出不重複扣點
  res := public.purchase_my_perk('bubble-milktea');
  PERFORM pg_temp.ok('重複兌換不再扣點', (res ->> 'balance')::integer = 920 AND (res ->> 'replayed') = 'true', res::text);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok('流水只有一筆 -80', (SELECT count(*) FROM public.member_point_entries WHERE user_id = a AND claim_key = 'perk_unlock:bubble-milktea' AND delta = -80) = 1);
  PERFORM pg_temp.ok('只有一筆收藏', (SELECT count(*) FROM public.member_perk_holds WHERE user_id = a AND perk_id = 'bubble-milktea') = 1);
  PERFORM pg_temp.as_member(a);

  -- 新欄位可以裝備、卸下；貼圖包不佔欄位
  res := public.set_my_perk_equipped('bubble-milktea', true);
  PERFORM pg_temp.ok('裝備聊天氣泡', res -> 'equipped' ->> 'bubble' = 'bubble-milktea', res::text);
  res := public.purchase_my_perk('sticker-party');
  PERFORM pg_temp.ok('兌換貼圖包', res -> 'owned' ? 'sticker-party' AND (res ->> 'balance')::integer = 770, res::text);
  PERFORM pg_temp.fails('貼圖包不能裝備', 'SELECT public.set_my_perk_equipped(''sticker-party'', true)', '不需要裝備');
  res := public.public_equipped_perks(ARRAY[a]);
  PERFORM pg_temp.ok('公開裝備含氣泡與貼圖包', res -> 0 ->> 'bubble' = 'bubble-milktea' AND res -> 0 -> 'stickers' ? 'sticker-party', res::text);
  res := public.set_my_perk_equipped('bubble-milktea', false);
  PERFORM pg_temp.ok('卸下聊天氣泡', NOT (res -> 'equipped' ? 'bubble'), res::text);

  -- 未解鎖：前端怎麼送都拿不到
  PERFORM pg_temp.fails('未達解鎖條件不能兌換', 'SELECT public.purchase_my_perk(''title-merge-boss'')', '尚未達成解鎖條件');
  PERFORM pg_temp.fails('商店街等級不足不能兌換裝潢', 'SELECT public.purchase_my_perk(''decor-fountain'')', '尚未達成解鎖條件');
  PERFORM pg_temp.fails('未擁有不能裝備', 'SELECT public.set_my_perk_equipped(''pet-cat'', true)', '尚未擁有');
  PERFORM pg_temp.fails('不存在的商品', 'SELECT public.purchase_my_perk(''frame-fake'')', '無法購買');

  -- 點數不足：B 只有 100 點
  PERFORM pg_temp.as_member(b);
  mall := public.get_my_points_mall();
  PERFORM pg_temp.ok('B 看到點數不足', pg_temp.item(mall, 'pet-penguin') ->> 'state' = 'short');
  PERFORM pg_temp.fails('點數不足不能兌換', 'SELECT public.purchase_my_perk(''pet-penguin'')', '點數不足');
  PERFORM pg_temp.ok('失敗不扣點', (public.get_my_points_mall() ->> 'balance')::integer = 100);
  PERFORM pg_temp.ok('B 看不到 A 的收藏', NOT (public.list_my_perks() -> 'owned' ? 'bubble-milktea'));

  -- 會員不能直接改表
  PERFORM pg_temp.fails('會員不能寫收藏表', 'INSERT INTO public.member_perk_holds (user_id, perk_id, category, cost, claim_key, point_entry_id) VALUES (''' || b || ''', ''pet-cat'', ''pet'', 1, ''perk_unlock:pet-cat'', gen_random_uuid())', 'permission denied');
  PERFORM pg_temp.fails('會員不能改價格', 'UPDATE public.member_perk_catalog SET cost = 1', 'permission denied');
  PERFORM pg_temp.fails('會員不能改販售期間', 'INSERT INTO public.member_perk_sale_windows VALUES (''collect-moon'', ''2026-10-01'', ''2026-11-01'')', 'permission denied');
  PERFORM pg_temp.fails('會員不能打開或關閉兌換', 'UPDATE public.member_perk_settings SET purchase_enabled = false', 'permission denied');
END
$t$;

-- 節慶期間：把資料庫時鐘以外的判斷函式直接帶入日期驗證
DO $t2$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.ok('聖誕期間開賣', public.perk_sale_open('collect-snowman', DATE '2026-12-24'));
  PERFORM pg_temp.ok('聖誕前未開賣', NOT public.perk_sale_open('collect-snowman', DATE '2026-12-19'));
  PERFORM pg_temp.ok('聖誕後已結束', NOT public.perk_sale_open('collect-snowman', DATE '2026-12-26'));
  PERFORM pg_temp.ok('隔年再開賣', public.perk_sale_open('collect-snowman', DATE '2027-12-20'));
  PERFORM pg_temp.ok('常態商品永遠開賣', public.perk_sale_open('board-wood', DATE '2030-01-01'));
  PERFORM pg_temp.ok('節慶前顯示未開始',
    pg_temp.item(jsonb_build_object('perks', public.perk_mall_items_json('aaaaaaaa-0000-4000-8000-0000000000d1', 999, true, DATE '2026-12-01')), 'collect-snowman') ->> 'state' = 'not_started');
  PERFORM pg_temp.ok('節慶中可兌換',
    pg_temp.item(jsonb_build_object('perks', public.perk_mall_items_json('aaaaaaaa-0000-4000-8000-0000000000d1', 999, true, DATE '2026-12-22')), 'collect-snowman') ->> 'state' = 'available');
  PERFORM pg_temp.ok('最後一期之後顯示已結束',
    pg_temp.item(jsonb_build_object('perks', public.perk_mall_items_json('aaaaaaaa-0000-4000-8000-0000000000d1', 999, true, DATE '2036-01-10')), 'collect-snowman') ->> 'state' = 'ended');
  PERFORM pg_temp.ok('兌換關閉時顯示未開放',
    pg_temp.item(jsonb_build_object('perks', public.perk_mall_items_json('aaaaaaaa-0000-4000-8000-0000000000d1', 999, false, DATE '2026-12-22')), 'board-wood') ->> 'state' = 'closed');
  PERFORM pg_temp.ok('已擁有優先於關閉',
    pg_temp.item(jsonb_build_object('perks', public.perk_mall_items_json('aaaaaaaa-0000-4000-8000-0000000000d1', 0, false, DATE '2026-12-22')), 'bubble-milktea') ->> 'state' = 'owned');
  -- 達成解鎖條件後可兌換：先由合成小舖本身建立存檔，再把等級調到 5（只在交易內）
  PERFORM pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000d1');
  PERFORM public.apply_my_merge_shop_action(gen_random_uuid()::text, 'start', '{}'::jsonb);
  EXECUTE 'RESET ROLE';
  SET LOCAL session_replication_role = replica;
  UPDATE public.member_merge_shops SET shop_level = 5 WHERE user_id = 'aaaaaaaa-0000-4000-8000-0000000000d1';
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000d1');
  PERFORM pg_temp.ok('達成合成 Lv.5 後顯示可兌換', pg_temp.item(public.get_my_points_mall(), 'title-merge-boss') ->> 'state' = 'available',
    pg_temp.item(public.get_my_points_mall(), 'title-merge-boss')::text);
  PERFORM pg_temp.ok('達成條件後兌換成功', public.purchase_my_perk('title-merge-boss') -> 'owned' ? 'title-merge-boss');

  -- 限量：把一件商品暫時改成限量 1，A 兌換後 B 看到已兌換完畢且無法兌換
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.perk_catalog', 'on', true);
  UPDATE public.member_perk_catalog SET stock_limit = 1 WHERE id = 'board-wood';
  PERFORM set_config('app.perk_catalog', 'off', true);
  PERFORM pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000d1');
  PERFORM public.purchase_my_perk('board-wood');
  PERFORM pg_temp.ok('最後一件兌換者看到已擁有', pg_temp.item(public.get_my_points_mall(), 'board-wood') ->> 'state' = 'owned');
  PERFORM pg_temp.as_member('bbbbbbbb-0000-4000-8000-0000000000d2');
  PERFORM pg_temp.ok('其他人看到已兌換完畢', pg_temp.item(public.get_my_points_mall(), 'board-wood') ->> 'state' = 'sold_out');
  PERFORM pg_temp.fails('兌換完畢不能兌換', 'SELECT public.purchase_my_perk(''board-wood'')', '已經兌換完畢');
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.ok('原有 15 件點數不變', (SELECT sum(cost) FROM public.member_perk_catalog WHERE sort <= 150) = 2180);
  PERFORM pg_temp.ok('帳戶餘額與流水一致', NOT EXISTS (
    SELECT 1 FROM public.member_point_accounts AS acc
    WHERE acc.balance <> (SELECT coalesce(sum(delta), 0) FROM public.member_point_entries AS e WHERE e.user_id = acc.user_id)));
END
$t2$;
