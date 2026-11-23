-- =============================================================================
-- 第四批補充驗收：100 點兌換，以及刮卡發券與替代點數互斥
-- 只在本機隔離資料庫、由資料庫擁有者整份執行。本檔不會被自動執行。
-- 不要對正式 Supabase 執行。不要把 ROLLBACK 改成 COMMIT。
--
-- BEGIN 開始，ROLLBACK 結束。不重建資料表，不改已上線的函式、機率或既有會員餘額。
-- 交易內自行建立測試商家、會員與兩張授權券。不讀取、不鎖定、不領取、不改寫
-- 任何執行前就存在的優惠券庫存。若已有可發授權券，立刻停止且不做寫入。
-- 通過或失敗都靠最後的 ROLLBACK 收回。語句若中途失敗，交易會中止；
-- 離開連線前仍要執行 ROLLBACK，中止的交易不會提交。
--
-- 暫存表一律寫成 pg_temp。同名正式表不會被 DROP、建立或讀寫。
-- 本檔觸發器檢查只接受會隨交易回復的 SQL 函式。發現可能寫出交易外的觸發器就停止。
-- setseed 只影響這條連線後續的隨機數，ROLLBACK 不會把它改回去。
-- 身份欄位若使用序列，nextval 不會被 ROLLBACK 收回；那只留下序號空缺，不會留下資料列。
--
-- 100 點不是改既有會員餘額做出來的。隔離會員先經 post_member_reward 入帳：
-- 一筆與刮卡開獎列一致的 50 點，加一筆帳本函式允許的 50 點簽到。
-- 點數不足的會員只走正式 claim_my_daily_checkin。
-- 兌換券與刮卡券各 1 張。兌換用掉兌換券後，刮卡才發另一張；兩張都發完才測替代點數。
-- 刮卡有實際呼叫 draw_my_scratch_card 與 reveal_my_scratch_card。
-- 隨機數用 setseed 在有限範圍內尋找指定獎項，失敗的那次開獎在子交易內回復。
-- 這沒有修改 scratch_award_from_units。也不是網站上不設種子的那一次自然刮卡。
-- 確認可發券為空之後會鎖定 seller_coupons，直到 ROLLBACK 才放開，避免測試途中
-- 新寫入的正式券被刮卡發走。鎖定期間不更新任何執行前就存在的券。
-- 單一連線不能代表兩個同時送出的請求。
-- =============================================================================

BEGIN;

