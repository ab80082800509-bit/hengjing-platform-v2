-- =============================================================================
-- 第五批預演：虛擬特權購買、入庫與裝備。
-- 購買開關預設關閉。預演先證明關閉時不能購買，再由資料庫擁有者暫時開啟，最後在交易內恢復關閉。
-- 只在本機隔離資料庫、由資料庫擁有者整份執行。不要對正式 Supabase 執行。
-- BEGIN 開始，ROLLBACK 結束。不重建既有發獎函式，不改執行前就存在的會員餘額。
-- =============================================================================

BEGIN;

-- perk-inventory-body-start

DO $require_perk_inventory$
DECLARE
  post_def text;
BEGIN
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL
     OR to_regprocedure('public.taipei_today(timestamptz)') IS NULL
     OR to_regprocedure('public.post_coupon_exchange_debit(uuid, text, jsonb)') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL
     OR to_regclass('public.member_point_entries') IS NULL
     OR to_regclass('public.reward_claims') IS NULL THEN
    RAISE EXCEPTION '第五批需要已套用的點數帳本與優惠券扣點';
  END IF;
  post_def := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  IF position('這個獎勵來源尚未開放入帳' IN post_def) = 0 THEN
    RAISE EXCEPTION '既有發獎函式已被改寫，第五批停止';
  END IF;
END
$require_perk_inventory$;

DO $perk_debit_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_point_entries_perk_debit'
  ) THEN
    ALTER TABLE public.member_point_entries
      ADD CONSTRAINT member_point_entries_perk_debit
      CHECK (kind <> 'perk_unlock' OR delta < 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_claims_perk_debit'
  ) THEN
    ALTER TABLE public.reward_claims
      ADD CONSTRAINT reward_claims_perk_debit
      CHECK (kind <> 'perk_unlock' OR delta < 0);
  END IF;
END
$perk_debit_constraints$;

CREATE TABLE IF NOT EXISTS public.member_perk_catalog (
  id text PRIMARY KEY,
  category text NOT NULL,
  cost integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT member_perk_catalog_id_check CHECK (id ~ '^[a-z0-9-]{1,40}$'),
  CONSTRAINT member_perk_catalog_category_check CHECK (category IN ('frame', 'badge', 'title', 'skin')),
  CONSTRAINT member_perk_catalog_cost_check CHECK (cost BETWEEN 1 AND 10000)
);

COMMENT ON TABLE public.member_perk_catalog IS
  '虛擬特權目錄。點數沿用既有 15 件規劃價，尚未另附商業定價簽核。會員不能改價。';

CREATE TABLE IF NOT EXISTS public.member_perk_holds (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  perk_id text NOT NULL REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  category text NOT NULL,
  cost integer NOT NULL,
  claim_key text NOT NULL,
  point_entry_id uuid NOT NULL UNIQUE REFERENCES public.member_point_entries (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_perk_holds_user_perk UNIQUE (user_id, perk_id),
  CONSTRAINT member_perk_holds_user_claim UNIQUE (user_id, claim_key),
  CONSTRAINT member_perk_holds_category_check CHECK (category IN ('frame', 'badge', 'title', 'skin')),
  CONSTRAINT member_perk_holds_cost_check CHECK (cost BETWEEN 1 AND 10000),
  CONSTRAINT member_perk_holds_key_check CHECK (claim_key = 'perk_unlock:' || perk_id)
);

COMMENT ON TABLE public.member_perk_holds IS
  '永久收藏。建立後不可修改或刪除。同一會員同一件只能有一筆。';

CREATE TABLE IF NOT EXISTS public.member_perk_loadout (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  frame_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  badge_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  title_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  skin_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

COMMENT ON TABLE public.member_perk_loadout IS
  '每位會員一個裝備列。頭像框、勳章、頭銜、主題各一欄，不能同時裝備兩件。';

CREATE OR REPLACE FUNCTION public.guard_member_perk_catalog()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '虛擬特權目錄不可刪除';
  END IF;
  IF current_setting('app.perk_catalog', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '虛擬特權目錄不可直接修改';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.category IS DISTINCT FROM OLD.category) THEN
    RAISE EXCEPTION '虛擬特權編號與分類不可變更';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_perk_catalog_guard ON public.member_perk_catalog;
CREATE TRIGGER member_perk_catalog_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_perk_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_perk_catalog();

CREATE OR REPLACE FUNCTION public.guard_member_perk_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  entry public.member_point_entries%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已擁有的虛擬特權不可修改或刪除';
  END IF;
  IF current_setting('app.perk_hold', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '會員不能自行建立虛擬特權';
  END IF;
  IF NEW.claim_key IS DISTINCT FROM ('perk_unlock:' || NEW.perk_id) THEN
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.member_perk_catalog AS catalog
    WHERE catalog.id = NEW.perk_id
      AND catalog.category = NEW.category
      AND catalog.active
  ) THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  SELECT *
  INTO entry
  FROM public.member_point_entries
  WHERE id = NEW.point_entry_id;

  IF NOT FOUND
     OR entry.user_id IS DISTINCT FROM NEW.user_id
     OR entry.kind IS DISTINCT FROM 'perk_unlock'
     OR entry.claim_key IS DISTINCT FROM NEW.claim_key
     OR entry.delta IS DISTINCT FROM -NEW.cost THEN
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.reward_claims AS claim
    WHERE claim.point_entry_id = entry.id
      AND claim.user_id = NEW.user_id
      AND claim.kind = 'perk_unlock'
      AND claim.claim_key = NEW.claim_key
      AND claim.delta = entry.delta
  ) THEN
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_perk_holds_guard ON public.member_perk_holds;
CREATE TRIGGER member_perk_holds_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_perk_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_perk_hold();

CREATE OR REPLACE FUNCTION public.assert_owned_perk_slot(
  p_user_id uuid,
  p_category text,
  p_perk_id text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_perk_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.member_perk_catalog AS catalog
    WHERE catalog.id = p_perk_id
      AND catalog.category = p_category
  ) THEN
    RAISE EXCEPTION '裝備欄位與道具分類不符';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.member_perk_holds AS hold
    WHERE hold.user_id = p_user_id
      AND hold.perk_id = p_perk_id
      AND hold.category = p_category
  ) THEN
    RAISE EXCEPTION '尚未擁有這個虛擬特權';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_member_perk_loadout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '裝備狀態不可刪除';
  END IF;
  IF current_setting('app.perk_equip', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '會員不能直接修改裝備狀態';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '不能變更裝備狀態的會員';
  END IF;
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'frame', NEW.frame_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'badge', NEW.badge_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'title', NEW.title_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'skin', NEW.skin_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_perk_loadout_guard ON public.member_perk_loadout;
CREATE TRIGGER member_perk_loadout_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_perk_loadout
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_perk_loadout();

DO $seed_perk_catalog$
BEGIN
  PERFORM set_config('app.perk_catalog', 'on', true);
  INSERT INTO public.member_perk_catalog (id, category, cost)
  VALUES
    ('frame-founder', 'frame', 100),
    ('frame-blackdiamond', 'frame', 150),
    ('frame-koi', 'frame', 80),
    ('frame-cyber', 'frame', 120),
    ('frame-flame', 'frame', 200),
    ('badge-honest', 'badge', 80),
    ('badge-detail', 'badge', 60),
    ('badge-fivestar', 'badge', 120),
    ('badge-referee', 'badge', 150),
    ('title-saver', 'title', 150),
    ('title-flash', 'title', 120),
    ('title-cart', 'title', 100),
    ('title-hunter', 'title', 250),
    ('skin-cyber', 'skin', 200),
    ('skin-ink', 'skin', 300)
  ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('app.perk_catalog', 'off', true);
END
$seed_perk_catalog$;

DO $perk_catalog_matches$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('frame-founder', 'frame', 100),
        ('frame-blackdiamond', 'frame', 150),
        ('frame-koi', 'frame', 80),
        ('frame-cyber', 'frame', 120),
        ('frame-flame', 'frame', 200),
        ('badge-honest', 'badge', 80),
        ('badge-detail', 'badge', 60),
        ('badge-fivestar', 'badge', 120),
        ('badge-referee', 'badge', 150),
        ('title-saver', 'title', 150),
        ('title-flash', 'title', 120),
        ('title-cart', 'title', 100),
        ('title-hunter', 'title', 250),
        ('skin-cyber', 'skin', 200),
        ('skin-ink', 'skin', 300)
    ) AS expected(id, category, cost)
    FULL JOIN public.member_perk_catalog AS catalog ON catalog.id = expected.id
    WHERE catalog.id IS NULL
       OR expected.id IS NULL
       OR catalog.category IS DISTINCT FROM expected.category
       OR catalog.cost IS DISTINCT FROM expected.cost
       OR catalog.active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION '虛擬特權目錄與既有 15 件規劃不一致';
  END IF;
