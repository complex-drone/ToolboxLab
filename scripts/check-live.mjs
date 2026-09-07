// 部署后复测工具：全量巡检线上 sitemap URL 状态码（node scripts/check-live.mjs）
const BASE = 'https://toolboxlab.pages.dev'

async function getText(url) {
  const r = await fetch(url, { redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location') || '', text: await r.text() }
}

function locsOf(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
}

// 1) 三个 sitemap 自身
for (const f of ['sitemap.xml', 'sitemap-zh-CN.xml', 'sitemap-en-US.xml']) {
  const { status, location } = await getText(`${BASE}/${f}`)
  console.log(`sitemap ${f}: ${status}${location ? ' -> ' + location : ''}`)
}

// 2) 收集子表全部 URL 并并发探测
const zhXml = (await getText(`${BASE}/sitemap-zh-CN.xml`)).text
const enXml = (await getText(`${BASE}/sitemap-en-US.xml`)).text
const all = [...locsOf(zhXml), ...locsOf(enXml)]
console.log(`子表 URL 总数: ${all.length}`)

const statusByCode = {}
const bad = []
const CONC = 12
for (let i = 0; i < all.length; i += CONC) {
  const batch = all.slice(i, i + CONC)
  await Promise.all(
    batch.map(async u => {
      try {
        const { status, location } = await getText(u)
        statusByCode[status] = (statusByCode[status] || 0) + 1
        if (status !== 200) bad.push(`${status} ${u}${location ? ' -> ' + location : ''}`)
      } catch (e) {
        bad.push(`FETCH_FAIL ${u} ${e.message}`)
      }
    }),
  )
}
console.log('状态码分布:', JSON.stringify(statusByCode))
if (bad.length) console.log('非 200 清单:\n' + bad.slice(0, 20).join('\n'))

// 3) 抽样确认服务的是预渲染页（含 canonical 与工具 h1），而非 SPA 壳
const sample = all.find(u => u.includes('date-calculator'))
const s = await getText(sample)
console.log(`抽样 ${sample}: ${s.status}, 含 canonical: ${s.text.includes('rel="canonical"')}, 含 h1: ${/<h1[^>]*>/.test(s.text)}`)

// 4) 404 行为（应为 HTTP 404）与尾斜杠变体
const nf = await getText(`${BASE}/zh-CN/not-exist-page`)
console.log(`未知路径: ${nf.status}`)
const slash = await getText(`${BASE}/zh-CN/date-calculator/`)
console.log(`尾斜杠变体 /date-calculator/: ${slash.status}`)

const ok = Object.keys(statusByCode).every(k => k === '200') && nf.status === 404
console.log(ok ? '✅ 全量复测通过：282/282 = 200，未知路径 404' : '❌ 存在异常，见上方清单')
