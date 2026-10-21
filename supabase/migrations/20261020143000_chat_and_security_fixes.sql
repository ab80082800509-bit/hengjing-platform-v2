-- =============================================================================
-- 安全修正與賣場聊天
-- 請在 20261020120000_buyer_store_features.sql 之後人工審查並執行一次。本檔不執行。
-- 不 UPDATE / DELETE 既有 products、會員或訂單。不關閉 RLS。不授權 service_role 給前端。
-- 若上一支 migration 已用較早版本執行，本檔會覆寫個人資料保護、賣場圖片網址與銷量認列函式。
-- 聊天是買賣家站內訊息，與平台客服工單分開。不會發送 LINE。
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- profiles：一般會員只能改自己的頭像欄位。角色與其他欄位維持原值。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_profile_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor text := coalesce(auth.role(), '');
  trusted_nickname boolean := current_setting('app.nickname_write', true) = 'on';
  next_avatar text;
  next_tone smallint;
  next_nickname text;
  next_changed timestamptz;
  next_initialized boolean;
BEGIN
  IF actor = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'buyer';
    IF NOT trusted_nickname THEN
      NEW.public_nickname := NULL;
      NEW.nickname_changed_at := NULL;
      NEW.nickname_initialized := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION '不能變更會員編號';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION '不能從個人資料變更會員角色或認證狀態';
  END IF;

  next_avatar := NEW.avatar_url;
  next_tone := NEW.avatar_tone;
  next_nickname := NEW.public_nickname;
  next_changed := NEW.nickname_changed_at;
  next_initialized := NEW.nickname_initialized;

  IF (
    next_nickname IS DISTINCT FROM OLD.public_nickname
    OR next_changed IS DISTINCT FROM OLD.nickname_changed_at
    OR next_initialized IS DISTINCT FROM OLD.nickname_initialized
  ) AND NOT trusted_nickname THEN
    RAISE EXCEPTION '暱稱只能透過正式修改流程更新';
  END IF;

  NEW := OLD;
  NEW.avatar_url := next_avatar;
  NEW.avatar_tone := coalesce(next_tone, OLD.avatar_tone);
  IF trusted_nickname THEN
    NEW.public_nickname := next_nickname;
    NEW.nickname_changed_at := next_changed;
    NEW.nickname_initialized := next_initialized;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT INSERT (id) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (avatar_url, avatar_tone) ON TABLE public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 賣場圖片必須是本專案 store-media、目前賣家 UUID 路徑，且檔案確實存在。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_media_url_ok(p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  uid text := auth.uid()::text;
  issuer text := coalesce(auth.jwt() ->> 'iss', '');
  host text;
  host_re text;
  path text;
  filename text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN true;
  END IF;
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  host := substring(issuer FROM '^https://([a-z0-9-]+\.supabase\.co)/auth/v1$');
  IF host IS NULL THEN
    RETURN false;
  END IF;
  host_re := replace(host, '.', '\.');
  IF p_url !~ (
    '^https://' || host_re || '/storage/v1/object/public/store-media/'
    || uid || '/[A-Za-z0-9._-]{1,180}$'
  ) THEN
    RETURN false;
  END IF;
  path := substring(p_url FROM '/store-media/([0-9a-f-]{36}/[A-Za-z0-9._-]{1,180})$');
  filename := split_part(path, '/', 2);
  IF split_part(path, '/', 1) IS DISTINCT FROM uid
     OR filename IS NULL
     OR filename = ''
     OR filename ~ '\.\.'
     OR split_part(path, '/', 3) <> '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'store-media'
      AND name = path
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 銷量只接受 service_role，而且訂單明細必須已完成、數量等於淨售出件數。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recognize_sale(
  p_order_item_id uuid,
  p_product_id uuid,
  p_seller_user_id uuid,
  p_quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF p_order_item_id IS NULL OR p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION '銷量認列資料不完整';
  END IF;
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION '銷量只能由訂單交易寫入';
  END IF;
  IF to_regclass('public.order_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'completed_at'
     ) THEN
    RAISE EXCEPTION '真實訂單尚未完成，不能認列銷量';
  END IF;

  BEGIN
    EXECUTE $q$
      SELECT oi.product_id = $2
         AND p.seller_id = $3
         AND o.completed_at IS NOT NULL
         AND GREATEST(oi.quantity - coalesce(oi.refunded_qty, 0), 0) = $4
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.id = $1
    $q$ INTO ok USING p_order_item_id, p_product_id, p_seller_user_id, p_quantity;
  EXCEPTION
    WHEN undefined_column OR undefined_table THEN
      RAISE EXCEPTION '真實訂單尚未完成，不能認列銷量';
  END;

  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION '這筆訂單明細尚未達到可認列的完成狀態';
  END IF;

  INSERT INTO public.sales_recognitions (order_item_id, product_id, seller_user_id, quantity, updated_at)
  VALUES (p_order_item_id, p_product_id, p_seller_user_id, p_quantity, now())
  ON CONFLICT (order_item_id) DO UPDATE
  SET
    product_id = EXCLUDED.product_id,
    seller_user_id = EXCLUDED.seller_user_id,
    quantity = EXCLUDED.quantity,
    updated_at = now()
  WHERE public.sales_recognitions.quantity IS DISTINCT FROM EXCLUDED.quantity
     OR public.sales_recognitions.product_id IS DISTINCT FROM EXCLUDED.product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_product_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.sold := 0;
  ELSE
    NEW.sold := OLD.sold;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_sensitive() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_media_url_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recognize_sale(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preserve_product_sold() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 買賣家聊天。平台客服工單不在這裡。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.seller_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_user_id uuid NOT NULL,
  product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  buyer_last_read_at timestamptz,
  seller_last_read_at timestamptz,
  CONSTRAINT seller_chats_not_self CHECK (buyer_id <> seller_user_id),
  CONSTRAINT seller_chats_pair_unique UNIQUE (buyer_id, seller_user_id)
);

CREATE TABLE IF NOT EXISTS public.seller_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.seller_chats (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_chat_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS seller_chats_seller_recent_idx
  ON public.seller_chats (seller_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS seller_chats_buyer_recent_idx
  ON public.seller_chats (buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS seller_chat_messages_chat_idx
  ON public.seller_chat_messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS seller_chat_messages_sender_recent_idx
  ON public.seller_chat_messages (sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

ALTER TABLE public.seller_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_chats_participant_select ON public.seller_chats;
CREATE POLICY seller_chats_participant_select
  ON public.seller_chats
  FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_user_id = auth.uid());

DROP POLICY IF EXISTS seller_chat_messages_participant_select ON public.seller_chat_messages;
CREATE POLICY seller_chat_messages_participant_select
  ON public.seller_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.seller_chats c
      WHERE c.id = chat_id
        AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
    )
  );

REVOKE ALL ON public.seller_chats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_chat_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_chats TO authenticated;
GRANT SELECT ON public.seller_chat_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.open_seller_chat(p_seller_user_id uuid, p_product_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  chat_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_seller_user_id IS NULL OR p_seller_user_id = uid THEN
    RAISE EXCEPTION '不能向這個賣場建立對話';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.seller_applications sa
    WHERE sa.user_id = p_seller_user_id
      AND sa.status = 'approved'
  ) THEN
    RAISE EXCEPTION '只能聯繫已核准的賣場';
  END IF;
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.seller_id = p_seller_user_id
      AND public.product_is_public(to_jsonb(p))
  ) THEN
    RAISE EXCEPTION '這個商品目前不能附在對話中';
  END IF;

  INSERT INTO public.seller_chats (buyer_id, seller_user_id, product_id)
  VALUES (uid, p_seller_user_id, p_product_id)
  ON CONFLICT (buyer_id, seller_user_id) DO UPDATE
  SET product_id = COALESCE(EXCLUDED.product_id, public.seller_chats.product_id)
  RETURNING id INTO chat_id;

  RETURN chat_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_seller_chat_message(p_chat_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_body, ''));
  chat public.seller_chats%ROWTYPE;
  message_id uuid;
  recipient uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF cleaned = '' OR char_length(cleaned) > 500 THEN
    RAISE EXCEPTION '訊息需為 1 到 500 個字';
  END IF;
  IF cleaned ~ '[[:cntrl:]]' AND cleaned ~ '[^[:space:]]' AND cleaned ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]' THEN
    RAISE EXCEPTION '訊息包含無法使用的字元';
  END IF;

  SELECT * INTO chat FROM public.seller_chats WHERE id = p_chat_id;
  IF NOT FOUND OR (chat.buyer_id <> uid AND chat.seller_user_id <> uid) THEN
    RAISE EXCEPTION '不能在這則對話發言';
  END IF;
  IF chat.seller_user_id = uid AND NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能回覆買家';
  END IF;
  IF (
    SELECT count(*)
    FROM public.seller_chat_messages
    WHERE sender_id = uid
      AND created_at > now() - interval '1 minute'
  ) >= 10 THEN
    RAISE EXCEPTION '傳送過於頻繁，請稍後再試';
  END IF;

  INSERT INTO public.seller_chat_messages (chat_id, sender_id, body)
  VALUES (p_chat_id, uid, cleaned)
  RETURNING id INTO message_id;

  UPDATE public.seller_chats
  SET last_message_at = now()
  WHERE id = p_chat_id;

  recipient := CASE WHEN chat.buyer_id = uid THEN chat.seller_user_id ELSE chat.buyer_id END;
  INSERT INTO public.notification_outbox (event_key, kind, user_id, payload)
  VALUES (
    'seller_chat_message:' || message_id::text,
    'seller_chat_message',
    recipient,
    jsonb_build_object('chatId', p_chat_id, 'messageId', message_id)
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN jsonb_build_object(
    'id', message_id,
    'chat_id', p_chat_id,
    'sender_id', uid,
    'body', cleaned,
    'created_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_seller_chats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.last_at DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT
        c.id,
        c.buyer_id,
        c.seller_user_id,
        c.product_id,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.name
          ELSE NULL
        END AS product_name,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.image
          ELSE NULL
        END AS product_image,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.price
          ELSE NULL
        END AS product_price,
        (pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))) AS product_visible,
        CASE
          WHEN c.buyer_id = uid THEN coalesce(store.store_name, '賣場')
          ELSE coalesce(nullif(btrim(buyer.public_nickname), ''), '買家')
        END AS peer_name,
        CASE
          WHEN c.buyer_id = uid THEN sf.logo_url
          ELSE buyer.avatar_url
        END AS peer_avatar,
        last_msg.body AS last_body,
        coalesce(c.last_message_at, c.created_at) AS last_at,
        (
          SELECT count(*)::integer
          FROM public.seller_chat_messages m
          WHERE m.chat_id = c.id
            AND m.sender_id <> uid
            AND m.created_at > CASE
              WHEN c.buyer_id = uid THEN coalesce(c.buyer_last_read_at, '-infinity'::timestamptz)
              ELSE coalesce(c.seller_last_read_at, '-infinity'::timestamptz)
            END
        ) AS unread
      FROM public.seller_chats c
      LEFT JOIN public.products pr ON pr.id = c.product_id
      LEFT JOIN public.profiles buyer ON buyer.id = c.buyer_id
      LEFT JOIN LATERAL (
        SELECT sa.store_name
        FROM public.seller_applications sa
        WHERE sa.user_id = c.seller_user_id AND sa.status = 'approved'
        ORDER BY sa.created_at DESC
        LIMIT 1
      ) store ON true
      LEFT JOIN public.storefronts sf ON sf.seller_user_id = c.seller_user_id
      LEFT JOIN LATERAL (
        SELECT m.body
        FROM public.seller_chat_messages m
        WHERE m.chat_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) last_msg ON true
      WHERE c.buyer_id = uid OR c.seller_user_id = uid
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_seller_chat_messages(p_chat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_chats c
    WHERE c.id = p_chat_id
      AND (c.buyer_id = uid OR c.seller_user_id = uid)
  ) THEN
    RAISE EXCEPTION '不能查看這則對話';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at), '[]'::jsonb)
    FROM (
      SELECT m.id, m.chat_id, m.sender_id, m.body, m.created_at
      FROM public.seller_chat_messages m
      WHERE m.chat_id = p_chat_id
      ORDER BY m.created_at DESC
      LIMIT 200
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_seller_chat_read(p_chat_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  UPDATE public.seller_chats
  SET
    buyer_last_read_at = CASE WHEN buyer_id = uid THEN now() ELSE buyer_last_read_at END,
    seller_last_read_at = CASE WHEN seller_user_id = uid THEN now() ELSE seller_last_read_at END
  WHERE id = p_chat_id
    AND (buyer_id = uid OR seller_user_id = uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION '不能更新這則對話的已讀狀態';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_chats;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_chat_messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.open_seller_chat(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_seller_chat_message(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_seller_chats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_seller_chat_messages(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_seller_chat_read(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.open_seller_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_seller_chat_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_seller_chats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_seller_chat_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_seller_chat_read(uuid) TO authenticated;

COMMIT;
