-- =============================================================================
-- 買賣家聊聊：照片與檔案。增量，不重跑歷史套用檔。
--
-- 前置檢查（本檔交易內確認，缺一即整筆回滾，不回補其他歷史功能）：
--   public.seller_chats / public.seller_chat_messages
--   public.send_seller_chat_message(uuid, text)
--   public.list_seller_chat_messages(uuid) 須為專案已知舊版或本檔版本
--   public.is_approved_seller()
--   public.notification_outbox 須有 event_key、kind、user_id、payload，且 event_key 有防重約束
--   storage.buckets / storage.objects
--   已存在的 seller_chat_attachments 須與本檔欄位、約束一致
--
-- 套用順序：
--   1. 既有買賣家聊聊（隔離庫為 supabase/manual/20261028030000_docker_missing_feature_objects.sql
--      或正式庫同等 migration）已存在。
--   2. 再套用本檔。本檔不修改文字／貼圖的 send_seller_chat_message(uuid, text)。
--
-- 隔離庫：
--   Get-Content supabase/manual/20261030031100_seller_chat_files.sql -Raw |
--     docker exec -i supabase_db_hengjing-stage45-local psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- 正式庫尚未套用。
--
-- 私人桶 seller-chat-files：不公開、單檔 8MB（對齊 product-images）、
-- JPG／PNG／WEBP（對齊現有圖片桶）與 PDF（對齊 seller-kyc）。
-- 不建立永久公開連結。已寫進訊息的物件不能刪；未送出的暫存才可刪。
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.seller_chats') IS NULL
     OR to_regclass('public.seller_chat_messages') IS NULL THEN
    RAISE EXCEPTION '缺少買賣家聊聊資料表，請先套用既有聊天功能，不要從本檔回補';
  END IF;
  IF to_regprocedure('public.send_seller_chat_message(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '缺少 public.send_seller_chat_message(uuid, text)';
  END IF;
  IF to_regprocedure('public.is_approved_seller()') IS NULL THEN
    RAISE EXCEPTION '缺少 public.is_approved_seller()';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION '缺少 Supabase Storage';
  END IF;
  IF to_regclass('public.notification_outbox') IS NULL THEN
    RAISE EXCEPTION '缺少 public.notification_outbox，請先套用既有聊天功能，不要從本檔回補';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('event_key', 'text'),
        ('kind', 'text'),
        ('user_id', 'uuid'),
        ('payload', 'jsonb')
    ) AS need(column_name, udt_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'notification_outbox'
        AND c.column_name = need.column_name
        AND c.udt_name = need.udt_name
        AND c.is_nullable = 'NO'
    )
  ) THEN
    RAISE EXCEPTION 'notification_outbox 欄位不足，停止';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.notification_outbox'::regclass
      AND con.contype = 'u'
      AND att.attname = 'event_key'
      AND cardinality(con.conkey) = 1
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index idx
    JOIN pg_attribute att
      ON att.attrelid = idx.indrelid
     AND att.attnum = ANY (idx.indkey)
    WHERE idx.indrelid = 'public.notification_outbox'::regclass
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND att.attname = 'event_key'
  ) THEN
    RAISE EXCEPTION 'notification_outbox 缺少 event_key 防重約束，停止';
  END IF;
END;
$$;

-- 指紋是函式本文（成對 dollar quote 之間的文字，CRLF 換成 LF）的 md5。
-- 常數來自專案來源檔，不從待檢資料庫讀出現行本文再寫回來。
-- list_seller_chat_messages(uuid) 舊版：
--   supabase/migrations/20261020143000_chat_and_security_fixes.sql
--   supabase/manual/20261028030000_docker_missing_feature_objects.sql
-- send_seller_chat_file、seller_chat_file_deletable 的上一版是本檔加上路徑鎖之前的本文。
DO $$
DECLARE
  fp text;
  known text[];
