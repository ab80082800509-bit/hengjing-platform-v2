'use client'

import { useState } from 'react'
import { Plus, X, Wand2 } from 'lucide-react'

export const parseOptions = (csv: string) =>
  Array.from(new Set(csv.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)))

const splitQuickAdd = (text: string) => text.split(/[、,，;；\n]/).map((s) => s.trim()).filter(Boolean)

export const isSizeName = (name: string) => /尺寸|尺碼|size|號|腰圍/i.test(name)
export const isColorName = (name: string) => /顏色|款式|色|color/i.test(name)

const SIZE_PRESETS: { label: string; values: string[] }[] = [
  { label: 'S – 2XL', values: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'XS – 3XL', values: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: '均碼 Free', values: ['Free'] },
  { label: '歐碼 36 – 44', values: ['36', '37', '38', '39', '40', '41', '42', '43', '44'] },
  { label: '美碼 US 6 – 11', values: ['US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11'] },
  { label: '腰圍 28 – 36', values: ['28', '29', '30', '31', '32', '33', '34', '35', '36'] },
]

const COLOR_CHIPS = ['黑色', '白色', '灰色', '米色', '藍色', '紅色', '綠色', '粉色']

const NAME_SUGGESTIONS = ['顏色', '款式', '尺寸', '顏色/款式']

const fieldCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30'
const chipCls =
  'inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold transition hover:border-primary/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function VariantEditor({
  title,
  name,
  onName,
  options,
  onOptions,
  suggestedNames = [],
  error,
  onRemove,
}: {
  title: string
  name: string
  onName: (v: string) => void
  options: string
  onOptions: (csv: string) => void
  suggestedNames?: string[]
  error?: string
  onRemove?: () => void
}) {
  const [draft, setDraft] = useState('')
  const list = parseOptions(options)
  const nameChips = Array.from(new Set([...suggestedNames, ...NAME_SUGGESTIONS]))

  const commit = (next: string[]) => onOptions(Array.from(new Set(next)).join('、'))
  const addDraft = () => {
    const add = splitQuickAdd(draft)
    if (!add.length) return
    commit([...list, ...add])
    setDraft('')
  }
  const toggle = (v: string) => commit(list.includes(v) ? list.filter((o) => o !== v) : [...list, v])

  return (
    <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">{title}</p>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs font-bold text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
            移除此規格
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-muted-foreground" htmlFor={`vname-${title}`}>規格名稱</label>
        <input id={`vname-${title}`} className={fieldCls} value={name} onChange={(e) => onName(e.target.value)} placeholder="例如：顏色 / 尺寸" />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">建議名稱：</span>
          {nameChips.map((n) => {
            const rec = suggestedNames.includes(n)
            return (
              <button
                key={n}
                type="button"
                aria-pressed={name === n}
                onClick={() => onName(n)}
                className={`${chipCls} ${name === n ? 'border-primary bg-accent text-accent-foreground' : rec ? 'border-primary/50 text-brand-ink' : ''}`}
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground">規格選項（{list.length}）</p>
        {list.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={`${name || title} 選項`}>
            {list.map((o) => (
              <li key={o} className="inline-flex items-center gap-1 rounded-full bg-accent py-1 pl-3 pr-1.5 text-xs font-bold text-accent-foreground">
                {o}
                <button
                  type="button"
                  aria-label={`移除 ${o}`}
                  onClick={() => commit(list.filter((x) => x !== o))}
                  className="rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">尚未新增選項，可用下方快速新增或一鍵帶入。</p>
        )}

        <div className="flex gap-2">
          <input
            className={fieldCls}
            value={draft}
            aria-label={`快速新增${name || title}選項`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              addDraft()
            }}
            placeholder="一次輸入多個，逗號或換行分隔，例如：S, M, L, XL"
          />
          <button type="button" onClick={addDraft} disabled={!draft.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="size-4" />新增
          </button>
        </div>

        {isSizeName(name) && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold text-muted-foreground">
              <Wand2 className="size-3.5" />常用尺寸一鍵帶入（會取代目前選項）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => commit(p.values)} className={chipCls}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isColorName(name) && !isSizeName(name) && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold text-muted-foreground">
              <Wand2 className="size-3.5" />常用顏色（點擊加入或移除）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_CHIPS.map((c) => (
                <button key={c} type="button" aria-pressed={list.includes(c)} onClick={() => toggle(c)} className={`${chipCls} ${list.includes(c) ? 'border-primary bg-accent text-accent-foreground' : ''}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  )
}
