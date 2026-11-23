-- 第六階段第二～四批預覽。只供本機隔離 Supabase 驗證，不是正式 migration。
-- 需要先套用第四、五階段 migration 與 20261025201700_merge_shop_preview.sql。
--
-- 第二批：三款遊戲共用的 Pay 點數獎勵規則、任務與領取紀錄。
--   規則存在 game_reward_policies / game_reward_tasks，可由資料庫擁有者調整，不寫死在函式。
--   payout_enabled 仍被 CHECK 鎖在 false。領取只留下「已達成、暫不發放」紀錄，
--   不呼叫 post_member_reward，不寫 member_point_entries / reward_claims / member_point_accounts。
--   任務進度只讀合成交易寫入的 member_merge_shop_events，不接受前端傳入分數或完成宣告。
--   每日與每週以 Asia/Taipei 計算，週一 00:00 起算、下週一 00:00 結束。
--   刮刮卡維持原本的次數與獎勵，不計入這裡的上限。
-- 第三批：遊戲成就、展示勳章與點數商城讀取介面。
--   成就不進 member_perk_holds（那張表必須對應扣點流水），另存 member_game_achievements。
--   點數商城只讀既有虛擬特權開關、既有優惠券兌換來源，不新增商品、優惠券或兌換交易。

BEGIN;

DO $require_stage6_batch1$
BEGIN
  IF to_regclass('public.member_merge_shops') IS NULL
     OR to_regclass('public.member_merge_shop_events') IS NULL
     OR to_regclass('public.game_reward_policies') IS NULL
     OR to_regclass('public.member_perk_settings') IS NULL
     OR to_regclass('public.seller_coupons') IS NULL
     OR to_regclass('public.member_coupon_holds') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL THEN
    RAISE EXCEPTION '需要先套用第四、五階段與第六階段第一批';
  END IF;
END
$require_stage6_batch1$;

-- ---------------------------------------------------------------------------
-- 第二批：共用規則
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_reward_policies DROP CONSTRAINT IF EXISTS game_reward_caps_pending;
ALTER TABLE public.game_reward_policies DROP CONSTRAINT IF EXISTS game_reward_caps_range;
ALTER TABLE public.game_reward_policies
  ADD CONSTRAINT game_reward_caps_range CHECK (
    daily_cap BETWEEN 0 AND 1000
    AND weekly_quest BETWEEN 0 AND 1000
    AND weekly_cap BETWEEN 0 AND 7000
    AND weekly_cap >= weekly_quest
  );
ALTER TABLE public.game_reward_policies ADD COLUMN IF NOT EXISTS week_starts_on text NOT NULL DEFAULT 'monday';
ALTER TABLE public.game_reward_policies DROP CONSTRAINT IF EXISTS game_reward_week_monday;
ALTER TABLE public.game_reward_policies ADD CONSTRAINT game_reward_week_monday CHECK (week_starts_on = 'monday');
ALTER TABLE public.game_reward_policies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public.game_reward_policies IS
  '三款遊戲共用的 Pay 點數額度。數字是尚未簽核的規劃值，可由資料庫擁有者調整。payout_enabled 由 CHECK 鎖在 false。';