END
$perk_catalog_matches$;

CREATE OR REPLACE FUNCTION public.perk_state_json(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  bal integer := 0;
  owned jsonb;
  equipped jsonb;
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

  SELECT coalesce(pg_catalog.jsonb_agg(hold.perk_id ORDER BY hold.created_at, hold.perk_id), '[]'::jsonb)
  INTO owned
  FROM public.member_perk_holds AS hold
  WHERE hold.user_id = p_user_id;

  SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'frame', loadout.frame_id,
    'badge', loadout.badge_id,
    'title', loadout.title_id,
    'skin', loadout.skin_id
  ))
  INTO equipped
  FROM public.member_perk_loadout AS loadout
  WHERE loadout.user_id = p_user_id;

  IF equipped IS NULL THEN
    equipped := '{}'::jsonb;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'balance', bal,
    'owned', owned,
    'equipped', equipped
  );
END;
$$;

-- 虛擬特權購買開關。單列旗標，預設關閉。
-- 會員沒有資料表權限。觸發器只放行沒有會員身份的資料庫角色；
-- 若既有的平台管理員函式存在，已登入的管理員也可放行。一般會員不行。
-- 15 件特權價格尚未商業簽核。本段只建立關閉狀態，不改目錄點數。

CREATE TABLE IF NOT EXISTS public.member_perk_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  purchase_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

COMMENT ON TABLE public.member_perk_settings IS
  '虛擬特權購買開關。預設關閉。15 件特權價格尚未商業簽核前必須維持關閉。會員不能自行開啟。不影響已擁有道具的讀取與裝備，也不影響簽到、刮卡或優惠券。';

COMMENT ON COLUMN public.member_perk_settings.purchase_enabled IS
  'true 才允許 purchase_my_perk 扣點並建立收藏。預設 false。';

CREATE OR REPLACE FUNCTION public.guard_member_perk_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '虛擬特權購買開關不可刪除';
  END IF;
  IF NEW.id IS DISTINCT FROM true THEN
    RAISE EXCEPTION '虛擬特權購買開關不可新增第二列';
  END IF;
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;
  IF to_regprocedure('public.is_platform_admin()') IS NOT NULL THEN
    IF public.is_platform_admin() IS TRUE THEN
      NEW.updated_at := pg_catalog.now();
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '不能修改虛擬特權購買開關';
END;
$$;

DROP TRIGGER IF EXISTS member_perk_settings_guard ON public.member_perk_settings;
CREATE TRIGGER member_perk_settings_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_perk_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_perk_settings();

