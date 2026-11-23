-- =============================================================================
-- 第四、第五階段第三批刮刮卡與註冊邀請預演
-- 與正式 migration 的本文必須相同。整份在同一個交易內，結尾 ROLLBACK。
-- 不會留下刮卡、點數或邀請。不會建立會員，也不會改寫已提交的帳本。
-- =============================================================================

BEGIN;

-- scratch-batch-body-start

DO $require_scratch_batch$
BEGIN
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION '第三批需要已套用的第一批 post_member_reward';
  END IF;
  IF to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '第三批需要已套用的台北日函式';
  END IF;
  IF to_regprocedure('public.claim_my_daily_checkin()') IS NULL
     OR to_regprocedure('public.get_my_checkin_state()') IS NULL THEN
    RAISE EXCEPTION '第三批需要已套用的第二批每日簽到';
  END IF;
  IF pg_get_function_identity_arguments('public.claim_my_daily_checkin()'::regprocedure) <> '' THEN
    RAISE EXCEPTION '既有簽到入口不應被加上參數';
  END IF;
END
$require_scratch_batch$;

CREATE TABLE IF NOT EXISTS public.scratch_plays (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  taipei_day date NOT NULL,
  slot smallint NOT NULL,
  claim_key text NOT NULL,
  outcome_kind text NOT NULL,
  points integer NOT NULL,
  revealed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT scratch_plays_slot_check CHECK (slot IN (1, 2)),
  CONSTRAINT scratch_plays_kind_check CHECK (
    outcome_kind IN ('points', 'none', 'coupon_fallback', 'founder_fallback')
  ),
  CONSTRAINT scratch_plays_points_check CHECK (points IN (3, 10, 15, 20, 30, 50)),
  CONSTRAINT scratch_plays_claim_key_check CHECK (
    claim_key ~ '^scratch:[0-9]{4}-[0-9]{2}-[0-9]{2}:slot:[12]$'
  ),
  CONSTRAINT scratch_plays_user_day_slot UNIQUE (user_id, taipei_day, slot),
  CONSTRAINT scratch_plays_user_claim UNIQUE (user_id, claim_key)
);

COMMENT ON TABLE public.scratch_plays IS
  '刮卡開獎結果。點數另寫入第一批帳本。會員不能直接讀寫。';

CREATE TABLE IF NOT EXISTS public.member_invite_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_invite_codes_code_check CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  CONSTRAINT member_invite_codes_code_key UNIQUE (code)
);

COMMENT ON TABLE public.member_invite_codes IS
  '會員自己的邀請碼。不發點數。';

CREATE TABLE IF NOT EXISTS public.member_signup_invites (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_signup_invites_code_check CHECK (code ~ '^[A-Z0-9]{8}$')
);

COMMENT ON TABLE public.member_signup_invites IS
  '註冊當下留下的邀請碼。之後改會員資料不會覆寫。點開連結不會寫入這裡。';

CREATE TABLE IF NOT EXISTS public.member_invite_redemptions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  inviter_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  invitee_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  code text NOT NULL,
  taipei_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_invite_redemptions_not_self CHECK (inviter_user_id <> invitee_user_id),
  CONSTRAINT member_invite_redemptions_invitee_once UNIQUE (invitee_user_id)
);

COMMENT ON TABLE public.member_invite_redemptions IS
  '一位新會員只能成立一次邀請，而且不能邀請自己。';

CREATE TABLE IF NOT EXISTS public.member_invite_daily_bonus (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  taipei_day date NOT NULL,
  redemption_id uuid NOT NULL REFERENCES public.member_invite_redemptions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_invite_daily_bonus_pk PRIMARY KEY (user_id, taipei_day),
  CONSTRAINT member_invite_daily_bonus_redemption_once UNIQUE (redemption_id)
);

COMMENT ON TABLE public.member_invite_daily_bonus IS
  '邀請加碼只在註冊完成當天有效。同一天多位朋友也只加 1 次，隔天不作廢後補發。';

CREATE OR REPLACE FUNCTION public.guard_scratch_play_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.taipei_day IS DISTINCT FROM OLD.taipei_day
     OR NEW.slot IS DISTINCT FROM OLD.slot
     OR NEW.claim_key IS DISTINCT FROM OLD.claim_key
     OR NEW.outcome_kind IS DISTINCT FROM OLD.outcome_kind
     OR NEW.points IS DISTINCT FROM OLD.points
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id
     OR OLD.revealed_at IS NOT NULL
     OR NEW.revealed_at IS NULL THEN
    RAISE EXCEPTION '刮卡結果不可改寫';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scratch_plays_guard_update ON public.scratch_plays;
CREATE TRIGGER scratch_plays_guard_update
  BEFORE UPDATE ON public.scratch_plays
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_scratch_play_update();

CREATE OR REPLACE FUNCTION public.reject_scratch_play_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '刮卡結果不可刪除';
END;
$$;

DROP TRIGGER IF EXISTS scratch_plays_reject_delete ON public.scratch_plays;
CREATE TRIGGER scratch_plays_reject_delete
  BEFORE DELETE ON public.scratch_plays
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_scratch_play_delete();

