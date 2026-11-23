const pages = ['http://localhost:3001/?page=arcade&game=merge', 'http://localhost:3000/']
for (const page of pages) {
  const html = await (await fetch(page)).text()
  const paths = [...html.matchAll(/\/_next\/[^"'\\\s]+/g)].map((match) => match[0]).slice(0, 30)
  const base = new URL(page).origin
  let local = html.includes('127.0.0.1:54321')
  let prod = html.includes('qfbupfnrvzgwbvdgdwvh.supabase.co')
  let service = html.includes('service_role')
  for (const path of [...new Set(paths)]) {
    const text = await (await fetch(base + path)).text()
    if (text.includes('127.0.0.1:54321')) local = true
    if (text.includes('qfbupfnrvzgwbvdgdwvh.supabase.co')) prod = true
    if (text.includes('"role":"service_role"') || text.includes('service_role')) service = true
  }
  console.log(JSON.stringify({ origin: base, files: new Set(paths).size, localApi: local, productionHost: prod, serviceRole: service }))
}
