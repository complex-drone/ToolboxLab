import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

/**
 * 构建时静态壳预渲染（post-build，自定义实现，不依赖第三方 prerender 插件）
 *
 * 对注册表中的每个路由 × 语言，基于 dist/index.html 模板生成静态 HTML：
 * - <title> / <meta description> / canonical / hreflang（x-default 指向 zh-CN）
 * - Open Graph / Twitter 卡片
 * - JSON-LD：WebApplication（全站）+ BreadcrumbList（工具页）+ FAQPage（有 faq 键的工具页）
 * - #app 内注入可见的 SEO 内容块（工具标题/描述/面包屑/FAQ），Vue 挂载后正常接管
 * - 按语言写入 <html lang>
 *
 * 已知路由落地为真实静态文件后，未知路径由 Cloudflare Pages 默认 404（404.html），
 * 从根本上消除 SPA 软 404。
 */

const SITE_URL = 'https://toolboxlab.pages.dev'
const LOCALES = ['zh-CN', 'en-US']
const DEFAULT_LOCALE = 'zh-CN'
const OG_IMAGE = `${SITE_URL}/og-image.png`

const root = process.cwd()
const distDir = path.join(root, 'dist')
const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')

/* ---------------- 注册表解析（源码正则，与 generate-sitemap.js 同源） ---------------- */

function parseRegistry() {
  const src = fs.readFileSync(path.resolve(root, 'src/router/toolsRegistry.js'), 'utf8')
  // 分类块：key: 'xxx', icon: '…', tools: [ … ]
  const catRe = /key:\s*'([a-z]+)',\s*icon:\s*'[^']*',\s*tools:\s*\[/g
  const marks = []
  let m
  while ((m = catRe.exec(src)) !== null) marks.push({ key: m[1], start: m.index })
  const tools = []
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length
    const block = src.slice(marks[i].start, end)
    const toolRe = /tool\(\s*'([^']+)'\s*,\s*'((?:\/[a-z0-9-]+)+)'/g
    let t
    while ((t = toolRe.exec(block)) !== null) {
      tools.push({ id: t[1], path: t[2], category: marks[i].key })
    }
    // 共享组件工具（密码生成器）以 passwordTool, 形式挂在分类块内
    if (/passwordTool,/.test(block)) {
      tools.push({ id: 'password', path: '/password', category: marks[i].key, isPassword: true })
    }
  }
  if (tools.length === 0) throw new Error('未能从 toolsRegistry.js 解析到任何工具')
  return tools
}

/* ---------------- 语言包加载（纯 ESM 对象，Node 可直接 import） ---------------- */

async function loadLocaleFiles(lang) {
  const dir = path.resolve(root, 'src/locales/tools', lang)
  const out = {}
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    out[f.replace(/\.js$/, '')] = (await import(pathToFileURL(path.join(dir, f)))).default
  }
  return out
}

const [zhGlobal, enGlobal] = await Promise.all([
  import(pathToFileURL(path.resolve(root, 'src/locales/zh-CN.js'))).then(m => m.default),
  import(pathToFileURL(path.resolve(root, 'src/locales/en-US.js'))).then(m => m.default),
])
const globals = { 'zh-CN': zhGlobal, 'en-US': enGlobal }
const fragments = {
  'zh-CN': await loadLocaleFiles('zh-CN'),
  'en-US': await loadLocaleFiles('en-US'),
}

/* ---------------- 工具函数 ---------------- */

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function escapeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c')
}
function pick(obj, keyPath) {
  let cur = obj
  for (const k of keyPath.split('.')) {
    if (cur == null || !(k in cur)) return ''
    cur = cur[k]
  }
  return typeof cur === 'string' ? cur : ''
}
// 当前路由在另一语言下的 URL
function localeUrl(route, locale) {
  return `${SITE_URL}/${locale}${route.url.slice(SITE_URL.length).replace(`/${route.locale}`, '') || '/'}`
}

