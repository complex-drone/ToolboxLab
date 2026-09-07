import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * sitemap 生成脚本（构建时执行）
 * 路由清单从 src/router/toolsRegistry.js 解析派生，避免与注册表脱节
 * 每个 URL 携带 xhtml:link 语言互换（zh-CN/en-US/x-default）与 lastmod（取 src/ 最近一次提交时间）
 */

const supportedLocales = ['zh-CN', 'en-US']
const staticPaths = ['/about'] // 非工具页路由（首页单独输出）
const siteUrl = 'https://toolboxlab.pages.dev'

// 从注册表源码解析工具路径（tool('id', '/path', ...) 与 passwordTool 的 path: '/password'）
function parseToolPaths() {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/router/toolsRegistry.js'), 'utf8')
  const paths = new Set()
  const toolRe = /tool\(\s*'[^']+'\s*,\s*'((?:\/[a-z0-9-]+)+)'/g
  let m
  while ((m = toolRe.exec(src)) !== null) paths.add(m[1])
  const passwordRe = /path:\s*('(\/password)')/
  if (passwordRe.test(src)) paths.add('/password')
  if (paths.size === 0) throw new Error('未能从 toolsRegistry.js 解析到任何工具路径')
  return [...paths]
}

const toolPaths = parseToolPaths()

// lastmod：src/ 最近一次 git 提交时间（非 git 环境回退为构建时间）
function lastModDate() {
  try {
    return execSync('git log -1 --format=%cI -- src/', { encoding: 'utf8' }).trim()
  } catch {
    return new Date().toISOString()
  }
}

// xhtml:link 语言互换块（含 x-default 指向默认语言 zh-CN）
function alternateLinks(pathOnSite) {
  const urlFor = locale => `${siteUrl}/${locale}${pathOnSite || '/'}`
  let links = ''
  for (const l of supportedLocales) {
    links += `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlFor(l)}" />\n`
  }
  links += `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor('zh-CN')}" />\n`
  return links
}

function generateLocaleSitemap(locale, lastmod) {
  let xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
  // 首页
  xml +=
    `  <url>\n    <loc>${siteUrl}/${locale}/</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n` +
    alternateLinks('') +
    '  </url>\n'
  // 静态页 + 工具页
  for (const route of [...staticPaths, ...toolPaths]) {
    xml +=
      `  <url>\n    <loc>${siteUrl}/${locale}${route}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n` +
      alternateLinks(route) +
      '  </url>\n'
  }
  xml += '</urlset>'
  return xml
}

function generateMultilingualSitemap() {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  supportedLocales.forEach(locale => {
    xml += '  <sitemap>\n'
    xml += `    <loc>${siteUrl}/sitemap-${locale}.xml</loc>\n`
    xml += '  </sitemap>\n'
  })
  xml += '</sitemapindex>'
  return xml
}

const distDir = path.join(process.cwd(), 'dist')
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

const lastmod = lastModDate()
supportedLocales.forEach(locale => {
  fs.writeFileSync(path.join(distDir, `sitemap-${locale}.xml`), generateLocaleSitemap(locale, lastmod))
})
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), generateMultilingualSitemap())

console.log(`✅ Sitemap generated successfully! (${supportedLocales.length} locales × ${toolPaths.length + staticPaths.length + 1} URLs, lastmod ${lastmod})`)