BEGIN
  IF to_regprocedure('public.list_seller_chat_messages(uuid)') IS NULL THEN
    RAISE EXCEPTION '缺少 list_seller_chat_messages(uuid)，請先套用既有聊天功能，不要從本檔回補';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO fp
  FROM pg_proc p
  WHERE p.oid = 'public.list_seller_chat_messages(uuid)'::regprocedure;
  known := ARRAY[
    '7529691f75392b78c75e25ddb3e8efa6',
    'c260ad262c297704ef19ce4263f0e284'
  ];
  IF NOT (fp = ANY (known)) THEN
    RAISE EXCEPTION 'list_seller_chat_messages(uuid) 是未知版本，停止';
  END IF;

  IF to_regprocedure('public.list_seller_chat_messages(uuid, timestamptz)') IS NOT NULL THEN
    SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO fp
    FROM pg_proc p
    WHERE p.oid = 'public.list_seller_chat_messages(uuid, timestamptz)'::regprocedure;
    known := ARRAY['c2b9ab21fa8a04ac9f3766a6462973fd'];
    IF NOT (fp = ANY (known)) THEN
      RAISE EXCEPTION 'list_seller_chat_messages(uuid, timestamptz) 是未知版本，停止';
    END IF;
  END IF;

  IF to_regprocedure('public.send_seller_chat_file(uuid, text, text, uuid)') IS NOT NULL THEN
    SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO fp
    FROM pg_proc p
    WHERE p.oid = 'public.send_seller_chat_file(uuid, text, text, uuid)'::regprocedure;
    known := ARRAY[
      'ffcbc5d5d0ba2bb057097a57e5f357de',
      'f36cef1ffa01c0ffc3d974eb22fafbfb'
    ];
    IF NOT (fp = ANY (known)) THEN
      RAISE EXCEPTION 'send_seller_chat_file(uuid, text, text, uuid) 是未知版本，停止';
    END IF;
  END IF;

  IF to_regprocedure('public.seller_chat_file_deletable(text, text)') IS NOT NULL THEN
    SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO fp
    FROM pg_proc p
    WHERE p.oid = 'public.seller_chat_file_deletable(text, text)'::regprocedure;
    known := ARRAY[
      '57662d0356dc0061512a6b085f78883d',
      '6c3a73169e23ed7fc18ee92bdce0f00b'
    ];
    IF NOT (fp = ANY (known)) THEN
      RAISE EXCEPTION 'seller_chat_file_deletable(text, text) 是未知版本，停止';
    END IF;
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-chat-files',
  'seller-chat-files',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.seller_chat_attachments (
  message_id uuid PRIMARY KEY REFERENCES public.seller_chat_messages (id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.seller_chats (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  path text NOT NULL,
  file_name text NOT NULL,
  byte_size integer NOT NULL,
  mime text NOT NULL,
  claim_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_chat_attachments_path_unique UNIQUE (path),
  CONSTRAINT seller_chat_attachments_claim_unique UNIQUE (sender_id, claim_key),
  CONSTRAINT seller_chat_attachments_name_len CHECK (char_length(file_name) BETWEEN 1 AND 80),
  CONSTRAINT seller_chat_attachments_size CHECK (byte_size BETWEEN 1 AND 8388608),
  CONSTRAINT seller_chat_attachments_mime CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
);

DO $$
DECLARE
  defs text;
BEGIN
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_chat_attachments'
  ) <> 9
  OR EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('message_id', 'uuid'),
        ('chat_id', 'uuid'),
        ('sender_id', 'uuid'),
        ('path', 'text'),
        ('file_name', 'text'),
        ('byte_size', 'int4'),
        ('mime', 'text'),
        ('claim_key', 'uuid'),
        ('created_at', 'timestamptz')
    ) AS need(column_name, udt_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'seller_chat_attachments'
        AND c.column_name = need.column_name
        AND c.udt_name = need.udt_name
        AND c.is_nullable = 'NO'
    )
  ) THEN
    RAISE EXCEPTION '附件表欄位與這份增量不一致，停止';
  END IF;

  SELECT string_agg(pg_get_constraintdef(oid), E'\n' ORDER BY conname)
  INTO defs
  FROM pg_constraint
  WHERE conrelid = 'public.seller_chat_attachments'::regclass;

  IF defs IS NULL
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.seller_chat_attachments'::regclass) <> 8
     OR defs NOT LIKE '%PRIMARY KEY (message_id)%'
     OR defs NOT LIKE '%UNIQUE (path)%'
     OR defs NOT LIKE '%UNIQUE (sender_id, claim_key)%'
     OR position('char_length(file_name) >= 1' in defs) = 0
     OR position('char_length(file_name) <= 80' in defs) = 0
     OR position('byte_size >= 1' in defs) = 0
     OR position('byte_size <= 8388608' in defs) = 0
     OR position('image/jpeg' in defs) = 0
     OR position('image/png' in defs) = 0
     OR position('image/webp' in defs) = 0
     OR position('application/pdf' in defs) = 0
     OR position('FOREIGN KEY (message_id) REFERENCES seller_chat_messages(id) ON DELETE CASCADE' in defs) = 0
     OR position('FOREIGN KEY (chat_id) REFERENCES seller_chats(id) ON DELETE CASCADE' in defs) = 0
  THEN
    RAISE EXCEPTION '附件表約束與這份增量不一致，停止';
  END IF;