DO $b4_require$
DECLARE
  award jsonb;
  exchange_def text;
  draw_def text;
  issue_fn text := 'public.issue_member_coupon(uuid, uuid, text, text, uuid)';
  issue_acl text;
  trig record;
  trig_def text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '補充驗收必須由資料庫擁有者開始。交易會回復。';
  END IF;

  IF to_regprocedure('public.exchange_my_coupon(uuid)') IS NULL
     OR to_regprocedure('public.draw_my_scratch_card()') IS NULL
     OR to_regprocedure('public.reveal_my_scratch_card()') IS NULL
     OR to_regprocedure('public.post_coupon_exchange_debit(uuid, text, jsonb)') IS NULL
     OR to_regprocedure('public.issue_member_coupon(uuid, uuid, text, text, uuid)') IS NULL
     OR to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL
     OR to_regprocedure('public.claim_my_daily_checkin()') IS NULL
     OR to_regprocedure('public.save_my_seller_coupon(uuid, jsonb)') IS NULL
     OR to_regprocedure('public.scratch_award_from_units(integer, integer)') IS NULL
     OR to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '第四批正式入口不完整，補充驗收停止。交易會回復。';
  END IF;

  exchange_def := pg_get_functiondef('public.exchange_my_coupon(uuid)'::regprocedure);
  draw_def := pg_get_functiondef('public.draw_my_scratch_card()'::regprocedure);
  IF position('v_claim_key' IN exchange_def) = 0 OR position('v_claim_key' IN draw_def) = 0 THEN
    RAISE EXCEPTION '正式函式還沒有 v3 的 v_claim_key，不能把欄位與變數混用的版本當成驗收對象。交易會回復。';
  END IF;
  IF exchange_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '兌換函式不能吞掉錯誤。交易會回復。';
  END IF;
  IF position('-- scratch-coupon-or-points' IN draw_def) = 0
     OR position('lock_scratch_pool_coupon' IN draw_def) = 0 THEN
    RAISE EXCEPTION '正式刮卡入口沒有發券與入點分支。交易會回復。';
  END IF;

  award := public.scratch_award_from_units(0, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '刮卡一般券機率不應被改掉';
  END IF;
  award := public.scratch_award_from_units(2499, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '刮卡一般券邊界不應被改掉';
  END IF;
  award := public.scratch_award_from_units(9000, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券仍必須是 30 點替代';
  END IF;
  award := public.scratch_award_from_units(9499, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券邊界不應被改掉';
  END IF;
  award := public.scratch_award_from_units(9500, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'none' OR (award->>'points')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '刮卡保底不應被改掉';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'member_point_entries_require_claim'
      AND tgdeferrable
      AND tginitdeferred
  ) THEN
    RAISE EXCEPTION '點數流水的領獎約束必須維持延後檢查。交易會回復。';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '補充驗收需要 anon 與 authenticated 角色。交易會回復。';
  END IF;

  IF has_function_privilege('anon', issue_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', issue_fn, 'EXECUTE')
     OR (
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
       AND has_function_privilege('service_role', issue_fn, 'EXECUTE')
     ) THEN
    RAISE EXCEPTION '內部發券函式不應開放給 anon、authenticated 或 service_role。交易會回復。';
  END IF;

  SELECT CASE WHEN p.proacl IS NULL THEN 'default-public' ELSE '' END
  INTO issue_acl
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'issue_member_coupon'
    AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, text, uuid';

  IF issue_acl = '' THEN
    SELECT coalesce(string_agg(granted.label, ',' ORDER BY granted.label), 'none')
    INTO issue_acl
    FROM (
      SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS label
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(p.proacl) AS a
      LEFT JOIN pg_roles AS r ON r.oid = a.grantee
      WHERE n.nspname = 'public'
        AND p.proname = 'issue_member_coupon'
        AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, text, uuid'
        AND a.privilege_type = 'EXECUTE'
    ) AS granted;
  END IF;

  PERFORM set_config(
    'app.b4_issue_privileges',
    'owner=' || pg_get_userbyid(p.proowner)
      || ';owner_exec=' || has_function_privilege(pg_get_userbyid(p.proowner), issue_fn, 'EXECUTE')::text
      || ';current_exec=' || has_function_privilege(current_user, issue_fn, 'EXECUTE')::text
      || ';anon=false;authenticated=false;service_role='
      || CASE
           WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN 'false'
           ELSE 'absent'
         END
      || ';acl=' || coalesce(issue_acl, 'missing'),
    true
  )
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'issue_member_coupon'
    AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, text, uuid';
  PERFORM set_config('app.b4_owner_reissue', 'not-run', true);

  FOR trig IN
    SELECT p.oid AS fn_oid,
           l.lanname,
           n.nspname || '.' || c.relname || '.' || t.tgname AS label
    FROM pg_trigger AS t
    JOIN pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_language AS l ON l.oid = p.prolang
    WHERE NOT t.tgisinternal
      AND (
        (n.nspname = 'auth' AND c.relname IN ('users', 'identities'))
        OR (
          n.nspname = 'public'
          AND c.relname IN (
            'seller_applications', 'seller_coupons', 'member_coupon_holds',
            'scratch_plays', 'member_point_accounts', 'member_point_entries', 'reward_claims'
          )
        )
      )
  LOOP
    IF trig.lanname NOT IN ('plpgsql', 'sql') THEN
      RAISE EXCEPTION '預演停止：觸發器 % 不是 SQL，無法確認失敗與 ROLLBACK 不會留下交易外副作用。交易會回復。', trig.label;
    END IF;
    trig_def := pg_get_functiondef(trig.fn_oid);
    IF trig_def ~* '(dblink|pg_net|net\.http_|http_request|lo_import|pg_background)' THEN
      RAISE EXCEPTION '預演停止：觸發器 % 可能寫出交易外。不會繼續建立測試資料。交易會回復。', trig.label;
    END IF;
  END LOOP;

  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'off', true);
  PERFORM set_config('app.b4_replay_new_coupon', '', true);
END
$b4_require$;

DO $b4_setup$
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
  uid uuid;
  v_play_key text;
  posted jsonb;
  seller uuid;
  plan text;
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('public.seller_applications') IS NULL THEN
    RAISE EXCEPTION '補充驗收需要正式的 auth.users 與 seller_applications。交易會回復。';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seller_coupons AS coupon
    WHERE coupon.game_pool
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.issued_count < coupon.qty
      AND coupon.start_on <= day
      AND coupon.end_on >= day
  ) THEN
    RAISE EXCEPTION '預演停止：已有可發的授權券。不會使用正式商家庫存。請改在沒有可發授權券的本機隔離資料庫執行。交易會回復。';
  END IF;
  LOCK TABLE public.seller_coupons IN SHARE ROW EXCLUSIVE MODE;

  CREATE TEMP TABLE pg_temp.b4_schema_ready ();
  DROP TABLE pg_temp.b4_schema_ready;
  DROP TABLE IF EXISTS pg_temp.b4_balance_before;
  DROP TABLE IF EXISTS pg_temp.b4_isolated_users;
  DROP TABLE IF EXISTS pg_temp.b4_issued_before;
  CREATE TEMP TABLE pg_temp.b4_balance_before AS
  SELECT account.user_id, account.balance
  FROM public.member_point_accounts AS account;
  CREATE TEMP TABLE pg_temp.b4_isolated_users (
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

  FOREACH label IN ARRAY ARRAY['seller', 'rich', 'rich2', 'poor', 'scratch', 'fallback', 'founder']
  LOOP
    new_id := pg_catalog.gen_random_uuid();
    email := 'b4-safety-' || label || '-' || replace(new_id::text, '-', '') || '@example.invalid';
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
      RAISE EXCEPTION '預演停止：auth.users 有未預期的必填欄位 %，不會猜測正式會員結構。交易會回復。', missing;
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
          expr := format('%L::jsonb', jsonb_build_object('sub', new_id, 'email', email)::text);
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

    INSERT INTO pg_temp.b4_isolated_users (id) VALUES (new_id);
    PERFORM set_config('app.b4_' || label, new_id::text, true);
  END LOOP;

  FOREACH label IN ARRAY ARRAY['rich', 'rich2']
  LOOP
    uid := current_setting('app.b4_' || label, true)::uuid;
    v_play_key := 'scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:1';
    INSERT INTO public.scratch_plays (user_id, taipei_day, slot, claim_key, outcome_kind, points)
    VALUES (uid, day, 1, v_play_key, 'points', 50);

    PERFORM set_config('app.reward_post', 'on', true);
    posted := public.post_member_reward(
      uid,
      'scratch',
      v_play_key,
      50,
      jsonb_build_object('outcomeKind', 'points', 'slot', 1)
    );
    IF (posted->>'replayed')::boolean IS DISTINCT FROM false OR (posted->>'delta')::integer IS DISTINCT FROM 50 THEN
      RAISE EXCEPTION '隔離會員的 50 點刮卡入帳沒有走帳本函式';
    END IF;
    posted := public.post_member_reward(
      uid,
      'checkin',
      'checkin:' || to_char(day, 'YYYY-MM-DD'),
      50,
      jsonb_build_object('purpose', 'batch4-isolated-seed')
    );
    IF (posted->>'replayed')::boolean IS DISTINCT FROM false
       OR (posted->>'delta')::integer IS DISTINCT FROM 50
       OR (posted->>'currentBalance')::integer IS DISTINCT FROM 100 THEN
      RAISE EXCEPTION '隔離會員沒有剛好湊到 100 點';
    END IF;
    PERFORM set_config('app.reward_post', 'off', true);
  END LOOP;

  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';
  IF EXISTS (
    SELECT 1
    FROM public.member_point_accounts AS account
    JOIN pg_temp.b4_isolated_users AS isolated ON isolated.id = account.user_id
    WHERE account.balance IS DISTINCT FROM (
      SELECT coalesce(sum(entry.delta), 0)
      FROM public.member_point_entries AS entry
      WHERE entry.user_id = account.user_id
    )
  ) THEN
    RAISE EXCEPTION '隔離會員的點數餘額與流水不一致';
  END IF;
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim DEFERRED';

  seller := current_setting('app.b4_seller', true)::uuid;
  cols := '';
  vals := '';
  sep := '';
  missing := '';
  FOR col IN
    SELECT c.column_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity, c.data_type
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'seller_applications'
    ORDER BY c.ordinal_position
  LOOP
    IF col.is_generated IS DISTINCT FROM 'NEVER' OR col.is_identity = 'YES' THEN
      CONTINUE;
    END IF;
    expr := NULL;
    IF col.column_name = 'id' AND col.data_type = 'uuid' THEN
      expr := format('%L::uuid', pg_catalog.gen_random_uuid()::text);
    ELSIF col.column_name = 'user_id' THEN
      expr := format('%L::uuid', seller::text);
    ELSIF col.column_name = 'status' THEN
      expr := quote_literal('approved');
    ELSIF col.column_name = 'store_name' THEN
      expr := quote_literal('驗收店' || substr(replace(seller::text, '-', ''), 1, 6));
    ELSIF col.column_name = 'legal_name' THEN
      expr := quote_literal('驗收測試');
    ELSIF col.column_name IN ('created_at', 'updated_at', 'certified_at', 'reviewed_at') THEN
      expr := 'pg_catalog.now()';
    ELSIF col.column_name IN ('suspended', 'banned') THEN
      expr := 'false';
    ELSIF col.column_name IN ('review_note', 'kyc_document_path') THEN
      expr := quote_literal('');
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
    RAISE EXCEPTION '預演停止：seller_applications 有未預期的必填欄位 %，不會猜測正式商家結構。交易會回復。', missing;
  END IF;
  IF cols = '' THEN
    RAISE EXCEPTION '預演停止：無法建立測試商家。交易會回復。';
  END IF;
  EXECUTE format('INSERT INTO public.seller_applications (%s) VALUES (%s)', cols, vals);
  IF NOT EXISTS (
    SELECT 1
    FROM public.seller_applications AS sa
    WHERE sa.user_id = seller
      AND sa.status = 'approved'
  ) THEN
    RAISE EXCEPTION '測試商家沒有建立成已通過審核。交易會回復。';
  END IF;

  plan := 'split';
  PERFORM set_config('app.b4_seller', seller::text, true);
  PERFORM set_config('app.b4_day', to_char(day, 'YYYY-MM-DD'), true);
  PERFORM set_config('app.b4_plan', plan, true);
  PERFORM set_config('app.b4_create_exchange_qty', '1', true);
  PERFORM set_config('app.b4_create_scratch', 'yes', true);
  PERFORM set_config('app.b4_exchange', '', true);
  PERFORM set_config('request.jwt.claim.sub', seller::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', seller::text, 'role', 'authenticated')::text, true);
END
$b4_setup$;

SET LOCAL ROLE authenticated;

DO $b4_create$
DECLARE
  qty integer;
  code text;
  created jsonb;
  draft jsonb;
  day text := current_setting('app.b4_day', true);
  ending text;
BEGIN
  IF current_setting('app.b4_create_exchange_qty', true) = '' THEN
    RETURN;
  END IF;
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.b4_seller', true) THEN
    RAISE EXCEPTION '無法模擬商家 auth.uid()，不會改用直接寫入優惠券。交易會回復。';
  END IF;

  ending := to_char(day::date + 90, 'YYYY-MM-DD');
  qty := current_setting('app.b4_create_exchange_qty', true)::integer;
  code := 'B4' || upper(substr(md5(clock_timestamp()::text || random()::text), 1, 8));
  draft := jsonb_build_object(
    'name', '驗收兌換券',
    'code', code,
    'kind', 'cash',
    'amount', 10,
    'percent', 0,
    'maxDiscount', 0,
    'gift', '',
    'minSpend', 100,
    'qty', qty,
    'startAt', day,
    'endAt', ending,
    'listed', true,
    'shelf', false
  );
  created := public.save_my_seller_coupon(NULL, draft);
  IF created->>'sellerId' IS DISTINCT FROM auth.uid()::text
     OR (created->>'listed')::boolean IS DISTINCT FROM true
     OR (created->>'qty')::integer IS DISTINCT FROM qty
     OR (created->>'active')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '測試兌換券沒有以授權曝光券建立';
  END IF;
  PERFORM set_config('app.b4_exchange', created->>'id', true);

  IF current_setting('app.b4_create_scratch', true) = 'yes' THEN
    code := 'B4' || upper(substr(md5(clock_timestamp()::text || random()::text || ':scratch'), 1, 8));
    draft := jsonb_build_object(
      'name', '驗收刮卡券',
      'code', code,
      'kind', 'cash',
      'amount', 10,
      'percent', 0,
      'maxDiscount', 0,
      'gift', '',
      'minSpend', 100,
      'qty', 1,
      'startAt', day,
      'endAt', ending,
      'listed', true,
      'shelf', false
    );
    created := public.save_my_seller_coupon(NULL, draft);
    IF (created->>'listed')::boolean IS DISTINCT FROM true OR (created->>'qty')::integer IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '測試刮卡券沒有建立';
    END IF;
    PERFORM set_config('app.b4_scratch_coupon', created->>'id', true);
  END IF;
END
$b4_create$;

RESET ROLE;

DO $b4_snapshot$
DECLARE
  exchange_id uuid := current_setting('app.b4_exchange', true)::uuid;
  q integer;
  issued integer;
BEGIN
  IF exchange_id IS NULL THEN
    RAISE EXCEPTION '沒有可兌換的測試券。交易會回復。';
  END IF;
  SELECT coupon.qty, coupon.issued_count
  INTO q, issued
  FROM public.seller_coupons AS coupon
  WHERE coupon.id = exchange_id
    AND coupon.game_pool
    AND coupon.active
    AND coupon.deleted_at IS NULL
    AND coupon.issued_count < coupon.qty;
  IF NOT FOUND THEN
    RAISE EXCEPTION '測試兌換券不是可發的授權券。交易會回復。';
  END IF;
  PERFORM set_config('app.b4_exchange_qty', q::text, true);
  PERFORM set_config('app.b4_exchange_start_issued', issued::text, true);
  CREATE TEMP TABLE pg_temp.b4_issued_before AS
  SELECT coupon.id, coupon.issued_count
  FROM public.seller_coupons AS coupon;

  PERFORM set_config('request.jwt.claim.sub', current_setting('app.b4_poor', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.b4_poor', true), 'role', 'authenticated')::text, true);
END
$b4_snapshot$;

SET LOCAL ROLE authenticated;

DO $b4_checkin$
DECLARE
  posted jsonb;
BEGIN
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.b4_poor', true) THEN
    RAISE EXCEPTION '無法模擬點數不足的會員。交易會回復。';
  END IF;
  posted := public.claim_my_daily_checkin();
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (posted->>'awardedDelta')::integer IS NULL
     OR (posted->>'awardedDelta')::integer <= 0
     OR (posted->>'awardedDelta')::integer >= 100
     OR (posted->>'balance')::integer IS NULL
     OR (posted->>'balance')::integer >= 100
     OR (posted->>'balance')::integer < (posted->>'awardedDelta')::integer THEN
    RAISE EXCEPTION '正式簽到沒有給出低於 100 的可驗證點數';
  END IF;
  PERFORM set_config('app.b4_poor_before', posted->>'balance', true);
END
$b4_checkin$;

RESET ROLE;

DO $b4_poor_balance$
DECLARE
  poor uuid := current_setting('app.b4_poor', true)::uuid;
  actual integer;
  account_found boolean;
BEGIN
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
  SELECT account.balance
  INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = poor;
  account_found := FOUND;
  IF NOT account_found OR actual IS DISTINCT FROM current_setting('app.b4_poor_before', true)::integer
     OR actual IS NULL
     OR actual >= 100
     OR actual IS DISTINCT FROM (
       SELECT coalesce(sum(entry.delta), 0)
       FROM public.member_point_entries AS entry
       WHERE entry.user_id = poor
     ) THEN
    RAISE EXCEPTION '點數不足會員的簽到餘額與流水不一致';
  END IF;
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim DEFERRED';
END
$b4_poor_balance$;

SET LOCAL ROLE authenticated;

DO $b4_part1$
DECLARE
  plan text := current_setting('app.b4_plan', true);
  exchange_id uuid := current_setting('app.b4_exchange', true)::uuid;
  rich uuid := current_setting('app.b4_rich', true)::uuid;
  poor uuid := current_setting('app.b4_poor', true)::uuid;
  scratch uuid := current_setting('app.b4_scratch', true)::uuid;
  first jsonb;
  replay jsonb;
  drawn jsonb;
  revealed jsonb;
  found boolean := false;
  i integer;
  actor uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', poor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', poor::text, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM poor THEN
    RAISE EXCEPTION '無法模擬點數不足的會員';
  END IF;
  BEGIN
    PERFORM public.exchange_my_coupon(exchange_id);
    RAISE EXCEPTION '點數不足時不應兌換成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '點數不足' THEN
        RAISE;
      END IF;
  END;

  IF plan IN ('shared', 'shared_existing') THEN
    actor := scratch;
  ELSE
    actor := NULL;
  END IF;

  IF actor IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', scratch::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', scratch::text, 'role', 'authenticated')::text, true);
    IF auth.uid() IS DISTINCT FROM scratch THEN
      RAISE EXCEPTION '無法模擬刮卡會員';
    END IF;
    found := false;
    FOR i IN 1..400 LOOP
      PERFORM setseed((i::double precision * 2 / 401.0) - 1);
      BEGIN
        drawn := public.draw_my_scratch_card();
        IF drawn->'card'->>'outcomeKind' IS DISTINCT FROM 'coupon'
           OR (drawn->'card'->>'points')::integer IS DISTINCT FROM 0
           OR drawn->>'awardedDelta' IS NOT NULL
           OR (drawn->>'replayed')::boolean IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'b4-seed-retry-coupon';
        END IF;
        found := true;
      EXCEPTION
        WHEN raise_exception THEN
          IF SQLERRM IS DISTINCT FROM 'b4-seed-retry-coupon' THEN
            RAISE;
          END IF;
      END;
      EXIT WHEN found;
    END LOOP;
    IF NOT found THEN
      RAISE EXCEPTION '預演停止：有限種子內沒有由正式刮卡入口發到一般券。不會把其他獎項說成發券。交易會回復。';
    END IF;
    PERFORM set_config('app.b4_scratch_card', drawn->'card'->>'id', true);
    replay := public.draw_my_scratch_card();
    IF (replay->>'replayed')::boolean IS DISTINCT FROM true
       OR replay->'card'->>'id' IS DISTINCT FROM drawn->'card'->>'id'
       OR replay->'card'->>'outcomeKind' IS DISTINCT FROM 'coupon' THEN
      RAISE EXCEPTION '同一張刮卡重新請求時又抽了一次';
    END IF;
    revealed := public.reveal_my_scratch_card();
    IF revealed->'card'->>'id' IS DISTINCT FROM drawn->'card'->>'id'
       OR (revealed->'card'->>'revealed')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION '揭曉改變了刮卡結果';
    END IF;
    BEGIN
      PERFORM public.draw_my_scratch_card();
      RAISE EXCEPTION '次數用完後不應再發券';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM '今日刮卡次數已用完' THEN
          RAISE;
        END IF;
    END;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', rich::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', rich::text, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM rich THEN
    RAISE EXCEPTION '無法模擬有 100 點的會員';
  END IF;
  first := public.exchange_my_coupon(exchange_id);
  IF (first->>'replayed')::boolean IS DISTINCT FROM false
     OR (first->>'balance')::integer IS DISTINCT FROM 0
     OR first->'hold'->>'couponId' IS DISTINCT FROM exchange_id::text
     OR first->'hold'->>'source' IS DISTINCT FROM 'points' THEN
    RAISE EXCEPTION '100 點兌換沒有完成';
  END IF;
  replay := public.exchange_my_coupon(exchange_id);
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'balance')::integer IS DISTINCT FROM 0
     OR replay->'hold'->>'id' IS DISTINCT FROM first->'hold'->>'id' THEN
    RAISE EXCEPTION '重複兌換又扣了點或又發了一張';
  END IF;
  PERFORM set_config('app.b4_exchange_hold', first->'hold'->>'id', true);

  PERFORM set_config('request.jwt.claim.sub', current_setting('app.b4_rich2', true), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.b4_rich2', true), 'role', 'authenticated')::text, true);
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.b4_rich2', true) THEN
    RAISE EXCEPTION '無法模擬第二位兌換會員';
  END IF;
  BEGIN
    PERFORM public.exchange_my_coupon(exchange_id);
    RAISE EXCEPTION '庫存不足時不應兌換成功';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '此優惠券已被領完' THEN
        RAISE;
      END IF;
  END;

  IF plan NOT IN ('shared', 'shared_existing') THEN
    PERFORM set_config('request.jwt.claim.sub', scratch::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', scratch::text, 'role', 'authenticated')::text, true);
    IF auth.uid() IS DISTINCT FROM scratch THEN
      RAISE EXCEPTION '無法模擬刮卡會員';
    END IF;
    found := false;
    FOR i IN 1..400 LOOP
      PERFORM setseed((i::double precision * 2 / 401.0) - 1);
      BEGIN
        drawn := public.draw_my_scratch_card();
        IF drawn->'card'->>'outcomeKind' IS DISTINCT FROM 'coupon'
           OR (drawn->'card'->>'points')::integer IS DISTINCT FROM 0
           OR drawn->>'awardedDelta' IS NOT NULL
           OR (drawn->>'replayed')::boolean IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'b4-seed-retry-coupon';
        END IF;
        found := true;
      EXCEPTION
        WHEN raise_exception THEN
          IF SQLERRM IS DISTINCT FROM 'b4-seed-retry-coupon' THEN
            RAISE;
          END IF;
      END;
      EXIT WHEN found;
    END LOOP;
    IF NOT found THEN
      RAISE EXCEPTION '預演停止：有限種子內沒有由正式刮卡入口發到一般券。不會把其他獎項說成發券。交易會回復。';
    END IF;
    PERFORM set_config('app.b4_scratch_card', drawn->'card'->>'id', true);
    replay := public.draw_my_scratch_card();
    IF (replay->>'replayed')::boolean IS DISTINCT FROM true
       OR replay->'card'->>'id' IS DISTINCT FROM drawn->'card'->>'id' THEN
      RAISE EXCEPTION '同一張刮卡重新請求時又抽了一次';
    END IF;
    revealed := public.reveal_my_scratch_card();
    IF revealed->'card'->>'id' IS DISTINCT FROM drawn->'card'->>'id' THEN
      RAISE EXCEPTION '揭曉改變了刮卡結果';
    END IF;
    BEGIN
      PERFORM public.draw_my_scratch_card();
      RAISE EXCEPTION '次數用完後不應再發券';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM '今日刮卡次數已用完' THEN
          RAISE;
        END IF;
    END;
  END IF;
END
$b4_part1$;

RESET ROLE;

DO $b4_verify1$
DECLARE
  plan text := current_setting('app.b4_plan', true);
  exchange_id uuid := current_setting('app.b4_exchange', true)::uuid;
  rich uuid := current_setting('app.b4_rich', true)::uuid;
  rich2 uuid := current_setting('app.b4_rich2', true)::uuid;
  poor uuid := current_setting('app.b4_poor', true)::uuid;
  scratch uuid := current_setting('app.b4_scratch', true)::uuid;
  expected integer;
  actual integer;
  hold_count integer;
  claim_count integer;
  scratch_coupon uuid;
  changed integer;
  other_changed integer;
  play_points integer;
  play_kind text;
  v_claim_key text;
BEGIN
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'off', true);
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = rich;
  IF actual IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '兌換後餘額不是剛好少 100 點';
  END IF;
  SELECT count(*)::integer, coalesce(sum(claim.delta), 0)
  INTO claim_count, actual
  FROM public.reward_claims AS claim
  WHERE claim.user_id = rich
    AND claim.kind = 'coupon_exchange'
    AND claim.claim_key = 'coupon_exchange:' || exchange_id::text;
  IF claim_count IS DISTINCT FROM 1 OR actual IS DISTINCT FROM -100 THEN
    RAISE EXCEPTION '兌換領獎紀錄不是剛好一筆 -100';
  END IF;
  IF (
    SELECT coalesce(sum(entry.delta), 0)
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = rich
  ) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '兌換會員的點數流水加總不是 0';
  END IF;
  SELECT count(*)::integer INTO hold_count
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = rich
    AND hold.coupon_id = exchange_id
    AND hold.source = 'points';
  IF hold_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '兌換沒有剛好發一張券進券包';
  END IF;

  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = rich2;
  IF actual IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION '庫存不足時第二位會員仍被扣點';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reward_claims AS claim
    WHERE claim.user_id = rich2
      AND claim.kind = 'coupon_exchange'
  ) OR EXISTS (
    SELECT 1
    FROM public.member_coupon_holds AS hold
    WHERE hold.user_id = rich2
  ) THEN
    RAISE EXCEPTION '庫存不足時仍寫入領獎或券包';
  END IF;

  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = poor;
  IF actual IS DISTINCT FROM current_setting('app.b4_poor_before', true)::integer THEN
    RAISE EXCEPTION '點數不足時餘額仍變動';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reward_claims AS claim
    WHERE claim.user_id = poor AND claim.kind = 'coupon_exchange'
  ) OR EXISTS (
    SELECT 1 FROM public.member_coupon_holds AS hold
    WHERE hold.user_id = poor
  ) THEN
    RAISE EXCEPTION '點數不足時仍發券或寫入兌換紀錄';
  END IF;

  IF plan IN ('shared', 'shared_existing') THEN
    expected := 2;
  ELSE
    expected := 1;
  END IF;
  SELECT coupon.issued_count
  INTO actual
  FROM public.seller_coupons AS coupon
  WHERE coupon.id = exchange_id;
  IF actual IS DISTINCT FROM current_setting('app.b4_exchange_start_issued', true)::integer + expected THEN
    RAISE EXCEPTION '兌換券已發行數量不是預期增加量';
  END IF;

  SELECT count(*)::integer INTO hold_count
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = scratch
    AND hold.source = 'scratch';
  IF hold_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '刮卡沒有剛好發一張券';
  END IF;
  SELECT hold.coupon_id
  INTO scratch_coupon
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = scratch
    AND hold.source = 'scratch';

  SELECT play.outcome_kind, play.points, play.claim_key
  INTO play_kind, play_points, v_claim_key
  FROM public.scratch_plays AS play
  WHERE play.id = current_setting('app.b4_scratch_card', true)::uuid
    AND play.user_id = scratch;
  IF play_kind IS DISTINCT FROM 'coupon' OR play_points IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '刮卡紀錄不是零點發券';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reward_claims AS claim
    WHERE claim.user_id = scratch
      AND claim.claim_key = v_claim_key
  ) OR EXISTS (
    SELECT 1 FROM public.member_point_entries AS entry
    WHERE entry.user_id = scratch
  ) THEN
    RAISE EXCEPTION '真實發券後又入帳點數';
  END IF;
  SELECT account.balance
  INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = scratch;
  IF NOT FOUND THEN
    actual := 0;
  END IF;
  IF actual IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '真實發券後餘額不是 0';
  END IF;

  SELECT coalesce(sum(coupon.issued_count - before.issued_count), 0)::integer
  INTO changed
  FROM public.seller_coupons AS coupon
  JOIN pg_temp.b4_issued_before AS before ON before.id = coupon.id;
  IF changed IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '兌換與刮卡合計沒有剛好發出 2 張';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.seller_coupons AS coupon
    JOIN pg_temp.b4_issued_before AS before ON before.id = coupon.id
    WHERE coupon.issued_count < before.issued_count
  ) OR EXISTS (
    SELECT 1
    FROM public.seller_coupons AS coupon
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.b4_issued_before AS before WHERE before.id = coupon.id)
  ) THEN
    RAISE EXCEPTION '刮卡發券不應新建券種或把已發行數量改少';
  END IF;

  IF plan IN ('shared', 'shared_existing') THEN
    IF scratch_coupon IS DISTINCT FROM exchange_id THEN
      RAISE EXCEPTION '唯一授權券沒有發到刮卡券包';
    END IF;
    SELECT count(*)::integer INTO other_changed
    FROM public.seller_coupons AS coupon
    JOIN pg_temp.b4_issued_before AS before ON before.id = coupon.id
    WHERE coupon.id IS DISTINCT FROM exchange_id
      AND coupon.issued_count IS DISTINCT FROM before.issued_count;
    IF other_changed IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '共享測試券以外的庫存被改動';
    END IF;
  ELSE
    IF scratch_coupon IS NOT DISTINCT FROM exchange_id THEN
      RAISE EXCEPTION '已領完的兌換券又被刮卡發出去';
    END IF;
    SELECT coupon.issued_count - before.issued_count
    INTO actual
    FROM public.seller_coupons AS coupon
    JOIN pg_temp.b4_issued_before AS before ON before.id = coupon.id
    WHERE coupon.id = scratch_coupon;
    IF actual IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '刮中的優惠券庫存不是剛好少 1 張';
    END IF;
    SELECT count(*)::integer INTO other_changed
    FROM public.seller_coupons AS coupon
    JOIN pg_temp.b4_issued_before AS before ON before.id = coupon.id
    WHERE coupon.id IS DISTINCT FROM exchange_id
      AND coupon.id IS DISTINCT FROM scratch_coupon
      AND coupon.issued_count IS DISTINCT FROM before.issued_count;
    IF other_changed IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '刮卡改到了兩張以上的優惠券庫存';
    END IF;
  END IF;

  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim DEFERRED';