const BREADCRUMB_HOME = { 'zh-CN': '首页', 'en-US': 'Home' }
const FAQ_TITLE = { 'zh-CN': '常见问题', 'en-US': 'FAQ' }
const LOCAL_NOTE = {
  'zh-CN': '数据仅在浏览器本地处理，不上传服务器。',
  'en-US': 'All data is processed locally in your browser. Nothing is uploaded.',
}

/* ---------------- 页面清单 ---------------- */

const registryTools = parseRegistry()

function collectFaq(frag) {
  const faq = []
  for (let i = 1; i <= 3; i++) {
    const q = frag[`faq${i}q`]
    const a = frag[`faq${i}a`]
    if (typeof q === 'string' && typeof a === 'string') faq.push({ q, a })
  }
  return faq
}

function pageInfo(locale, route) {
  const g = globals[locale]
  if (route.kind === 'home') {
    return {
      title: g.app.seoTitle || g.app.name,
      description: g.app.description,
      h1: g.app.name,
      categoryKey: null,
      categoryName: '',
      faq: [],
    }
  }
  if (route.kind === 'about') {
    return { title: g.about.title, description: g.about.description, h1: g.about.title, categoryKey: null, categoryName: '', faq: [] }
  }
  const tool = route.tool
  const frag = tool.isPassword
    ? { title: pick(g, 'password.title'), description: pick(g, 'password.description') }
    : fragments[locale][tool.id] || {}
  return {
    title: frag.title || tool.id,
    description: frag.description || '',
    h1: frag.title || tool.id,
    categoryKey: tool.category,
    categoryName: tool.category ? pick(g, `categories.list.${tool.category}.name`) : '',
    faq: collectFaq(frag),
  }
}

function routesFor(locale) {
  // 输出为扁平 .html 文件（date-calculator.html），Cloudflare Pages 会直接以 200
  // 服务无尾斜杠 URL；若用 目录/index.html 形式，Pages 会把无斜杠 URL 308 到
  // 尾斜杠变体，导致 sitemap/canonical 的无斜杠 URL 全部变成重定向
  const routes = [{ kind: 'home', locale, out: 'index.html', url: `${SITE_URL}/${locale}/` }]
  routes.push({ kind: 'about', locale, out: 'about.html', url: `${SITE_URL}/${locale}/about` })
  for (const tool of registryTools) {
    routes.push({
      kind: 'tool',
      locale,
      tool,
      out: tool.path.replace(/^\//, '') + '.html',
      url: `${SITE_URL}/${locale}${tool.path}`,
    })
  }
  return routes
}

/* ---------------- HTML 组装 ---------------- */

function buildHead(route, info, locale) {
  const other = locale === DEFAULT_LOCALE ? 'en-US' : DEFAULT_LOCALE
  const otherUrl = localeUrl(route, other)
  const defaultUrl = localeUrl(route, DEFAULT_LOCALE)

  const title = escapeHtml(info.title)
  const description = escapeHtml(info.description)

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: globals[locale].app.name,
      url: `${SITE_URL}/${locale}/`,
      description: globals[locale].app.description,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      inLanguage: locale,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ]
  if (route.kind === 'tool') {
    const list = [{ '@type': 'ListItem', position: 1, name: BREADCRUMB_HOME[locale], item: `${SITE_URL}/${locale}/` }]
    if (info.categoryKey) {
      list.push({
        '@type': 'ListItem',
        position: 2,
        name: info.categoryName,
        item: `${SITE_URL}/${locale}/#cat-${info.categoryKey}`,
      })
      list.push({ '@type': 'ListItem', position: 3, name: info.title })
    } else {
      list.push({ '@type': 'ListItem', position: 2, name: info.title })
    }
    jsonLd.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list })
    if ((info.faq || []).length) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: info.faq.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      })
    }
  }

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${route.url}" />`,
    `<link rel="alternate" hreflang="zh-CN" href="${locale === 'zh-CN' ? route.url : localeUrl(route, 'zh-CN')}" />`,
    `<link rel="alternate" hreflang="en-US" href="${locale === 'en-US' ? route.url : otherUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${defaultUrl}" />`,
    `<meta property="og:site_name" content="ToolboxLab" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${route.url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta property="og:locale:alternate" content="${other}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<script type="application/ld+json">${jsonLd.map(escapeJsonLd).join('\n')}</script>`,
  ].join('\n    ')
}

