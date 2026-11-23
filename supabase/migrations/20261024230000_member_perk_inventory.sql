-- =============================================================================
-- 第五批：虛擬特權永久收藏與裝備
-- 請人工審查後，在 Supabase SQL Editor 一次執行整份。本檔不會被這次作業自動執行。
--
-- 不改 post_member_reward、簽到、刮卡、優惠券兌換或 checkout_enabled。
-- perk_unlock 仍不能從發獎函式入帳。扣點走獨立函式，金額只讀目錄，不接受呼叫端傳入點數。
-- 點數沿用既有 15 件目錄，尚未另附商業定價簽核。
-- 購買開關 member_perk_settings.purchase_enabled 預設 false。未開啟時 purchase_my_perk 拒絕扣點與入庫。
-- 會員不能自行開啟。15 件價格簽核前，只能由資料庫擁有者確認後另行開啟。本檔不會把它打開。
-- 扣點、領獎紀錄與收藏入庫在同一個交易。失敗整筆回復。
-- 擁有權不可修改或刪除。裝備只有四個欄位，每欄一件，而且只能由裝備入口變更。
-- 關閉購買不影響已擁有道具的讀取與裝備。
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

COMMIT;
