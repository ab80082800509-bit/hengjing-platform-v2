import fs from 'fs'

const file = 'components/open-marketplace.tsx'
let s = fs.readFileSync(file, 'utf8')

const rep = (a, b) => {
  const n = s.split(a).length - 1
  if (n !== 1) throw new Error(`expected 1 match, got ${n}: ${a.slice(0, 70)}`)
  s = s.replace(a, () => b)
}
const repRe = (re, b) => {
  const all = s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))
  if (!all || all.length !== 1) throw new Error(`regex matches ${all ? all.length : 0}: ${re}`)
  s = s.replace(re, (...args) => (typeof b === 'function' ? b(...args) : b))
}
const slice = (startMarker, endMarker, replacement) => {
  const a = s.indexOf(startMarker)
  const b = s.indexOf(endMarker, a + 1)
  if (a < 0 || b < 0) throw new Error(`slice markers missing: ${startMarker.slice(0, 40)}`)
  s = s.slice(0, a) + replacement + s.slice(b)
}

/* ---------- StoreModal: report seller ---------- */
repRe(
  /(  onChat,\s*checkin = false,\s*\}: \{\s*seller: Seller\s*closed\?: boolean)/,
  (m) => m.replace('  onChat,', '  onChat,\n  viewer = null,\n  reportsLeft = REPORT_LIMIT,\n  onNeedLogin,\n  onReport,'),
)
repRe(
  /(  onChat: \(\) => void\s*checkin\?: boolean\s*\}\) \{\s*const \[sort, setSort\])/,
  (m) =>
    m.replace(
      '  checkin?: boolean',
      '  viewer?: Viewer | null\n  reportsLeft?: number\n  onNeedLogin?: () => void\n  onReport: (reason: ReportReason, note: string, evidence: string[]) => void\n  checkin?: boolean',
    ).replace('const [sort, setSort]', 'const [reportOpen, setReportOpen] = useState(false)\n  const [sort, setSort]'),
)
repRe(
  /(\{followed \? <><Heart className="size-4 fill-primary text-primary" \/> 已關注<\/> : <><Plus className="size-4" \/> 關注<\/>\}\s*<\/button>)/,
  (m) => `${m}
            <button
              type="button"
              onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}
              aria-label="檢舉此賣家"
              className={\`\${btnGhost} px-3 hover:text-destructive\`}
            >
              <Flag className="size-4" />
              <span className="hidden sm:inline">檢舉此賣家</span>
            </button>`,
)
repRe(
  /(<CouponDisclaimer \/>\s*<\/div>)(\s*<\/Modal>\s*\)\s*\}\s*\/\* -+\s*\* 聊聊 Modal)/,
  (_m, a, b) => `${a}
      {reportOpen && (
        <ReportModal
          title="檢舉此賣家"
          target={{ name: seller.name, seller }}
          left={reportsLeft}
          onClose={() => setReportOpen(false)}
          onSubmit={(reason, note, evidence) => {
            setReportOpen(false)
            onReport(reason, note, evidence)
          }}
        />
      )}${b}`,
)

/* ---------- ChatModal avatars ---------- */
rep(
  'function ChatModal({ seller, onClose }: { seller: Seller; onClose: () => void }) {',
  'function ChatModal({ seller, viewer = null, onClose }: { seller: Seller; viewer?: Viewer | null; onClose: () => void }) {',
)
slice(
  '{msgs.map((m, i) => (',
  '{typing && <p',
  `{msgs.map((m, i) => (
            <div key={i} className={\`flex items-end gap-2 \${m.from === 'me' ? 'flex-row-reverse' : ''}\`}>
              {m.from === 'me' ? (
                viewer ? <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-8" textSize="text-xs" /> : null
              ) : (
                <Avatar seller={seller} size="size-8" />
              )}
              <p
                className={\`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed \${
                  m.from === 'me' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border/70 bg-card'
                }\`}
              >
                {m.text}
              </p>
            </div>
          ))}
          `,
)
rep(
  '<ChatModal key={chatSeller.id} seller={chatSeller} onClose={() => setChatId(null)} />',
  '<ChatModal key={chatSeller.id} seller={chatSeller} viewer={viewer} onClose={() => setChatId(null)} />',
)