CREATE TABLE IF NOT EXISTS public.game_reward_tasks (
  id text PRIMARY KEY,
  game_id text NOT NULL,
  period text NOT NULL,
  metric text NOT NULL,
  target integer NOT NULL,
  points integer NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_reward_tasks_id_check CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  CONSTRAINT game_reward_tasks_game_check CHECK (game_id IN ('merge_shop', 'block_challenge', 'dream_street')),
  CONSTRAINT game_reward_tasks_period_check CHECK (period IN ('daily', 'weekly')),
  CONSTRAINT game_reward_tasks_metric_check CHECK (metric ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT game_reward_tasks_target_check CHECK (target BETWEEN 1 AND 1000),
  CONSTRAINT game_reward_tasks_points_check CHECK (points BETWEEN 1 AND 100)
);

COMMENT ON TABLE public.game_reward_tasks IS
  '遊戲 Pay 點數任務。進度由 game_reward_metric 從伺服器紀錄計算。enabled=false 的遊戲顯示尚未開放。';

INSERT INTO public.game_reward_tasks (id, game_id, period, metric, target, points, enabled, sort)
VALUES
  ('merge_daily_orders', 'merge_shop', 'daily', 'merge.orders', 3, 4, true, 10),
  ('merge_daily_merges', 'merge_shop', 'daily', 'merge.merges', 10, 3, true, 20),
  ('merge_daily_chest', 'merge_shop', 'daily', 'merge.chests', 1, 3, true, 30),
  ('merge_weekly_orders', 'merge_shop', 'weekly', 'merge.orders', 20, 10, true, 40),
  ('block_daily_clear', 'block_challenge', 'daily', 'block.clears', 1, 4, false, 50),
  ('street_daily_visit', 'dream_street', 'daily', 'street.visits', 1, 3, false, 60)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS member_merge_shop_events_user_type_time
  ON public.member_merge_shop_events (user_id, action_type, created_at);

CREATE OR REPLACE FUNCTION public.game_reward_period(p_period text, p_at timestamptz)
RETURNS TABLE (period_key date, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  day date := (p_at AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_period = 'daily' THEN
    period_key := day;
    ends_at := ((day + 1)::timestamp AT TIME ZONE 'Asia/Taipei');
  ELSIF p_period = 'weekly' THEN
    period_key := day - (extract(isodow FROM day)::integer - 1);
    ends_at := ((period_key + 7)::timestamp AT TIME ZONE 'Asia/Taipei');
  ELSE
    RAISE EXCEPTION '獎勵週期不正確';
  END IF;
  starts_at := (period_key::timestamp AT TIME ZONE 'Asia/Taipei');
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.game_reward_metric(p_user uuid, p_metric text, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  action text;
BEGIN
  action := CASE p_metric
    WHEN 'merge.orders' THEN 'serve'
    WHEN 'merge.merges' THEN 'merge'
    WHEN 'merge.chests' THEN 'claim_quest'
    WHEN 'merge.upgrades' THEN 'upgrade'
    ELSE NULL
  END;
  -- 方塊大挑戰、夢想商店街開發時在這裡接各自的伺服器紀錄。
  IF action IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT count(*)::integer
    FROM public.member_merge_shop_events AS events
    WHERE events.user_id = p_user
      AND events.action_type = action
      AND events.created_at >= p_from
      AND events.created_at < p_to
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.member_game_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  task_id text NOT NULL REFERENCES public.game_reward_tasks (id) ON DELETE RESTRICT,
  game_id text NOT NULL,
  period text NOT NULL,
  period_key date NOT NULL,
  taipei_day date NOT NULL,
  week_start date NOT NULL,
  claim_key text NOT NULL,
  task_points integer NOT NULL,
  awarded_points integer NOT NULL,
  metric_value integer NOT NULL,
  payout_state text NOT NULL DEFAULT 'withheld',
  point_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_game_reward_claims_user_key UNIQUE (user_id, claim_key),
  CONSTRAINT member_game_reward_claims_period_check CHECK (period IN ('daily', 'weekly')),
  CONSTRAINT member_game_reward_claims_key_shape CHECK (claim_key ~ '^game_reward:[a-z0-9_]{3,40}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT member_game_reward_claims_points_check CHECK (task_points BETWEEN 1 AND 100 AND awarded_points BETWEEN 1 AND task_points),
  CONSTRAINT member_game_reward_claims_metric_check CHECK (metric_value >= 0),
  CONSTRAINT member_game_reward_claims_payout_closed CHECK (payout_state = 'withheld' AND point_entry_id IS NULL)
);

CREATE INDEX IF NOT EXISTS member_game_reward_claims_user_week
  ON public.member_game_reward_claims (user_id, week_start, taipei_day);

COMMENT ON TABLE public.member_game_reward_claims IS
  '遊戲任務達成紀錄，只用來計算共用上限與顯示進度。不是點數餘額。payout_state 由 CHECK 鎖在 withheld，不連到點數流水。';

CREATE OR REPLACE FUNCTION public.guard_game_reward_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('game.reward_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '遊戲獎勵紀錄不可修改或刪除';
  END IF;
  IF current_setting('game.reward', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '遊戲獎勵只能由領取交易建立';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_game_reward_claims_guard ON public.member_game_reward_claims;
CREATE TRIGGER member_game_reward_claims_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_game_reward_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_game_reward_claim();

CREATE OR REPLACE FUNCTION public.game_reward_state_json(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  policy public.game_reward_policies%ROWTYPE;
  instant timestamptz := now();
  d record;
  w record;
  task public.game_reward_tasks%ROWTYPE;
  claim public.member_game_reward_claims%ROWTYPE;
  span_key date;
  span_start timestamptz;
  span_end timestamptz;
  daily_used integer := 0;
  weekly_used integer := 0;
  quest_used integer := 0;
  withheld_total integer := 0;
  remaining integer;
  progress integer;
  status text;
  tasks jsonb := '[]'::jsonb;
  key text;
BEGIN
  SELECT * INTO policy FROM public.game_reward_policies WHERE id = 'stage6';
  IF NOT FOUND OR policy.payout_enabled OR NOT policy.scratch_excluded THEN
    RAISE EXCEPTION '遊戲 Pay 點數尚未正式簽核，不能入帳';
  END IF;
  SELECT * INTO d FROM public.game_reward_period('daily', instant);
  SELECT * INTO w FROM public.game_reward_period('weekly', instant);

  IF p_user IS NOT NULL THEN
    SELECT
      coalesce(sum(c.awarded_points) FILTER (WHERE c.period = 'daily' AND c.taipei_day = d.period_key), 0),
      coalesce(sum(c.awarded_points), 0),
      coalesce(sum(c.awarded_points) FILTER (WHERE c.period = 'weekly'), 0)
    INTO daily_used, weekly_used, quest_used
    FROM public.member_game_reward_claims AS c
    WHERE c.user_id = p_user
      AND c.week_start = w.period_key;
    SELECT coalesce(sum(c.awarded_points), 0) INTO withheld_total
    FROM public.member_game_reward_claims AS c
    WHERE c.user_id = p_user;
  END IF;

  FOR task IN SELECT * FROM public.game_reward_tasks ORDER BY sort, id LOOP
    IF task.period = 'daily' THEN
      span_key := d.period_key; span_start := d.starts_at; span_end := d.ends_at;
    ELSE
      span_key := w.period_key; span_start := w.starts_at; span_end := w.ends_at;
    END IF;
    key := 'game_reward:' || task.id || ':' || to_char(span_key, 'YYYY-MM-DD');
    claim := NULL;
    progress := 0;
    IF p_user IS NOT NULL THEN
      SELECT * INTO claim FROM public.member_game_reward_claims AS c WHERE c.user_id = p_user AND c.claim_key = key;
      IF task.enabled THEN
        progress := public.game_reward_metric(p_user, task.metric, span_start, span_end);
      END IF;
    END IF;
    IF task.period = 'daily' THEN
      remaining := LEAST(policy.daily_cap - daily_used, policy.weekly_cap - weekly_used);
    ELSE
      remaining := LEAST(policy.weekly_quest - quest_used, policy.weekly_cap - weekly_used);
    END IF;
    remaining := GREATEST(0, remaining);
    status := CASE
      WHEN NOT task.enabled THEN 'locked'
      WHEN claim.id IS NOT NULL THEN 'claimed'
      WHEN remaining <= 0 THEN 'capped'
      WHEN progress >= task.target THEN 'claimable'
      ELSE 'in_progress'
    END;
    tasks := tasks || jsonb_build_object(
      'id', task.id,
      'gameId', task.game_id,
      'period', task.period,
      'metric', task.metric,
      'target', task.target,
      'progress', LEAST(progress, task.target),
      'points', task.points,
      'claimablePoints', CASE WHEN status = 'claimable' THEN LEAST(task.points, remaining) ELSE 0 END,
      'awardedPoints', coalesce(claim.awarded_points, 0),
      'status', status,
      'periodKey', span_key,
      'resetAt', span_end
    );
  END LOOP;

  RETURN jsonb_build_object(
    'signedIn', p_user IS NOT NULL,
    'payoutEnabled', false,
    'approval', policy.approval,
    'issuedPayPoints', 0,
    'dailyCap', policy.daily_cap,
    'weeklyQuest', policy.weekly_quest,
    'weeklyCap', policy.weekly_cap,
    'scratchExcluded', true,
    'weekStartsOn', policy.week_starts_on,
    'taipeiDay', d.period_key,
    'weekStart', w.period_key,
    'weekEnd', w.period_key + 6,
    'dailyResetAt', d.ends_at,
    'weeklyResetAt', w.ends_at,
    'dailyUsed', daily_used,
    'weeklyUsed', weekly_used,
    'weeklyQuestUsed', quest_used,
    'withheldTotal', withheld_total,
    'serverNow', instant,
    'games', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id,
        'open', EXISTS (SELECT 1 FROM public.game_reward_tasks AS t WHERE t.game_id = g.id AND t.enabled)
      ) ORDER BY g.ord)
      FROM (VALUES ('merge_shop', 1), ('block_challenge', 2), ('dream_street', 3)) AS g(id, ord)
    ),
    'tasks', tasks
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_reward_rules()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN public.game_reward_state_json(NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_game_rewards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.game_reward_state_json(uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_my_game_reward(p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  policy public.game_reward_policies%ROWTYPE;
  task public.game_reward_tasks%ROWTYPE;
  existing public.member_game_reward_claims%ROWTYPE;
  instant timestamptz := now();
  d record;
  w record;
  span_key date;
  span_start timestamptz;
  span_end timestamptz;
  key text;
  progress integer;
  daily_used integer;
  weekly_used integer;
  quest_used integer;
  remaining integer;
  award integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION '找不到這個遊戲任務';
  END IF;

  -- 三款遊戲共用同一把會員鎖，不同遊戲同時領取也不能繞過上限。
  PERFORM pg_advisory_xact_lock(hashtextextended('game-reward:' || uid::text, 0));

  SELECT * INTO policy FROM public.game_reward_policies WHERE id = 'stage6' FOR SHARE;
  IF NOT FOUND OR NOT policy.scratch_excluded THEN
    RAISE EXCEPTION '遊戲 Pay 點數尚未正式簽核，不能入帳';
  END IF;

  SELECT * INTO task FROM public.game_reward_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這個遊戲任務';
  END IF;
  IF NOT task.enabled THEN
    RAISE EXCEPTION '這款遊戲尚未開放';
  END IF;

  SELECT * INTO d FROM public.game_reward_period('daily', instant);
  SELECT * INTO w FROM public.game_reward_period('weekly', instant);
  IF task.period = 'daily' THEN
    span_key := d.period_key; span_start := d.starts_at; span_end := d.ends_at;
  ELSE
    span_key := w.period_key; span_start := w.starts_at; span_end := w.ends_at;
  END IF;
  key := 'game_reward:' || task.id || ':' || to_char(span_key, 'YYYY-MM-DD');

  SELECT * INTO existing FROM public.member_game_reward_claims WHERE user_id = uid AND claim_key = key;
  IF FOUND THEN
    RETURN public.game_reward_state_json(uid) || jsonb_build_object(
      'claim', jsonb_build_object('taskId', task.id, 'awardedPoints', existing.awarded_points, 'replayed', true)
    );
  END IF;

  progress := public.game_reward_metric(uid, task.metric, span_start, span_end);
  IF progress < task.target THEN
    RAISE EXCEPTION '任務還沒完成';
  END IF;

  SELECT
    coalesce(sum(c.awarded_points) FILTER (WHERE c.period = 'daily' AND c.taipei_day = d.period_key), 0),
    coalesce(sum(c.awarded_points), 0),
    coalesce(sum(c.awarded_points) FILTER (WHERE c.period = 'weekly'), 0)
  INTO daily_used, weekly_used, quest_used
  FROM public.member_game_reward_claims AS c
  WHERE c.user_id = uid
    AND c.week_start = w.period_key;

  IF task.period = 'daily' THEN
    remaining := LEAST(policy.daily_cap - daily_used, policy.weekly_cap - weekly_used);
  ELSE
    remaining := LEAST(policy.weekly_quest - quest_used, policy.weekly_cap - weekly_used);
  END IF;
  award := LEAST(task.points, remaining);
  IF award <= 0 THEN
    RAISE EXCEPTION '遊戲獎勵已達上限';
  END IF;

  IF policy.payout_enabled THEN
    -- CHECK 讓這裡目前不可能成立。接上正式帳本需另行簽核的 migration。
    RAISE EXCEPTION '遊戲 Pay 點數尚未接上正式帳本';
  END IF;

  PERFORM set_config('game.reward', 'on', true);
  INSERT INTO public.member_game_reward_claims (
    user_id, task_id, game_id, period, period_key, taipei_day, week_start, claim_key,
    task_points, awarded_points, metric_value, payout_state, point_entry_id
  )
  VALUES (
    uid, task.id, task.game_id, task.period, span_key, d.period_key, w.period_key, key,
    task.points, award, progress, 'withheld', NULL
  );
  PERFORM set_config('game.reward', 'off', true);

  RETURN public.game_reward_state_json(uid) || jsonb_build_object(
    'claim', jsonb_build_object('taskId', task.id, 'awardedPoints', award, 'replayed', false)
  );
END;
$$;

COMMENT ON FUNCTION public.claim_my_game_reward(text) IS
  '登入會員領取一項遊戲任務。進度只讀伺服器紀錄，額度由共用規則計算。payout_enabled=false 時只記錄達成，不寫點數帳本。';

-- ---------------------------------------------------------------------------
-- 第三批：成就與展示勳章
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.game_achievement_catalog (
  id text PRIMARY KEY,
  game_id text NOT NULL,
  metric text NOT NULL,
  target integer NOT NULL,
  tier text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT game_achievement_catalog_id_check CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  CONSTRAINT game_achievement_catalog_game_check CHECK (game_id IN ('merge_shop', 'block_challenge', 'dream_street')),
  CONSTRAINT game_achievement_catalog_metric_check CHECK (metric ~ '^[a-z_]+\.[a-z_]+(:[a-z]+-[1-5])?$'),
  CONSTRAINT game_achievement_catalog_target_check CHECK (target BETWEEN 1 AND 100000),
  CONSTRAINT game_achievement_catalog_tier_check CHECK (tier IN ('bronze', 'silver', 'gold', 'legend'))
);

INSERT INTO public.game_achievement_catalog (id, game_id, metric, target, tier, sort)
VALUES
  ('merge_first_order', 'merge_shop', 'merge.lifetime_orders', 1, 'bronze', 10),
  ('merge_regulars', 'merge_shop', 'merge.lifetime_orders', 30, 'silver', 20),
  ('merge_famous', 'merge_shop', 'merge.lifetime_orders', 120, 'gold', 30),
  ('merge_level_three', 'merge_shop', 'merge.shop_level', 3, 'silver', 40),
  ('merge_level_five', 'merge_shop', 'merge.shop_level', 5, 'legend', 50),
  ('merge_chest_week', 'merge_shop', 'merge.chests', 7, 'silver', 60),
  ('merge_codex_eight', 'merge_shop', 'merge.catalog', 8, 'bronze', 70),
  ('merge_tea_master', 'merge_shop', 'merge.has:tea-5', 1, 'gold', 80),
  ('merge_snack_master', 'merge_shop', 'merge.has:snack-5', 1, 'gold', 90),
  ('merge_gift_master', 'merge_shop', 'merge.has:gift-5', 1, 'gold', 100),
  ('merge_codex_full', 'merge_shop', 'merge.catalog', 15, 'legend', 110)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.member_game_achievements (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  achievement_id text NOT NULL REFERENCES public.game_achievement_catalog (id) ON DELETE RESTRICT,
  metric_value integer NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS public.member_game_showcase (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  achievement_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_game_showcase_owned FOREIGN KEY (user_id, achievement_id)
    REFERENCES public.member_game_achievements (user_id, achievement_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.member_game_achievements IS
  '遊戲成就收藏。只能由成就同步交易依伺服器進度建立，建立後不可修改。與虛擬特權收藏分開，但在收藏庫一起顯示。';
COMMENT ON TABLE public.member_game_showcase IS
  '每位會員一個公開展示的遊戲勳章。只能展示自己已解鎖的成就。';

CREATE OR REPLACE FUNCTION public.guard_game_achievement_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('game.reward_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF current_setting('game.achievement', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '遊戲成就只能由同步交易更新';
  END IF;
  IF TG_TABLE_NAME = 'member_game_achievements' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已解鎖的成就不可修改或刪除';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '展示設定不可刪除';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_game_achievements_guard ON public.member_game_achievements;
CREATE TRIGGER member_game_achievements_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_game_achievements
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_game_achievement_write();

DROP TRIGGER IF EXISTS member_game_showcase_guard ON public.member_game_showcase;
CREATE TRIGGER member_game_showcase_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_game_showcase
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_game_achievement_write();

CREATE OR REPLACE FUNCTION public.game_achievement_metric(p_user uuid, p_metric text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  shop public.member_merge_shops%ROWTYPE;
BEGIN
  IF p_metric LIKE 'merge.%' THEN
    SELECT * INTO shop FROM public.member_merge_shops WHERE user_id = p_user;
    IF NOT FOUND THEN
      RETURN 0;
    END IF;
    IF p_metric = 'merge.lifetime_orders' THEN
      RETURN shop.lifetime_orders;
    ELSIF p_metric = 'merge.shop_level' THEN
      RETURN shop.shop_level;
    ELSIF p_metric = 'merge.catalog' THEN
      RETURN jsonb_array_length(shop.catalog);
    ELSIF p_metric LIKE 'merge.has:%' THEN
      RETURN CASE WHEN shop.catalog @> jsonb_build_array(substr(p_metric, 11)) THEN 1 ELSE 0 END;
    ELSIF p_metric = 'merge.chests' THEN
      RETURN (
        SELECT count(*)::integer
        FROM public.member_merge_shop_events AS events
        WHERE events.user_id = p_user AND events.action_type = 'claim_quest'
      );
    END IF;
  END IF;
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.game_achievement_state_json(p_user uuid, p_new jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  items jsonb;
  badge text;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', catalog.id,
    'gameId', catalog.game_id,
    'tier', catalog.tier,
    'target', catalog.target,
    'progress', LEAST(public.game_achievement_metric(p_user, catalog.metric), catalog.target),
    'unlocked', owned.achievement_id IS NOT NULL,
    'unlockedAt', owned.unlocked_at
  ) ORDER BY catalog.sort, catalog.id), '[]'::jsonb)
  INTO items
  FROM public.game_achievement_catalog AS catalog
  LEFT JOIN public.member_game_achievements AS owned
    ON owned.user_id = p_user AND owned.achievement_id = catalog.id
  WHERE catalog.active;

  SELECT showcase.achievement_id INTO badge FROM public.member_game_showcase AS showcase WHERE showcase.user_id = p_user;

  RETURN jsonb_build_object(
    'achievements', items,
    'showcase', badge,
    'newlyUnlocked', coalesce(p_new, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_my_game_achievements()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  catalog public.game_achievement_catalog%ROWTYPE;
  value integer;
  fresh jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('game-achievement:' || uid::text, 0));
  PERFORM set_config('game.achievement', 'on', true);
  FOR catalog IN
    SELECT c.*
    FROM public.game_achievement_catalog AS c
    WHERE c.active
      AND NOT EXISTS (
        SELECT 1 FROM public.member_game_achievements AS owned
        WHERE owned.user_id = uid AND owned.achievement_id = c.id
      )
    ORDER BY c.sort, c.id
  LOOP
    value := public.game_achievement_metric(uid, catalog.metric);
    IF value >= catalog.target THEN
      INSERT INTO public.member_game_achievements (user_id, achievement_id, metric_value)
      VALUES (uid, catalog.id, value)
      ON CONFLICT (user_id, achievement_id) DO NOTHING;
      IF FOUND THEN
        fresh := fresh || to_jsonb(catalog.id);
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('game.achievement', 'off', true);
  RETURN public.game_achievement_state_json(uid, fresh);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_game_badge(p_achievement_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_achievement_id IS NOT NULL THEN
    IF p_achievement_id !~ '^[a-z0-9_]{3,40}$' OR NOT EXISTS (
      SELECT 1 FROM public.member_game_achievements AS owned
      WHERE owned.user_id = uid AND owned.achievement_id = p_achievement_id
    ) THEN
      RAISE EXCEPTION '尚未解鎖這個成就';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('game-achievement:' || uid::text, 0));
  PERFORM set_config('game.achievement', 'on', true);
  INSERT INTO public.member_game_showcase (user_id, achievement_id, updated_at)
  VALUES (uid, p_achievement_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET achievement_id = EXCLUDED.achievement_id,
        updated_at = now();
  PERFORM set_config('game.achievement', 'off', true);
  RETURN public.game_achievement_state_json(uid, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.public_game_badges(p_user_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'userId', ids.id,
    'badge', showcase.achievement_id,
    'unlocked', (SELECT count(*) FROM public.member_game_achievements AS owned WHERE owned.user_id = ids.id)
  )), '[]'::jsonb)
  FROM unnest((coalesce(p_user_ids, ARRAY[]::uuid[]))[1:40]) AS ids(id)
  LEFT JOIN public.member_game_showcase AS showcase ON showcase.user_id = ids.id
  WHERE ids.id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.public_game_badges(uuid[]) IS
  '公開讀取最多 40 位會員展示中的遊戲勳章與已解鎖數量。不含進度細節，也不能修改。';

-- ---------------------------------------------------------------------------
-- 第三批：Pay 點數商城讀取介面
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_points_mall()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  bal integer := 0;
  perk_open boolean := false;
  coupons jsonb;
  held integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT balance INTO bal FROM public.member_point_accounts WHERE user_id = uid;
  bal := coalesce(bal, 0);
  SELECT settings.purchase_enabled INTO perk_open FROM public.member_perk_settings AS settings WHERE settings.id = true;
  SELECT coalesce(jsonb_agg(item.data ORDER BY item.created_at DESC), '[]'::jsonb)
  INTO coupons
  FROM (
    SELECT
      public.seller_coupon_json(coupon) || jsonb_build_object(
        'sellerName', public.coupon_seller_name(coupon.seller_id),
        'held', EXISTS (
          SELECT 1 FROM public.member_coupon_holds AS hold
          WHERE hold.user_id = uid AND hold.coupon_id = coupon.id
        )
      ) AS data,
      coupon.created_at
    FROM public.seller_coupons AS coupon
    WHERE coupon.game_pool
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.start_on <= day
      AND coupon.end_on >= day
      AND coupon.issued_count < coupon.qty
    ORDER BY coupon.created_at DESC
    LIMIT 60
  ) AS item;
  SELECT count(*)::integer INTO held
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = uid AND hold.source = 'points';
  RETURN jsonb_build_object(
    'balance', bal,
    'perkPurchaseEnabled', coalesce(perk_open, false),
    'couponExchangeCost', 100,
    'coupons', coupons,
    'pointsCouponCount', held,
    'benefitsOpen', false,
    'taipeiDay', day
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_points_mall() IS
  '點數商城唯讀總覽。沿用虛擬特權開關與既有遊戲曝光券，兌換仍走 purchase_my_perk / exchange_my_coupon。不扣點。';

-- ---------------------------------------------------------------------------
-- 權限
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_reward_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_game_reward_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_achievement_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_game_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_game_showcase ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_game_reward_claims_select_own ON public.member_game_reward_claims;
CREATE POLICY member_game_reward_claims_select_own ON public.member_game_reward_claims
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS member_game_achievements_select_own ON public.member_game_achievements;
CREATE POLICY member_game_achievements_select_own ON public.member_game_achievements
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS member_game_showcase_select_own ON public.member_game_showcase;
CREATE POLICY member_game_showcase_select_own ON public.member_game_showcase
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.game_reward_tasks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_game_reward_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.game_achievement_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_game_achievements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_game_showcase FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.game_reward_period(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_reward_metric(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_game_reward_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_reward_state_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_game_reward_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_game_rewards() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_game_reward(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_game_achievement_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_achievement_metric(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_achievement_state_json(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_my_game_achievements() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_game_badge(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.public_game_badges(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_points_mall() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_game_reward_rules() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_game_rewards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_game_reward(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_game_achievements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_game_badge(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_game_badges(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_points_mall() TO authenticated;

DO $revoke_stage6_service$
DECLARE
  item text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  FOREACH item IN ARRAY ARRAY[
    'public.game_reward_tasks', 'public.member_game_reward_claims', 'public.game_achievement_catalog',
    'public.member_game_achievements', 'public.member_game_showcase'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM service_role', item);
  END LOOP;
  FOREACH item IN ARRAY ARRAY[
    'public.game_reward_state_json(uuid)', 'public.claim_my_game_reward(text)', 'public.get_my_game_rewards()',
    'public.sync_my_game_achievements()', 'public.set_my_game_badge(text)', 'public.get_my_points_mall()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', item);
  END LOOP;
END
$revoke_stage6_service$;

-- ---------------------------------------------------------------------------
-- 自我檢查
-- ---------------------------------------------------------------------------

DO $stage6_batch2_self_check$
DECLARE
  claim_def text := pg_get_functiondef('public.claim_my_game_reward(text)'::regprocedure);
  sync_def text := pg_get_functiondef('public.sync_my_game_achievements()'::regprocedure);
  mall_def text := pg_get_functiondef('public.get_my_points_mall()'::regprocedure);
  p record;
BEGIN
  SELECT * INTO p FROM public.game_reward_period('daily', '2026-10-25 16:00:00+00');
  IF p.period_key <> DATE '2026-10-26' OR p.ends_at <> '2026-10-26 16:00:00+00'::timestamptz THEN
    RAISE EXCEPTION '台北每日界線不對';
  END IF;
  SELECT * INTO p FROM public.game_reward_period('weekly', '2026-11-01 15:59:59+00');
  IF p.period_key <> DATE '2026-10-26' OR p.starts_at <> '2026-10-25 16:00:00+00'::timestamptz OR p.ends_at <> '2026-11-01 16:00:00+00'::timestamptz THEN
    RAISE EXCEPTION '台北週日深夜仍屬於本週';
  END IF;
  SELECT * INTO p FROM public.game_reward_period('weekly', '2026-11-01 16:00:00+00');
  IF p.period_key <> DATE '2026-11-02' THEN
    RAISE EXCEPTION '台北週一 00:00 應換週';
  END IF;
  IF position('post_member_reward' IN claim_def) > 0
     OR position('member_point_entries' IN claim_def) > 0
     OR position('member_point_accounts' IN claim_def) > 0
     OR position('public.reward_claims' IN claim_def) > 0 THEN
    RAISE EXCEPTION '遊戲領取不能寫入點數帳本';
  END IF;
  IF position('post_member_reward' IN sync_def) > 0 OR position('member_perk_holds' IN sync_def) > 0 THEN
    RAISE EXCEPTION '成就同步不能發點或偽造虛擬特權收藏';
  END IF;
  IF position('INSERT' IN mall_def) > 0 OR position('UPDATE' IN mall_def) > 0 THEN
    RAISE EXCEPTION '點數商城總覽只能讀取';
  END IF;
  BEGIN
    UPDATE public.game_reward_policies SET payout_enabled = true WHERE id = 'stage6';
    RAISE EXCEPTION 'payout lock failed open';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  IF has_function_privilege('anon', 'public.claim_my_game_reward(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.game_reward_state_json(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.game_reward_metric(uuid, text, timestamptz, timestamptz)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.member_game_reward_claims', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_game_achievements', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_game_showcase', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.game_reward_tasks', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'public.claim_my_game_reward(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.public_game_badges(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '第六階段獎勵權限不正確';
  END IF;
END
$stage6_batch2_self_check$;

COMMIT;
