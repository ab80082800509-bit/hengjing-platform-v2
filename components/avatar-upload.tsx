'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, ImagePlus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { ACCEPT_ATTR, IMAGE_RULE_TEXT, loadImage, readFileAsDataUrl, validateImageFile } from '@/lib/image-utils'

const VIEW = 256
const OUT = 320
const MAX_ZOOM = 3

const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

interface Loaded {
  src: string
  img: HTMLImageElement
}

export function AvatarCropModal({
  onClose,
  onSave,
  title = '上傳大頭貼',
}: {
  onClose: () => void
  onSave: (dataUrl: string) => void
  title?: string
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const dims = useCallback(
    (z: number) => {
      if (!loaded) return { w: VIEW, h: VIEW }
      const base = VIEW / Math.min(loaded.img.naturalWidth, loaded.img.naturalHeight)
      return { w: loaded.img.naturalWidth * base * z, h: loaded.img.naturalHeight * base * z }
    },
    [loaded],
  )

  const clamp = useCallback(
    (p: { x: number; y: number }, z: number) => {
      const { w, h } = dims(z)
      const mx = Math.max(0, (w - VIEW) / 2)
      const my = Math.max(0, (h - VIEW) / 2)
      return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) }
    },
    [dims],
  )

  const pick = async (file: File | undefined) => {
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) {
      setError(problem)
      return
    }
    try {
      const src = await readFileAsDataUrl(file)
      const img = await loadImage(src)
      setLoaded({ src, img })
      setZoom(1)
      setPos({ x: 0, y: 0 })
      setError('')
    } catch {
      setError('無法讀取這張圖片，請換一張試試')
    }
  }

  const changeZoom = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z))
    setZoom(next)
    setPos((p) => clamp(p, next))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!loaded) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setPos(clamp({ x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, zoom))
  }
  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 12
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const d = delta[e.key]
    if (!d) return
    e.preventDefault()
    setPos((p) => clamp({ x: p.x + d[0], y: p.y + d[1] }, zoom))
  }

  const save = () => {
    if (!loaded) return
    const { w, h } = dims(zoom)
    const k = OUT / VIEW
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT, OUT)
    ctx.drawImage(loaded.img, OUT / 2 - (w * k) / 2 + pos.x * k, OUT / 2 - (h * k) / 2 + pos.y * k, w * k, h * k)
    onSave(canvas.toDataURL('image/jpeg', 0.9))
  }

  const { w, h } = dims(zoom)

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-foreground/50 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
          <h2 className="text-base font-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            aria-label="選擇本機照片"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />

          <div className="flex justify-center">
            {loaded ? (
              <div
                role="application"
                tabIndex={0}
                aria-label="裁切預覽：拖曳或使用方向鍵調整位置"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown}
                style={{ width: VIEW, height: VIEW, touchAction: 'none' }}
                className={`relative max-w-full select-none overflow-hidden rounded-2xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={loaded.src}
                  alt="待裁切的大頭貼預覽"
                  draggable={false}
                  className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                  style={{ width: w, height: h, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(15,23,42,0.55)] ring-2 ring-card"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{ width: VIEW, height: VIEW }}
                className="flex max-w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-card shadow-sm">
                  <ImagePlus className="size-6" />
                </span>
                <span className="text-sm font-bold">選擇本機照片</span>
              </button>
            )}
          </div>

          {loaded && (
            <div className="flex items-center gap-3">
              <ZoomOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => changeZoom(Number(e.target.value))}
                aria-label="縮放"
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>
          )}

          <p className="text-pretty text-center text-xs leading-relaxed text-muted-foreground">
            {IMAGE_RULE_TEXT}。系統會裁成 1:1 正方形，圓形範圍內即為最終顯示區域。
          </p>
          {error && (
            <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-center text-xs font-bold text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 px-5 py-3.5">
          {loaded && (
            <button type="button" className={`${btnGhost} mr-auto`} onClick={() => fileRef.current?.click()}>
              <Camera className="size-4" />重新選擇
            </button>
          )}
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="button" className={btnPrimary} disabled={!loaded} onClick={save}>
            <Check className="size-4" />套用大頭貼
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
