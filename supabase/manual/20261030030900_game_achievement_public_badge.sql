-- 第七階段第 9 批：公開評價附上會員自己選好的遊戲成就勳章。
-- 只重建 list_public_reviews。不改成就目錄、不解鎖、不發 Pay 點數、不改頭銜與收藏持有。
-- 前置：member_game_showcase 與 list_public_reviews(uuid[]) 已存在。
-- 若公開評價已經帶遊戲勳章，或已經讀取較新的收藏欄位，本檔停止，避免覆蓋。

BEGIN;

DO $badge_precheck$
DECLARE
  def text;
BEGIN
  IF to_regclass('public.member_game_showcase') IS NULL
     OR to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN
    RAISE EXCEPTION '找不到成就展示或公開評價，停止';
  END IF;
  def := pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure);
  IF position('game_badge' IN def) > 0 THEN
    RAISE EXCEPTION '公開評價已有遊戲勳章，不需要再執行本檔';
  END IF;
  IF position('product_is_public' IN def) = 0 OR position('seller_id' IN def) = 0
     OR position('member_perk_loadout' IN def) = 0 THEN
    RAISE EXCEPTION '公開評價函式與目前正式版本不同，停止並回報';
  END IF;
  IF position('collection_id' IN def) > 0 OR position('pet_id' IN def) > 0 THEN
    RAISE EXCEPTION '公開評價已包含較新的收藏欄位，停止並回報，避免覆蓋';
  END IF;
END
$badge_precheck$;

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
        )) AS equipped,
        (
          SELECT showcase.achievement_id
          FROM public.member_game_showcase AS showcase
          WHERE showcase.user_id = r.user_id
            AND showcase.achievement_id IS NOT NULL
        ) AS game_badge
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
  '公開評價維持原本的可見範圍，附上評價者目前裝備的外觀，以及自己選擇公開展示的遊戲成就勳章。不回傳會員編號，也不回傳未裝備收藏。';

DO $badge_self_check$
DECLARE
  def text := pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure);
BEGIN
  IF position('game_badge' IN def) = 0
     OR position('member_game_showcase' IN def) = 0
     OR position('product_is_public' IN def) = 0
     OR position('seller_id' IN def) = 0
     OR position('member_perk_loadout' IN def) = 0
     OR position('title_id' IN def) = 0 THEN
    RAISE EXCEPTION '公開評價沒有同時保留頭銜裝備與遊戲勳章';
  END IF;
  IF position('member_point' IN def) > 0 OR position('post_member_reward' IN def) > 0 THEN
    RAISE EXCEPTION '公開評價不可碰點數';
  END IF;
  IF position('r.user_id,' IN def) > 0 OR position('AS user_id' IN def) > 0 THEN
    RAISE EXCEPTION '公開評價不可回傳會員編號';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_public_reviews(uuid[])'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '公開評價必須維持安全定義者，才能讀取展示勳章';
  END IF;
  IF public.list_public_reviews(ARRAY[]::uuid[]) IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION '沒有商品時公開評價應為空陣列';
  END IF;
END
$badge_self_check$;

COMMIT;
