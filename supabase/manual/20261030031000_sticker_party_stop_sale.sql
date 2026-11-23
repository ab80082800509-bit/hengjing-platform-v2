-- 第七階段第 9 批第 6 項：停止 sticker-party 的點數販售。
-- 只關閉這一件的上架狀態。保留編號、定價、持有紀錄與點數流水，不退點、不改其他商品。

BEGIN;

DO $stop_sticker_sale$
DECLARE
  was_active boolean;
  active_before integer;
  holds_before bigint;
  cost_before integer;
BEGIN
  IF to_regclass('public.member_perk_catalog') IS NULL THEN
    RAISE EXCEPTION '找不到點數商城目錄，停止';
  END IF;
  SELECT active, cost INTO was_active, cost_before
  FROM public.member_perk_catalog
  WHERE id = 'sticker-party';
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到 sticker-party，停止';
  END IF;
  IF cost_before IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'sticker-party 定價不是 150，停止並回報';
  END IF;
  SELECT count(*) INTO active_before FROM public.member_perk_catalog WHERE active;
  SELECT count(*) INTO holds_before FROM public.member_perk_holds WHERE perk_id = 'sticker-party';

  PERFORM set_config('app.perk_catalog', 'on', true);
  UPDATE public.member_perk_catalog
  SET active = false
  WHERE id = 'sticker-party';
  PERFORM set_config('app.perk_catalog', 'off', true);

  IF (SELECT active FROM public.member_perk_catalog WHERE id = 'sticker-party') IS DISTINCT FROM false
     OR (SELECT cost FROM public.member_perk_catalog WHERE id = 'sticker-party') IS DISTINCT FROM 150
     OR (SELECT count(*) FROM public.member_perk_catalog) IS DISTINCT FROM 40
     OR (SELECT count(*) FROM public.member_perk_holds WHERE perk_id = 'sticker-party') IS DISTINCT FROM holds_before THEN
    RAISE EXCEPTION '停售後編號、定價或持有紀錄不一致';
  END IF;
  IF was_active AND (SELECT count(*) FROM public.member_perk_catalog WHERE active) IS DISTINCT FROM active_before - 1 THEN
    RAISE EXCEPTION '其他商品的上架狀態被改到';
  END IF;
  IF NOT was_active AND (SELECT count(*) FROM public.member_perk_catalog WHERE active) IS DISTINCT FROM active_before THEN
    RAISE EXCEPTION '重複停售時改到其他商品';
  END IF;
END
$stop_sticker_sale$;

COMMIT;
