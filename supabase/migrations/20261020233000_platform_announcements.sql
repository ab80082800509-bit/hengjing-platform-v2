-- =============================================================================
-- 平台跑馬燈公告
-- 請人工審查後在 Supabase SQL Editor 整段執行一次。本檔不執行。
-- 只新增公告表與函式，不修改會員、商品、賣家、訂單或 KYC 資料。
-- 依賴既有 public.is_platform_admin()。一般會員沒有新增、修改、刪除權限。
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin'
  ) THEN
    RAISE EXCEPTION '缺少 public.is_platform_admin()，請先執行既有管理員 migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 180),
  CONSTRAINT platform_announcements_plain_text CHECK (body !~ '[<>]'),
  CONSTRAINT platform_announcements_sort_range CHECK (sort_order BETWEEN 0 AND 999)
);

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_announcements TO anon, authenticated;

DROP POLICY IF EXISTS platform_announcements_read_enabled ON public.platform_announcements;
CREATE POLICY platform_announcements_read_enabled
  ON public.platform_announcements
  FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

-- 沒有 INSERT / UPDATE / DELETE policy。直接寫表會被 RLS 拒絕。

CREATE OR REPLACE FUNCTION public.announcement_plain(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  cleaned := btrim(regexp_replace(coalesce(raw, ''), '[[:cntrl:]]', '', 'g'));
  IF cleaned = '' OR char_length(cleaned) > 180 THEN
    RAISE EXCEPTION '公告需為 1 到 180 個字';
  END IF;
  IF cleaned ~ '[<>]' THEN
    RAISE EXCEPTION '公告只接受純文字';
  END IF;
  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_enabled_announcements()
RETURNS TABLE (id uuid, body text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, a.body, a.sort_order
  FROM public.platform_announcements a
  WHERE a.enabled = true
  ORDER BY a.sort_order ASC, a.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_announcements()
RETURNS TABLE (
  id uuid,
  body text,
  enabled boolean,
  sort_order integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  RETURN QUERY
  SELECT a.id, a.body, a.enabled, a.sort_order, a.updated_at
  FROM public.platform_announcements a
  ORDER BY a.sort_order ASC, a.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_announcement(
  p_id uuid,
  p_body text,
  p_enabled boolean,
  p_sort integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_body text;
  next_sort integer;
  saved uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  next_body := public.announcement_plain(p_body);
  next_sort := coalesce(p_sort, 0);
  IF next_sort < 0 OR next_sort > 999 THEN
    RAISE EXCEPTION '排序需介於 0 到 999';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.platform_announcements (body, enabled, sort_order)
    VALUES (next_body, coalesce(p_enabled, false), next_sort)
    RETURNING platform_announcements.id INTO saved;
    RETURN saved;
  END IF;

  UPDATE public.platform_announcements
  SET body = next_body,
      enabled = coalesce(p_enabled, false),
      sort_order = next_sort,
      updated_at = now()
  WHERE platform_announcements.id = p_id
  RETURNING platform_announcements.id INTO saved;

  IF saved IS NULL THEN
    RAISE EXCEPTION '找不到這則公告';
  END IF;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  DELETE FROM public.platform_announcements WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.announcement_plain(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_enabled_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_announcement(uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_announcement(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_enabled_announcements() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_announcements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_announcement(uuid, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(uuid) TO authenticated;

COMMIT;