INSERT INTO public.member_perk_settings (id, purchase_enabled)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.post_perk_unlock_debit(
  p_user_id uuid,
  p_perk_id text,
  p_metadata jsonb
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
  catalog public.member_perk_catalog%ROWTYPE;
  entry_id uuid;
  claim_id uuid;
  next_balance integer;
  v_claim_key text;
  paid integer;
BEGIN
  IF current_setting('app.reward_post', true) IS DISTINCT FROM 'on'
     OR current_setting('app.perk_purchase', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '扣點只能由資料庫內部交易呼叫';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;
  IF p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION '獎勵附註必須是物件';
  END IF;
  IF pg_catalog.octet_length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION '獎勵附註過長';
  END IF;
  IF p_perk_id IS NULL OR p_perk_id !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  v_claim_key := 'perk_unlock:' || p_perk_id;
  IF v_claim_key !~ '^perk_unlock:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  SELECT *
  INTO catalog
  FROM public.member_perk_catalog
  WHERE id = p_perk_id
    AND active
  FOR SHARE;

  IF NOT FOUND OR catalog.cost IS NULL OR catalog.cost <= 0 THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;
  paid := catalog.cost;

  day := public.taipei_today();

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

  SELECT *
  INTO existing_claim
  FROM public.reward_claims AS claim
  WHERE claim.user_id = p_user_id
    AND claim.claim_key = v_claim_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_claim.kind IS DISTINCT FROM 'perk_unlock' OR existing_claim.delta IS DISTINCT FROM -paid THEN
      RAISE EXCEPTION '同一領獎鍵不可改寫來源或點數';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'replayed', true,
      'delta', existing_claim.delta,
      'balanceAfter', existing_claim.balance_after,
      'currentBalance', account.balance,
      'claimKey', existing_claim.claim_key
    );
  END IF;

  IF account.balance < paid THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  next_balance := account.balance - paid;

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    p_user_id, -paid, next_balance, 'perk_unlock', v_claim_key, day, p_metadata
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
    p_user_id, 'perk_unlock', v_claim_key, day, -paid, next_balance, entry_id, p_metadata
  )
  RETURNING id INTO claim_id;

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'claimId', claim_id,
    'pointEntryId', entry_id,
    'delta', -paid,
    'balanceAfter', next_balance,
    'currentBalance', next_balance,
    'claimKey', v_claim_key
  );
END;
$$;

COMMENT ON FUNCTION public.post_perk_unlock_debit(uuid, text, jsonb) IS
  '虛擬特權專用扣點。金額只讀目錄，不接受呼叫端傳入點數。不取代 post_member_reward，也不對 API 開放。';

CREATE OR REPLACE FUNCTION public.purchase_my_perk(p_perk_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  catalog public.member_perk_catalog%ROWTYPE;
  account public.member_point_accounts%ROWTYPE;
  hold public.member_perk_holds%ROWTYPE;
  posted jsonb;
  paid integer;
  metadata jsonb;
  v_claim_key text;
  purchases_open boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT settings.purchase_enabled
  INTO purchases_open
  FROM public.member_perk_settings AS settings
  WHERE settings.id = true;
  IF purchases_open IS DISTINCT FROM true THEN
    RAISE EXCEPTION '虛擬特權購買尚未開放';
  END IF;
  IF p_perk_id IS NULL OR p_perk_id !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('perk-user:' || uid::text, 0));

  SELECT *
  INTO catalog
  FROM public.member_perk_catalog
  WHERE id = p_perk_id
    AND active
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  v_claim_key := 'perk_unlock:' || catalog.id;

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account
  FROM public.member_point_accounts
  WHERE user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  SELECT *
  INTO hold
  FROM public.member_perk_holds
  WHERE user_id = uid
    AND perk_id = catalog.id;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.reward_claims AS claim
      WHERE claim.user_id = uid
        AND claim.claim_key = v_claim_key
        AND claim.kind = 'perk_unlock'
        AND claim.delta = -hold.cost
        AND claim.point_entry_id = hold.point_entry_id
    ) THEN
      RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;

  IF account.balance < catalog.cost THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  metadata := pg_catalog.jsonb_build_object(
    'perkId', catalog.id,
    'category', catalog.category,
    'cost', catalog.cost
  );

  PERFORM set_config('app.perk_purchase', 'on', true);
  PERFORM set_config('app.reward_post', 'on', true);
  posted := public.post_perk_unlock_debit(uid, catalog.id, metadata);
  PERFORM set_config('app.perk_purchase', 'off', true);
  PERFORM set_config('app.reward_post', 'off', true);

  paid := -1 * (posted->>'delta')::integer;
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false OR paid IS DISTINCT FROM catalog.cost THEN
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;

  PERFORM set_config('app.perk_hold', 'on', true);
  INSERT INTO public.member_perk_holds (
    user_id, perk_id, category, cost, claim_key, point_entry_id
  )
  VALUES (
    uid, catalog.id, catalog.category, paid, v_claim_key, (posted->>'pointEntryId')::uuid
  );
  PERFORM set_config('app.perk_hold', 'off', true);

  RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

COMMENT ON FUNCTION public.purchase_my_perk(text) IS
  '登入會員用目錄定價購買一件永久虛擬特權。購買開關關閉時拒絕扣點與入庫。扣點與入庫在同一個交易。重複請求不重複扣點。';