END;
$$;

ALTER TABLE public.seller_chat_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_chat_attachments_participant_select ON public.seller_chat_attachments;
CREATE POLICY seller_chat_attachments_participant_select
  ON public.seller_chat_attachments
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

REVOKE ALL ON public.seller_chat_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_chat_attachments TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_chat_file_deletable(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_bucket IS DISTINCT FROM 'seller-chat-files'
     OR auth.uid() IS NULL
     OR split_part(p_name, '/', 2) IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;
  -- 與 send_seller_chat_file 使用同一把路徑鎖。Storage 的 DELETE 會走這段政策；
  -- 鎖住之後才看附件列，避免送出交易尚未提交時，刪除仍用舊快照把檔案清掉。
  PERFORM pg_advisory_xact_lock(hashtext('seller-chat-file'), hashtext(p_name));
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.seller_chat_attachments a
    WHERE a.path = p_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_chat_file_deletable(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_chat_file_deletable(text, text) TO authenticated;

DROP POLICY IF EXISTS seller_chat_files_member_select ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_member_insert ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_pending_delete ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_scope_select ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_scope_insert ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_scope_update ON storage.objects;
DROP POLICY IF EXISTS seller_chat_files_scope_delete ON storage.objects;

CREATE POLICY seller_chat_files_member_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'seller-chat-files'
    AND EXISTS (
      SELECT 1
      FROM public.seller_chats c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
    )
  );

CREATE POLICY seller_chat_files_member_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'seller-chat-files'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.seller_chats c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
    )
  );

CREATE POLICY seller_chat_files_pending_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (public.seller_chat_file_deletable(bucket_id, name));

-- 寬鬆的既有政策是 OR。下面這些限制政策只在 seller-chat-files 追加 AND，
-- 其他儲存桶只要 bucket_id 不同就直接通過。
CREATE POLICY seller_chat_files_scope_select
  ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    bucket_id <> 'seller-chat-files'
    OR EXISTS (
      SELECT 1
      FROM public.seller_chats c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
    )
  );

CREATE POLICY seller_chat_files_scope_insert
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    bucket_id <> 'seller-chat-files'
    OR (
      split_part(name, '/', 2) = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.seller_chats c
        WHERE c.id::text = split_part(name, '/', 1)
          AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
      )
    )
  );

CREATE POLICY seller_chat_files_scope_update
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (bucket_id <> 'seller-chat-files')
  WITH CHECK (bucket_id <> 'seller-chat-files');

CREATE POLICY seller_chat_files_scope_delete
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    bucket_id <> 'seller-chat-files'
    OR public.seller_chat_file_deletable(bucket_id, name)
  );

