'use client'

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

const W = 640
const H = 360
const BRUSH = 46
const REVEAL_AT = 0.5
const MEASURE_EVERY_MS = 120

const TITLE = '刮開有驚喜'
const HINT = '用手指或滑鼠刮一刮'

function paintCoating(ctx: CanvasRenderingContext2D, family: string) {
  const base = ctx.createLinearGradient(0, 0, W, H)
  base.addColorStop(0, '#71717a')
  base.addColorStop(0.5, '#a1a1aa')
  base.addColorStop(1, '#52525b')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)'
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2)
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 10
  for (let x = -H; x < W; x += 44) {
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.lineTo(x + H, 0)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(24,24,27,0.78)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 46px ${family}`
  ctx.fillText(TITLE, W / 2, H / 2 - 12)
  ctx.font = `700 20px ${family}`
  ctx.fillText(HINT, W / 2, H / 2 + 36)

  ctx.strokeStyle = 'rgba(24,24,27,0.35)'
  ctx.lineWidth = 3
  ctx.setLineDash([10, 8])
  ctx.strokeRect(14, 14, W - 28, H - 28)
  ctx.setLineDash([])
}

export function ScratchSurface({
  revealed,
  onReveal,
  onProgress,
  children,
}: {
  revealed: boolean
  onReveal: () => void
  onProgress?: (ratio: number) => void
  children: ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const lastMeasure = useRef(0)
  const fired = useRef(false)
  const touched = useRef(false)
  const onRevealRef = useRef(onReveal)
  const onProgressRef = useRef(onProgress)
  onRevealRef.current = onReveal
  onProgressRef.current = onProgress

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return
    ctxRef.current = ctx
    const family = getComputedStyle(canvas).fontFamily || 'sans-serif'
    paintCoating(ctx, family)

    let cancelled = false
    Promise.all([
      document.fonts.load(`900 46px ${family}`, TITLE),
      document.fonts.load(`700 20px ${family}`, HINT),
    ])
      .then(() => {
        if (!cancelled && !touched.current) paintCoating(ctx, family)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (revealed) fired.current = true
  }, [revealed])

  const toCanvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height }
  }

  const scratchTo = (p: { x: number; y: number }) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const from = last.current ?? p
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineWidth = BRUSH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
    last.current = p
  }

  const measure = (force = false) => {
    const ctx = ctxRef.current
    if (!ctx || fired.current) return
    const now = performance.now()
    if (!force && now - lastMeasure.current < MEASURE_EVERY_MS) return
    lastMeasure.current = now
    const data = ctx.getImageData(0, 0, W, H).data
    let cleared = 0
    let total = 0
    for (let i = 3; i < data.length; i += 28) {
      total++
      if (data[i] < 128) cleared++
    }
    const ratio = cleared / total
    onProgressRef.current?.(ratio)
    if (ratio >= REVEAL_AT) {
      fired.current = true
      onRevealRef.current()
    }
  }

  const handleDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (revealed) return
    touched.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = null
    scratchTo(toCanvasPoint(e))
  }
  const handleMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || revealed) return
    scratchTo(toCanvasPoint(e))
    measure()
  }
  const handleUp = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    measure(true)
  }

  return (
    <div className="relative aspect-[16/9] w-full select-none overflow-hidden rounded-2xl border border-border bg-background">
      <div className="absolute inset-0">{children}</div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        aria-hidden
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        className={`absolute inset-0 h-full w-full touch-none transition-opacity duration-500 ${
          revealed ? 'pointer-events-none opacity-0' : 'cursor-crosshair opacity-100'
        }`}
      />
    </div>
  )
}