CREATE OR REPLACE FUNCTION public.set_my_perk_equipped(p_perk_id text, p_equipped boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  catalog public.member_perk_catalog%ROWTYPE;
  hold public.member_perk_holds%ROWTYPE;
  current_slot text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_equipped IS NULL OR p_perk_id IS NULL OR p_perk_id !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法裝備';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('perk-user:' || uid::text, 0));

  SELECT *
  INTO catalog
  FROM public.member_perk_catalog
  WHERE id = p_perk_id
    AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '這個虛擬特權無法裝備';
  END IF;

  SELECT *
  INTO hold
  FROM public.member_perk_holds
  WHERE user_id = uid
    AND perk_id = catalog.id;

  IF NOT FOUND OR hold.category IS DISTINCT FROM catalog.category THEN
    RAISE EXCEPTION '尚未擁有這個虛擬特權';
  END IF;

  PERFORM set_config('app.perk_equip', 'on', true);
  INSERT INTO public.member_perk_loadout (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  IF catalog.category = 'frame' THEN
    SELECT frame_id INTO current_slot FROM public.member_perk_loadout WHERE user_id = uid FOR UPDATE;
  ELSIF catalog.category = 'badge' THEN
    SELECT badge_id INTO current_slot FROM public.member_perk_loadout WHERE user_id = uid FOR UPDATE;
  ELSIF catalog.category = 'title' THEN
    SELECT title_id INTO current_slot FROM public.member_perk_loadout WHERE user_id = uid FOR UPDATE;
  ELSIF catalog.category = 'skin' THEN
    SELECT skin_id INTO current_slot FROM public.member_perk_loadout WHERE user_id = uid FOR UPDATE;
  ELSE
    RAISE EXCEPTION '裝備欄位與道具分類不符';
  END IF;

  IF (p_equipped AND current_slot IS NOT DISTINCT FROM catalog.id)
     OR (NOT p_equipped AND current_slot IS DISTINCT FROM catalog.id) THEN
    PERFORM set_config('app.perk_equip', 'off', true);
    RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  IF catalog.category = 'frame' THEN
    UPDATE public.member_perk_loadout
    SET frame_id = CASE WHEN p_equipped THEN catalog.id ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE user_id = uid;
  ELSIF catalog.category = 'badge' THEN
    UPDATE public.member_perk_loadout
    SET badge_id = CASE WHEN p_equipped THEN catalog.id ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE user_id = uid;
  ELSIF catalog.category = 'title' THEN
    UPDATE public.member_perk_loadout
    SET title_id = CASE WHEN p_equipped THEN catalog.id ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE user_id = uid;
  ELSE
    UPDATE public.member_perk_loadout
    SET skin_id = CASE WHEN p_equipped THEN catalog.id ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE user_id = uid;
  END IF;

  PERFORM set_config('app.perk_equip', 'off', true);
  RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

COMMENT ON FUNCTION public.set_my_perk_equipped(text, boolean) IS
  '登入會員裝備或卸下自己已擁有的虛擬特權。每個欄位只留一件。不扣點。';

CREATE OR REPLACE FUNCTION public.list_my_perks()
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
  RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

COMMENT ON FUNCTION public.list_my_perks() IS
  '登入會員讀取自己的收藏、裝備與點數餘額。不扣點。';

CREATE OR REPLACE FUNCTION public.public_equipped_perks(p_user_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(rows.item), '[]'::jsonb)
  FROM (
    SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'userId', ids.id,
      'frame', loadout.frame_id,
      'badge', loadout.badge_id,
      'title', loadout.title_id,
      'skin', loadout.skin_id
    )) AS item
    FROM unnest((coalesce(p_user_ids, ARRAY[]::uuid[]))[1:40]) AS ids(id)
    LEFT JOIN public.member_perk_loadout AS loadout ON loadout.user_id = ids.id
    WHERE ids.id IS NOT NULL
  ) AS rows;
$$;

COMMENT ON FUNCTION public.public_equipped_perks(uuid[]) IS
  '公開讀取最多 40 位會員正在裝備的外觀。不包含未裝備收藏，也不能修改。';

CREATE OR REPLACE FUNCTION public.list_public_reviews(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN (
    SELECT coalesce(pg_catalog.jsonb_agg(item ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        r.id,
        r.product_id,
        r.rating,
        r.body,
        r.created_at,
        r.seller_reply,
        r.seller_replied_at,
        coalesce(nullif(pg_catalog.btrim(p.public_nickname), ''), '買家') AS nickname,
        coalesce(
          (
            SELECT pg_catalog.jsonb_agg(ph.path ORDER BY ph.created_at)
            FROM public.product_review_photos AS ph
            WHERE ph.review_id = r.id
          ),
          '[]'::jsonb
        ) AS photos,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'frame', loadout.frame_id,
          'badge', loadout.badge_id,
          'title', loadout.title_id,
          'skin', loadout.skin_id
        )) AS equipped
      FROM public.product_reviews AS r
      LEFT JOIN public.profiles AS p ON p.id = r.user_id
      LEFT JOIN public.member_perk_loadout AS loadout ON loadout.user_id = r.user_id
      JOIN public.products AS pr ON pr.id = r.product_id
      WHERE r.product_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
        AND (
          public.product_is_public(pg_catalog.to_jsonb(pr))
          OR pr.seller_id = auth.uid()
        )
    ) AS item
  );
END;
$$;

COMMENT ON FUNCTION public.list_public_reviews(uuid[]) IS
  '公開評價維持原本的可見範圍，並附上評價者目前裝備的外觀。不回傳未裝備收藏。';