END
$b4_verify1$;

DO $b4_prehold$
DECLARE
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
  day date := current_setting('app.b4_day', true)::date;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.seller_coupons AS coupon
    WHERE coupon.game_pool
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.issued_count < coupon.qty
      AND coupon.start_on <= day
      AND coupon.end_on >= day
  ) THEN
    RAISE EXCEPTION '預演停止：替代點數測試時仍有可發授權券。不會用領券把庫存耗盡。交易會回復。';
  END IF;
  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.b4_preheld', '0', true);

  DROP TABLE IF EXISTS pg_temp.b4_issued_fallback;
  CREATE TEMP TABLE pg_temp.b4_issued_fallback AS
  SELECT coupon.id, coupon.issued_count
  FROM public.seller_coupons AS coupon;

  PERFORM set_config('request.jwt.claim.sub', fallback::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fallback::text, 'role', 'authenticated')::text, true);
END
$b4_prehold$;

SET LOCAL ROLE authenticated;

DO $b4_fallback_draw$
DECLARE
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
  drawn jsonb;
  found boolean := false;
  i integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM fallback THEN
    RAISE EXCEPTION '無法模擬沒有可領授權券的會員';
  END IF;
  FOR i IN 1..400 LOOP
    PERFORM setseed((i::double precision * 2 / 401.0) - 1);
    BEGIN
      drawn := public.draw_my_scratch_card();
      IF drawn->'card'->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback'
         OR (drawn->'card'->>'points')::integer IS DISTINCT FROM 20
         OR (drawn->>'awardedDelta')::integer IS DISTINCT FROM 20
         OR (drawn->>'balance')::integer IS DISTINCT FROM 20
         OR (drawn->>'replayed')::boolean IS DISTINCT FROM false
         OR drawn->'card'->>'coupon' IS NOT NULL THEN
        RAISE EXCEPTION 'b4-seed-retry-fallback';
      END IF;
      found := true;
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'b4-seed-retry-fallback' THEN
          RAISE;
        END IF;
    END;
    EXIT WHEN found;
  END LOOP;
  IF NOT found THEN
    RAISE EXCEPTION '預演停止：有限種子內沒有維持 20 點替代。不會把發券說成替代點數。交易會回復。';
  END IF;
  PERFORM set_config('app.b4_fallback_card', drawn->'card'->>'id', true);
