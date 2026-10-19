import fs from 'node:fs'

const file = '/vercel/share/v0-project/components/open-marketplace.tsx'
fs.copyFileSync(file, '/vercel/share/v0-project/.v0work/open-marketplace.before-draft.tsx')
let src = fs.readFileSync(file, 'utf8')

const patches = []
const patch = (name, find, replace) => patches.push({ name, find, replace })

patch(
  'Product.draft',
  '  comboPrice?: Record<string, number>\n}\n\ninterface CartLine {',
  '  comboPrice?: Record<string, number>\n  draft?: boolean\n}\n\ninterface CartLine {',
)

patch(
  'form: save as draft',
  '      active: product?.active ?? true,\n      flagged: product?.flagged,',
  '      active: product ? product.active : false,\n      draft: product ? product.draft : true,\n      flagged: product?.flagged,',
)

patch(
  'form: submit label',
  "{product ? '儲存變更' : '確認上架'}",
  "{product && !product.draft ? '儲存變更' : '儲存並預覽'}",
)

patch(
  'saveProduct notify',
  "notify(p.reviewHold ? `商品價格超過",
  "notify(p.draft ? '已存為草稿，請預覽確認後按「發佈商品」才會公開' : p.reviewHold ? `商品價格超過",
)

patch(
  'toggleProduct draft guard',
  '  const toggleProduct = (id: string) => {\n',
  "  const toggleProduct = (id: string) => {\n    if (products.find((p) => p.id === id)?.draft) {\n      notify('草稿尚未發佈，請先預覽確認後按「發佈商品」')\n      return\n    }\n",
)

patch(
  'publishProduct',
  '  const approveProductReview = (id: string, ok: boolean) => {',
  "  const publishProduct = (id: string) => {\n    const target = products.find((p) => p.id === id)\n    if (!target) return\n    setProducts((l) => l.map((p) => (p.id === id ? { ...p, draft: false, active: true } : p)))\n    notify(target.reviewHold ? `商品價格超過 ${money(REVIEW_PRICE_LIMIT)}，已發佈並送出審核，核准後才會公開` : '商品已發佈上架，買家現在看得到了')\n  }\n  const approveProductReview = (id: string, ok: boolean) => {",
)

patch(
  'call site',
  '              onSaveProduct={saveProduct}\n',
  '              onSaveProduct={saveProduct}\n              onPublishProduct={publishProduct}\n',
)

patch(
  'dashboard destructure',
  '  onSaveProduct,\n  onImportProducts,',
  '  onSaveProduct,\n  onPublishProduct,\n  onImportProducts,',
)

patch(
  'dashboard prop type',
  '  onSaveProduct: (p: Product) => void\n',
  '  onSaveProduct: (p: Product) => void\n  onPublishProduct: (id: string) => void\n',
)

patch(
  'dashboard state',
  "  const [editing, setEditing] = useState<Product | null | 'new'>(null)\n",
  "  const [editing, setEditing] = useState<Product | null | 'new'>(null)\n  const [previewId, setPreviewId] = useState<string | null>(null)\n",
)

patch(
  'list: pill button',
  "<button type=\"button\" onClick={guard('調整商品上下架', () => onToggleProduct(p.id))} aria-pressed={p.active} className=\"shrink-0\">",
  "<button type=\"button\" disabled={!!p.draft} onClick={guard('調整商品上下架', () => onToggleProduct(p.id))} aria-pressed={p.active} className=\"shrink-0 disabled:cursor-default\">",
)

patch(
  'list: draft pill',
  '                    {p.flagged ? (\n                      <Pill tone="bad"><Flag className="size-3" />被檢舉・審核中已隱藏</Pill>',
  '                    {p.draft ? (\n                      <Pill tone="warn"><Eye className="size-3" />草稿・尚未發佈</Pill>\n                    ) : p.flagged ? (\n                      <Pill tone="bad"><Flag className="size-3" />被檢舉・審核中已隱藏</Pill>',
)

patch(
  'list: preview + publish buttons',
  "                    <button type=\"button\" onClick={guard('編輯商品', () => setEditing(p))}",
  "                    <button type=\"button\" onClick={() => setPreviewId(p.id)} className={`${btnGhost} px-3`} aria-label={`預覽 ${p.name}`}><Eye className=\"size-4\" /></button>\n                    {p.draft && (\n                      <button type=\"button\" onClick={guard('發佈商品', () => onPublishProduct(p.id))} className={`${btnPrimary} px-3.5 text-xs`}><Send className=\"size-4\" />發佈商品</button>\n                    )}\n                    <button type=\"button\" onClick={guard('編輯商品', () => setEditing(p))}",
)