REVOKE ALL ON FUNCTION public.guard_member_perk_settings() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_perk_catalog() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_perk_hold() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_owned_perk_slot(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_perk_loadout() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perk_state_json(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_perk_unlock_debit(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.purchase_my_perk(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_perk_equipped(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_perks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_equipped_perks(uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purchase_my_perk(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_perk_equipped(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_perks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_equipped_perks(uuid[]) TO anon, authenticated;

ALTER TABLE public.member_perk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_perk_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_perk_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_perk_loadout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_perk_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_perk_catalog FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_perk_holds FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_perk_loadout FROM PUBLIC, anon, authenticated, service_role;

DO $perk_inventory_check$
DECLARE
  post_def text := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  debit_def text := pg_get_functiondef('public.post_perk_unlock_debit(uuid, text, jsonb)'::regprocedure);
  purchase_def text := pg_get_functiondef('public.purchase_my_perk(text)'::regprocedure);
  equip_def text := pg_get_functiondef('public.set_my_perk_equipped(text, boolean)'::regprocedure);
  review_def text := pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure);
  fn text;
BEGIN
  IF (SELECT count(*) FROM public.member_perk_catalog) IS DISTINCT FROM 15
     OR (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog) IS DISTINCT FROM 2180 THEN
    RAISE EXCEPTION '虛擬特權目錄必須維持既有 15 件與規劃點數';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_settings) IS DISTINCT FROM 1
     OR (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '虛擬特權購買必須預設關閉';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_attrdef AS def
      ON def.adrelid = attribute.attrelid
     AND def.adnum = attribute.attnum
    JOIN pg_catalog.pg_class AS rel ON rel.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'member_perk_settings'
      AND attribute.attname = 'purchase_enabled'
      AND attribute.attnotnull
      AND pg_catalog.pg_get_expr(def.adbin, def.adrelid) = 'false'
  ) THEN
    RAISE EXCEPTION '虛擬特權購買開關的預設值必須是關閉';
  END IF;
  IF position('member_perk_settings' IN purchase_def) = 0
     OR position('虛擬特權購買尚未開放' IN purchase_def) = 0 THEN
    RAISE EXCEPTION '購買入口必須讀取購買開關';
  END IF;
  IF position('member_perk_settings' IN equip_def) > 0 THEN
    RAISE EXCEPTION '裝備不能被購買開關擋住';
  END IF;
  IF position('這個獎勵來源尚未開放入帳' IN post_def) = 0 THEN
    RAISE EXCEPTION '不能改寫已驗收的發獎函式';
  END IF;
  IF position('p_delta' IN debit_def) > 0 OR position('member_perk_catalog' IN debit_def) = 0 THEN
    RAISE EXCEPTION '扣點函式必須讀目錄價格，不能接受呼叫端傳入點數';
  END IF;
  IF purchase_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' OR equip_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '購買與裝備函式不能吞掉錯誤';
  END IF;
  IF position('post_member_reward' IN purchase_def) > 0 OR position('post_perk_unlock_debit' IN purchase_def) = 0 THEN
    RAISE EXCEPTION '購買必須走虛擬特權扣點，不能偽裝成簽到或刮卡';
  END IF;
  IF position('product_is_public' IN review_def) = 0 OR position('member_perk_loadout' IN review_def) = 0 THEN
    RAISE EXCEPTION '評價可見範圍不能拿掉，裝備顯示必須讀裝備列';
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.post_perk_unlock_debit(uuid, text, jsonb)',
    'public.perk_state_json(uuid)',
    'public.post_member_reward(uuid, text, text, integer, jsonb)'
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '內部扣點函式不能開放給 API';
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.purchase_my_perk(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_my_perk_equipped(text, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.list_my_perks()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.purchase_my_perk(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.list_my_perks()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.public_equipped_perks(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '虛擬特權入口權限不正確';
  END IF;

  IF has_table_privilege('authenticated', 'public.member_perk_holds', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_perk_holds', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_perk_holds', 'DELETE')
     OR has_table_privilege('authenticated', 'public.member_perk_loadout', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_perk_catalog', 'UPDATE')
     OR has_table_privilege('anon', 'public.member_perk_holds', 'SELECT') THEN
    RAISE EXCEPTION '不能直接開放虛擬特權表';
  END IF;
  IF has_table_privilege('authenticated', 'public.member_perk_settings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_perk_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_perk_settings', 'DELETE')
     OR has_table_privilege('anon', 'public.member_perk_settings', 'UPDATE')
     OR has_table_privilege('anon', 'public.member_perk_settings', 'SELECT')
     OR has_function_privilege('authenticated', 'public.guard_member_perk_settings()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.guard_member_perk_settings()', 'EXECUTE') THEN
    RAISE EXCEPTION '會員不能修改虛擬特權購買開關';
  END IF;
END
$perk_inventory_check$;

-- perk-inventory-body-end

-- 第五批預演只在本機隔離資料庫、由資料庫擁有者整份執行。
-- 100 點沿用第四批隔離會員的作法：一筆與刮卡開獎列一致的 50 點，加一筆帳本允許的 50 點簽到。
-- 不使用創始人補點，不改執行前就存在的會員餘額，也不領取既有優惠券。
-- 通過或失敗都靠最後的 ROLLBACK 收回。單一連線不能代表兩個同時送出的請求。

DO $perk_switch_default$
BEGIN
  IF (SELECT count(*) FROM public.member_perk_settings) IS DISTINCT FROM 1
     OR (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '虛擬特權購買預設不是關閉';
  END IF;
END
$perk_switch_default$;

DO $perk_prepare$
DECLARE
  day date := public.taipei_today();
  label text;
  new_id uuid;
  email text;
  inst uuid;
  col record;
  cols text;
  vals text;
  sep text;
  expr text;
  missing text;
  buyer uuid;
  v_play_key text;
  posted jsonb;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '第五批預演必須由資料庫擁有者開始。交易會回復。';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION '第五批預演需要 auth.users。交易會回復。';
  END IF;

  DROP TABLE IF EXISTS pg_temp.perk_balance_before;
  DROP TABLE IF EXISTS pg_temp.perk_isolated_users;
  CREATE TEMP TABLE pg_temp.perk_balance_before AS
  SELECT account.user_id, account.balance
  FROM public.member_point_accounts AS account;
  CREATE TEMP TABLE pg_temp.perk_isolated_users (
    id uuid PRIMARY KEY
  );

  SELECT u.instance_id
  INTO inst
  FROM auth.users AS u
  WHERE u.instance_id IS NOT NULL
  LIMIT 1;
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  FOREACH label IN ARRAY ARRAY['buyer', 'other']
  LOOP
    new_id := pg_catalog.gen_random_uuid();
    email := 'b5-perk-' || label || '-' || replace(new_id::text, '-', '') || '@example.invalid';
    cols := '';
    vals := '';
    sep := '';
    missing := '';
    FOR col IN
      SELECT c.column_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'auth'
        AND c.table_name = 'users'
      ORDER BY c.ordinal_position
    LOOP
      IF col.is_generated IS DISTINCT FROM 'NEVER' OR col.is_identity = 'YES' THEN
        CONTINUE;
      END IF;
      expr := NULL;
      IF col.column_name = 'id' THEN
        expr := format('%L::uuid', new_id::text);
      ELSIF col.column_name = 'instance_id' THEN
        expr := format('%L::uuid', inst::text);
      ELSIF col.column_name = 'aud' OR col.column_name = 'role' THEN
        expr := quote_literal('authenticated');
      ELSIF col.column_name = 'email' THEN
        expr := quote_literal(email);
      ELSIF col.column_name = 'phone' THEN
        -- 唯一索引不允許多位測試會員共用空字串。寫 NULL 後不必依賴隔離庫的空白電話觸發器。
        expr := 'NULL';
      ELSIF col.column_name IN (
        'encrypted_password', 'confirmation_token', 'recovery_token',
        'email_change_token_new', 'email_change', 'email_change_token_current',
        'phone_change', 'phone_change_token', 'reauthentication_token'
      ) THEN
        expr := quote_literal('');
      ELSIF col.column_name = 'raw_app_meta_data' THEN
        expr := quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb';
      ELSIF col.column_name = 'raw_user_meta_data' THEN
        expr := quote_literal('{}') || '::jsonb';
      ELSIF col.column_name IN ('created_at', 'updated_at', 'email_confirmed_at') THEN
        expr := 'now()';
      ELSIF col.column_name IN ('is_super_admin', 'is_sso_user', 'is_anonymous') THEN
        expr := 'false';
      ELSIF col.column_name = 'email_change_confirm_status' THEN
        expr := '0';
      END IF;
      IF expr IS NOT NULL THEN
        cols := cols || sep || format('%I', col.column_name);
        vals := vals || sep || expr;
        sep := ', ';
      ELSIF col.is_nullable = 'NO' AND col.column_default IS NULL THEN
        missing := missing || col.column_name || ',';
      END IF;
    END LOOP;
    IF missing <> '' THEN
      RAISE EXCEPTION '預演停止：auth.users 有未預期的必填欄位 %。交易會回復。', missing;
    END IF;
    EXECUTE format('INSERT INTO auth.users (%s) VALUES (%s)', cols, vals);

    IF to_regclass('auth.identities') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = new_id) THEN
      cols := '';
      vals := '';
      sep := '';
      missing := '';
      FOR col IN
        SELECT c.column_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'auth'
          AND c.table_name = 'identities'
        ORDER BY c.ordinal_position
      LOOP
        IF col.is_generated IS DISTINCT FROM 'NEVER' OR col.is_identity = 'YES' THEN
          CONTINUE;
        END IF;
        expr := NULL;
        IF col.column_name = 'id' THEN
          expr := format('%L::uuid', pg_catalog.gen_random_uuid()::text);
        ELSIF col.column_name = 'user_id' THEN
          expr := format('%L::uuid', new_id::text);
        ELSIF col.column_name = 'provider' THEN
          expr := quote_literal('email');
        ELSIF col.column_name = 'provider_id' THEN
          expr := quote_literal(new_id::text);
        ELSIF col.column_name = 'identity_data' THEN
          expr := format('%L::jsonb', pg_catalog.jsonb_build_object('sub', new_id, 'email', email)::text);
        ELSIF col.column_name = 'email' THEN
          expr := quote_literal(email);
        ELSIF col.column_name IN ('created_at', 'updated_at', 'last_sign_in_at') THEN
          expr := 'now()';
        END IF;
        IF expr IS NOT NULL THEN
          cols := cols || sep || format('%I', col.column_name);
          vals := vals || sep || expr;
          sep := ', ';
        ELSIF col.is_nullable = 'NO' AND col.column_default IS NULL THEN
          missing := missing || col.column_name || ',';
        END IF;
      END LOOP;
      IF missing <> '' THEN
        RAISE EXCEPTION '預演停止：auth.identities 有未預期的必填欄位 %。交易會回復。', missing;
      END IF;
      IF cols <> '' THEN
        EXECUTE format('INSERT INTO auth.identities (%s) VALUES (%s)', cols, vals);
      END IF;
    END IF;

    INSERT INTO pg_temp.perk_isolated_users (id) VALUES (new_id);
    PERFORM set_config('app.perk_' || label, new_id::text, true);
  END LOOP;

  buyer := current_setting('app.perk_buyer', true)::uuid;
  v_play_key := 'scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:1';
  INSERT INTO public.scratch_plays (user_id, taipei_day, slot, claim_key, outcome_kind, points)
  VALUES (buyer, day, 1, v_play_key, 'points', 50);
  PERFORM set_config('app.reward_post', 'on', true);
  posted := public.post_member_reward(
    buyer,
    'scratch',
    v_play_key,
    50,
    pg_catalog.jsonb_build_object('outcomeKind', 'points', 'slot', 1, 'purpose', 'perk-preview-isolated-seed')
  );
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false OR (posted->>'delta')::integer IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION '隔離會員的 50 點刮卡入帳沒有走帳本函式';
  END IF;
  posted := public.post_member_reward(
    buyer,
    'checkin',
    'checkin:' || to_char(day, 'YYYY-MM-DD'),
    50,
    pg_catalog.jsonb_build_object('purpose', 'perk-preview-isolated-seed')
  );
  IF (posted->>'currentBalance')::integer IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION '隔離會員沒有剛好湊到 100 點';
  END IF;
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.perk_purchase', 'off', true);

  BEGIN
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM public.post_member_reward(
      buyer,
      'perk_unlock',
      'perk_unlock:badge-detail',
      -60,
      pg_catalog.jsonb_build_object('purpose', 'perk-preview-closed')
    );
    RAISE EXCEPTION 'perk_unlock 不應從既有發獎函式入帳';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '這個獎勵來源尚未開放入帳' THEN
        RAISE;
      END IF;
  END;
  PERFORM set_config('app.reward_post', 'off', true);
  IF (SELECT balance FROM public.member_point_accounts WHERE user_id = buyer) IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION '被拒絕的 perk_unlock 仍改了餘額';
  END IF;
END
$perk_prepare$;

DO $perk_closed_baseline$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
BEGIN
  PERFORM set_config('app.perk_balance_before', (SELECT balance FROM public.member_point_accounts WHERE user_id = buyer)::text, true);
  PERFORM set_config('app.perk_entries_before', (SELECT count(*) FROM public.member_point_entries WHERE user_id = buyer)::text, true);
  PERFORM set_config('app.perk_holds_before', (SELECT count(*) FROM public.member_perk_holds WHERE user_id = buyer)::text, true);
  PERFORM set_config('app.perk_claims_before', (SELECT count(*) FROM public.reward_claims WHERE user_id = buyer)::text, true);
  IF current_setting('app.perk_balance_before', true) IS DISTINCT FROM '100'
     OR current_setting('app.perk_holds_before', true) IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION '關閉購買前，隔離會員應該有 100 點且沒有收藏';
  END IF;
END
$perk_closed_baseline$;

DO $perk_jwt_buyer$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.perk_buyer', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.perk_buyer', true), 'role', 'authenticated')::text, true);
END
$perk_jwt_buyer$;

SET LOCAL ROLE authenticated;

DO $perk_closed_buy$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
BEGIN
  IF auth.uid() IS DISTINCT FROM buyer THEN
    RAISE EXCEPTION '無法模擬隔離會員，不會改用直接寫入收藏。交易會回復。';
  END IF;
  PERFORM set_config('app.perk_purchase', 'on', true);
  PERFORM set_config('app.reward_post', 'on', true);
  BEGIN
    PERFORM public.purchase_my_perk('badge-detail');
    RAISE EXCEPTION '關閉時不應購買成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '虛擬特權購買尚未開放' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    UPDATE public.member_perk_settings SET purchase_enabled = true WHERE id = true;
    RAISE EXCEPTION '一般會員不應能開啟虛擬特權購買';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END
$perk_closed_buy$;

RESET ROLE;

DO $perk_closed_unchanged$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
BEGIN
  PERFORM set_config('app.perk_purchase', 'off', true);
  PERFORM set_config('app.reward_post', 'off', true);
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '一般會員開啟了虛擬特權購買';
  END IF;
  IF (SELECT balance FROM public.member_point_accounts WHERE user_id = buyer)::text IS DISTINCT FROM current_setting('app.perk_balance_before', true)
     OR (SELECT count(*) FROM public.member_point_entries WHERE user_id = buyer)::text IS DISTINCT FROM current_setting('app.perk_entries_before', true)
     OR (SELECT count(*) FROM public.member_perk_holds WHERE user_id = buyer)::text IS DISTINCT FROM current_setting('app.perk_holds_before', true)
     OR (SELECT count(*) FROM public.reward_claims WHERE user_id = buyer)::text IS DISTINCT FROM current_setting('app.perk_claims_before', true) THEN
    RAISE EXCEPTION '關閉時購買被拒絕後，餘額、流水或收藏仍有變動';
  END IF;

  BEGIN
    UPDATE public.member_perk_settings SET purchase_enabled = true WHERE id = true;
    RAISE EXCEPTION '帶著會員身份時不應能開啟購買';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '不能修改虛擬特權購買開關' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '會員身份嘗試開啟後，開關不再是關閉';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '授權開啟前仍帶著會員身份';
  END IF;
  UPDATE public.member_perk_settings SET purchase_enabled = true WHERE id = true;
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '資料庫擁有者無法開啟虛擬特權購買';
  END IF;
END
$perk_closed_unchanged$;

DO $perk_jwt_buyer_open$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.perk_buyer', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.perk_buyer', true), 'role', 'authenticated')::text, true);
END
$perk_jwt_buyer_open$;

SET LOCAL ROLE authenticated;

DO $perk_buy$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
  bought jsonb;
  again jsonb;
  equipped jsonb;
  removed jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM buyer THEN
    RAISE EXCEPTION '無法模擬隔離會員，不會改用直接寫入收藏。交易會回復。';
  END IF;
  bought := public.purchase_my_perk('badge-detail');
  IF (bought->>'replayed')::boolean IS DISTINCT FROM false
     OR (bought->>'balance')::integer IS DISTINCT FROM 40
     OR NOT (bought->'owned' ? 'badge-detail') THEN
    RAISE EXCEPTION '60 點勳章沒有剛好扣點並入庫';
  END IF;
  again := public.purchase_my_perk('badge-detail');
  IF (again->>'replayed')::boolean IS DISTINCT FROM true
     OR (again->>'balance')::integer IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '重複購買又扣了點';
  END IF;
  BEGIN
    PERFORM public.purchase_my_perk('frame-cyber');
    RAISE EXCEPTION '點數不足時不應購買成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '點數不足' THEN
        RAISE;
      END IF;
  END;
  equipped := public.set_my_perk_equipped('badge-detail', true);
  IF equipped->'equipped'->>'badge' IS DISTINCT FROM 'badge-detail'
     OR equipped->'equipped' ? 'frame' THEN
    RAISE EXCEPTION '勳章沒有裝備到自己的欄位';
  END IF;
  BEGIN
    PERFORM public.set_my_perk_equipped('frame-koi', true);
    RAISE EXCEPTION '未擁有的特權不應裝備成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '尚未擁有這個虛擬特權' THEN
        RAISE;
      END IF;
  END;
  removed := public.set_my_perk_equipped('badge-detail', false);
  IF removed->'equipped' ? 'badge' THEN
    RAISE EXCEPTION '卸下後勳章欄位仍有值';
  END IF;
  IF (removed->>'balance')::integer IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '裝備或卸下不應改點數';
  END IF;
END
$perk_buy$;

DO $perk_jwt_other$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.perk_other', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.perk_other', true), 'role', 'authenticated')::text, true);
END
$perk_jwt_other$;

DO $perk_other$
BEGIN
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.perk_other', true) THEN
    RAISE EXCEPTION '無法模擬另一位會員';
  END IF;
  BEGIN
    PERFORM public.purchase_my_perk('badge-detail');
    RAISE EXCEPTION '沒有點數的會員不應購買成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '點數不足' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    INSERT INTO public.member_perk_holds (user_id, perk_id, category, cost, claim_key, point_entry_id)
    VALUES (auth.uid(), 'badge-detail', 'badge', 60, 'perk_unlock:badge-detail', pg_catalog.gen_random_uuid());
    RAISE EXCEPTION '會員不應能直接建立收藏';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.post_perk_unlock_debit(auth.uid(), 'badge-detail', '{}'::jsonb);
    RAISE EXCEPTION '內部扣點不應被會員呼叫';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END
$perk_other$;

RESET ROLE;

DO $perk_switch_close$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '授權關閉前仍帶著會員身份';
  END IF;
  UPDATE public.member_perk_settings SET purchase_enabled = false WHERE id = true;
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '授權關閉購買開關失敗';
  END IF;
END
$perk_switch_close$;

DO $perk_jwt_buyer_closed$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.perk_buyer', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.perk_buyer', true), 'role', 'authenticated')::text, true);
END
$perk_jwt_buyer_closed$;

