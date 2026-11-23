-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-game-achievements-v2-local-test.mjs 組合：BEGIN；前置本體；合成 v2；成就 v2；本檔；ROLLBACK。
-- runner 在成就 v2 之前先替會員 A 解鎖舊成就 merge_first_order，驗證舊成就保留。

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

CREATE FUNCTION pg_temp.item(s jsonb, p_id text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(s -> 'achievements') AS t(e) WHERE e ->> 'id' = p_id
$$;

-- 伺服器進度：A 合成 Lv.6 有水果禮籃、商店街雲端存檔 120 位客人、方塊排行賽 2 局 verified。
RESET ROLE;
SELECT set_config('merge.internal', 'on', true);
UPDATE public.member_merge_shops SET shop_level = 6, catalog = '["tea-1","fruit-1","fruit-5"]' WHERE user_id = 'aaaaaaaa-0000-4000-8000-0000000000a7';
SELECT set_config('merge.internal', 'off', true);
INSERT INTO public.member_street_saves (user_id, progress, coins, xp, shop_level, import_source, last_request_key)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a7',
  '{"v":3,"shopLevel":3,"buildings":["tea"],"ownedDecors":["mat","lantern","bunting","parasols"],"stats":{"served":120,"earned":4200}}',
  0, 0, 3, 'fresh', gen_random_uuid());
INSERT INTO public.block_ranked_runs (user_id, seed, week_start, status, submitted_at, move_log, score, lines, best_combo, moves)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a7', 1, current_date, 'verified', now(), '[]', 3400, 20, 3, 40),
  ('aaaaaaaa-0000-4000-8000-0000000000a7', 2, current_date, 'rejected', now(), '[]', 99999, 0, 0, 1);

SELECT pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000a7');
DO $$
DECLARE s jsonb := public.sync_my_game_achievements();
BEGIN
  PERFORM pg_temp.ok('三款遊戲成就都列出', (SELECT count(DISTINCT e ->> 'gameId') FROM jsonb_array_elements(s -> 'achievements') e) = 3 AND (s ->> 'catalogVersion')::int = 2, s::text);
  PERFORM pg_temp.ok('舊成就保留', (pg_temp.item(s, 'merge_first_order') ->> 'unlocked')::boolean);
  PERFORM pg_temp.ok('合成 Lv.6 與水果線解鎖', (pg_temp.item(s, 'merge_level_six') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'merge_fruit_master') ->> 'unlocked')::boolean);
  PERFORM pg_temp.ok('圖鑑 20 件未完成', NOT (pg_temp.item(s, 'merge_codex_twenty') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'merge_codex_twenty') ->> 'progress')::int = 3);
  PERFORM pg_temp.ok('商店街依雲端存檔解鎖', (pg_temp.item(s, 'street_regulars') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'street_decorator') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'street_level_three') ->> 'unlocked')::boolean);
  PERFORM pg_temp.ok('商店街未完成的顯示進度', NOT (pg_temp.item(s, 'street_famous') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'street_famous') ->> 'progress')::int = 120 AND (pg_temp.item(s, 'street_earned_10k') ->> 'progress')::int = 4200);
  PERFORM pg_temp.ok('方塊只算 verified 排行賽', (pg_temp.item(s, 'block_ranked_first') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'block_score_3k') ->> 'unlocked')::boolean
    AND NOT (pg_temp.item(s, 'block_score_8k') ->> 'unlocked')::boolean AND (pg_temp.item(s, 'block_score_8k') ->> 'progress')::int = 3400, pg_temp.item(s, 'block_score_8k')::text);
  PERFORM pg_temp.ok('來源都已套用時全部 available', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'achievements') e WHERE (e ->> 'available')::boolean IS NOT TRUE));
  PERFORM pg_temp.ok('新解鎖清單', s -> 'newlyUnlocked' @> '["merge_level_six","street_regulars","block_score_3k"]'::jsonb AND NOT (s -> 'newlyUnlocked' @> '["merge_first_order"]'::jsonb), s ->> 'newlyUnlocked');
END $$;
SELECT pg_temp.ok('再同步不重複解鎖', jsonb_array_length(public.sync_my_game_achievements() -> 'newlyUnlocked') = 0);

-- 前端不能偽造：不能直接寫成就表、不能展示沒解鎖的成就。
SELECT pg_temp.fails('不能直接寫入成就', $q$INSERT INTO public.member_game_achievements (user_id, achievement_id, metric_value) VALUES ('aaaaaaaa-0000-4000-8000-0000000000a7', 'street_famous', 999)$q$, 'permission denied');
SELECT pg_temp.fails('不能展示沒解鎖的成就', $q$SELECT public.set_my_game_badge('street_famous')$q$, '尚未解鎖這個成就');
SELECT pg_temp.ok('可以公開展示商店街勳章', public.set_my_game_badge('street_regulars') ->> 'showcase' = 'street_regulars');
SELECT pg_temp.ok('公開勳章讀得到', (public.public_game_badges(ARRAY['aaaaaaaa-0000-4000-8000-0000000000a7'::uuid]) -> 0 ->> 'badge') = 'street_regulars');

-- 會員 B 沒有任何進度：全部未解鎖、進度 0。
SELECT pg_temp.as_member('bbbbbbbb-0000-4000-8000-0000000000b7');
DO $$
DECLARE s jsonb := public.sync_my_game_achievements();
BEGIN
  PERFORM pg_temp.ok('沒進度的會員不會解鎖', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'achievements') e WHERE (e ->> 'unlocked')::boolean OR (e ->> 'progress')::int > 0), s::text);
END $$;

-- 資料來源未套用時顯示待開放：暫時把排行賽表改名（交易結束會回復）。
RESET ROLE;
ALTER TABLE public.block_ranked_runs RENAME TO block_ranked_runs_hidden;
SELECT pg_temp.as_member('bbbbbbbb-0000-4000-8000-0000000000b7');
DO $$
DECLARE s jsonb := public.sync_my_game_achievements();
BEGIN
  PERFORM pg_temp.ok('方塊來源未套用時待開放', (pg_temp.item(s, 'block_ranked_first') ->> 'available')::boolean = false AND (pg_temp.item(s, 'street_first_guest') ->> 'available')::boolean, pg_temp.item(s, 'block_ranked_first')::text);
END $$;
SELECT pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000a7');
SELECT pg_temp.ok('已解鎖的成就不因來源暫停而消失', (pg_temp.item(public.sync_my_game_achievements(), 'block_score_3k') ->> 'unlocked')::boolean);
RESET ROLE;
ALTER TABLE public.block_ranked_runs_hidden RENAME TO block_ranked_runs;
