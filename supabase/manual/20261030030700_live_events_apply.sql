-- 第七階段第 9 批：三款遊戲的每日／每週／每月／遊戲季／節慶活動（伺服器紀錄版）。
-- 本檔由 scripts/gen-live-events-sql.ts 依 lib/arcade/live-ops.ts 產生，請勿手改；改規則後重新產生。
--
-- 影響範圍：
--   新增 game_live_events、game_live_festival_windows、member_live_event_entries 三張表與五個函式。
--   不改任何既有表、不碰點數 ledger、不發 Pay 點數（pay_points 有 CHECK = 0）、不動購物車／訂單／金流／賣家訂閱。
--   會員只能透過 get_my_live_events / claim_my_live_event 讀寫自己的活動紀錄，不能直接寫表。
-- 期別一律以 Asia/Taipei 計算；節慶窗口為 2026～2050 年依 27 種節慶規則（含農曆）推算，不是單次日期。
-- 進度只用伺服器資料重算：合成小舖看 member_merge_shop_events、商店街看雲端存檔（以加入活動時為起點）、方塊看 verified 排行賽。
-- 依賴：member_merge_shop_events 必須已存在；商店街雲端存檔、方塊排行賽表若還沒套用，對應活動顯示「待開放」。
-- 回復方式：DROP FUNCTION 五個函式後 DROP TABLE member_live_event_entries, game_live_festival_windows, game_live_events。

BEGIN;

DO $live_precheck$
BEGIN
  IF to_regclass('public.member_merge_shop_events') IS NULL THEN
    RAISE EXCEPTION '請先套用合成小舖（member_merge_shop_events 不存在）';
  END IF;
END
$live_precheck$;