/* ---------- navbar avatar ---------- */
rep(
  '<span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-foreground md:size-7">{account.name.slice(0, 1)}</span>',
  '<UserAvatar name={account.name} tone={buyerProfile.tone} src={buyerProfile.avatar} size="size-8 md:size-7" textSize="text-xs" />',
)

/* ---------- review owner ---------- */
rep('added.push({ user, rating:', 'added.push({ owner: account?.name, user, rating:')

/* ---------- admin report rows ---------- */
rep(
  '買家可在商品詳情頁點「檢舉此商品」送出檢舉，商品會立即隱藏並出現在這裡。',
  '買家可在商品詳情頁或賣場頁送出檢舉，案件會進入待審區等待人工審核，商品不會直接下架。',
)
rep(
  '<div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70"><ProductImage src={r.productImage} alt={r.productName} /></div>',
  `{r.targetType === 'seller' ? (
                          seller ? <Avatar seller={seller} size="size-16" /> : null
                        ) : (
                          <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70"><ProductImage src={r.productImage} alt={r.productName} /></div>
                        )}`,
)
repRe(
  /<p className="text-sm font-black">\{r\.productName\}<\/p>(\s*<p className="text-xs text-muted-foreground">賣家：)/,
  (_m, b) =>
    `<p className="flex flex-wrap items-center gap-1.5 text-sm font-black">{r.productName}<Pill tone="neutral">{r.targetType === 'seller' ? '檢舉賣家' : '檢舉商品'}</Pill></p>${b}`,
)
rep(
  "{r.note && <p className=\"text-pretty text-xs text-muted-foreground\">補充：{r.note}</p>}",
  "{r.note && <p className=\"text-pretty text-xs text-muted-foreground\">補充：{r.note}</p>}\n                          {r.evidence && r.evidence.length > 0 && <EvidenceThumbs images={r.evidence} />}",
)
rep(
  '>駁回並恢復上架</button>',
  ">{r.targetType === 'seller' ? '駁回檢舉' : '駁回檢舉（維持上架）'}</button>",
)
rep(
  '>確認違規並下架</button>',
  ">{r.targetType === 'seller' ? '確認違規並警告' : '確認違規並下架'}</button>",
)

/* ---------- seller dashboard: reply to reports ---------- */
repRe(/(\n\s*onAppeal,)/, (m) => `${m}\n  reports = [],`)
rep(
  "productName: string; text: string }) => void\n",
  "productName: string; text: string }) => void\n  reports?: Report[]\n",
)
rep(
  "const flagged = products.find((p) => p.id === productId)?.flagged ?? false",
  "const flagged = (products.find((p) => p.id === productId)?.flagged ?? false) || reports.some((r) => r.status === 'open' && r.productId === productId)",
)
rep(
  "const banAppeal = appeals.find((a) => a.kind === 'ban')",
  "const banAppeal = appeals.find((a) => a.kind === 'ban')\n  const sellerReportsOpen = reports.filter((r) => r.status === 'open' && r.targetType === 'seller').length\n  const sellerAppeal = appeals.find((a) => a.kind === 'seller' && a.status === 'pending')",
)
repRe(
  /(\)\}\s*)(<div className=\{`\$\{panelCls\} flex flex-wrap items-center gap-4 p-4`\}>\s*<Avatar seller=\{seller\} size="size-14" \/>)/,
  (_m, a, b) => `${a}{sellerReportsOpen > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <Flag className="size-5 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1 text-pretty font-bold leading-relaxed text-amber-900">
            您的賣場有 {sellerReportsOpen} 筆檢舉正在人工審核中，賣場仍正常營運。若認為檢舉不實，可提出申訴並回覆說明。
          </p>
          {sellerAppeal ? (
            <AppealStatusBlock appeal={sellerAppeal} />
          ) : (
            <button type="button" onClick={() => setAppealTarget({ kind: 'seller', name: seller.name })} className={\`\${btnGhost} px-3 py-1.5 text-xs\`}>
              <Megaphone className="size-3.5" />申訴 / 回覆
            </button>
          )}
        </div>
      )}
      ${b}`,
)
rep(
  'onAppeal={submitAppeal}',
  'onAppeal={submitAppeal}\n              reports={reports.filter((r) => r.sellerId === mySeller.id)}',
)

fs.writeFileSync(file, s)
console.log('patched ok')
