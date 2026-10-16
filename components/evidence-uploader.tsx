'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { ACCEPT_ATTR, IMAGE_RULE_TEXT, downscaleImage, validateImageFile } from '@/lib/image-utils'

export const EVIDENCE_MAX = 3

export function EvidenceLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="佐證截圖放大檢視"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/80 p-4"
      onMouseDown={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉檢視"
        className="absolute right-4 top-4 rounded-full bg-card p-2 text-foreground shadow"
      >
        <X className="size-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="佐證截圖" className="max-h-full max-w-full rounded-2xl bg-card object-contain" />
    </div>,
    document.body,
  )
}

export function EvidenceThumbs({ images }: { images: string[] }) {
  const [zoom, setZoom] = useState<string | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label="檢舉佐證截圖">
        {images.map((src, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setZoom(src)}
              aria-label={`放大檢視第 ${i + 1} 張佐證截圖`}
              className="block size-14 overflow-hidden rounded-xl border border-border/70 transition hover:ring-2 hover:ring-primary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {zoom && <EvidenceLightbox src={zoom} onClose={() => setZoom(null)} />}
    </>
  )
}

export function EvidenceUploader({
  value,
  onChange,
  max = EVIDENCE_MAX,
}: {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const room = max - value.length
    const picked = Array.from(files).slice(0, room)
    const problem = picked.map(validateImageFile).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const urls = await Promise.all(picked.map((f) => downscaleImage(f)))
      onChange([...value, ...urls])
      setError(files.length > room ? `最多只能附 ${max} 張，已略過多餘的圖片` : '')
    } catch {
      setError('圖片處理失敗，請換一張再試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="sr-only"
        aria-label="上傳佐證截圖"
        onChange={(e) => {
          void addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap gap-2">
        {value.map((src, i) => (
          <div key={i} className="group relative size-20 overflow-hidden rounded-xl border border-border/70">
            <button type="button" onClick={() => setZoom(src)} aria-label={`放大檢視第 ${i + 1} 張截圖`} className="block size-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`佐證截圖 ${i + 1}`} className="size-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`移除第 ${i + 1} 張截圖`}
              className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-foreground/75 text-card transition hover:bg-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {value.length < max && (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            <ImagePlus className="size-5" />
            <span className="text-[11px] font-bold">{busy ? '處理中' : '上傳截圖'}</span>
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        最多 {max} 張，{IMAGE_RULE_TEXT.replace('單張檔案', '單張')}。可附上對話紀錄或商品頁面截圖。
      </p>
      {error && (
        <p role="alert" className="text-xs font-bold text-destructive">
          {error}
        </p>
      )}
      {zoom && <EvidenceLightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}
