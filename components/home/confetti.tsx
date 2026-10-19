'use client'

import { useEffect, useRef } from 'react'

const COLORS = ['#f97316', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#f4f4f5']
const DURATION_MS = 2600

export function Confetti({ fireKey }: { fireKey: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!fireKey) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width
    canvas.height = height

    const pieces = Array.from({ length: 150 }, (_, i) => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.5,
      vx: (Math.random() - 0.5) * 15,
      vy: -(Math.random() * 13 + 5),
      size: Math.random() * 7 + 5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[i % COLORS.length],
    }))

    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const elapsed = now - start
      ctx.clearRect(0, 0, width, height)
      if (elapsed >= DURATION_MS) return
      ctx.globalAlpha = Math.max(0, 1 - elapsed / DURATION_MS)
      for (const p of pieces) {
        p.vy += 0.35
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6)
        ctx.restore()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ctx.clearRect(0, 0, width, height)
    }
  }, [fireKey])

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full" />
}
