import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Store } from 'lucide-react'
import { LEGAL_DOCS, getLegalDoc } from '@/lib/legal'

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ doc: d.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params
  const found = getLegalDoc(doc)
  if (!found) return {}
  return { title: `${found.title}｜買個 Pay 服`, description: found.summary }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  const current = getLegalDoc(doc)
  if (!current) notFound()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2" aria-label="回到買個 Pay 服首頁">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Store className="size-5" />
            </span>
            <span className="text-lg font-black tracking-tight">買個 Pay 服</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-ink hover:underline">
            <ArrowLeft className="size-4" />
            回到市集
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:grid-cols-[14rem_1fr]">
        <nav aria-label="法律文件" className="md:sticky md:top-6 md:self-start">
          <p className="mb-2 text-xs font-bold text-muted-foreground">法律與合規文件</p>
          <ul className="space-y-1">
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/legal/${d.slug}`}
                  aria-current={d.slug === current.slug ? 'page' : undefined}
                  className={`block rounded-xl px-3 py-2 text-sm font-medium transition ${
                    d.slug === current.slug ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main>
          <article className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm md:p-8">
            <h1 className="text-balance text-2xl font-black md:text-3xl">{current.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">最後更新：{current.updated}</p>
            <p className="mt-4 text-pretty rounded-xl bg-secondary p-4 text-sm leading-relaxed text-secondary-foreground">{current.summary}</p>
            <div className="mt-6 space-y-6">
              {current.sections.map((s) => (
                <section key={s.heading} aria-labelledby={s.heading}>
                  <h2 id={s.heading} className="text-base font-black">{s.heading}</h2>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                    {s.body.map((p) => (
                      <li key={p} className="text-pretty">{p}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        </main>
      </div>
    </div>
  )
}
