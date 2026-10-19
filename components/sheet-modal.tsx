'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface SheetModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  z?: number
  footer?: ReactNode
}

const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' } as const

let sheetSeq = 0
const sheetStack: number[] = []

export function SheetModal({ title, onClose, children, size = 'md', z = 95, footer }: SheetModalProps) {
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    sheetSeq += 1
    const id = sheetSeq
    sheetStack.push(id)
    const trigger = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === id) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const at = sheetStack.indexOf(id)
      if (at >= 0) sheetStack.splice(at, 1)
      document.body.style.overflow = previousOverflow
      trigger?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4" style={{ zIndex: z }}>
      <button
        type="button"
        aria-label="關閉視窗"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full ${SIZES[size]} flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl outline-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-300 sm:rounded-3xl`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <h2 id={titleId} className="text-balance text-base font-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="-mr-1.5 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="overflow-y-auto overscroll-contain">{children}</div>
        {footer && <footer className="border-t border-border/60 bg-card px-5 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