END
$b4_fallback_draw$;

RESET ROLE;

DO $b4_verify_fallback$
DECLARE
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
  play_id uuid := current_setting('app.b4_fallback_card', true)::uuid;
  play_kind text;
  play_points integer;
  v_claim_key text;
  actual integer;
  claim_count integer;
BEGIN
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  SELECT play.outcome_kind, play.points, play.claim_key
  INTO play_kind, play_points, v_claim_key
  FROM public.scratch_plays AS play
  WHERE play.id = play_id
    AND play.user_id = fallback;
  IF play_kind IS DISTINCT FROM 'coupon_fallback' OR play_points IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '替代點數的刮卡紀錄不正確';
  END IF;
  SELECT count(*)::integer, coalesce(sum(claim.delta), 0)
  INTO claim_count, actual
  FROM public.reward_claims AS claim
  WHERE claim.user_id = fallback
    AND claim.claim_key = v_claim_key
    AND claim.kind = 'scratch';
  IF claim_count IS DISTINCT FROM 1 OR actual IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '20 點替代不是剛好一筆領獎';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_point_entries AS entry
    WHERE entry.user_id = fallback
      AND entry.delta IN (2, 5)
  ) THEN
    RAISE EXCEPTION '替代點數另外贈送了點數';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_coupon_holds AS hold
    WHERE hold.user_id = fallback
      AND hold.source = 'scratch'
  ) THEN
    RAISE EXCEPTION '20 點替代同時發了刮卡券';
  END IF;
  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = fallback;
  IF actual IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '替代點數後餘額不是 20';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.seller_coupons AS coupon
    JOIN pg_temp.b4_issued_fallback AS before ON before.id = coupon.id
    WHERE coupon.issued_count IS DISTINCT FROM before.issued_count
  ) THEN
    RAISE EXCEPTION '走替代點數時優惠券庫存仍被扣減';
  END IF;

  PERFORM set_config('app.b4_replay_seller', current_setting('app.b4_seller', true), true);
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.b4_seller', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.b4_seller', true), 'role', 'authenticated')::text, true);
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim DEFERRED';
END
$b4_verify_fallback$;