CREATE OR REPLACE FUNCTION public.send_seller_chat_file(
  p_chat_id uuid,
  p_path text,
  p_name text,
  p_claim_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  chat public.seller_chats%ROWTYPE;
  existing public.seller_chat_attachments%ROWTYPE;
  meta jsonb;
  mime text;
  bytes bigint;
  cleaned_name text;
  cleaned_path text;
  message_body text;
  message_id uuid;
  message_at timestamptz;
  recipient uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_claim_key IS NULL THEN
    RAISE EXCEPTION '缺少送出識別';
  END IF;

  SELECT * INTO existing
  FROM public.seller_chat_attachments
  WHERE sender_id = uid
    AND claim_key = p_claim_key;
  IF FOUND THEN
    IF existing.chat_id <> p_chat_id THEN
      RAISE EXCEPTION '不能使用這個附件';
    END IF;
    SELECT m.created_at INTO message_at
    FROM public.seller_chat_messages m
    WHERE m.id = existing.message_id;
    RETURN jsonb_build_object(
      'id', existing.message_id,
      'chat_id', existing.chat_id,
      'sender_id', existing.sender_id,
      'body', (SELECT m.body FROM public.seller_chat_messages m WHERE m.id = existing.message_id),
      'created_at', message_at,
      'file', jsonb_build_object(
        'path', existing.path,
        'name', existing.file_name,
        'bytes', existing.byte_size,
        'mime', existing.mime
      )
    );
  END IF;

  cleaned_path := lower(btrim(coalesce(p_path, '')));
  IF cleaned_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '不能使用這個附件';
  END IF;
  IF split_part(cleaned_path, '/', 1) <> p_chat_id::text
     OR split_part(cleaned_path, '/', 2) <> uid::text THEN
    RAISE EXCEPTION '不能使用這個附件';
  END IF;

  SELECT * INTO chat FROM public.seller_chats WHERE id = p_chat_id;
  IF NOT FOUND OR (chat.buyer_id <> uid AND chat.seller_user_id <> uid) THEN
    RAISE EXCEPTION '不能在這則對話發言';
  END IF;
  IF chat.seller_user_id = uid AND NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能回覆買家';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('seller-chat-file'), hashtext(cleaned_path));

  SELECT o.metadata INTO meta
  FROM storage.objects o
  WHERE o.bucket_id = 'seller-chat-files'
    AND o.name = cleaned_path
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這個附件';
  END IF;

  mime := lower(split_part(coalesce(meta->>'mimetype', ''), ';', 1));
  bytes := coalesce((meta->>'size')::bigint, (meta->>'contentLength')::bigint, 0);
  IF mime NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
    RAISE EXCEPTION '只支援 JPG、PNG、WEBP 照片或 PDF 檔案';
  END IF;
  IF bytes <= 0 THEN
    RAISE EXCEPTION '檔案是空的';
  END IF;
  IF bytes > 8388608 THEN
    RAISE EXCEPTION '單檔上限 8MB';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seller_chat_attachments a WHERE a.path = cleaned_path) THEN
    RAISE EXCEPTION '這個附件已經送出';
  END IF;

  IF (
    SELECT count(*)
    FROM public.seller_chat_messages
    WHERE sender_id = uid
      AND created_at > now() - interval '1 minute'
  ) >= 10 THEN
    RAISE EXCEPTION '傳送過於頻繁，請稍後再試';
  END IF;

  cleaned_name := regexp_replace(btrim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g');
  cleaned_name := regexp_replace(cleaned_name, '[\\/]+', '-', 'g');
  cleaned_name := btrim(cleaned_name);
  IF cleaned_name = '' THEN
    cleaned_name := '附件';
  END IF;
  IF char_length(cleaned_name) > 80 THEN
    cleaned_name := left(cleaned_name, 80);
  END IF;
  message_body := CASE
    WHEN mime IN ('image/jpeg', 'image/png', 'image/webp') THEN '［照片］'
    ELSE '［檔案］'
  END || cleaned_name;

  BEGIN
    INSERT INTO public.seller_chat_messages (chat_id, sender_id, body)
    VALUES (p_chat_id, uid, message_body)
    RETURNING id, created_at INTO message_id, message_at;

    INSERT INTO public.seller_chat_attachments (
      message_id, chat_id, sender_id, path, file_name, byte_size, mime, claim_key
    ) VALUES (
      message_id, p_chat_id, uid, cleaned_path, cleaned_name, bytes::integer, mime, p_claim_key
    );

    UPDATE public.seller_chats
    SET last_message_at = message_at
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
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO existing
      FROM public.seller_chat_attachments
      WHERE sender_id = uid
        AND claim_key = p_claim_key;
      IF NOT FOUND OR existing.chat_id <> p_chat_id THEN
        RAISE EXCEPTION '這個附件已經送出';
      END IF;
      SELECT m.body, m.created_at INTO message_body, message_at
      FROM public.seller_chat_messages m
      WHERE m.id = existing.message_id;
      RETURN jsonb_build_object(
        'id', existing.message_id,
        'chat_id', existing.chat_id,
        'sender_id', existing.sender_id,
        'body', message_body,
        'created_at', message_at,
        'file', jsonb_build_object(
          'path', existing.path,
          'name', existing.file_name,
          'bytes', existing.byte_size,
          'mime', existing.mime
        )
      );
  END;

  RETURN jsonb_build_object(
    'id', message_id,
    'chat_id', p_chat_id,
    'sender_id', uid,
    'body', message_body,
    'created_at', message_at,
    'file', jsonb_build_object(
      'path', cleaned_path,
      'name', cleaned_name,
      'bytes', bytes,
      'mime', mime
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_seller_chat_file(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_seller_chat_file(uuid, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_seller_chat_messages(p_chat_id uuid, p_before timestamptz)
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
      SELECT
        m.id,
        m.chat_id,
        m.sender_id,
        m.body,
        m.created_at,
        CASE
          WHEN a.message_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'path', a.path,
            'name', a.file_name,
            'bytes', a.byte_size,
            'mime', a.mime
          )
        END AS file
      FROM public.seller_chat_messages m
      LEFT JOIN public.seller_chat_attachments a ON a.message_id = m.id
      WHERE m.chat_id = p_chat_id
        AND (p_before IS NULL OR m.created_at < p_before)
      ORDER BY m.created_at DESC
      LIMIT 200
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
BEGIN
  RETURN public.list_seller_chat_messages(p_chat_id, NULL::timestamptz);
END;
$$;

REVOKE ALL ON FUNCTION public.list_seller_chat_messages(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_seller_chat_messages(uuid, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.list_seller_chat_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_seller_chat_messages(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'seller-chat-files'
      AND public = false
      AND file_size_limit = 8388608
      AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
  ) THEN
    RAISE EXCEPTION 'seller-chat-files 私人儲存設定不完整';
  END IF;
  IF to_regprocedure('public.send_seller_chat_file(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'send_seller_chat_file 沒有建立';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.list_seller_chat_messages(uuid)'::regprocedure),
        ('public.list_seller_chat_messages(uuid, timestamptz)'::regprocedure),
        ('public.send_seller_chat_file(uuid, text, text, uuid)'::regprocedure),
        ('public.seller_chat_file_deletable(text, text)'::regprocedure)
    ) AS fn(oid)
    WHERE EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS perm
      WHERE p.oid = fn.oid
        AND perm.privilege_type = 'EXECUTE'
        AND (
          perm.grantee = 0
          OR perm.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')
        )
    )
    OR NOT has_function_privilege('authenticated', fn.oid, 'execute')
  ) THEN
    RAISE EXCEPTION '附件函式權限不正確，停止';
  END IF;

  IF has_table_privilege('anon', 'public.seller_chat_attachments', 'select')
     OR has_table_privilege('anon', 'public.seller_chat_attachments', 'insert')
     OR has_table_privilege('anon', 'public.seller_chat_attachments', 'update')
     OR has_table_privilege('anon', 'public.seller_chat_attachments', 'delete')
     OR NOT has_table_privilege('authenticated', 'public.seller_chat_attachments', 'select')
     OR has_table_privilege('authenticated', 'public.seller_chat_attachments', 'insert')
     OR has_table_privilege('authenticated', 'public.seller_chat_attachments', 'update')
     OR has_table_privilege('authenticated', 'public.seller_chat_attachments', 'delete')
  THEN
    RAISE EXCEPTION '附件表權限不正確，停止';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polname IN (
        'seller_chat_files_scope_select',
        'seller_chat_files_scope_insert',
        'seller_chat_files_scope_update',
        'seller_chat_files_scope_delete'
      )
      AND polpermissive = false
  ) <> 4 THEN
    RAISE EXCEPTION 'seller-chat-files 的限制政策不完整，停止';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