CREATE OR REPLACE FUNCTION public.scratch_award_from_units(p_kind_bp integer, p_point_bp integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  points integer;
  kind text;
BEGIN
  IF p_kind_bp IS NULL OR p_point_bp IS NULL
     OR p_kind_bp < 0 OR p_kind_bp > 9999
     OR p_point_bp < 0 OR p_point_bp > 9999 THEN
    RAISE EXCEPTION '刮卡隨機數不在可接受範圍';
  END IF;

  IF p_kind_bp < 2500 THEN
    kind := 'coupon_fallback';
    points := 20;
  ELSIF p_kind_bp < 9000 THEN
    kind := 'points';
    IF p_point_bp < 4000 THEN
      points := 10;
    ELSIF p_point_bp < 7000 THEN
      points := 15;
    ELSIF p_point_bp < 8800 THEN
      points := 20;
    ELSIF p_point_bp < 9700 THEN
      points := 30;
    ELSE
      points := 50;
    END IF;
  ELSIF p_kind_bp < 9500 THEN
    kind := 'founder_fallback';
    points := 30;
  ELSE
    kind := 'none';
    points := 3;
  END IF;

  RETURN pg_catalog.jsonb_build_object('outcomeKind', kind, 'points', points);
END;
$$;

COMMENT ON FUNCTION public.scratch_award_from_units(integer, integer) IS
  '刮卡機率。一般券與創始券在正式券池完成前改發 20 與 30 點。不發券，不讀庫存。';

CREATE OR REPLACE FUNCTION public.make_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  made text := '';
  i integer;
BEGIN
  FOR i IN 1..8 LOOP
    made := made || pg_catalog.substr(alphabet, 1 + pg_catalog.floor(pg_catalog.random() * pg_catalog.length(alphabet))::integer, 1);
  END LOOP;
  RETURN made;
END;
$$;

COMMENT ON FUNCTION public.make_invite_code() IS
  '產生邀請碼。不發點數，也不讀進站紀錄。';

CREATE OR REPLACE FUNCTION public.capture_signup_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  raw text;
BEGIN
  BEGIN
    raw := pg_catalog.upper(pg_catalog.btrim(coalesce(NEW.raw_user_meta_data->>'invite_code', '')));
    IF raw ~ '^[A-Z0-9]{8}$' THEN
      INSERT INTO public.member_signup_invites (user_id, code)
      VALUES (NEW.id, raw)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'capture_signup_invite skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.capture_signup_invite() IS
  '只在新會員建立時留下邀請碼。失敗也不阻擋註冊。不發點數。';

DROP TRIGGER IF EXISTS capture_signup_invite ON auth.users;
CREATE TRIGGER capture_signup_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_signup_invite();

CREATE OR REPLACE FUNCTION public.build_my_scratch_state(
  p_user_id uuid,
  p_replayed boolean,
  p_awarded integer,
  p_card_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  bal integer := 0;
  used integer := 0;
  bonus boolean := false;
  total integer;
  card jsonb := NULL;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  SELECT balance
  INTO bal
  FROM public.member_point_accounts
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    bal := 0;
  END IF;

  SELECT count(*)::integer
  INTO used
  FROM public.scratch_plays
  WHERE user_id = p_user_id
    AND taipei_day = day;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_invite_daily_bonus
    WHERE user_id = p_user_id
      AND taipei_day = day
  )
  INTO bonus;

  total := CASE WHEN bonus THEN 2 ELSE 1 END;

  SELECT pg_catalog.jsonb_build_object(
    'id', play.id,
    'slot', play.slot,
    'outcomeKind', play.outcome_kind,
    'points', play.points,
    'revealed', play.revealed_at IS NOT NULL
  )
  INTO card
  FROM public.scratch_plays AS play
  WHERE play.user_id = p_user_id
    AND play.taipei_day = day
    AND (
      (p_card_id IS NOT NULL AND play.id = p_card_id)
      OR (
        p_card_id IS NULL
        AND (
          play.revealed_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.scratch_plays AS pending
            WHERE pending.user_id = p_user_id
              AND pending.taipei_day = day
              AND pending.revealed_at IS NULL
          )
        )
      )
    )
  ORDER BY
    CASE WHEN play.revealed_at IS NULL THEN 0 ELSE 1 END,
    play.slot DESC
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'balance', bal,
    'taipeiDay', pg_catalog.to_char(day, 'YYYY-MM-DD'),
    'baseChances', 1,
    'bonusChances', CASE WHEN bonus THEN 1 ELSE 0 END,
    'chancesTotal', total,
    'used', used,
    'chancesLeft', CASE WHEN total > used THEN total - used ELSE 0 END,
    'inviteBonusToday', bonus,
    'replayed', coalesce(p_replayed, false),
    'awardedDelta', p_awarded,
    'card', card
  );
END;
$$;

COMMENT ON FUNCTION public.build_my_scratch_state(uuid, boolean, integer, uuid) IS
  '組出一位會員的今日刮卡狀態。不授權給 API。入口只傳 auth.uid()。';

CREATE OR REPLACE FUNCTION public.post_member_reward(
  p_user_id uuid,
  p_kind text,
  p_claim_key text,
  p_delta integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date;
  account public.member_point_accounts%ROWTYPE;
  existing_claim public.reward_claims%ROWTYPE;
  entry_id uuid;
  claim_id uuid;
  next_balance integer;
  play_points integer;
BEGIN
  IF current_setting('app.reward_post', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '發獎只能由資料庫內部交易呼叫';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION '獎勵附註必須是物件';
  END IF;
  IF octet_length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION '獎勵附註過長';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock') THEN
    RAISE EXCEPTION '尚未開放這個獎勵來源';
  END IF;

  day := public.taipei_today();

  IF p_kind = 'checkin' THEN
    IF p_claim_key IS DISTINCT FROM ('checkin:' || to_char(day, 'YYYY-MM-DD')) THEN
      RAISE EXCEPTION '簽到領獎鍵必須使用資料庫台北日';
    END IF;
    IF p_delta IS NULL OR p_delta NOT IN (10, 15, 20, 50) THEN
      RAISE EXCEPTION '簽到點數必須是已確認的 10、15、20 或 50';
    END IF;
  ELSIF p_kind = 'scratch' THEN
    IF p_claim_key IS DISTINCT FROM ('scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:1')
       AND p_claim_key IS DISTINCT FROM ('scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:2') THEN
      RAISE EXCEPTION '刮卡領獎鍵必須使用資料庫台北日與次數槽';
    END IF;
    IF p_delta IS NULL OR p_delta NOT IN (3, 10, 15, 20, 30, 50) THEN
      RAISE EXCEPTION '刮卡點數不在已確認的獎項';
    END IF;
    IF p_claim_key = ('scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:2')
       AND NOT EXISTS (
         SELECT 1
         FROM public.member_invite_daily_bonus
         WHERE user_id = p_user_id
           AND taipei_day = day
       ) THEN
      RAISE EXCEPTION '邀請加碼次數尚未成立';
    END IF;
  ELSE
    RAISE EXCEPTION '這個獎勵來源尚未開放入帳';
  END IF;

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account
  FROM public.member_point_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  IF p_kind = 'scratch' THEN
    SELECT points
    INTO play_points
    FROM public.scratch_plays
    WHERE user_id = p_user_id
      AND claim_key = p_claim_key;
    IF play_points IS NULL OR play_points IS DISTINCT FROM p_delta THEN
      RAISE EXCEPTION '刮卡領獎必須與已鎖定的開獎結果一致';
    END IF;
  END IF;

  SELECT *
  INTO existing_claim
  FROM public.reward_claims
  WHERE user_id = p_user_id
    AND claim_key = p_claim_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_claim.kind IS DISTINCT FROM p_kind OR existing_claim.delta IS DISTINCT FROM p_delta THEN
      RAISE EXCEPTION '同一領獎鍵不可改寫來源或點數';
    END IF;
    RETURN jsonb_build_object(
      'replayed', true,
      'claimId', existing_claim.id,
      'pointEntryId', existing_claim.point_entry_id,
      'delta', existing_claim.delta,
      'balanceAfter', existing_claim.balance_after,
      'currentBalance', account.balance,
      'taipeiDay', existing_claim.taipei_day,
      'kind', existing_claim.kind,
      'claimKey', existing_claim.claim_key
    );
  END IF;

  IF p_kind = 'checkin' AND EXISTS (
    SELECT 1
    FROM public.reward_claims
    WHERE user_id = p_user_id
      AND kind = 'checkin'
      AND taipei_day = day
      AND claim_key IS DISTINCT FROM p_claim_key
  ) THEN
    RAISE EXCEPTION '同一天不能重複簽到';
  END IF;

  next_balance := account.balance + p_delta;
  IF next_balance < 0 THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    p_user_id, p_delta, next_balance, p_kind, p_claim_key, day, p_metadata
  )
  RETURNING id INTO entry_id;

  UPDATE public.member_point_accounts
  SET balance = next_balance,
      updated_at = pg_catalog.now()
  WHERE user_id = p_user_id;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    p_user_id, p_kind, p_claim_key, day, p_delta, next_balance, entry_id, p_metadata
  )
  RETURNING id INTO claim_id;

  RETURN jsonb_build_object(
    'replayed', false,
    'claimId', claim_id,
    'pointEntryId', entry_id,
    'delta', p_delta,
    'balanceAfter', next_balance,
    'currentBalance', next_balance,
    'taipeiDay', day,
    'kind', p_kind,
    'claimKey', p_claim_key
  );