SET LOCAL ROLE authenticated;

DO $b4_extra_coupon$
DECLARE
  created jsonb;
  code text;
  day text := current_setting('app.b4_day', true);
BEGIN
  IF current_setting('app.b4_replay_seller', true) = '' THEN
    RETURN;
  END IF;
  IF auth.uid()::text IS DISTINCT FROM current_setting('app.b4_replay_seller', true) THEN
    RAISE EXCEPTION '無法模擬還有曝光名額的商家';
  END IF;
  code := 'B4' || upper(substr(md5(clock_timestamp()::text || random()::text || ':replay'), 1, 8));
  BEGIN
    created := public.save_my_seller_coupon(NULL, jsonb_build_object(
      'name', '驗收補發券',
      'code', code,
      'kind', 'cash',
      'amount', 10,
      'percent', 0,
      'maxDiscount', 0,
      'gift', '',
      'minSpend', 100,
      'qty', 5,
      'startAt', day,
      'endAt', to_char(day::date + 90, 'YYYY-MM-DD'),
      'listed', true,
      'shelf', false
    ));
    PERFORM set_config('app.b4_replay_new_coupon', created->>'id', true);
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '每家店最多同時上架 3 張到簽到專區' THEN
        RAISE;
      END IF;
      PERFORM set_config('app.b4_replay_new_coupon', '', true);
  END;