SET LOCAL ROLE authenticated;

DO $perk_closed_still_equips$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
  listed jsonb;
  equipped jsonb;
  removed jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM buyer THEN
    RAISE EXCEPTION '無法模擬隔離會員，不會改用直接寫入收藏。交易會回復。';
  END IF;
  listed := public.list_my_perks();
  IF NOT (listed->'owned' ? 'badge-detail') OR (listed->>'balance')::integer IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '關閉購買後不能讀取已擁有的特權';
  END IF;
  equipped := public.set_my_perk_equipped('badge-detail', true);
  IF equipped->'equipped'->>'badge' IS DISTINCT FROM 'badge-detail' OR (equipped->>'balance')::integer IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '關閉購買後不能裝備已擁有的特權';
  END IF;
  removed := public.set_my_perk_equipped('badge-detail', false);
  IF removed->'equipped' ? 'badge' OR (removed->>'balance')::integer IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '關閉購買後卸下改了點數或仍留著裝備';
  END IF;
  BEGIN
    PERFORM public.purchase_my_perk('badge-detail');
    RAISE EXCEPTION '關閉後不應再進入購買';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '虛擬特權購買尚未開放' THEN
        RAISE;
      END IF;
  END;
END
$perk_closed_still_equips$;

RESET ROLE;