CREATE TABLE IF NOT EXISTS public.game_live_events (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  game_id text NOT NULL CHECK (game_id IN ('merge_shop', 'block_challenge', 'dream_street')),
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'season', 'festival')),
  festival_id text,
  variants jsonb NOT NULL CHECK (jsonb_typeof(variants) = 'array' AND jsonb_array_length(variants) BETWEEN 1 AND 12),
  medal text NOT NULL,
  pay_points integer NOT NULL DEFAULT 0 CHECK (pay_points = 0),
  active boolean NOT NULL DEFAULT true,
  CHECK ((cadence = 'festival') = (festival_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.game_live_festival_windows (
  festival_id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on > starts_on),
  PRIMARY KEY (festival_id, starts_on)
);

CREATE TABLE IF NOT EXISTS public.member_live_event_entries (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.game_live_events (id),
  period_key text NOT NULL CHECK (period_key ~ '^(d|w|m|s|f):[a-z0-9:-]{4,60}$'),
  variant integer NOT NULL CHECK (variant >= 0),
  baseline integer NOT NULL DEFAULT 0 CHECK (baseline >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  PRIMARY KEY (user_id, event_id, period_key)
);

ALTER TABLE public.game_live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_live_festival_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_live_event_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_live_events, public.game_live_festival_windows, public.member_live_event_entries FROM PUBLIC, anon, authenticated;

INSERT INTO public.game_live_events (id, game_id, cadence, festival_id, variants, medal) VALUES
  ('merge_daily_errand', 'merge_shop', 'daily', NULL, '[{"metric":"merge.orders","target":5},{"metric":"merge.merges","target":15}]'::jsonb, 'ic-chest-open'),
  ('street_daily_rounds', 'dream_street', 'daily', NULL, '[{"metric":"street.served","target":20},{"metric":"street.earned","target":800}]'::jsonb, 'ic-coin'),
  ('merge_weekly_rush', 'merge_shop', 'weekly', NULL, '[{"metric":"merge.orders","target":25},{"metric":"merge.merges","target":60},{"metric":"merge.orders","target":35}]'::jsonb, 'ic-quest'),
  ('street_monthly_fair', 'dream_street', 'monthly', NULL, '[{"metric":"street.served","target":120},{"metric":"street.earned","target":6000},{"metric":"street.served","target":160}]'::jsonb, 'ic-shop'),
  ('block_weekly_cup', 'block_challenge', 'weekly', NULL, '[{"metric":"block.ranked","target":3},{"metric":"block.score","target":4000}]'::jsonb, 'ic-star'),
  ('season_street_parade', 'dream_street', 'season', NULL, '[{"metric":"street.served","target":400}]'::jsonb, 'ic-up'),
  ('fest_lantern_festival', 'merge_shop', 'festival', 'lantern-festival', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_qingming', 'dream_street', 'festival', 'qingming', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_new_year_merge', 'merge_shop', 'festival', 'lunar-new-year', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_ghost_festival', 'merge_shop', 'festival', 'ghost-festival', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_new_year_eve', 'dream_street', 'festival', 'new-year-eve', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_qixi', 'block_challenge', 'festival', 'qixi', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_fathers_day', 'merge_shop', 'festival', 'fathers-day', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_mothers_day', 'dream_street', 'festival', 'mothers-day', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_retrocession', 'block_challenge', 'festival', 'retrocession', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_mid_autumn_street', 'dream_street', 'festival', 'mid-autumn', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_double_ninth', 'dream_street', 'festival', 'double-ninth', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_valentine', 'block_challenge', 'festival', 'valentine', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_white_day', 'merge_shop', 'festival', 'white-day', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_day_520', 'dream_street', 'festival', 'day-520', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_national_day', 'block_challenge', 'festival', 'national-day', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_dongzhi', 'merge_shop', 'festival', 'dongzhi', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_teachers_day', 'dream_street', 'festival', 'teachers-day', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_dragon_boat', 'block_challenge', 'festival', 'dragon-boat', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_childrens_day', 'merge_shop', 'festival', 'childrens-day', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_labor_day', 'dream_street', 'festival', 'labor-day', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_halloween', 'block_challenge', 'festival', 'halloween', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_double_11', 'merge_shop', 'festival', 'double-11', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_double_12', 'dream_street', 'festival', 'double-12', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_womens_day', 'block_challenge', 'festival', 'womens-day', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy'),
  ('fest_mid_year_618', 'merge_shop', 'festival', 'mid-year-618', '[{"metric":"merge.orders","target":15}]'::jsonb, 'it-gift-5'),
  ('fest_double_9', 'dream_street', 'festival', 'double-9', '[{"metric":"street.served","target":40}]'::jsonb, 'ic-street'),
  ('fest_christmas_block', 'block_challenge', 'festival', 'christmas', '[{"metric":"block.ranked","target":1}]'::jsonb, 'ic-trophy')
ON CONFLICT (id) DO UPDATE SET game_id = EXCLUDED.game_id, cadence = EXCLUDED.cadence, festival_id = EXCLUDED.festival_id,
  variants = EXCLUDED.variants, medal = EXCLUDED.medal, active = true;

INSERT INTO public.game_live_festival_windows (festival_id, starts_on, ends_on) VALUES
  ('lantern-festival', DATE '2026-03-03', DATE '2026-03-04'),
  ('lantern-festival', DATE '2027-02-20', DATE '2027-02-21'),
  ('lantern-festival', DATE '2028-02-09', DATE '2028-02-10'),
  ('lantern-festival', DATE '2029-02-27', DATE '2029-02-28'),
  ('lantern-festival', DATE '2030-02-17', DATE '2030-02-18'),
  ('lantern-festival', DATE '2031-02-06', DATE '2031-02-07'),
  ('lantern-festival', DATE '2032-02-25', DATE '2032-02-26'),
  ('lantern-festival', DATE '2033-02-14', DATE '2033-02-15'),
  ('lantern-festival', DATE '2034-03-05', DATE '2034-03-06'),
  ('lantern-festival', DATE '2035-02-22', DATE '2035-02-23'),
  ('lantern-festival', DATE '2036-02-11', DATE '2036-02-12'),
  ('lantern-festival', DATE '2037-03-01', DATE '2037-03-02'),
  ('lantern-festival', DATE '2038-02-18', DATE '2038-02-19'),
  ('lantern-festival', DATE '2039-02-07', DATE '2039-02-08'),
  ('lantern-festival', DATE '2040-02-26', DATE '2040-02-27'),
  ('lantern-festival', DATE '2041-02-15', DATE '2041-02-16'),
  ('lantern-festival', DATE '2042-02-05', DATE '2042-02-06'),
  ('lantern-festival', DATE '2043-02-24', DATE '2043-02-25'),
  ('lantern-festival', DATE '2044-02-13', DATE '2044-02-14'),
  ('lantern-festival', DATE '2045-03-03', DATE '2045-03-04'),
  ('lantern-festival', DATE '2046-02-20', DATE '2046-02-21'),
  ('lantern-festival', DATE '2047-02-09', DATE '2047-02-10'),
  ('lantern-festival', DATE '2048-02-28', DATE '2048-02-29'),
  ('lantern-festival', DATE '2049-02-16', DATE '2049-02-17'),
  ('lantern-festival', DATE '2050-02-06', DATE '2050-02-07'),
  ('qingming', DATE '2026-04-05', DATE '2026-04-06'),
  ('qingming', DATE '2027-04-05', DATE '2027-04-06'),
  ('qingming', DATE '2028-04-04', DATE '2028-04-05'),
  ('qingming', DATE '2029-04-04', DATE '2029-04-05'),
  ('qingming', DATE '2030-04-05', DATE '2030-04-06'),
  ('qingming', DATE '2031-04-05', DATE '2031-04-06'),
  ('qingming', DATE '2032-04-04', DATE '2032-04-05'),
  ('qingming', DATE '2033-04-04', DATE '2033-04-05'),
  ('qingming', DATE '2034-04-05', DATE '2034-04-06'),
  ('qingming', DATE '2035-04-05', DATE '2035-04-06'),
  ('qingming', DATE '2036-04-04', DATE '2036-04-05'),
  ('qingming', DATE '2037-04-04', DATE '2037-04-05'),
  ('qingming', DATE '2039-04-05', DATE '2039-04-06'),
  ('qingming', DATE '2040-04-04', DATE '2040-04-05'),
  ('qingming', DATE '2041-04-04', DATE '2041-04-05'),
  ('qingming', DATE '2043-04-05', DATE '2043-04-06'),
  ('qingming', DATE '2044-04-04', DATE '2044-04-05'),
  ('qingming', DATE '2045-04-04', DATE '2045-04-05'),
  ('qingming', DATE '2046-04-04', DATE '2046-04-05'),
  ('qingming', DATE '2047-04-05', DATE '2047-04-06'),
  ('qingming', DATE '2048-04-04', DATE '2048-04-05'),
  ('qingming', DATE '2049-04-04', DATE '2049-04-05'),
  ('qingming', DATE '2050-04-04', DATE '2050-04-05'),
  ('lunar-new-year', DATE '2026-02-16', DATE '2026-03-04'),
  ('lunar-new-year', DATE '2027-02-05', DATE '2027-02-21'),
  ('lunar-new-year', DATE '2028-01-25', DATE '2028-02-10'),
  ('lunar-new-year', DATE '2029-02-12', DATE '2029-02-28'),
  ('lunar-new-year', DATE '2030-02-02', DATE '2030-02-18'),
  ('lunar-new-year', DATE '2031-01-22', DATE '2031-02-07'),
  ('lunar-new-year', DATE '2032-02-10', DATE '2032-02-26'),
  ('lunar-new-year', DATE '2033-01-30', DATE '2033-02-15'),
  ('lunar-new-year', DATE '2034-02-18', DATE '2034-03-06'),
  ('lunar-new-year', DATE '2035-02-07', DATE '2035-02-23'),
  ('lunar-new-year', DATE '2036-01-27', DATE '2036-02-12'),
  ('lunar-new-year', DATE '2037-02-14', DATE '2037-03-02'),
  ('lunar-new-year', DATE '2038-02-03', DATE '2038-02-19'),
  ('lunar-new-year', DATE '2039-01-23', DATE '2039-02-08'),
  ('lunar-new-year', DATE '2040-02-11', DATE '2040-02-27'),
  ('lunar-new-year', DATE '2041-01-31', DATE '2041-02-16'),
  ('lunar-new-year', DATE '2042-01-21', DATE '2042-02-06'),
  ('lunar-new-year', DATE '2043-02-09', DATE '2043-02-25'),
  ('lunar-new-year', DATE '2044-01-29', DATE '2044-02-14'),
  ('lunar-new-year', DATE '2045-02-16', DATE '2045-03-04'),
  ('lunar-new-year', DATE '2046-02-05', DATE '2046-02-21'),
  ('lunar-new-year', DATE '2047-01-25', DATE '2047-02-10'),
  ('lunar-new-year', DATE '2048-02-13', DATE '2048-02-29'),
  ('lunar-new-year', DATE '2049-02-01', DATE '2049-02-17'),
  ('lunar-new-year', DATE '2050-01-22', DATE '2050-02-07'),
  ('ghost-festival', DATE '2026-08-27', DATE '2026-08-28'),
  ('ghost-festival', DATE '2027-08-16', DATE '2027-08-17'),
  ('ghost-festival', DATE '2028-09-03', DATE '2028-09-04'),
  ('ghost-festival', DATE '2029-08-24', DATE '2029-08-25'),
  ('ghost-festival', DATE '2030-08-13', DATE '2030-08-14'),
  ('ghost-festival', DATE '2031-09-01', DATE '2031-09-02'),
  ('ghost-festival', DATE '2032-08-20', DATE '2032-08-21'),
  ('ghost-festival', DATE '2033-08-09', DATE '2033-08-10'),
  ('ghost-festival', DATE '2034-08-28', DATE '2034-08-29'),
  ('ghost-festival', DATE '2035-08-18', DATE '2035-08-19'),
  ('ghost-festival', DATE '2036-09-05', DATE '2036-09-06'),
  ('ghost-festival', DATE '2037-08-25', DATE '2037-08-26'),
  ('ghost-festival', DATE '2038-08-15', DATE '2038-08-16'),
  ('ghost-festival', DATE '2039-09-03', DATE '2039-09-04'),
  ('ghost-festival', DATE '2040-08-22', DATE '2040-08-23'),
  ('ghost-festival', DATE '2041-08-11', DATE '2041-08-12'),
  ('ghost-festival', DATE '2042-08-30', DATE '2042-08-31'),
  ('ghost-festival', DATE '2043-08-19', DATE '2043-08-20'),
  ('ghost-festival', DATE '2044-08-08', DATE '2044-08-09'),
  ('ghost-festival', DATE '2045-08-27', DATE '2045-08-28'),
  ('ghost-festival', DATE '2046-08-16', DATE '2046-08-17'),
  ('ghost-festival', DATE '2047-09-04', DATE '2047-09-05'),
  ('ghost-festival', DATE '2048-08-24', DATE '2048-08-25'),
  ('ghost-festival', DATE '2049-08-13', DATE '2049-08-14'),
  ('ghost-festival', DATE '2050-08-31', DATE '2050-09-01'),
  ('new-year-eve', DATE '2026-01-01', DATE '2026-01-02'),
  ('new-year-eve', DATE '2027-01-01', DATE '2027-01-02'),
  ('new-year-eve', DATE '2028-01-01', DATE '2028-01-02'),
  ('new-year-eve', DATE '2029-01-01', DATE '2029-01-02'),
  ('new-year-eve', DATE '2030-01-01', DATE '2030-01-02'),
  ('new-year-eve', DATE '2031-01-01', DATE '2031-01-02'),
  ('new-year-eve', DATE '2032-01-01', DATE '2032-01-02'),
  ('new-year-eve', DATE '2033-01-01', DATE '2033-01-02'),
  ('new-year-eve', DATE '2034-01-01', DATE '2034-01-02'),
  ('new-year-eve', DATE '2035-01-01', DATE '2035-01-02'),
  ('new-year-eve', DATE '2036-01-01', DATE '2036-01-02'),
  ('new-year-eve', DATE '2037-01-01', DATE '2037-01-02'),
  ('new-year-eve', DATE '2038-01-01', DATE '2038-01-02'),
  ('new-year-eve', DATE '2039-01-01', DATE '2039-01-02'),
  ('new-year-eve', DATE '2040-01-01', DATE '2040-01-02'),
  ('new-year-eve', DATE '2041-01-01', DATE '2041-01-02'),
  ('new-year-eve', DATE '2042-01-01', DATE '2042-01-02'),
  ('new-year-eve', DATE '2043-01-01', DATE '2043-01-02'),
  ('new-year-eve', DATE '2044-01-01', DATE '2044-01-02'),
  ('new-year-eve', DATE '2045-01-01', DATE '2045-01-02'),
  ('new-year-eve', DATE '2046-01-01', DATE '2046-01-02'),
  ('new-year-eve', DATE '2047-01-01', DATE '2047-01-02'),
  ('new-year-eve', DATE '2048-01-01', DATE '2048-01-02'),
  ('new-year-eve', DATE '2049-01-01', DATE '2049-01-02'),
  ('new-year-eve', DATE '2050-01-01', DATE '2050-01-02'),
  ('qixi', DATE '2026-08-18', DATE '2026-08-20'),
  ('qixi', DATE '2027-08-07', DATE '2027-08-09'),
  ('qixi', DATE '2028-08-25', DATE '2028-08-27'),
  ('qixi', DATE '2029-08-15', DATE '2029-08-17'),
  ('qixi', DATE '2030-08-04', DATE '2030-08-06'),
  ('qixi', DATE '2031-08-23', DATE '2031-08-25'),
  ('qixi', DATE '2032-08-11', DATE '2032-08-13'),
  ('qixi', DATE '2033-07-31', DATE '2033-08-02'),
  ('qixi', DATE '2034-08-19', DATE '2034-08-21'),
  ('qixi', DATE '2035-08-09', DATE '2035-08-11'),
  ('qixi', DATE '2036-08-27', DATE '2036-08-29'),
  ('qixi', DATE '2037-08-16', DATE '2037-08-18'),
  ('qixi', DATE '2038-08-06', DATE '2038-08-08'),
  ('qixi', DATE '2039-08-25', DATE '2039-08-27'),
  ('qixi', DATE '2040-08-13', DATE '2040-08-15'),
  ('qixi', DATE '2041-08-02', DATE '2041-08-04'),
  ('qixi', DATE '2042-08-21', DATE '2042-08-23'),
  ('qixi', DATE '2043-08-10', DATE '2043-08-12'),
  ('qixi', DATE '2044-07-30', DATE '2044-08-01'),
  ('qixi', DATE '2045-08-18', DATE '2045-08-20'),
  ('qixi', DATE '2046-08-07', DATE '2046-08-09'),
  ('qixi', DATE '2047-08-26', DATE '2047-08-28'),
  ('qixi', DATE '2048-08-15', DATE '2048-08-17'),
  ('qixi', DATE '2049-08-04', DATE '2049-08-06'),
  ('qixi', DATE '2050-08-22', DATE '2050-08-24'),
  ('fathers-day', DATE '2026-08-06', DATE '2026-08-09'),
  ('fathers-day', DATE '2027-08-06', DATE '2027-08-09'),
  ('fathers-day', DATE '2028-08-06', DATE '2028-08-09'),
  ('fathers-day', DATE '2029-08-06', DATE '2029-08-09'),
  ('fathers-day', DATE '2030-08-06', DATE '2030-08-09'),
  ('fathers-day', DATE '2031-08-06', DATE '2031-08-09'),
  ('fathers-day', DATE '2032-08-06', DATE '2032-08-09'),
  ('fathers-day', DATE '2033-08-06', DATE '2033-08-09'),
  ('fathers-day', DATE '2034-08-06', DATE '2034-08-09'),
  ('fathers-day', DATE '2035-08-06', DATE '2035-08-09'),
  ('fathers-day', DATE '2036-08-06', DATE '2036-08-09'),
  ('fathers-day', DATE '2037-08-06', DATE '2037-08-09'),
  ('fathers-day', DATE '2038-08-06', DATE '2038-08-09'),
  ('fathers-day', DATE '2039-08-06', DATE '2039-08-09'),
  ('fathers-day', DATE '2040-08-06', DATE '2040-08-09'),
  ('fathers-day', DATE '2041-08-06', DATE '2041-08-09'),
  ('fathers-day', DATE '2042-08-06', DATE '2042-08-09'),
  ('fathers-day', DATE '2043-08-06', DATE '2043-08-09'),
  ('fathers-day', DATE '2044-08-06', DATE '2044-08-09'),
  ('fathers-day', DATE '2045-08-06', DATE '2045-08-09'),
  ('fathers-day', DATE '2046-08-06', DATE '2046-08-09'),
  ('fathers-day', DATE '2047-08-06', DATE '2047-08-09'),
  ('fathers-day', DATE '2048-08-06', DATE '2048-08-09'),
  ('fathers-day', DATE '2049-08-06', DATE '2049-08-09'),
  ('fathers-day', DATE '2050-08-06', DATE '2050-08-09'),
  ('mothers-day', DATE '2026-05-04', DATE '2026-05-11'),
  ('mothers-day', DATE '2027-05-03', DATE '2027-05-10'),
  ('mothers-day', DATE '2028-05-08', DATE '2028-05-15'),
  ('mothers-day', DATE '2029-05-07', DATE '2029-05-14'),
  ('mothers-day', DATE '2030-05-06', DATE '2030-05-13'),
  ('mothers-day', DATE '2031-05-05', DATE '2031-05-12'),
  ('mothers-day', DATE '2032-05-03', DATE '2032-05-10'),
  ('mothers-day', DATE '2033-05-02', DATE '2033-05-09'),
  ('mothers-day', DATE '2034-05-08', DATE '2034-05-15'),
  ('mothers-day', DATE '2035-05-07', DATE '2035-05-14'),
  ('mothers-day', DATE '2036-05-05', DATE '2036-05-12'),
  ('mothers-day', DATE '2037-05-04', DATE '2037-05-11'),
  ('mothers-day', DATE '2038-05-03', DATE '2038-05-10'),
  ('mothers-day', DATE '2039-05-02', DATE '2039-05-09'),
  ('mothers-day', DATE '2040-05-07', DATE '2040-05-14'),
  ('mothers-day', DATE '2041-05-06', DATE '2041-05-13'),
  ('mothers-day', DATE '2042-05-05', DATE '2042-05-12'),
  ('mothers-day', DATE '2043-05-04', DATE '2043-05-11'),
  ('mothers-day', DATE '2044-05-02', DATE '2044-05-09'),
  ('mothers-day', DATE '2045-05-08', DATE '2045-05-15'),
  ('mothers-day', DATE '2046-05-07', DATE '2046-05-14'),
  ('mothers-day', DATE '2047-05-06', DATE '2047-05-13'),
  ('mothers-day', DATE '2048-05-04', DATE '2048-05-11'),
  ('mothers-day', DATE '2049-05-03', DATE '2049-05-10'),
  ('mothers-day', DATE '2050-05-02', DATE '2050-05-09'),
  ('retrocession', DATE '2026-10-25', DATE '2026-10-26'),
  ('retrocession', DATE '2027-10-25', DATE '2027-10-26'),
  ('retrocession', DATE '2028-10-25', DATE '2028-10-26'),
  ('retrocession', DATE '2029-10-25', DATE '2029-10-26'),
  ('retrocession', DATE '2030-10-25', DATE '2030-10-26'),
  ('retrocession', DATE '2031-10-25', DATE '2031-10-26'),
  ('retrocession', DATE '2032-10-25', DATE '2032-10-26'),
  ('retrocession', DATE '2033-10-25', DATE '2033-10-26'),
  ('retrocession', DATE '2034-10-25', DATE '2034-10-26'),
  ('retrocession', DATE '2035-10-25', DATE '2035-10-26'),
  ('retrocession', DATE '2036-10-25', DATE '2036-10-26'),
  ('retrocession', DATE '2037-10-25', DATE '2037-10-26'),
  ('retrocession', DATE '2038-10-25', DATE '2038-10-26'),
  ('retrocession', DATE '2039-10-25', DATE '2039-10-26'),
  ('retrocession', DATE '2040-10-25', DATE '2040-10-26'),
  ('retrocession', DATE '2041-10-25', DATE '2041-10-26'),
  ('retrocession', DATE '2042-10-25', DATE '2042-10-26'),
  ('retrocession', DATE '2043-10-25', DATE '2043-10-26'),
  ('retrocession', DATE '2044-10-25', DATE '2044-10-26'),
  ('retrocession', DATE '2045-10-25', DATE '2045-10-26'),
  ('retrocession', DATE '2046-10-25', DATE '2046-10-26'),
  ('retrocession', DATE '2047-10-25', DATE '2047-10-26'),
  ('retrocession', DATE '2048-10-25', DATE '2048-10-26'),
  ('retrocession', DATE '2049-10-25', DATE '2049-10-26'),
  ('retrocession', DATE '2050-10-25', DATE '2050-10-26'),
  ('mid-autumn', DATE '2026-09-24', DATE '2026-09-26'),
  ('mid-autumn', DATE '2027-09-14', DATE '2027-09-16'),
  ('mid-autumn', DATE '2028-10-02', DATE '2028-10-04'),
  ('mid-autumn', DATE '2029-09-21', DATE '2029-09-23'),
  ('mid-autumn', DATE '2030-09-11', DATE '2030-09-13'),
  ('mid-autumn', DATE '2031-09-30', DATE '2031-10-02'),
  ('mid-autumn', DATE '2032-09-18', DATE '2032-09-20'),
  ('mid-autumn', DATE '2033-09-07', DATE '2033-09-09'),
  ('mid-autumn', DATE '2034-09-26', DATE '2034-09-28'),
  ('mid-autumn', DATE '2035-09-15', DATE '2035-09-17'),
  ('mid-autumn', DATE '2036-10-03', DATE '2036-10-05'),
  ('mid-autumn', DATE '2037-09-23', DATE '2037-09-25'),
  ('mid-autumn', DATE '2038-09-12', DATE '2038-09-14'),
  ('mid-autumn', DATE '2039-10-01', DATE '2039-10-03'),
  ('mid-autumn', DATE '2040-09-19', DATE '2040-09-21'),
  ('mid-autumn', DATE '2041-09-09', DATE '2041-09-11'),
  ('mid-autumn', DATE '2042-09-27', DATE '2042-09-29'),
  ('mid-autumn', DATE '2043-09-16', DATE '2043-09-18'),
  ('mid-autumn', DATE '2044-10-04', DATE '2044-10-06'),
  ('mid-autumn', DATE '2045-09-24', DATE '2045-09-26'),
  ('mid-autumn', DATE '2046-09-14', DATE '2046-09-16'),
  ('mid-autumn', DATE '2047-10-03', DATE '2047-10-05'),
  ('mid-autumn', DATE '2048-09-21', DATE '2048-09-23'),
  ('mid-autumn', DATE '2049-09-10', DATE '2049-09-12'),
  ('mid-autumn', DATE '2050-09-29', DATE '2050-10-01'),
  ('double-ninth', DATE '2026-10-18', DATE '2026-10-19'),
  ('double-ninth', DATE '2027-10-08', DATE '2027-10-09'),
  ('double-ninth', DATE '2028-10-26', DATE '2028-10-27'),
  ('double-ninth', DATE '2029-10-16', DATE '2029-10-17'),
  ('double-ninth', DATE '2030-10-05', DATE '2030-10-06'),
  ('double-ninth', DATE '2031-10-24', DATE '2031-10-25'),
  ('double-ninth', DATE '2032-10-12', DATE '2032-10-13'),
  ('double-ninth', DATE '2033-10-01', DATE '2033-10-02'),
  ('double-ninth', DATE '2034-10-20', DATE '2034-10-21'),
  ('double-ninth', DATE '2035-10-09', DATE '2035-10-10'),
  ('double-ninth', DATE '2036-10-27', DATE '2036-10-28'),
  ('double-ninth', DATE '2037-10-17', DATE '2037-10-18'),
  ('double-ninth', DATE '2038-10-07', DATE '2038-10-08'),
  ('double-ninth', DATE '2039-10-26', DATE '2039-10-27'),
  ('double-ninth', DATE '2040-10-14', DATE '2040-10-15'),
  ('double-ninth', DATE '2041-10-03', DATE '2041-10-04'),
  ('double-ninth', DATE '2042-10-22', DATE '2042-10-23'),
  ('double-ninth', DATE '2043-10-11', DATE '2043-10-12'),
  ('double-ninth', DATE '2044-10-29', DATE '2044-10-30'),
  ('double-ninth', DATE '2045-10-18', DATE '2045-10-19'),
  ('double-ninth', DATE '2046-10-08', DATE '2046-10-09'),
  ('double-ninth', DATE '2047-10-27', DATE '2047-10-28'),
  ('double-ninth', DATE '2048-10-16', DATE '2048-10-17'),
  ('double-ninth', DATE '2049-10-05', DATE '2049-10-06'),
  ('double-ninth', DATE '2050-10-24', DATE '2050-10-25'),
  ('valentine', DATE '2026-02-12', DATE '2026-02-15'),
  ('valentine', DATE '2027-02-12', DATE '2027-02-15'),
  ('valentine', DATE '2028-02-12', DATE '2028-02-15'),
  ('valentine', DATE '2029-02-12', DATE '2029-02-15'),
  ('valentine', DATE '2030-02-12', DATE '2030-02-15'),
  ('valentine', DATE '2031-02-12', DATE '2031-02-15'),
  ('valentine', DATE '2032-02-12', DATE '2032-02-15'),
  ('valentine', DATE '2033-02-12', DATE '2033-02-15'),
  ('valentine', DATE '2034-02-12', DATE '2034-02-15'),
  ('valentine', DATE '2035-02-12', DATE '2035-02-15'),
  ('valentine', DATE '2036-02-12', DATE '2036-02-15'),
  ('valentine', DATE '2037-02-12', DATE '2037-02-15'),
  ('valentine', DATE '2038-02-12', DATE '2038-02-15'),
  ('valentine', DATE '2039-02-12', DATE '2039-02-15'),
  ('valentine', DATE '2040-02-12', DATE '2040-02-15'),
  ('valentine', DATE '2041-02-12', DATE '2041-02-15'),
  ('valentine', DATE '2042-02-12', DATE '2042-02-15'),
  ('valentine', DATE '2043-02-12', DATE '2043-02-15'),
  ('valentine', DATE '2044-02-12', DATE '2044-02-15'),
  ('valentine', DATE '2045-02-12', DATE '2045-02-15'),
  ('valentine', DATE '2046-02-12', DATE '2046-02-15'),
  ('valentine', DATE '2047-02-12', DATE '2047-02-15'),
  ('valentine', DATE '2048-02-12', DATE '2048-02-15'),
  ('valentine', DATE '2049-02-12', DATE '2049-02-15'),
  ('valentine', DATE '2050-02-12', DATE '2050-02-15'),
  ('white-day', DATE '2026-03-13', DATE '2026-03-15'),
  ('white-day', DATE '2027-03-13', DATE '2027-03-15'),
  ('white-day', DATE '2028-03-13', DATE '2028-03-15'),
  ('white-day', DATE '2029-03-13', DATE '2029-03-15'),
  ('white-day', DATE '2030-03-13', DATE '2030-03-15'),
  ('white-day', DATE '2031-03-13', DATE '2031-03-15'),
  ('white-day', DATE '2032-03-13', DATE '2032-03-15'),
  ('white-day', DATE '2033-03-13', DATE '2033-03-15'),
  ('white-day', DATE '2034-03-13', DATE '2034-03-15'),
  ('white-day', DATE '2035-03-13', DATE '2035-03-15'),
  ('white-day', DATE '2036-03-13', DATE '2036-03-15'),
  ('white-day', DATE '2037-03-13', DATE '2037-03-15'),
  ('white-day', DATE '2038-03-13', DATE '2038-03-15'),
  ('white-day', DATE '2039-03-13', DATE '2039-03-15'),
  ('white-day', DATE '2040-03-13', DATE '2040-03-15'),
  ('white-day', DATE '2041-03-13', DATE '2041-03-15'),
  ('white-day', DATE '2042-03-13', DATE '2042-03-15'),
  ('white-day', DATE '2043-03-13', DATE '2043-03-15'),
  ('white-day', DATE '2044-03-13', DATE '2044-03-15'),
  ('white-day', DATE '2045-03-13', DATE '2045-03-15'),
  ('white-day', DATE '2046-03-13', DATE '2046-03-15'),
  ('white-day', DATE '2047-03-13', DATE '2047-03-15'),
  ('white-day', DATE '2048-03-13', DATE '2048-03-15'),
  ('white-day', DATE '2049-03-13', DATE '2049-03-15'),
  ('white-day', DATE '2050-03-13', DATE '2050-03-15'),
  ('day-520', DATE '2026-05-19', DATE '2026-05-21'),
  ('day-520', DATE '2027-05-19', DATE '2027-05-21'),
  ('day-520', DATE '2028-05-19', DATE '2028-05-21'),
  ('day-520', DATE '2029-05-19', DATE '2029-05-21'),
  ('day-520', DATE '2030-05-19', DATE '2030-05-21'),
  ('day-520', DATE '2031-05-19', DATE '2031-05-21'),
  ('day-520', DATE '2032-05-19', DATE '2032-05-21'),
  ('day-520', DATE '2033-05-19', DATE '2033-05-21'),
  ('day-520', DATE '2034-05-19', DATE '2034-05-21'),
  ('day-520', DATE '2035-05-19', DATE '2035-05-21'),
  ('day-520', DATE '2036-05-19', DATE '2036-05-21'),
  ('day-520', DATE '2037-05-19', DATE '2037-05-21'),
  ('day-520', DATE '2038-05-19', DATE '2038-05-21'),
  ('day-520', DATE '2039-05-19', DATE '2039-05-21'),
  ('day-520', DATE '2040-05-19', DATE '2040-05-21'),
  ('day-520', DATE '2041-05-19', DATE '2041-05-21'),
  ('day-520', DATE '2042-05-19', DATE '2042-05-21'),
  ('day-520', DATE '2043-05-19', DATE '2043-05-21'),
  ('day-520', DATE '2044-05-19', DATE '2044-05-21'),
  ('day-520', DATE '2045-05-19', DATE '2045-05-21'),
  ('day-520', DATE '2046-05-19', DATE '2046-05-21'),
  ('day-520', DATE '2047-05-19', DATE '2047-05-21'),
  ('day-520', DATE '2048-05-19', DATE '2048-05-21'),
  ('day-520', DATE '2049-05-19', DATE '2049-05-21'),
  ('day-520', DATE '2050-05-19', DATE '2050-05-21'),
  ('national-day', DATE '2026-10-10', DATE '2026-10-11'),
  ('national-day', DATE '2027-10-10', DATE '2027-10-11'),
  ('national-day', DATE '2028-10-10', DATE '2028-10-11'),
  ('national-day', DATE '2029-10-10', DATE '2029-10-11'),
  ('national-day', DATE '2030-10-10', DATE '2030-10-11'),
  ('national-day', DATE '2031-10-10', DATE '2031-10-11'),
  ('national-day', DATE '2032-10-10', DATE '2032-10-11'),
  ('national-day', DATE '2033-10-10', DATE '2033-10-11'),
  ('national-day', DATE '2034-10-10', DATE '2034-10-11'),
  ('national-day', DATE '2035-10-10', DATE '2035-10-11'),
  ('national-day', DATE '2036-10-10', DATE '2036-10-11'),
  ('national-day', DATE '2037-10-10', DATE '2037-10-11'),
  ('national-day', DATE '2038-10-10', DATE '2038-10-11'),
  ('national-day', DATE '2039-10-10', DATE '2039-10-11'),
  ('national-day', DATE '2040-10-10', DATE '2040-10-11'),
  ('national-day', DATE '2041-10-10', DATE '2041-10-11'),
  ('national-day', DATE '2042-10-10', DATE '2042-10-11'),
  ('national-day', DATE '2043-10-10', DATE '2043-10-11'),
  ('national-day', DATE '2044-10-10', DATE '2044-10-11'),
  ('national-day', DATE '2045-10-10', DATE '2045-10-11'),
  ('national-day', DATE '2046-10-10', DATE '2046-10-11'),
  ('national-day', DATE '2047-10-10', DATE '2047-10-11'),
  ('national-day', DATE '2048-10-10', DATE '2048-10-11'),
  ('national-day', DATE '2049-10-10', DATE '2049-10-11'),
  ('national-day', DATE '2050-10-10', DATE '2050-10-11'),
  ('dongzhi', DATE '2026-12-22', DATE '2026-12-23'),
  ('dongzhi', DATE '2027-12-22', DATE '2027-12-23'),
  ('dongzhi', DATE '2028-12-21', DATE '2028-12-22'),
  ('dongzhi', DATE '2029-12-21', DATE '2029-12-22'),
  ('dongzhi', DATE '2030-12-22', DATE '2030-12-23'),
  ('dongzhi', DATE '2031-12-22', DATE '2031-12-23'),
  ('dongzhi', DATE '2032-12-21', DATE '2032-12-22'),
  ('dongzhi', DATE '2033-12-21', DATE '2033-12-22'),
  ('dongzhi', DATE '2034-12-22', DATE '2034-12-23'),
  ('dongzhi', DATE '2035-12-22', DATE '2035-12-23'),
  ('dongzhi', DATE '2036-12-21', DATE '2036-12-22'),
  ('dongzhi', DATE '2037-12-21', DATE '2037-12-22'),
  ('dongzhi', DATE '2038-12-22', DATE '2038-12-23'),
  ('dongzhi', DATE '2039-12-22', DATE '2039-12-23'),
  ('dongzhi', DATE '2040-12-21', DATE '2040-12-22'),
  ('dongzhi', DATE '2041-12-21', DATE '2041-12-22'),
  ('dongzhi', DATE '2042-12-22', DATE '2042-12-23'),
  ('dongzhi', DATE '2043-12-22', DATE '2043-12-23'),
  ('dongzhi', DATE '2044-12-21', DATE '2044-12-22'),
  ('dongzhi', DATE '2045-12-21', DATE '2045-12-22'),
  ('dongzhi', DATE '2046-12-22', DATE '2046-12-23'),
  ('dongzhi', DATE '2047-12-22', DATE '2047-12-23'),
  ('dongzhi', DATE '2048-12-21', DATE '2048-12-22'),
  ('dongzhi', DATE '2049-12-21', DATE '2049-12-22'),
  ('dongzhi', DATE '2050-12-22', DATE '2050-12-23'),
  ('teachers-day', DATE '2026-09-28', DATE '2026-09-29'),
  ('teachers-day', DATE '2027-09-28', DATE '2027-09-29'),
  ('teachers-day', DATE '2028-09-28', DATE '2028-09-29'),
  ('teachers-day', DATE '2029-09-28', DATE '2029-09-29'),
  ('teachers-day', DATE '2030-09-28', DATE '2030-09-29'),
  ('teachers-day', DATE '2031-09-28', DATE '2031-09-29'),
  ('teachers-day', DATE '2032-09-28', DATE '2032-09-29'),
  ('teachers-day', DATE '2033-09-28', DATE '2033-09-29'),
  ('teachers-day', DATE '2034-09-28', DATE '2034-09-29'),
  ('teachers-day', DATE '2035-09-28', DATE '2035-09-29'),
  ('teachers-day', DATE '2036-09-28', DATE '2036-09-29'),
  ('teachers-day', DATE '2037-09-28', DATE '2037-09-29'),
  ('teachers-day', DATE '2038-09-28', DATE '2038-09-29'),
  ('teachers-day', DATE '2039-09-28', DATE '2039-09-29'),
  ('teachers-day', DATE '2040-09-28', DATE '2040-09-29'),
  ('teachers-day', DATE '2041-09-28', DATE '2041-09-29'),
  ('teachers-day', DATE '2042-09-28', DATE '2042-09-29'),
  ('teachers-day', DATE '2043-09-28', DATE '2043-09-29'),
  ('teachers-day', DATE '2044-09-28', DATE '2044-09-29'),
  ('teachers-day', DATE '2045-09-28', DATE '2045-09-29'),
  ('teachers-day', DATE '2046-09-28', DATE '2046-09-29'),
  ('teachers-day', DATE '2047-09-28', DATE '2047-09-29'),
  ('teachers-day', DATE '2048-09-28', DATE '2048-09-29'),
  ('teachers-day', DATE '2049-09-28', DATE '2049-09-29'),
  ('teachers-day', DATE '2050-09-28', DATE '2050-09-29'),
  ('dragon-boat', DATE '2026-06-18', DATE '2026-06-20'),
  ('dragon-boat', DATE '2027-06-08', DATE '2027-06-10'),
  ('dragon-boat', DATE '2028-05-27', DATE '2028-05-29'),
  ('dragon-boat', DATE '2029-06-15', DATE '2029-06-17'),
  ('dragon-boat', DATE '2030-06-04', DATE '2030-06-06'),
  ('dragon-boat', DATE '2031-06-23', DATE '2031-06-25'),
  ('dragon-boat', DATE '2032-06-11', DATE '2032-06-13'),
  ('dragon-boat', DATE '2033-05-31', DATE '2033-06-02'),
  ('dragon-boat', DATE '2034-06-19', DATE '2034-06-21'),
  ('dragon-boat', DATE '2035-06-09', DATE '2035-06-11'),
  ('dragon-boat', DATE '2036-05-29', DATE '2036-05-31'),
  ('dragon-boat', DATE '2037-06-17', DATE '2037-06-19'),
  ('dragon-boat', DATE '2038-06-06', DATE '2038-06-08'),
  ('dragon-boat', DATE '2039-05-26', DATE '2039-05-28'),
  ('dragon-boat', DATE '2040-06-13', DATE '2040-06-15'),
  ('dragon-boat', DATE '2041-06-02', DATE '2041-06-04'),
  ('dragon-boat', DATE '2042-06-21', DATE '2042-06-23'),
  ('dragon-boat', DATE '2043-06-10', DATE '2043-06-12'),
  ('dragon-boat', DATE '2044-05-30', DATE '2044-06-01'),
  ('dragon-boat', DATE '2045-06-18', DATE '2045-06-20'),
  ('dragon-boat', DATE '2046-06-07', DATE '2046-06-09'),
  ('dragon-boat', DATE '2047-05-28', DATE '2047-05-30'),
  ('dragon-boat', DATE '2048-06-14', DATE '2048-06-16'),
  ('dragon-boat', DATE '2049-06-03', DATE '2049-06-05'),
  ('dragon-boat', DATE '2050-06-22', DATE '2050-06-24'),
  ('childrens-day', DATE '2026-04-01', DATE '2026-04-05'),
  ('childrens-day', DATE '2027-04-01', DATE '2027-04-05'),
  ('childrens-day', DATE '2028-04-01', DATE '2028-04-05'),
  ('childrens-day', DATE '2029-04-01', DATE '2029-04-05'),
  ('childrens-day', DATE '2030-04-01', DATE '2030-04-05'),
  ('childrens-day', DATE '2031-04-01', DATE '2031-04-05'),
  ('childrens-day', DATE '2032-04-01', DATE '2032-04-05'),
  ('childrens-day', DATE '2033-04-01', DATE '2033-04-05'),
  ('childrens-day', DATE '2034-04-01', DATE '2034-04-05'),
  ('childrens-day', DATE '2035-04-01', DATE '2035-04-05'),
  ('childrens-day', DATE '2036-04-01', DATE '2036-04-05'),
  ('childrens-day', DATE '2037-04-01', DATE '2037-04-05'),
  ('childrens-day', DATE '2038-04-01', DATE '2038-04-05'),
  ('childrens-day', DATE '2039-04-01', DATE '2039-04-05'),
  ('childrens-day', DATE '2040-04-01', DATE '2040-04-05'),
  ('childrens-day', DATE '2041-04-01', DATE '2041-04-05'),
  ('childrens-day', DATE '2042-04-01', DATE '2042-04-05'),
  ('childrens-day', DATE '2043-04-01', DATE '2043-04-05'),
  ('childrens-day', DATE '2044-04-01', DATE '2044-04-05'),
  ('childrens-day', DATE '2045-04-01', DATE '2045-04-05'),
  ('childrens-day', DATE '2046-04-01', DATE '2046-04-05'),
  ('childrens-day', DATE '2047-04-01', DATE '2047-04-05'),
  ('childrens-day', DATE '2048-04-01', DATE '2048-04-05'),
  ('childrens-day', DATE '2049-04-01', DATE '2049-04-05'),
  ('childrens-day', DATE '2050-04-01', DATE '2050-04-05'),
  ('labor-day', DATE '2026-05-01', DATE '2026-05-02'),
  ('labor-day', DATE '2027-05-01', DATE '2027-05-02'),
  ('labor-day', DATE '2028-05-01', DATE '2028-05-02'),
  ('labor-day', DATE '2029-05-01', DATE '2029-05-02'),
  ('labor-day', DATE '2030-05-01', DATE '2030-05-02'),
  ('labor-day', DATE '2031-05-01', DATE '2031-05-02'),
  ('labor-day', DATE '2032-05-01', DATE '2032-05-02'),
  ('labor-day', DATE '2033-05-01', DATE '2033-05-02'),
  ('labor-day', DATE '2034-05-01', DATE '2034-05-02'),
  ('labor-day', DATE '2035-05-01', DATE '2035-05-02'),
  ('labor-day', DATE '2036-05-01', DATE '2036-05-02'),
  ('labor-day', DATE '2037-05-01', DATE '2037-05-02'),
  ('labor-day', DATE '2038-05-01', DATE '2038-05-02'),
  ('labor-day', DATE '2039-05-01', DATE '2039-05-02'),
  ('labor-day', DATE '2040-05-01', DATE '2040-05-02'),
  ('labor-day', DATE '2041-05-01', DATE '2041-05-02'),
  ('labor-day', DATE '2042-05-01', DATE '2042-05-02'),
  ('labor-day', DATE '2043-05-01', DATE '2043-05-02'),
  ('labor-day', DATE '2044-05-01', DATE '2044-05-02'),
  ('labor-day', DATE '2045-05-01', DATE '2045-05-02'),
  ('labor-day', DATE '2046-05-01', DATE '2046-05-02'),
  ('labor-day', DATE '2047-05-01', DATE '2047-05-02'),
  ('labor-day', DATE '2048-05-01', DATE '2048-05-02'),
  ('labor-day', DATE '2049-05-01', DATE '2049-05-02'),
  ('labor-day', DATE '2050-05-01', DATE '2050-05-02'),
  ('halloween', DATE '2026-10-29', DATE '2026-11-01'),
  ('halloween', DATE '2027-10-29', DATE '2027-11-01'),
  ('halloween', DATE '2028-10-29', DATE '2028-11-01'),
  ('halloween', DATE '2029-10-29', DATE '2029-11-01'),
  ('halloween', DATE '2030-10-29', DATE '2030-11-01'),
  ('halloween', DATE '2031-10-29', DATE '2031-11-01'),
  ('halloween', DATE '2032-10-29', DATE '2032-11-01'),
  ('halloween', DATE '2033-10-29', DATE '2033-11-01'),
  ('halloween', DATE '2034-10-29', DATE '2034-11-01'),
  ('halloween', DATE '2035-10-29', DATE '2035-11-01'),
  ('halloween', DATE '2036-10-29', DATE '2036-11-01'),
  ('halloween', DATE '2037-10-29', DATE '2037-11-01'),
  ('halloween', DATE '2038-10-29', DATE '2038-11-01'),
  ('halloween', DATE '2039-10-29', DATE '2039-11-01'),
  ('halloween', DATE '2040-10-29', DATE '2040-11-01'),
  ('halloween', DATE '2041-10-29', DATE '2041-11-01'),
  ('halloween', DATE '2042-10-29', DATE '2042-11-01'),
  ('halloween', DATE '2043-10-29', DATE '2043-11-01'),
  ('halloween', DATE '2044-10-29', DATE '2044-11-01'),
  ('halloween', DATE '2045-10-29', DATE '2045-11-01'),
  ('halloween', DATE '2046-10-29', DATE '2046-11-01'),
  ('halloween', DATE '2047-10-29', DATE '2047-11-01'),
  ('halloween', DATE '2048-10-29', DATE '2048-11-01'),
  ('halloween', DATE '2049-10-29', DATE '2049-11-01'),
  ('halloween', DATE '2050-10-29', DATE '2050-11-01'),
  ('double-11', DATE '2026-11-09', DATE '2026-11-12'),
  ('double-11', DATE '2027-11-09', DATE '2027-11-12'),
  ('double-11', DATE '2028-11-09', DATE '2028-11-12'),
  ('double-11', DATE '2029-11-09', DATE '2029-11-12'),
  ('double-11', DATE '2030-11-09', DATE '2030-11-12'),
  ('double-11', DATE '2031-11-09', DATE '2031-11-12'),
  ('double-11', DATE '2032-11-09', DATE '2032-11-12'),
  ('double-11', DATE '2033-11-09', DATE '2033-11-12'),
  ('double-11', DATE '2034-11-09', DATE '2034-11-12'),
  ('double-11', DATE '2035-11-09', DATE '2035-11-12'),
  ('double-11', DATE '2036-11-09', DATE '2036-11-12'),
  ('double-11', DATE '2037-11-09', DATE '2037-11-12'),
  ('double-11', DATE '2038-11-09', DATE '2038-11-12'),
  ('double-11', DATE '2039-11-09', DATE '2039-11-12'),
  ('double-11', DATE '2040-11-09', DATE '2040-11-12'),
  ('double-11', DATE '2041-11-09', DATE '2041-11-12'),
  ('double-11', DATE '2042-11-09', DATE '2042-11-12'),
  ('double-11', DATE '2043-11-09', DATE '2043-11-12'),
  ('double-11', DATE '2044-11-09', DATE '2044-11-12'),
  ('double-11', DATE '2045-11-09', DATE '2045-11-12'),
  ('double-11', DATE '2046-11-09', DATE '2046-11-12'),
  ('double-11', DATE '2047-11-09', DATE '2047-11-12'),
  ('double-11', DATE '2048-11-09', DATE '2048-11-12'),
  ('double-11', DATE '2049-11-09', DATE '2049-11-12'),
  ('double-11', DATE '2050-11-09', DATE '2050-11-12'),
  ('double-12', DATE '2026-12-10', DATE '2026-12-13'),
  ('double-12', DATE '2027-12-10', DATE '2027-12-13'),
  ('double-12', DATE '2028-12-10', DATE '2028-12-13'),
  ('double-12', DATE '2029-12-10', DATE '2029-12-13'),
  ('double-12', DATE '2030-12-10', DATE '2030-12-13'),
  ('double-12', DATE '2031-12-10', DATE '2031-12-13'),
  ('double-12', DATE '2032-12-10', DATE '2032-12-13'),
  ('double-12', DATE '2033-12-10', DATE '2033-12-13'),
  ('double-12', DATE '2034-12-10', DATE '2034-12-13'),
  ('double-12', DATE '2035-12-10', DATE '2035-12-13'),
  ('double-12', DATE '2036-12-10', DATE '2036-12-13'),
  ('double-12', DATE '2037-12-10', DATE '2037-12-13'),
  ('double-12', DATE '2038-12-10', DATE '2038-12-13'),
  ('double-12', DATE '2039-12-10', DATE '2039-12-13'),
  ('double-12', DATE '2040-12-10', DATE '2040-12-13'),
  ('double-12', DATE '2041-12-10', DATE '2041-12-13'),
  ('double-12', DATE '2042-12-10', DATE '2042-12-13'),
  ('double-12', DATE '2043-12-10', DATE '2043-12-13'),
  ('double-12', DATE '2044-12-10', DATE '2044-12-13'),
  ('double-12', DATE '2045-12-10', DATE '2045-12-13'),
  ('double-12', DATE '2046-12-10', DATE '2046-12-13'),
  ('double-12', DATE '2047-12-10', DATE '2047-12-13'),
  ('double-12', DATE '2048-12-10', DATE '2048-12-13'),
  ('double-12', DATE '2049-12-10', DATE '2049-12-13'),
  ('double-12', DATE '2050-12-10', DATE '2050-12-13'),
  ('womens-day', DATE '2026-03-06', DATE '2026-03-09'),
  ('womens-day', DATE '2027-03-06', DATE '2027-03-09'),
  ('womens-day', DATE '2028-03-06', DATE '2028-03-09'),
  ('womens-day', DATE '2029-03-06', DATE '2029-03-09'),
  ('womens-day', DATE '2030-03-06', DATE '2030-03-09'),
  ('womens-day', DATE '2031-03-06', DATE '2031-03-09'),
  ('womens-day', DATE '2032-03-06', DATE '2032-03-09'),
  ('womens-day', DATE '2033-03-06', DATE '2033-03-09'),
  ('womens-day', DATE '2034-03-06', DATE '2034-03-09'),
  ('womens-day', DATE '2035-03-06', DATE '2035-03-09'),
  ('womens-day', DATE '2036-03-06', DATE '2036-03-09'),
  ('womens-day', DATE '2037-03-06', DATE '2037-03-09'),
  ('womens-day', DATE '2038-03-06', DATE '2038-03-09'),
  ('womens-day', DATE '2039-03-06', DATE '2039-03-09'),
  ('womens-day', DATE '2040-03-06', DATE '2040-03-09'),
  ('womens-day', DATE '2041-03-06', DATE '2041-03-09'),
  ('womens-day', DATE '2042-03-06', DATE '2042-03-09'),
  ('womens-day', DATE '2043-03-06', DATE '2043-03-09'),
  ('womens-day', DATE '2044-03-06', DATE '2044-03-09'),
  ('womens-day', DATE '2045-03-06', DATE '2045-03-09'),
  ('womens-day', DATE '2046-03-06', DATE '2046-03-09'),
  ('womens-day', DATE '2047-03-06', DATE '2047-03-09'),
  ('womens-day', DATE '2048-03-06', DATE '2048-03-09'),
  ('womens-day', DATE '2049-03-06', DATE '2049-03-09'),
  ('womens-day', DATE '2050-03-06', DATE '2050-03-09'),
  ('mid-year-618', DATE '2026-06-16', DATE '2026-06-19'),
  ('mid-year-618', DATE '2027-06-16', DATE '2027-06-19'),
  ('mid-year-618', DATE '2028-06-16', DATE '2028-06-19'),
  ('mid-year-618', DATE '2029-06-16', DATE '2029-06-19'),
  ('mid-year-618', DATE '2030-06-16', DATE '2030-06-19'),
  ('mid-year-618', DATE '2031-06-16', DATE '2031-06-19'),
  ('mid-year-618', DATE '2032-06-16', DATE '2032-06-19'),
  ('mid-year-618', DATE '2033-06-16', DATE '2033-06-19'),
  ('mid-year-618', DATE '2034-06-16', DATE '2034-06-19'),
  ('mid-year-618', DATE '2035-06-16', DATE '2035-06-19'),
  ('mid-year-618', DATE '2036-06-16', DATE '2036-06-19'),
  ('mid-year-618', DATE '2037-06-16', DATE '2037-06-19'),
  ('mid-year-618', DATE '2038-06-16', DATE '2038-06-19'),
  ('mid-year-618', DATE '2039-06-16', DATE '2039-06-19'),
  ('mid-year-618', DATE '2040-06-16', DATE '2040-06-19'),
  ('mid-year-618', DATE '2041-06-16', DATE '2041-06-19'),
  ('mid-year-618', DATE '2042-06-16', DATE '2042-06-19'),
  ('mid-year-618', DATE '2043-06-16', DATE '2043-06-19'),
  ('mid-year-618', DATE '2044-06-16', DATE '2044-06-19'),
  ('mid-year-618', DATE '2045-06-16', DATE '2045-06-19'),
  ('mid-year-618', DATE '2046-06-16', DATE '2046-06-19'),
  ('mid-year-618', DATE '2047-06-16', DATE '2047-06-19'),
  ('mid-year-618', DATE '2048-06-16', DATE '2048-06-19'),
  ('mid-year-618', DATE '2049-06-16', DATE '2049-06-19'),
  ('mid-year-618', DATE '2050-06-16', DATE '2050-06-19'),
  ('double-9', DATE '2026-09-07', DATE '2026-09-10'),
  ('double-9', DATE '2027-09-07', DATE '2027-09-10'),
  ('double-9', DATE '2028-09-07', DATE '2028-09-10'),
  ('double-9', DATE '2029-09-07', DATE '2029-09-10'),
  ('double-9', DATE '2030-09-07', DATE '2030-09-10'),
  ('double-9', DATE '2031-09-07', DATE '2031-09-10'),
  ('double-9', DATE '2032-09-07', DATE '2032-09-10'),
  ('double-9', DATE '2033-09-07', DATE '2033-09-10'),
  ('double-9', DATE '2034-09-07', DATE '2034-09-10'),
  ('double-9', DATE '2035-09-07', DATE '2035-09-10'),
  ('double-9', DATE '2036-09-07', DATE '2036-09-10'),
  ('double-9', DATE '2037-09-07', DATE '2037-09-10'),
  ('double-9', DATE '2038-09-07', DATE '2038-09-10'),
  ('double-9', DATE '2039-09-07', DATE '2039-09-10'),
  ('double-9', DATE '2040-09-07', DATE '2040-09-10'),
  ('double-9', DATE '2041-09-07', DATE '2041-09-10'),
  ('double-9', DATE '2042-09-07', DATE '2042-09-10'),
  ('double-9', DATE '2043-09-07', DATE '2043-09-10'),
  ('double-9', DATE '2044-09-07', DATE '2044-09-10'),
  ('double-9', DATE '2045-09-07', DATE '2045-09-10'),
  ('double-9', DATE '2046-09-07', DATE '2046-09-10'),
  ('double-9', DATE '2047-09-07', DATE '2047-09-10'),
  ('double-9', DATE '2048-09-07', DATE '2048-09-10'),
  ('double-9', DATE '2049-09-07', DATE '2049-09-10'),
  ('double-9', DATE '2050-09-07', DATE '2050-09-10'),
  ('christmas', DATE '2026-12-20', DATE '2026-12-26'),
  ('christmas', DATE '2027-12-20', DATE '2027-12-26'),
  ('christmas', DATE '2028-12-20', DATE '2028-12-26'),
  ('christmas', DATE '2029-12-20', DATE '2029-12-26'),
  ('christmas', DATE '2030-12-20', DATE '2030-12-26'),
  ('christmas', DATE '2031-12-20', DATE '2031-12-26'),
  ('christmas', DATE '2032-12-20', DATE '2032-12-26'),
  ('christmas', DATE '2033-12-20', DATE '2033-12-26'),
  ('christmas', DATE '2034-12-20', DATE '2034-12-26'),
  ('christmas', DATE '2035-12-20', DATE '2035-12-26'),
  ('christmas', DATE '2036-12-20', DATE '2036-12-26'),
  ('christmas', DATE '2037-12-20', DATE '2037-12-26'),
  ('christmas', DATE '2038-12-20', DATE '2038-12-26'),
  ('christmas', DATE '2039-12-20', DATE '2039-12-26'),
  ('christmas', DATE '2040-12-20', DATE '2040-12-26'),
  ('christmas', DATE '2041-12-20', DATE '2041-12-26'),
  ('christmas', DATE '2042-12-20', DATE '2042-12-26'),
  ('christmas', DATE '2043-12-20', DATE '2043-12-26'),
  ('christmas', DATE '2044-12-20', DATE '2044-12-26'),
  ('christmas', DATE '2045-12-20', DATE '2045-12-26'),
  ('christmas', DATE '2046-12-20', DATE '2046-12-26'),
  ('christmas', DATE '2047-12-20', DATE '2047-12-26'),
  ('christmas', DATE '2048-12-20', DATE '2048-12-26'),
  ('christmas', DATE '2049-12-20', DATE '2049-12-26'),
  ('christmas', DATE '2050-12-20', DATE '2050-12-26')
ON CONFLICT (festival_id, starts_on) DO UPDATE SET ends_on = EXCLUDED.ends_on;

-- 某個活動在 p_now 的那一期（台北時間）。不在期間回傳空。
CREATE OR REPLACE FUNCTION public.live_event_period(p_event_id text, p_now timestamptz)
RETURNS TABLE (period_key text, starts_at timestamptz, ends_at timestamptz, variant integer)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  ev public.game_live_events%ROWTYPE;
  d date := (p_now AT TIME ZONE 'Asia/Taipei')::date;
  m integer := extract(month FROM d)::integer;
  y integer := extract(year FROM d)::integer;
  first_day date;
  next_day date;
  idx integer;
  season text;
  season_year integer;
  n integer;
BEGIN
  SELECT * INTO ev FROM public.game_live_events WHERE id = p_event_id AND active;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF ev.cadence = 'daily' THEN
    first_day := d; next_day := d + 1; idx := d - DATE '2026-01-01';
    period_key := 'd:' || to_char(d, 'YYYY-MM-DD');
  ELSIF ev.cadence = 'weekly' THEN
    first_day := d - (extract(isodow FROM d)::integer - 1); next_day := first_day + 7;
    idx := floor((first_day - DATE '2025-12-29')::numeric / 7)::integer;
    period_key := 'w:' || to_char(first_day, 'YYYY-MM-DD');
  ELSIF ev.cadence = 'monthly' THEN
    first_day := date_trunc('month', d)::date; next_day := (first_day + interval '1 month')::date;
    idx := (y - 2026) * 12 + m - 1;
    period_key := 'm:' || to_char(d, 'YYYY-MM');
  ELSIF ev.cadence = 'season' THEN
    season := CASE WHEN m BETWEEN 3 AND 5 THEN 'spring' WHEN m BETWEEN 6 AND 8 THEN 'summer' WHEN m BETWEEN 9 AND 11 THEN 'autumn' ELSE 'winter' END;
    season_year := CASE WHEN season = 'winter' AND m <= 2 THEN y - 1 ELSE y END;
    first_day := make_date(season_year, CASE season WHEN 'spring' THEN 3 WHEN 'summer' THEN 6 WHEN 'autumn' THEN 9 ELSE 12 END, 1);
    next_day := (first_day + interval '3 months')::date;
    idx := (season_year - 2026) * 4 + CASE season WHEN 'spring' THEN 0 WHEN 'summer' THEN 1 WHEN 'autumn' THEN 2 ELSE 3 END;
    period_key := 's:' || season_year || '-' || season;
  ELSE
    SELECT w.starts_on, w.ends_on INTO first_day, next_day
    FROM public.game_live_festival_windows AS w
    WHERE w.festival_id = ev.festival_id AND w.starts_on <= d AND d < w.ends_on;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    idx := extract(year FROM first_day)::integer - 2026;
    period_key := 'f:' || ev.festival_id || ':' || to_char(first_day, 'YYYY-MM-DD');
  END IF;
  n := jsonb_array_length(ev.variants);
  variant := ((idx % n) + n) % n;
  starts_at := first_day::timestamp AT TIME ZONE 'Asia/Taipei';
  ends_at := next_day::timestamp AT TIME ZONE 'Asia/Taipei';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.live_event_available(p_metric text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_metric IN ('merge.orders', 'merge.merges') THEN to_regclass('public.member_merge_shop_events') IS NOT NULL
    WHEN p_metric IN ('street.served', 'street.earned') THEN to_regclass('public.member_street_saves') IS NOT NULL
    WHEN p_metric IN ('block.ranked', 'block.score') THEN to_regclass('public.block_ranked_runs') IS NOT NULL
    ELSE false
  END
$$;

-- 伺服器重算的進度原始值。商店街是累計值（扣掉加入時的 baseline 才是這一期的進度），其他直接是這一期的值。
CREATE OR REPLACE FUNCTION public.live_event_metric(p_user uuid, p_metric text, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  value bigint := 0;
  street jsonb;
BEGIN
  IF NOT public.live_event_available(p_metric) THEN
    RETURN 0;
  END IF;
  IF p_metric IN ('merge.orders', 'merge.merges') THEN
    SELECT count(*) INTO value FROM public.member_merge_shop_events AS e
    WHERE e.user_id = p_user AND e.action_type = CASE p_metric WHEN 'merge.orders' THEN 'serve' ELSE 'merge' END
      AND e.created_at >= p_from AND e.created_at < p_to;
  ELSIF p_metric IN ('street.served', 'street.earned') THEN
    EXECUTE 'SELECT progress FROM public.member_street_saves WHERE user_id = $1' INTO street USING p_user;
    IF street IS NOT NULL AND jsonb_typeof(street #> ARRAY['stats', substr(p_metric, 8)]) = 'number' THEN
      value := floor((street #>> ARRAY['stats', substr(p_metric, 8)])::numeric)::bigint;
    END IF;
  ELSIF p_metric = 'block.ranked' THEN
    EXECUTE 'SELECT count(*) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified'' AND submitted_at >= $2 AND submitted_at < $3'
      INTO value USING p_user, p_from, p_to;
  ELSIF p_metric = 'block.score' THEN
    EXECUTE 'SELECT coalesce(max(score), 0) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified'' AND submitted_at >= $2 AND submitted_at < $3'
      INTO value USING p_user, p_from, p_to;
  END IF;
  RETURN LEAST(GREATEST(coalesce(value, 0), 0), 1000000000)::integer;
END;
$$;

-- 讀取（並自動加入）目前進行中的活動。p_now 只給內部測試用；會員呼叫的版本固定用 now()。
CREATE OR REPLACE FUNCTION public.live_event_state(p_user uuid, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  ev public.game_live_events%ROWTYPE;
  per record;
  entry public.member_live_event_entries%ROWTYPE;
  goal jsonb;
  metric text;
  raw integer;
  items jsonb := '[]'::jsonb;
  records jsonb;
BEGIN
  FOR ev IN SELECT * FROM public.game_live_events WHERE active ORDER BY id LOOP
    SELECT * INTO per FROM public.live_event_period(ev.id, p_now);
    CONTINUE WHEN per.period_key IS NULL;
    goal := ev.variants -> per.variant;
    metric := goal ->> 'metric';
    raw := public.live_event_metric(p_user, metric, per.starts_at, per.ends_at);
    INSERT INTO public.member_live_event_entries (user_id, event_id, period_key, variant, baseline)
    VALUES (p_user, ev.id, per.period_key, per.variant, CASE WHEN metric LIKE 'street.%' THEN raw ELSE 0 END)
    ON CONFLICT DO NOTHING;
    SELECT * INTO entry FROM public.member_live_event_entries
    WHERE user_id = p_user AND event_id = ev.id AND period_key = per.period_key;
    items := items || jsonb_build_object(
      'eventId', ev.id,
      'gameId', ev.game_id,
      'cadence', ev.cadence,
      'periodKey', per.period_key,
      'variant', entry.variant,
      'metric', metric,
      'target', (goal ->> 'target')::integer,
      'progress', LEAST(GREATEST(raw - entry.baseline, 0), (goal ->> 'target')::integer),
      'available', public.live_event_available(metric),
      'claimed', entry.claimed_at IS NOT NULL,
      'startsAt', per.starts_at,
      'endsAt', per.ends_at
    );
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('eventId', e.event_id, 'periodKey', e.period_key, 'variant', e.variant, 'medal', ev2.medal, 'claimedAt', e.claimed_at)
    ORDER BY e.claimed_at DESC), '[]'::jsonb)
  INTO records
  FROM (SELECT * FROM public.member_live_event_entries WHERE user_id = p_user AND claimed_at IS NOT NULL ORDER BY claimed_at DESC LIMIT 60) AS e
  JOIN public.game_live_events AS ev2 ON ev2.id = e.event_id;

  RETURN jsonb_build_object('events', items, 'records', records, 'version', 1, 'serverNow', p_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.live_event_claim(p_user uuid, p_event_id text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  per record;
  entry public.member_live_event_entries%ROWTYPE;
  goal jsonb;
  raw integer;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION '找不到這個活動';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('live_event:' || p_user::text, 0));
  SELECT * INTO per FROM public.live_event_period(p_event_id, p_now);
  IF per.period_key IS NULL THEN
    RAISE EXCEPTION '活動不在進行期間';
  END IF;
  PERFORM public.live_event_state(p_user, p_now);
  SELECT * INTO entry FROM public.member_live_event_entries
  WHERE user_id = p_user AND event_id = p_event_id AND period_key = per.period_key FOR UPDATE;
  IF entry.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION '這一期已經領過活動紀錄';
  END IF;
  SELECT variants -> entry.variant INTO goal FROM public.game_live_events WHERE id = p_event_id;
  IF NOT public.live_event_available(goal ->> 'metric') THEN
    RAISE EXCEPTION '活動資料來源還沒開放';
  END IF;
  raw := public.live_event_metric(p_user, goal ->> 'metric', per.starts_at, per.ends_at);
  IF raw - entry.baseline < (goal ->> 'target')::integer THEN
    RAISE EXCEPTION '活動目標還沒完成';
  END IF;
  UPDATE public.member_live_event_entries SET claimed_at = p_now
  WHERE user_id = p_user AND event_id = p_event_id AND period_key = per.period_key;
  RETURN public.live_event_state(p_user, p_now) || jsonb_build_object('claimed', jsonb_build_object('eventId', p_event_id, 'periodKey', per.period_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_live_events()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.live_event_state(auth.uid(), now());
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_my_live_event(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.live_event_claim(auth.uid(), p_event_id, now());
END;
$$;

REVOKE ALL ON FUNCTION public.live_event_period(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_available(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_metric(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_claim(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_live_events() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_live_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_live_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_live_event(text) TO authenticated;

DO $live_self_check$
DECLARE
  bad text;
  def text := pg_get_functiondef('public.live_event_claim(uuid, text, timestamptz)'::regprocedure);
BEGIN
  IF (SELECT count(*) FROM public.game_live_events WHERE active AND cadence = 'festival') < 27 THEN
    RAISE EXCEPTION '27 種節慶都要有限定活動';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_live_events WHERE pay_points <> 0) THEN
    RAISE EXCEPTION '活動不可發 Pay 點數';
  END IF;
  IF position('member_point' IN def) > 0 OR position('post_member_reward' IN def) > 0 THEN
    RAISE EXCEPTION '活動領取不可碰點數';
  END IF;
  SELECT string_agg(x.event_id || '@' || x.at::text, ', ') INTO bad
  FROM (VALUES
  ('merge_daily_errand', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'd:2026-10-29', 1),
  ('street_daily_rounds', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'd:2026-10-29', 1),
  ('merge_weekly_rush', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'w:2026-10-26', 1),
  ('street_monthly_fair', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'm:2026-10', 0),
  ('block_weekly_cup', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'w:2026-10-26', 1),
  ('season_street_parade', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 's:2026-autumn', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_ghost_festival', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_double_ninth', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', 'f:halloween:2026-10-29', 0),
  ('fest_double_11', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2026-10-29T23:59:00+08:00', NULL, -1),
  ('merge_daily_errand', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 'd:2026-11-02', 1),
  ('street_daily_rounds', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 'd:2026-11-02', 1),
  ('merge_weekly_rush', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 'w:2026-11-02', 2),
  ('street_monthly_fair', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 'm:2026-11', 1),
  ('block_weekly_cup', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 'w:2026-11-02', 0),
  ('season_street_parade', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', 's:2026-autumn', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_ghost_festival', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_double_ninth', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_double_11', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2026-11-02T00:00:00+08:00', NULL, -1),
  ('merge_daily_errand', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'd:2026-12-24', 1),
  ('street_daily_rounds', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'd:2026-12-24', 1),
  ('merge_weekly_rush', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'w:2026-12-21', 0),
  ('street_monthly_fair', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'm:2026-12', 2),
  ('block_weekly_cup', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'w:2026-12-21', 1),
  ('season_street_parade', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 's:2026-winter', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_ghost_festival', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_double_ninth', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_double_11', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2026-12-24T12:00:00+08:00', 'f:christmas:2026-12-20', 0),
  ('merge_daily_errand', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'd:2027-02-10', 1),
  ('street_daily_rounds', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'd:2027-02-10', 1),
  ('merge_weekly_rush', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'w:2027-02-08', 1),
  ('street_monthly_fair', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'm:2027-02', 1),
  ('block_weekly_cup', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'w:2027-02-08', 0),
  ('season_street_parade', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 's:2026-winter', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', 'f:lunar-new-year:2027-02-05', 0),
  ('fest_ghost_festival', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_double_ninth', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_double_11', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2027-02-10T12:00:00+08:00', NULL, -1),
  ('merge_daily_errand', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'd:2027-09-15', 0),
  ('street_daily_rounds', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'd:2027-09-15', 0),
  ('merge_weekly_rush', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'w:2027-09-13', 2),
  ('street_monthly_fair', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'm:2027-09', 2),
  ('block_weekly_cup', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'w:2027-09-13', 1),
  ('season_street_parade', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 's:2027-autumn', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_ghost_festival', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', 'f:mid-autumn:2027-09-14', 0),
  ('fest_double_ninth', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_double_11', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2027-09-15T08:00:00+08:00', NULL, -1),
  ('merge_daily_errand', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 'd:2031-06-01', 1),
  ('street_daily_rounds', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 'd:2031-06-01', 1),
  ('merge_weekly_rush', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 'w:2031-05-26', 0),
  ('street_monthly_fair', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 'm:2031-06', 2),
  ('block_weekly_cup', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 'w:2031-05-26', 0),
  ('season_street_parade', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', 's:2031-summer', 0),
  ('fest_lantern_festival', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_qingming', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_new_year_merge', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_ghost_festival', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_new_year_eve', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_qixi', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_fathers_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_mothers_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_retrocession', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_mid_autumn_street', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_double_ninth', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_valentine', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_white_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_day_520', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_national_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_dongzhi', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_teachers_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_dragon_boat', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_childrens_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_labor_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_halloween', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_double_11', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_double_12', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_womens_day', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_mid_year_618', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_double_9', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1),
  ('fest_christmas_block', TIMESTAMPTZ '2031-06-01T00:30:00+08:00', NULL, -1)
  ) AS x(event_id, at, want_key, want_variant)
  LEFT JOIN LATERAL public.live_event_period(x.event_id, x.at) AS p ON true
  WHERE p.period_key IS DISTINCT FROM x.want_key OR (x.want_key IS NOT NULL AND p.variant <> x.want_variant);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '資料庫期別和前端不一致：%', bad;
  END IF;
END
$live_self_check$;

COMMIT;