END
$b4_extra_coupon$;

RESET ROLE;

DO $b4_switch_part2$
DECLARE
  observed text := NULL;
  coupon_id text := current_setting('app.b4_replay_new_coupon', true);
  play_id uuid := current_setting('app.b4_fallback_card', true)::uuid;
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
BEGIN
  IF coalesce(coupon_id, '') <> '' THEN
    BEGIN
      PERFORM set_config('app.coupon_issue', 'on', true);
      PERFORM public.issue_member_coupon(
        fallback,
        coupon_id::uuid,
        'scratch',
        'scratch:' || play_id::text,
        play_id
      );
      observed := 'allowed';
      RAISE EXCEPTION 'b4-reissue-rollback';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'b4-reissue-rollback' THEN
          observed := SQLERRM;
        END IF;
      WHEN insufficient_privilege THEN
        observed := SQLERRM;
    END;
  ELSE
    observed := 'skipped-no-new-coupon';
  END IF;
  IF observed IS NULL THEN
    observed := 'allowed';
  END IF;
  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.b4_owner_reissue', observed, true);

  PERFORM set_config('request.jwt.claim.sub', fallback::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fallback::text, 'role', 'authenticated')::text, true);
END
$b4_switch_part2$;

SET LOCAL ROLE authenticated;