function buildContentBlock(route, info, locale) {
  const crumbs = [`<a href="${SITE_URL}/${locale}/">${BREADCRUMB_HOME[locale]}</a>`]
  if (info.categoryKey) {
    crumbs.push(`<a href="${SITE_URL}/${locale}/#cat-${info.categoryKey}">${escapeHtml(info.categoryName)}</a>`)
  }
  crumbs.push(escapeHtml(info.h1))

  const faqHtml =
    (info.faq || []).length
      ? `<h2 style="font-size:1.05rem;margin:1.6rem 0 .6rem;">${FAQ_TITLE[locale]}</h2>\n      <dl style="margin:0;">` +
        info.faq
          .map(
            f =>
              `<dt style="font-weight:600;margin:.7rem 0 .2rem;">${escapeHtml(f.q)}</dt>` +
              `<dd style="margin:0 0 .4rem;color:#475569;">${escapeHtml(f.a)}</dd>`,
          )
          .join('') +
        `</dl>`
      : ''

  const aboutLine =
    route.kind === 'tool'
      ? `<p style="color:#64748b;margin:1.4rem 0 0;">${escapeHtml(LOCAL_NOTE[locale])}</p>`
      : ''

  return `<div style="max-width:56rem;margin:0 auto;padding:2.5rem 1.25rem;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1e293b;">
      <nav style="font-size:.85rem;color:#64748b;margin-bottom:1rem;">${crumbs.join(' <span aria-hidden="true">›</span> ')}</nav>
      <h1 style="font-size:1.6rem;margin:0 0 .6rem;">${escapeHtml(info.h1)}</h1>
      <p style="color:#475569;margin:0;line-height:1.7;">${escapeHtml(info.description)}</p>
      ${faqHtml}
      ${aboutLine}
    </div>`
}

function renderPage(route, locale) {
  const info = pageInfo(locale, route)
  let html = template
  html = html.replace('<html lang="zh-CN">', `<html lang="${locale}">`)
  // 模板中的 <title> 与 description meta 一起被完整 head 替换
  html = html.replace(/<title>[\s\S]*?<\/title>/, buildHead(route, info, locale))
  html = html.replace(/<meta name="description"[^>]*>\s*/, '')
  html = html.replace('<div id="app"></div>', `<div id="app">${buildContentBlock(route, info, locale)}</div>`)
  return html
}

/* ---------------- 主流程 ---------------- */

let count = 0
for (const locale of LOCALES) {
  for (const route of routesFor(locale)) {
    const outPath = path.join(distDir, locale, route.out)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, renderPage(route, locale))
    count++
  }
}

// 404 页：双语文案 + 指向双语言首页，交给 Cloudflare Pages 以 404 状态服务
const notFound = template
  .replace(/<title>[\s\S]*?<\/title>/, '<title>404 页面不存在 · Page not found - ToolboxLab</title>')
  .replace(/<meta name="description"[^>]*>\s*/, '<meta name="robots" content="noindex" />')
  .replace(
    '<div id="app"></div>',
    `<div id="app"><div style="max-width:56rem;margin:0 auto;padding:4rem 1.25rem;font-family:system-ui,sans-serif;text-align:center;color:#1e293b;">
      <h1 style="font-size:2rem;margin:0 0 .8rem;">404</h1>
      <p style="color:#475569;margin:0 0 1.4rem;">页面不存在 · Page not found</p>
      <p style="margin:0;"><a href="${SITE_URL}/zh-CN/">返回中文首页</a> · <a href="${SITE_URL}/en-US/">Go to English home</a></p>
    </div></div>`,
  )
fs.writeFileSync(path.join(distDir, '404.html'), notFound)
count++

console.log(`✅ 预渲染完成：${count} 个静态页面（${LOCALES.join(' × ')} + 404.html）`)
