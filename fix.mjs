import fs from 'fs'
const f = 'components/open-marketplace.tsx'
let s = fs.readFileSync(f, 'utf8')
const pairs = [
  ['${order.remit.ref}\uFFFD\uFFFD\uFFFD${order.remit.at}', '${order.remit.ref}・${order.remit.at}'],
  ['一鍵生成社群\uFFFD\uFFFD銷貼文', '一鍵生成社群行銷貼文'],
  ['儲存收款帳號，\uFFFD\uFFFD\uFFFD能進行', '儲存收款帳號，才能進行'],
  ['申\uFFFD\uFFFD\uFFFD成立，商品已恢復上架', '申訴成立，商品已恢復上架'],
]
for (const [a, b] of pairs) {
  const n = s.split(a).length - 1
  if (n !== 1) throw new Error('match ' + n + ': ' + a)
  s = s.replace(a, () => b)
}
fs.writeFileSync(f, s)
console.log('fixed; remaining:', (s.match(/\uFFFD/g) || []).length)