DO $b4_part2$
DECLARE
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
  founder uuid := current_setting('app.b4_founder', true)::uuid;
  replay jsonb;
  revealed jsonb;
  drawn jsonb;
  found boolean := false;
  i integer;
  scratch_holds integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM fallback THEN
    RAISE EXCEPTION '無法回到已拿到替代點數的會員';
  END IF;
  replay := public.draw_my_scratch_card();
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR replay->'card'->>'id' IS DISTINCT FROM current_setting('app.b4_fallback_card', true)
     OR replay->'card'->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback'
     OR (replay->>'balance')::integer IS DISTINCT FROM 20
     OR replay->'card'->>'coupon' IS NOT NULL THEN
    RAISE EXCEPTION '替代點數後重新請求又發了券或又加了點';
  END IF;
  revealed := public.reveal_my_scratch_card();
  IF revealed->'card'->>'id' IS DISTINCT FROM current_setting('app.b4_fallback_card', true)
     OR revealed->'card'->>'coupon' IS NOT NULL THEN
    RAISE EXCEPTION '揭曉替代點數卡時補發了優惠券';
  END IF;
  BEGIN
    PERFORM public.draw_my_scratch_card();
    RAISE EXCEPTION '替代點數後不應再刮一張';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '今日刮卡次數已用完' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', founder::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', founder::text, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM founder THEN
    RAISE EXCEPTION '無法模擬創始券測試會員';
  END IF;
  FOR i IN 1..400 LOOP
    PERFORM setseed((i::double precision * 2 / 401.0) - 1);
    BEGIN
      drawn := public.draw_my_scratch_card();
      IF drawn->'card'->>'outcomeKind' IS DISTINCT FROM 'founder_fallback'
         OR (drawn->'card'->>'points')::integer IS DISTINCT FROM 30
         OR (drawn->>'awardedDelta')::integer IS DISTINCT FROM 30
         OR (drawn->>'balance')::integer IS DISTINCT FROM 30
         OR drawn->'card'->>'coupon' IS NOT NULL THEN
        RAISE EXCEPTION 'b4-seed-retry-founder';
      END IF;
      found := true;
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM 'b4-seed-retry-founder' THEN
          RAISE;
        END IF;
    END;
    EXIT WHEN found;
  END LOOP;
  IF NOT found THEN
    RAISE EXCEPTION '預演停止：有限種子內沒有維持創始券 30 點替代。交易會回復。';
  END IF;
  PERFORM set_config('app.b4_founder_card', drawn->'card'->>'id', true);
  replay := public.draw_my_scratch_card();
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'balance')::integer IS DISTINCT FROM 30
     OR replay->'card'->>'coupon' IS NOT NULL THEN
    RAISE EXCEPTION '創始券替代點數被重送或補發券';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', current_setting('app.b4_poor', true), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('app.b4_poor', true), 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.post_coupon_exchange_debit(
      current_setting('app.b4_rich', true)::uuid,
      'coupon_exchange:blocked',
      jsonb_build_object('source', 'blocked')
    );
    RAISE EXCEPTION '一般會員不應能呼叫內部扣點';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.issue_member_coupon(
      current_setting('app.b4_poor', true)::uuid,
      current_setting('app.b4_exchange', true)::uuid,
      'points',
      'points:blocked',
      NULL
    );
    RAISE EXCEPTION '一般會員不應能呼叫內部發券';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.post_member_reward(
      current_setting('app.b4_poor', true)::uuid,
      'checkin',
      'checkin:' || current_setting('app.b4_day', true),
      10,
      jsonb_build_object('purpose', 'blocked')
    );
    RAISE EXCEPTION '一般會員不應能直接呼叫發獎函式';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    INSERT INTO public.member_point_entries DEFAULT VALUES;
    RAISE EXCEPTION '一般會員不應能改寫帳本';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    UPDATE public.member_point_accounts
    SET balance = balance + 100
    WHERE user_id = current_setting('app.b4_rich', true)::uuid;
    GET DIAGNOSTICS scratch_holds = ROW_COUNT;
    IF scratch_holds <> 0 THEN
      RAISE EXCEPTION '一般會員不應能改寫餘額';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '點數餘額只能由發獎交易更新' THEN
        RAISE;
      END IF;
  END;