END;
$$;

COMMENT ON FUNCTION public.post_member_reward(uuid, text, text, integer, jsonb) IS
  '內部發獎。簽到規則維持原狀。刮卡只接受當日兩個次數槽，而且點數必須與已鎖定的開獎結果相同。不對 API 角色開放。';

CREATE OR REPLACE FUNCTION public.get_my_scratch_state()
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
  RETURN public.build_my_scratch_state(uid, false, NULL, NULL);
END;
$$;

COMMENT ON FUNCTION public.get_my_scratch_state() IS
  '登入會員讀取自己的今日刮卡次數、未揭曉結果與點數餘額。不開獎，也不發點。';

CREATE OR REPLACE FUNCTION public.draw_my_scratch_card()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  locked uuid;
  existing public.scratch_plays%ROWTYPE;
  award jsonb;
  slot integer;
  points integer;
  kind text;
  claim_key text;
  play_id uuid;
  posted jsonb;
  bonus boolean := false;
  used integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-scratch:' || uid::text, 0));

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT user_id
  INTO locked
  FROM public.member_point_accounts
  WHERE user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  day := public.taipei_today();

  SELECT *
  INTO existing
  FROM public.scratch_plays
  WHERE user_id = uid
    AND taipei_day = day
    AND revealed_at IS NULL
  ORDER BY slot
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    PERFORM set_config('app.reward_post', 'on', true);
    posted := public.post_member_reward(
      uid,
      'scratch',
      existing.claim_key,
      existing.points,
      jsonb_build_object('outcomeKind', existing.outcome_kind, 'slot', existing.slot)
    );
    IF (posted->>'delta')::integer IS DISTINCT FROM existing.points THEN
      RAISE EXCEPTION '刮卡沒有成功，點數沒有增加';
    END IF;
    RETURN public.build_my_scratch_state(
      uid,
      true,
      NULL,
      existing.id
    );
  END IF;

  SELECT count(*)::integer
  INTO used
  FROM public.scratch_plays
  WHERE user_id = uid
    AND taipei_day = day;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_invite_daily_bonus
    WHERE user_id = uid
      AND taipei_day = day
  )
  INTO bonus;

  IF used >= (CASE WHEN bonus THEN 2 ELSE 1 END) THEN
    RAISE EXCEPTION '今日刮卡次數已用完';
  END IF;

  slot := used + 1;
  IF slot = 2 AND bonus IS DISTINCT FROM true THEN
    RAISE EXCEPTION '邀請加碼次數尚未成立';
  END IF;
  IF slot NOT IN (1, 2) THEN
    RAISE EXCEPTION '今日刮卡次數已用完';
  END IF;

  award := public.scratch_award_from_units(
    least(9999, floor(pg_catalog.random() * 10000)::integer),
    least(9999, floor(pg_catalog.random() * 10000)::integer)
  );
  kind := award->>'outcomeKind';
  points := (award->>'points')::integer;
  claim_key := 'scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:' || slot::text;

  INSERT INTO public.scratch_plays (
    user_id, taipei_day, slot, claim_key, outcome_kind, points
  )
  VALUES (
    uid, day, slot, claim_key, kind, points
  )
  RETURNING id INTO play_id;

  PERFORM set_config('app.reward_post', 'on', true);
  posted := public.post_member_reward(
    uid,
    'scratch',
    claim_key,
    points,
    jsonb_build_object('outcomeKind', kind, 'slot', slot)
  );

  IF (posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (posted->>'delta')::integer IS DISTINCT FROM points
     OR (posted->>'currentBalance')::integer IS DISTINCT FROM (
       SELECT balance FROM public.member_point_accounts WHERE user_id = uid
     ) THEN
    RAISE EXCEPTION '刮卡沒有成功，點數沒有增加';
  END IF;

  RETURN public.build_my_scratch_state(uid, false, points, play_id);
END;
$$;

COMMENT ON FUNCTION public.draw_my_scratch_card() IS
  '登入會員刮一張。沒有參數。結果、次數與點數都在這次交易決定。未揭曉的同一張會回放，不會重抽。';

CREATE OR REPLACE FUNCTION public.reveal_my_scratch_card()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  play_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-scratch:' || uid::text, 0));
  day := public.taipei_today();

  SELECT id
  INTO play_id
  FROM public.scratch_plays
  WHERE user_id = uid
    AND taipei_day = day
    AND revealed_at IS NULL
  ORDER BY slot
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT id
    INTO play_id
    FROM public.scratch_plays
    WHERE user_id = uid
      AND taipei_day = day
    ORDER BY slot DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION '目前沒有可揭曉的刮卡';
    END IF;
    RETURN public.build_my_scratch_state(uid, true, NULL, play_id);
  END IF;

  UPDATE public.scratch_plays
  SET revealed_at = pg_catalog.now()
  WHERE id = play_id
    AND user_id = uid
    AND revealed_at IS NULL;

  RETURN public.build_my_scratch_state(uid, false, NULL, play_id);
END;
$$;

COMMENT ON FUNCTION public.reveal_my_scratch_card() IS
  '把今天尚未揭曉的刮卡標成已看過。不發點，也不改開獎結果。';

CREATE OR REPLACE FUNCTION public.get_my_invite_status()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  existing text;
  candidate text;
  i integer;
  bonus boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-invite:' || uid::text, 0));
  day := public.taipei_today();

  SELECT code
  INTO existing
  FROM public.member_invite_codes
  WHERE user_id = uid;

  IF existing IS NULL THEN
    FOR i IN 1..8 LOOP
      candidate := public.make_invite_code();
      BEGIN
        INSERT INTO public.member_invite_codes (user_id, code)
        VALUES (uid, candidate);
        existing := candidate;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT code
          INTO existing
          FROM public.member_invite_codes
          WHERE user_id = uid;
          IF existing IS NOT NULL THEN
            EXIT;
          END IF;
      END;
    END LOOP;
  END IF;

  IF existing IS NULL THEN
    RAISE EXCEPTION '邀請碼暫時無法產生';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_invite_daily_bonus
    WHERE user_id = uid
      AND taipei_day = day
  )
  INTO bonus;

  RETURN pg_catalog.jsonb_build_object(
    'code', existing,
    'inviteBonusToday', bonus
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_invite_status() IS
  '讀取或建立自己的邀請碼，以及今天是否已有註冊加碼。不發點。';

CREATE OR REPLACE FUNCTION public.settle_my_signup_invite()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  ready boolean := false;
  raw text;
  inviter uuid;
  redemption uuid;
  bonus_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-invite-settle', 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-invite:' || uid::text, 0));
  day := public.taipei_today();

  SELECT email_confirmed_at IS NOT NULL
  INTO ready
  FROM auth.users
  WHERE id = uid;

  IF ready IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object(
      'settled', false,
      'replayed', false,
      'reason', 'registration_incomplete',
      'bonusGranted', false
    );
  END IF;

  SELECT code
  INTO raw
  FROM public.member_signup_invites
  WHERE user_id = uid;

  IF raw IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'settled', false,
      'replayed', false,
      'reason', 'no_signup_invite',
      'bonusGranted', false
    );
  END IF;

  SELECT id
  INTO redemption
  FROM public.member_invite_redemptions
  WHERE invitee_user_id = uid;

  IF redemption IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'settled', true,
      'replayed', true,
      'reason', NULL,
      'bonusGranted', false
    );
  END IF;

  SELECT user_id
  INTO inviter
  FROM public.member_invite_codes
  WHERE code = raw;

  IF inviter IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'settled', false,
      'replayed', false,
      'reason', 'invalid_code',
      'bonusGranted', false
    );
  END IF;

  IF inviter = uid THEN
    RETURN pg_catalog.jsonb_build_object(
      'settled', false,
      'replayed', false,
      'reason', 'self_invite',
      'bonusGranted', false
    );
  END IF;

  INSERT INTO public.member_invite_redemptions (
    inviter_user_id, invitee_user_id, code, taipei_day
  )
  VALUES (
    inviter, uid, raw, day
  )
  RETURNING id INTO redemption;

  INSERT INTO public.member_invite_daily_bonus (user_id, taipei_day, redemption_id)
  VALUES (inviter, day, redemption)
  ON CONFLICT (user_id, taipei_day) DO NOTHING
  RETURNING redemption_id INTO bonus_id;

  RETURN pg_catalog.jsonb_build_object(
    'settled', true,
    'replayed', false,
    'reason', NULL,
    'bonusGranted', bonus_id IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.settle_my_signup_invite() IS
  '受邀者登入後結算註冊邀請。不接受邀請碼參數。只在信箱已驗證、不是自己、且這位會員尚未被邀請過時成立。邀請人當天最多加 1 次刮卡，不發點。';

ALTER TABLE public.scratch_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_signup_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_invite_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_invite_daily_bonus ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scratch_plays FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_invite_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_signup_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_invite_redemptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_invite_daily_bonus FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.guard_scratch_play_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_scratch_play_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scratch_award_from_units(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.make_invite_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_signup_invite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_my_scratch_state(uuid, boolean, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_member_reward(uuid, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_scratch_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.draw_my_scratch_card() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reveal_my_scratch_card() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_invite_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_my_signup_invite() FROM PUBLIC, anon, authenticated;

DO $revoke_scratch_service$
DECLARE
  fn text;
  rel text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  FOREACH rel IN ARRAY ARRAY[
    'public.scratch_plays',
    'public.member_invite_codes',
    'public.member_signup_invites',
    'public.member_invite_redemptions',
    'public.member_invite_daily_bonus'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM service_role', rel);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.guard_scratch_play_update()',
    'public.reject_scratch_play_delete()',
    'public.scratch_award_from_units(integer, integer)',
    'public.make_invite_code()',
    'public.capture_signup_invite()',
    'public.build_my_scratch_state(uuid, boolean, integer, uuid)',
    'public.post_member_reward(uuid, text, text, integer, jsonb)',
    'public.get_my_scratch_state()',
    'public.draw_my_scratch_card()',
    'public.reveal_my_scratch_card()',
    'public.get_my_invite_status()',
    'public.settle_my_signup_invite()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', fn);
  END LOOP;
END
$revoke_scratch_service$;

GRANT EXECUTE ON FUNCTION public.get_my_scratch_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.draw_my_scratch_card() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_my_scratch_card() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_invite_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_my_signup_invite() TO authenticated;

DO $scratch_batch_check$
DECLARE
  award jsonb;
  post_def text := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  draw_def text := pg_get_functiondef('public.draw_my_scratch_card()'::regprocedure);
  reveal_def text := pg_get_functiondef('public.reveal_my_scratch_card()'::regprocedure);
  settle_def text := pg_get_functiondef('public.settle_my_signup_invite()'::regprocedure);
  checkin_def text := pg_get_functiondef('public.claim_my_daily_checkin()'::regprocedure);
  actor text;
  fn text;
  rel text;
  priv text;
  actors text[] := ARRAY['anon', 'authenticated'];
  entrypoints text[] := ARRAY[
    'public.get_my_scratch_state()',
    'public.draw_my_scratch_card()',
    'public.reveal_my_scratch_card()',
    'public.get_my_invite_status()',
    'public.settle_my_signup_invite()'
  ];
  hidden text[] := ARRAY[
    'public.scratch_award_from_units(integer, integer)',
    'public.make_invite_code()',
    'public.capture_signup_invite()',
    'public.build_my_scratch_state(uuid, boolean, integer, uuid)',
    'public.post_member_reward(uuid, text, text, integer, jsonb)'
  ];
BEGIN
  IF public.taipei_today('2026-10-22 15:59:59+00'::timestamptz) <> DATE '2026-10-22'
     OR public.taipei_today('2026-10-22 16:00:00+00'::timestamptz) <> DATE '2026-10-23' THEN
    RAISE EXCEPTION '台北日換日基準不應被改掉';
  END IF;

  award := public.scratch_award_from_units(0, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '0 到 2499 必須是一般券替代 20 點';
  END IF;
  award := public.scratch_award_from_units(2499, 9700);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '2499 仍必須是一般券替代 20 點';
  END IF;
  award := public.scratch_award_from_units(2500, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'points' OR (award->>'points')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '點數權重起點必須是 10 點';
  END IF;
  award := public.scratch_award_from_units(2500, 3999);
  IF (award->>'points')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '3999 仍必須是 10 點';
  END IF;
  award := public.scratch_award_from_units(8999, 4000);
  IF award->>'outcomeKind' IS DISTINCT FROM 'points' OR (award->>'points')::integer IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION '4000 必須是 15 點';
  END IF;
  award := public.scratch_award_from_units(2500, 6999);
  IF (award->>'points')::integer IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION '6999 仍必須是 15 點';
  END IF;
  award := public.scratch_award_from_units(2500, 7000);
  IF (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '7000 必須是 20 點';
  END IF;
  award := public.scratch_award_from_units(2500, 8799);
  IF (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '8799 仍必須是 20 點';
  END IF;
  award := public.scratch_award_from_units(2500, 8800);
  IF (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '8800 必須是 30 點';
  END IF;
  award := public.scratch_award_from_units(2500, 9699);
  IF (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '9699 仍必須是 30 點';
  END IF;
  award := public.scratch_award_from_units(2500, 9700);
  IF award->>'outcomeKind' IS DISTINCT FROM 'points' OR (award->>'points')::integer IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION '9700 必須是 50 點';
  END IF;
  award := public.scratch_award_from_units(9000, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '9000 必須是創始券替代 30 點';
  END IF;
  award := public.scratch_award_from_units(9499, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '9499 仍必須是創始券替代 30 點';
  END IF;
  award := public.scratch_award_from_units(9500, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'none' OR (award->>'points')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '9500 必須是保底 3 點';
  END IF;
  award := public.scratch_award_from_units(9999, 9999);
  IF award->>'outcomeKind' IS DISTINCT FROM 'none' OR (award->>'points')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '9999 仍必須是保底 3 點';
  END IF;

  BEGIN
    PERFORM public.scratch_award_from_units(10000, 0);
    RAISE EXCEPTION '超過範圍的隨機數必須拒絕';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('刮卡隨機數不在可接受範圍' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION '隨機數拒絕訊息不正確：%', SQLERRM;
      END IF;
  END;

  IF position('p_delta NOT IN (10, 15, 20, 50)' IN post_def) = 0
     OR position('簽到點數必須是已確認的 10、15、20 或 50' IN post_def) = 0
     OR position('同一天不能重複簽到' IN post_def) = 0 THEN
    RAISE EXCEPTION '簽到入帳規則必須維持原狀';
  END IF;
  IF position('p_delta NOT IN (3, 10, 15, 20, 30, 50)' IN post_def) = 0
     OR position('刮卡點數不在已確認的獎項' IN post_def) = 0
     OR position('邀請加碼次數尚未成立' IN post_def) = 0
     OR position('刮卡領獎必須與已鎖定的開獎結果一致' IN post_def) = 0 THEN
    RAISE EXCEPTION '刮卡入帳規則不完整';
  END IF;
  IF position('這個獎勵來源尚未開放入帳' IN post_def) = 0 THEN
    RAISE EXCEPTION '優惠券兌換與虛擬道具仍必須關閉';
  END IF;
  IF position('FOR UPDATE' IN post_def) = 0 OR position('app.reward_post' IN post_def) = 0 THEN
    RAISE EXCEPTION '發獎必須維持內部旗標與帳戶鎖';
  END IF;

  IF pg_get_function_identity_arguments('public.draw_my_scratch_card()'::regprocedure) <> ''
     OR pg_get_function_identity_arguments('public.reveal_my_scratch_card()'::regprocedure) <> ''
     OR pg_get_function_identity_arguments('public.get_my_scratch_state()'::regprocedure) <> ''
     OR pg_get_function_identity_arguments('public.settle_my_signup_invite()'::regprocedure) <> ''
     OR pg_get_function_identity_arguments('public.get_my_invite_status()'::regprocedure) <> '' THEN
    RAISE EXCEPTION '刮卡與邀請入口不能接受參數';
  END IF;
  IF position('auth.uid()' IN draw_def) = 0
     OR position('public.taipei_today()' IN draw_def) = 0
     OR position('pg_advisory_xact_lock' IN draw_def) = 0
     OR position('FOR UPDATE' IN draw_def) = 0
     OR position('app.reward_post' IN draw_def) = 0
     OR position('public.post_member_reward(' IN draw_def) = 0
     OR position('public.scratch_award_from_units(' IN draw_def) = 0 THEN
    RAISE EXCEPTION '刮卡必須由資料庫開獎、上鎖並呼叫內部發獎';
  END IF;
  IF position('p_delta' IN draw_def) > 0 OR position('p_user_id' IN draw_def) > 0 OR position('p_today' IN draw_def) > 0 THEN
    RAISE EXCEPTION '刮卡入口不能接受會員、點數或日期';
  END IF;
  IF position('public.post_member_reward(' IN reveal_def) > 0 THEN
    RAISE EXCEPTION '揭曉不能再發點';
  END IF;
  IF position('auth.uid()' IN settle_def) = 0
     OR position('email_confirmed_at' IN settle_def) = 0
     OR position('self_invite' IN settle_def) = 0
     OR position('registration_incomplete' IN settle_def) = 0
     OR position('no_signup_invite' IN settle_def) = 0 THEN
    RAISE EXCEPTION '邀請結算必須確認已驗證的註冊，並拒絕自己邀請自己';
  END IF;
  IF position('p_code' IN settle_def) > 0 OR position('post_member_reward' IN settle_def) > 0 THEN
    RAISE EXCEPTION '邀請結算不能接收邀請碼，也不能直接發點';
  END IF;
  IF position('ARRAY[10, 10, 15, 15, 20, 20, 50]' IN pg_get_functiondef('public.checkin_cycle_from_days(date[], date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '七日簽到金額必須維持原狀';
  END IF;
  IF position('auth.uid()' IN checkin_def) = 0 OR position('public.post_member_reward(' IN checkin_def) = 0 THEN
    RAISE EXCEPTION '既有簽到入口必須保留';
  END IF;
  IF position('INSERT INTO public.coupons' IN draw_def) > 0
     OR position('INSERT INTO public.coupon' IN draw_def) > 0
     OR position('wallet' IN draw_def) > 0 THEN
    RAISE EXCEPTION '刮卡不能建立優惠券';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'capture_signup_invite'
      AND tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '註冊邀請必須在新會員建立時留下';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    actors := array_append(actors, 'service_role');
  END IF;

  FOREACH fn IN ARRAY entrypoints LOOP
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '登入會員應能呼叫 %', fn;
    END IF;
    FOREACH actor IN ARRAY actors LOOP
      IF actor <> 'authenticated' AND has_function_privilege(actor, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% 不應能呼叫 %', actor, fn;
      END IF;
    END LOOP;
  END LOOP;

  IF has_function_privilege('anon', 'public.get_my_scratch_state()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.draw_my_scratch_card()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.settle_my_signup_invite()', 'EXECUTE') THEN
    RAISE EXCEPTION '匿名角色不能刮卡或結算邀請';
  END IF;

  FOREACH fn IN ARRAY hidden LOOP
    FOREACH actor IN ARRAY actors LOOP
      IF has_function_privilege(actor, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% 不應能執行 %', actor, fn;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH rel IN ARRAY ARRAY[
    'public.scratch_plays',
    'public.member_invite_codes',
    'public.member_signup_invites',
    'public.member_invite_redemptions',
    'public.member_invite_daily_bonus',
    'public.reward_claims',
    'public.member_point_entries',
    'public.member_point_accounts'
  ]
  LOOP
    FOREACH actor IN ARRAY actors LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(actor, rel, priv) THEN
          RAISE EXCEPTION '% 不應能對 % 執行 %', actor, rel, priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.claim_my_daily_checkin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_checkin_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '登入會員應仍能簽到並讀取簽到狀態';
  END IF;
END
$scratch_batch_check$;

-- scratch-batch-body-end

-- 以下只在預演交易內刮卡與結算邀請。最後會 ROLLBACK。不建立會員，也不保留點數或邀請。

DO $scratch_preview_setup$
DECLARE
  inviter uuid;
  invitee uuid;
  old_inviter integer;
  old_invitee integer;
  others text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '預演開始時不應已是 API 角色。交易會回復。';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL) < 2 THEN
    RAISE EXCEPTION '預演停止：至少需要兩位已完成信箱驗證的既有會員。交易會回復，不會建立會員。';
  END IF;

  SELECT u.id
  INTO inviter
  FROM auth.users AS u
  WHERE u.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.scratch_plays AS play
      WHERE play.user_id = u.id
        AND play.taipei_day = public.taipei_today()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_invite_redemptions AS redemption
      WHERE redemption.invitee_user_id = u.id
    )
  ORDER BY u.id
  LIMIT 1;

  IF inviter IS NULL THEN
    RAISE EXCEPTION '預演停止：找不到今天還沒有刮卡紀錄的已驗證會員。不會改寫現有刮卡。交易會回復。';
  END IF;

  SELECT u.id
  INTO invitee
  FROM auth.users AS u
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.id <> inviter
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_invite_redemptions AS redemption
      WHERE redemption.invitee_user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_signup_invites AS signup
      WHERE signup.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.scratch_plays AS play
      WHERE play.user_id = u.id
        AND play.taipei_day = public.taipei_today()
    )
  ORDER BY u.id
  LIMIT 1;

  IF invitee IS NULL THEN
    RAISE EXCEPTION '預演停止：找不到尚未綁定邀請的第二位已驗證會員。不會改寫現有邀請。交易會回復。';
  END IF;

  SELECT coalesce(balance, 0)
  INTO old_inviter
  FROM public.member_point_accounts
  WHERE user_id = inviter;
  IF NOT FOUND THEN
    old_inviter := 0;
  END IF;

  SELECT coalesce(balance, 0)
  INTO old_invitee
  FROM public.member_point_accounts
  WHERE user_id = invitee;
  IF NOT FOUND THEN
    old_invitee := 0;
  END IF;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id::text)), 'empty')
  INTO others
  FROM public.member_point_accounts
  WHERE user_id NOT IN (inviter, invitee);

  PERFORM set_config('app.scratch_inviter', inviter::text, true);
  PERFORM set_config('app.scratch_invitee', invitee::text, true);
  PERFORM set_config('app.scratch_old_inviter', old_inviter::text, true);
  PERFORM set_config('app.scratch_old_invitee', old_invitee::text, true);
  PERFORM set_config('app.scratch_others', others, true);
  PERFORM set_config('app.scratch_day', to_char(public.taipei_today(), 'YYYY-MM-DD'), true);
  PERFORM set_config('request.jwt.claim.sub', inviter::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inviter::text, 'role', 'authenticated')::text, true);

  IF auth.uid() IS DISTINCT FROM inviter THEN
    RAISE EXCEPTION '無法模擬 auth.uid()，刮卡預演停止。交易會回復。';
  END IF;
END
$scratch_preview_setup$;

SET LOCAL ROLE authenticated;

DO $scratch_preview_inviter$
DECLARE
  uid uuid := auth.uid();
  invite jsonb;
  first jsonb;
  replay jsonb;
  revealed jsonb;
  denied_table boolean := false;
  denied_post boolean := false;
  denied_claim boolean := false;
BEGIN
  IF uid IS NULL OR uid::text IS DISTINCT FROM current_setting('app.scratch_inviter', true) THEN
    RAISE EXCEPTION '切換到一般會員後讀不到邀請人。交易會回復。';
  END IF;

  invite := public.get_my_invite_status();
  IF invite->>'code' IS NULL OR (invite->>'inviteBonusToday')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '邀請碼沒有建立，或預演開始前不應已有今日加碼';
  END IF;

  first := public.draw_my_scratch_card();
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  IF (first->>'replayed')::boolean IS DISTINCT FROM false
     OR first->>'taipeiDay' IS DISTINCT FROM current_setting('app.scratch_day', true)
     OR (first->>'baseChances')::integer IS DISTINCT FROM 1
     OR (first->>'bonusChances')::integer IS DISTINCT FROM 0
     OR (first->>'chancesTotal')::integer IS DISTINCT FROM 1
     OR (first->>'used')::integer IS DISTINCT FROM 1
     OR (first->>'chancesLeft')::integer IS DISTINCT FROM 0
     OR (first->>'inviteBonusToday')::boolean IS DISTINCT FROM false
     OR (first->'card'->>'revealed')::boolean IS DISTINCT FROM false
     OR (first->'card'->>'slot')::integer IS DISTINCT FROM 1
     OR (first->>'awardedDelta')::integer IS DISTINCT FROM (first->'card'->>'points')::integer
     OR (first->>'balance')::integer IS DISTINCT FROM current_setting('app.scratch_old_inviter', true)::integer + (first->>'awardedDelta')::integer
     OR (first->>'awardedDelta')::integer NOT IN (3, 10, 15, 20, 30, 50) THEN
    RAISE EXCEPTION '第一次刮卡沒有正常入帳';
  END IF;
  IF first->'card'->>'outcomeKind' = 'coupon_fallback' AND (first->>'awardedDelta')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '一般券替代點數不正確';
  END IF;
  IF first->'card'->>'outcomeKind' = 'founder_fallback' AND (first->>'awardedDelta')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券替代點數不正確';
  END IF;
  IF first->'card'->>'outcomeKind' = 'none' AND (first->>'awardedDelta')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '保底點數不正確';
  END IF;
  IF first->'card'->>'outcomeKind' IN ('coupon', 'founder') THEN
    RAISE EXCEPTION '正式券池未開放，不應發出優惠券';
  END IF;

  replay := public.draw_my_scratch_card();
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR replay->'card'->>'id' IS DISTINCT FROM first->'card'->>'id'
     OR (replay->>'balance')::integer IS DISTINCT FROM (first->>'balance')::integer
     OR (replay->>'used')::integer IS DISTINCT FROM 1
     OR replay->>'awardedDelta' IS NOT NULL THEN
    RAISE EXCEPTION '未揭曉前再次刮卡不能重抽或再入帳';
  END IF;

  revealed := public.reveal_my_scratch_card();
  IF (revealed->>'replayed')::boolean IS DISTINCT FROM false
     OR (revealed->'card'->>'revealed')::boolean IS DISTINCT FROM true
     OR (revealed->>'balance')::integer IS DISTINCT FROM (first->>'balance')::integer
     OR revealed->>'awardedDelta' IS NOT NULL THEN
    RAISE EXCEPTION '揭曉不應再發點';
  END IF;

  BEGIN
    PERFORM public.draw_my_scratch_card();
    RAISE EXCEPTION '沒有邀請加碼時不應刮第二次';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('今日刮卡次數已用完' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION '次數用完時的錯誤不正確：%', SQLERRM;
      END IF;
  END;

  BEGIN
    PERFORM 1 FROM public.scratch_plays;
    RAISE EXCEPTION '一般會員不應能直接讀取刮卡紀錄';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied_table := true;
  END;
  IF NOT denied_table THEN
    RAISE EXCEPTION '一般會員直接讀取刮卡紀錄時沒有被拒絕';
  END IF;

  BEGIN
    PERFORM 1 FROM public.reward_claims;
    RAISE EXCEPTION '一般會員不應能直接讀取領獎紀錄';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied_claim := true;
  END;
  IF NOT denied_claim THEN
    RAISE EXCEPTION '一般會員直接讀取 reward_claims 時沒有被拒絕';
  END IF;

  BEGIN
    PERFORM public.post_member_reward(uid, 'scratch', 'scratch:' || current_setting('app.scratch_day', true) || ':slot:1', 10, '{}'::jsonb);
    RAISE EXCEPTION '一般會員不應能直接發獎';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied_post := true;
  END;
  IF NOT denied_post THEN
    RAISE EXCEPTION '一般會員直接發獎時沒有被拒絕';
  END IF;
END
$scratch_preview_inviter$;

RESET ROLE;

DO $scratch_preview_bind$
DECLARE
  inviter uuid := current_setting('app.scratch_inviter', true)::uuid;
  invitee uuid := current_setting('app.scratch_invitee', true)::uuid;
  code text;
  first_points integer;
BEGIN
  SELECT invite_code.code, play.points
  INTO code, first_points
  FROM public.member_invite_codes AS invite_code
  JOIN public.scratch_plays AS play
    ON play.user_id = invite_code.user_id
   AND play.slot = 1
   AND play.taipei_day = current_setting('app.scratch_day', true)::date
  WHERE invite_code.user_id = inviter;

  IF code IS NULL OR code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' OR first_points IS NULL THEN
    RAISE EXCEPTION '預演沒有取得邀請碼或第一次刮卡。交易會回復。';
  END IF;
  PERFORM set_config('app.scratch_code', code, true);
  PERFORM set_config('app.scratch_first_points', first_points::text, true);

  INSERT INTO public.member_signup_invites (user_id, code)
  VALUES (invitee, code);
  PERFORM set_config('request.jwt.claim.sub', invitee::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', invitee::text, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM invitee THEN
    RAISE EXCEPTION '無法模擬受邀者。交易會回復。';
  END IF;
END
$scratch_preview_bind$;

SET LOCAL ROLE authenticated;

DO $scratch_preview_invitee$
DECLARE
  settled jsonb;
  replay jsonb;
  scratched jsonb;
BEGIN
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.scratch_invitee', true) THEN
    RAISE EXCEPTION '受邀者身份不正確。交易會回復。';
  END IF;

  settled := public.settle_my_signup_invite();
  IF (settled->>'settled')::boolean IS DISTINCT FROM true
     OR (settled->>'replayed')::boolean IS DISTINCT FROM false
     OR (settled->>'bonusGranted')::boolean IS DISTINCT FROM true
     OR settled->>'reason' IS NOT NULL THEN
    RAISE EXCEPTION '完成註冊的邀請沒有成立';
  END IF;

  replay := public.settle_my_signup_invite();
  IF (replay->>'settled')::boolean IS DISTINCT FROM true
     OR (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'bonusGranted')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '同一位受邀者不能重複成立邀請';
  END IF;

  scratched := public.draw_my_scratch_card();
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';
  IF (scratched->>'replayed')::boolean IS DISTINCT FROM false
     OR (scratched->>'bonusChances')::integer IS DISTINCT FROM 0
     OR (scratched->>'used')::integer IS DISTINCT FROM 1
     OR (scratched->>'balance')::integer IS DISTINCT FROM current_setting('app.scratch_old_invitee', true)::integer + (scratched->>'awardedDelta')::integer THEN
    RAISE EXCEPTION '受邀者自己的免費刮卡不正確';
  END IF;
END
$scratch_preview_invitee$;

RESET ROLE;

DO $scratch_preview_switch_back$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.scratch_inviter', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('app.scratch_inviter', true), 'role', 'authenticated')::text,
    true
  );
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.scratch_inviter', true) THEN
    RAISE EXCEPTION '無法回到邀請人。交易會回復。';
  END IF;
END
$scratch_preview_switch_back$;

SET LOCAL ROLE authenticated;

DO $scratch_preview_bonus$
DECLARE
  bonus jsonb;
  blocked boolean := false;
  status jsonb;
BEGIN
  status := public.get_my_invite_status();
  IF (status->>'inviteBonusToday')::boolean IS DISTINCT FROM true
     OR status->>'code' IS DISTINCT FROM current_setting('app.scratch_code', true) THEN
    RAISE EXCEPTION '邀請人今天應看到加碼，而且邀請碼不能改變';
  END IF;

  bonus := public.draw_my_scratch_card();
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';
  IF (bonus->>'replayed')::boolean IS DISTINCT FROM false
     OR (bonus->>'bonusChances')::integer IS DISTINCT FROM 1
     OR (bonus->>'chancesTotal')::integer IS DISTINCT FROM 2
     OR (bonus->>'used')::integer IS DISTINCT FROM 2
     OR (bonus->>'chancesLeft')::integer IS DISTINCT FROM 0
     OR (bonus->'card'->>'slot')::integer IS DISTINCT FROM 2
     OR (bonus->>'awardedDelta')::integer NOT IN (3, 10, 15, 20, 30, 50)
     OR (bonus->>'balance')::integer IS DISTINCT FROM
        current_setting('app.scratch_old_inviter', true)::integer
        + current_setting('app.scratch_first_points', true)::integer
        + (bonus->>'awardedDelta')::integer THEN
    RAISE EXCEPTION '邀請加碼的第二次刮卡沒有入帳';
  END IF;

  BEGIN
    PERFORM public.draw_my_scratch_card();
    RAISE EXCEPTION '每天最多 2 次，第三次不應成功';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('今日刮卡次數已用完' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION '第三次刮卡的錯誤不正確：%', SQLERRM;
      END IF;
      blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION '第三次刮卡沒有被拒絕';
  END IF;
END
$scratch_preview_bonus$;

RESET ROLE;

DO $scratch_preview_self$
DECLARE
  inviter uuid := current_setting('app.scratch_inviter', true)::uuid;
  code text := current_setting('app.scratch_code', true);
BEGIN
  INSERT INTO public.member_signup_invites (user_id, code)
  VALUES (inviter, code)
  ON CONFLICT (user_id) DO UPDATE
  SET code = EXCLUDED.code;
  PERFORM set_config('request.jwt.claim.sub', inviter::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', inviter::text, 'role', 'authenticated')::text, true);
END
$scratch_preview_self$;

SET LOCAL ROLE authenticated;

DO $scratch_preview_reject_self$
DECLARE
  result jsonb;
BEGIN
  result := public.settle_my_signup_invite();
  IF result->>'reason' IS DISTINCT FROM 'self_invite'
     OR (result->>'settled')::boolean IS DISTINCT FROM false
     OR (result->>'bonusGranted')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '自己邀請自己必須拒絕';
  END IF;
END
$scratch_preview_reject_self$;

RESET ROLE;

DO $scratch_preview_assert$
DECLARE
  inviter uuid := current_setting('app.scratch_inviter', true)::uuid;
  invitee uuid := current_setting('app.scratch_invitee', true)::uuid;
  old_inviter integer := current_setting('app.scratch_old_inviter', true)::integer;
  old_invitee integer := current_setting('app.scratch_old_invitee', true)::integer;
  inviter_sum integer;
  invitee_sum integer;
  inviter_balance integer;
  invitee_balance integer;
  others text;
  claims integer;
  plays integer;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '檢查結果前必須回到管理者角色。交易會回復。';
  END IF;

  SELECT coalesce(sum(points), 0)
  INTO inviter_sum
  FROM public.scratch_plays
  WHERE user_id = inviter
    AND taipei_day = current_setting('app.scratch_day', true)::date;

  SELECT coalesce(sum(points), 0)
  INTO invitee_sum
  FROM public.scratch_plays
  WHERE user_id = invitee
    AND taipei_day = current_setting('app.scratch_day', true)::date;

  SELECT balance INTO inviter_balance FROM public.member_point_accounts WHERE user_id = inviter;
  SELECT balance INTO invitee_balance FROM public.member_point_accounts WHERE user_id = invitee;

  IF inviter_sum IS DISTINCT FROM (
       SELECT coalesce(sum(delta), 0)
       FROM public.member_point_entries
       WHERE user_id = inviter
         AND kind = 'scratch'
         AND taipei_day = current_setting('app.scratch_day', true)::date
     )
     OR invitee_sum IS DISTINCT FROM (
       SELECT coalesce(sum(delta), 0)
       FROM public.member_point_entries
       WHERE user_id = invitee
         AND kind = 'scratch'
         AND taipei_day = current_setting('app.scratch_day', true)::date
     ) THEN
    RAISE EXCEPTION '刮卡點數與流水不一致';
  END IF;

  IF inviter_balance IS DISTINCT FROM old_inviter + inviter_sum
     OR invitee_balance IS DISTINCT FROM old_invitee + invitee_sum THEN
    RAISE EXCEPTION '點數餘額與刮卡結果不一致';
  END IF;

  IF (SELECT count(*) FROM public.scratch_plays WHERE user_id = inviter AND taipei_day = current_setting('app.scratch_day', true)::date) <> 2
     OR (SELECT count(*) FROM public.scratch_plays WHERE user_id = invitee AND taipei_day = current_setting('app.scratch_day', true)::date) <> 1 THEN
    RAISE EXCEPTION '刮卡次數不正確';
  END IF;

  SELECT count(*) INTO plays FROM public.scratch_plays WHERE user_id IN (inviter, invitee);
  SELECT count(*) INTO claims
  FROM public.reward_claims
  WHERE user_id IN (inviter, invitee)
    AND kind = 'scratch';
  IF plays IS DISTINCT FROM claims THEN
    RAISE EXCEPTION '刮卡領獎紀錄數量與開獎數量不一致';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.member_invite_redemptions
    WHERE invitee_user_id = inviter
  ) THEN
    RAISE EXCEPTION '自己邀請自己不應寫入邀請關係';
  END IF;

  IF (
    SELECT count(*)
    FROM public.member_invite_redemptions
    WHERE inviter_user_id = inviter
      AND invitee_user_id = invitee
  ) <> 1
  OR (
    SELECT count(*)
    FROM public.member_invite_daily_bonus
    WHERE user_id = inviter
      AND taipei_day = current_setting('app.scratch_day', true)::date
  ) <> 1 THEN
    RAISE EXCEPTION '邀請關係或當日加碼數量不正確';
  END IF;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id::text)), 'empty')
  INTO others
  FROM public.member_point_accounts
  WHERE user_id NOT IN (inviter, invitee);

  IF others IS DISTINCT FROM current_setting('app.scratch_others', true) THEN
    RAISE EXCEPTION '其他會員的點數被改寫';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'member_point_entries_require_claim'
      AND tgrelid = 'public.member_point_entries'::regclass
      AND tgenabled = 'o'
      AND (tgdeferrable AND tginitdeferred)
  ) THEN
    RAISE EXCEPTION '預演不得把延後約束觸發器改成立即檢查';
  END IF;
END
$scratch_preview_assert$;

-- 交易回復後，上面的刮卡、點數與邀請都不會留下。
ROLLBACK;