DO $perk_verify$
DECLARE
  buyer uuid := current_setting('app.perk_buyer', true)::uuid;
  other uuid := current_setting('app.perk_other', true)::uuid;
  actual integer;
  claims integer;
BEGIN
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.perk_purchase', 'off', true);
  PERFORM set_config('app.perk_hold', 'off', true);
  PERFORM set_config('app.perk_equip', 'off', true);
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = buyer;
  IF actual IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '購買後餘額不是剛好少 60 點';
  END IF;
  SELECT count(*)::integer INTO claims
  FROM public.reward_claims AS claim
  WHERE claim.user_id = buyer
    AND claim.kind = 'perk_unlock'
    AND claim.claim_key = 'perk_unlock:badge-detail'
    AND claim.delta = -60;
  IF claims IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '虛擬特權領獎紀錄不是剛好一筆 -60';
  END IF;
  IF (
    SELECT coalesce(sum(entry.delta), 0)
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = buyer
  ) IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '購買會員的點數流水加總不是 40';
  END IF;
  IF (
    SELECT count(*)
    FROM public.member_perk_holds AS hold
    WHERE hold.user_id = buyer
      AND hold.perk_id = 'badge-detail'
      AND hold.cost = 60
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '收藏庫沒有剛好一筆 60 點勳章';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_perk_holds AS hold WHERE hold.user_id = buyer AND hold.perk_id = 'frame-cyber'
  ) OR EXISTS (
    SELECT 1 FROM public.reward_claims AS claim WHERE claim.user_id = buyer AND claim.claim_key = 'perk_unlock:frame-cyber'
  ) THEN
    RAISE EXCEPTION '點數不足時仍入庫或寫入領獎';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_perk_holds AS hold WHERE hold.user_id = other
  ) OR EXISTS (
    SELECT 1 FROM public.member_point_accounts AS account WHERE account.user_id = other AND account.balance <> 0
  ) THEN
    RAISE EXCEPTION '另一位會員的點數或收藏被改寫';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.member_perk_loadout AS loadout
    WHERE loadout.user_id = buyer
      AND (loadout.badge_id IS NOT NULL OR loadout.frame_id IS NOT NULL OR loadout.title_id IS NOT NULL OR loadout.skin_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '卸下後仍有裝備';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.perk_balance_before AS before
    JOIN public.member_point_accounts AS account ON account.user_id = before.user_id
    WHERE account.balance IS DISTINCT FROM before.balance
  ) THEN
    RAISE EXCEPTION '其他會員的點數被改寫';
  END IF;
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '驗收結束時購買開關必須恢復關閉';
  END IF;
  IF (SELECT balance FROM public.member_point_accounts WHERE user_id = buyer) IS DISTINCT FROM 40
     OR (SELECT count(*) FROM public.member_perk_holds WHERE user_id = buyer) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.member_point_entries WHERE user_id = buyer AND kind = 'perk_unlock') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '關閉後的閱讀或裝備改了餘額、流水或收藏';
  END IF;
END
$perk_verify$;

SELECT '第五批購買開關驗收通過：預設關閉，會員不能開啟，授權開啟後可購買且重複購買不重複扣點，裝備不受影響，結束時已恢復關閉。交易即將回復。' AS result;

ROLLBACK;