END
$b4_part2$;

RESET ROLE;

DO $b4_anon_switch$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
END
$b4_anon_switch$;

SET LOCAL ROLE anon;

DO $b4_anon$
BEGIN
  BEGIN
    PERFORM public.exchange_my_coupon(current_setting('app.b4_exchange', true)::uuid);
    RAISE EXCEPTION '匿名不應能兌換';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.draw_my_scratch_card();
    RAISE EXCEPTION '匿名不應能刮卡';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END
$b4_anon$;

RESET ROLE;

DO $b4_final$
DECLARE
  fallback uuid := current_setting('app.b4_fallback', true)::uuid;
  founder uuid := current_setting('app.b4_founder', true)::uuid;
  play_kind text;
  play_points integer;
  actual integer;
  claim_count integer;
  coupon_count_before integer;
  coupon_count_after integer;
BEGIN
  PERFORM set_config('app.reward_post', 'off', true);
  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'off', true);
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = fallback;
  IF actual IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '重新請求替代點數卡後餘額改變';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_coupon_holds AS hold
    WHERE hold.scratch_play_id = current_setting('app.b4_fallback_card', true)::uuid
  ) THEN
    RAISE EXCEPTION '已入替代點數的刮卡後來又補了優惠券';
  END IF;
  SELECT count(*)::integer INTO claim_count
  FROM public.reward_claims AS claim
  WHERE claim.user_id = fallback
    AND claim.kind = 'scratch';
  IF claim_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '替代點數被重複入帳';
  END IF;

  SELECT play.outcome_kind, play.points
  INTO play_kind, play_points
  FROM public.scratch_plays AS play
  WHERE play.id = current_setting('app.b4_founder_card', true)::uuid
    AND play.user_id = founder;
  IF play_kind IS DISTINCT FROM 'founder_fallback' OR play_points IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券刮卡紀錄不是 30 點替代';
  END IF;
  SELECT account.balance INTO actual
  FROM public.member_point_accounts AS account
  WHERE account.user_id = founder;
  IF actual IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券替代後餘額不是 30';
  END IF;
  SELECT count(*)::integer, coalesce(sum(claim.delta), 0)
  INTO claim_count, actual
  FROM public.reward_claims AS claim
  WHERE claim.user_id = founder
    AND claim.kind = 'scratch';
  IF claim_count IS DISTINCT FROM 1 OR actual IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券不是剛好一筆 30 點';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_coupon_holds AS hold
    WHERE hold.user_id = founder
  ) OR EXISTS (
    SELECT 1 FROM public.member_point_entries AS entry
    WHERE entry.user_id = founder
      AND entry.delta IS DISTINCT FROM 30
  ) THEN
    RAISE EXCEPTION '創始券建立了券包或額外點數';
  END IF;

  SELECT count(*)::integer INTO coupon_count_before FROM pg_temp.b4_issued_fallback;
  SELECT count(*)::integer INTO coupon_count_after FROM public.seller_coupons;
  IF current_setting('app.b4_replay_new_coupon', true) = '' THEN
    IF coupon_count_after IS DISTINCT FROM coupon_count_before THEN
      RAISE EXCEPTION '創始券測試建立了優惠券庫存';
    END IF;
  ELSE
    IF coupon_count_after IS DISTINCT FROM coupon_count_before + 1 THEN
      RAISE EXCEPTION '補發測試以外多建立了優惠券';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.member_coupon_holds AS hold
      WHERE hold.coupon_id = current_setting('app.b4_replay_new_coupon', true)::uuid
    ) OR EXISTS (
      SELECT 1 FROM public.seller_coupons AS coupon
      WHERE coupon.id = current_setting('app.b4_replay_new_coupon', true)::uuid
        AND coupon.issued_count IS DISTINCT FROM 0
    ) THEN
      RAISE EXCEPTION '新的授權券被補發到已經拿過替代點數的刮卡';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reward_claims AS claim
    JOIN public.member_point_entries AS entry ON entry.id = claim.point_entry_id
    JOIN pg_temp.b4_isolated_users AS isolated ON isolated.id = claim.user_id
    WHERE entry.user_id IS DISTINCT FROM claim.user_id
       OR entry.claim_key IS DISTINCT FROM claim.claim_key
       OR entry.kind IS DISTINCT FROM claim.kind
       OR entry.delta IS DISTINCT FROM claim.delta
       OR entry.balance_after IS DISTINCT FROM claim.balance_after
       OR entry.taipei_day IS DISTINCT FROM claim.taipei_day
  ) THEN
    RAISE EXCEPTION '領獎紀錄與點數流水不一致';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.member_point_accounts AS account
    JOIN pg_temp.b4_balance_before AS before ON before.user_id = account.user_id
    WHERE account.balance IS DISTINCT FROM before.balance
  ) OR EXISTS (
    SELECT 1
    FROM pg_temp.b4_balance_before AS before
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.member_point_accounts AS account
      WHERE account.user_id = before.user_id
    )
  ) THEN
    RAISE EXCEPTION '其他會員的點數被改寫';
  END IF;

  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim DEFERRED';
END
$b4_final$;

SELECT
  '第四批補充驗收通過：100 點兌換與刮卡發券互斥已在這個交易內驗證，即將回復。' AS result,
  current_setting('app.b4_plan', true) AS exchange_plan,
  current_setting('app.b4_replay_new_coupon', true) <> '' AS fallback_replay_saw_new_coupon,
  current_setting('app.b4_issue_privileges', true) AS issue_member_coupon_privileges,
  current_setting('app.b4_owner_reissue', true) AS owner_reissue_after_fallback;

ROLLBACK;