patch(
  'dashboard: open preview after save + preview modal',
  '          onSave={(p) => {\n            onSaveProduct(p)\n            setEditing(null)\n          }}\n        />\n      )}\n',
  [
    '          onSave={(p) => {',
    '            onSaveProduct(p)',
    '            setEditing(null)',
    '            if (p.draft) setPreviewId(p.id)',
    '          }}',
    '        />',
    '      )}',
    '      {previewId && (() => {',
    '        const pv = myProducts.find((x) => x.id === previewId)',
    '        if (!pv) return null',
    '        return (',
    '          <ProductModal',
    '            product={pv}',
    '            seller={seller}',
    '            preview={{',
    '              draft: !!pv.draft,',
    '              onEdit: () => {',
    '                setPreviewId(null)',
    '                setEditing(pv)',
    '              },',
    "              onPublish: guard('發佈商品', () => {",
    '                onPublishProduct(pv.id)',
    '                setPreviewId(null)',
    '              }),',
    '            }}',
    '            onClose={() => setPreviewId(null)}',
    '            onAdd={() => {}}',
    '            onBuyNow={() => {}}',
    '            onOpenStore={() => {}}',
    '            onChat={() => {}}',
    '            onReport={() => {}}',
    '          />',
    '        )',
    '      })()}',
    '',
  ].join('\n'),
)

patch(
  'ProductModal destructure',
  '  onNotify,\n}: {\n  product: Product\n  seller: Seller\n',
  '  onNotify,\n  preview,\n}: {\n  product: Product\n  seller: Seller\n',
)

patch(
  'ProductModal prop type',
  '  onNotify?: (msg: string) => void\n}) {\n  const [reportOpen, setReportOpen] = useState(false)',
  '  onNotify?: (msg: string) => void\n  preview?: { draft: boolean; onEdit: () => void; onPublish: () => void }\n}) {\n  const [reportOpen, setReportOpen] = useState(false)',
)

patch(
  'ProductModal title + banner',
  '    <Modal title="商品詳情" onClose={onClose} size="xl" z={60}>\n      <div className="grid gap-6 p-5 md:grid-cols-2">',
  [
    "    <Modal title={preview ? '商品預覽（買家視角）' : '商品詳情'} onClose={onClose} size=\"xl\" z={60}>",
    '      {preview && (',
    '        <div role="note" className="mx-5 mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">',
    '          <Eye className="mt-0.5 size-5 shrink-0" />',
    '          <p className="min-w-0 flex-1 text-pretty font-bold leading-relaxed">',
    "            {preview.draft ? '預覽模式：這是買家會看到的樣子，目前尚未發佈。確認沒問題後，按下「發佈商品」才會公開上架。' : '預覽模式：這是買家目前看到的商品頁。'}",
    '          </p>',
    '        </div>',
    '      )}',
    '      <div className="grid gap-6 p-5 md:grid-cols-2">',
  ].join('\n'),
)

patch(
  'ProductModal buy buttons open',
  '          <div className="flex gap-3">\n            <button type="button" disabled={soldOut} onClick={() => tryBuy(onAdd)}',
  [
    '          {preview ? (',
    '            <div className="flex gap-3">',
    '              <button type="button" onClick={preview.onEdit} className={`${btnGhost} flex-1 py-3`}>',
    '                <Pencil className="size-4" />{preview.draft ? \'返回編輯\' : \'編輯商品\'}',
    '              </button>',
    '              {preview.draft ? (',
    '                <button type="button" onClick={preview.onPublish} className={`${btnPrimary} flex-1`}>',
    '                  <Send className="size-4" />發佈商品',
    '                </button>',
    '              ) : (',
    '                <button type="button" onClick={onClose} className={`${btnPrimary} flex-1`}>完成預覽</button>',
    '              )}',
    '            </div>',
    '          ) : (',
    '          <div className="flex gap-3">',
    '            <button type="button" disabled={soldOut} onClick={() => tryBuy(onAdd)}',
  ].join('\n'),
)

patch(
  'ProductModal buy buttons close',
  '              立即購買\n            </button>\n          </div>\n',
  '              立即購買\n            </button>\n          </div>\n          )}\n',
)

patch(
  'ProductModal report open',
  '          <button\n            type="button"\n            onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}',
  '          {!preview && (\n          <button\n            type="button"\n            onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}',
)

patch(
  'ProductModal report close',
  '            <Flag className="size-3.5" /> 檢舉此商品\n          </button>\n',
  '            <Flag className="size-3.5" /> 檢舉此商品\n          </button>\n          )}\n',
)

patch(
  'ProductModal seller actions open',
  '          <div className="flex flex-wrap gap-2">\n            <button type="button" onClick={onChat}',
  '          {!preview && (\n          <div className="flex flex-wrap gap-2">\n            <button type="button" onClick={onChat}',
)

patch(
  'ProductModal seller actions close',
  '              <Store className="size-4" /> 進入賣家賣場\n            </button>\n          </div>\n',
  '              <Store className="size-4" /> 進入賣家賣場\n            </button>\n          </div>\n          )}\n',
)

patch(
  'csv status',
  "p.flagged ? '審核中' : p.active ? '上架中' : '已下架'",
  "p.draft ? '草稿' : p.flagged ? '審核中' : p.active ? '上架中' : '已下架'",
)

for (const { name, find, replace } of patches) {
  const hits = src.split(find).length - 1
  if (hits !== 1) {
    console.error(`ABORT: "${name}" matched ${hits} times`)
    process.exit(1)
  }
  src = src.replace(find, () => replace)
}

fs.writeFileSync(file, src)
console.log(`applied ${patches.length} patches`)
