import fs from 'fs'
import path from 'path'

/**
 * sitemap 生成脚本（构建时执行）
 * 路由清单从 src/router/toolsRegistry.js 解析派生，避免与注册表脱节
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

function generateLocaleSitemap(locale) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  // 首页
  xml += `  <url>\n    <loc>${siteUrl}/${locale}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`
  // 静态页 + 工具页
  for (const route of [...staticPaths, ...toolPaths]) {
    xml += '  <url>\n'
    xml += `    <loc>${siteUrl}/${locale}${route}</loc>\n`
    xml += '    <changefreq>weekly</changefreq>\n'
    xml += '    <priority>0.8</priority>\n'
    xml += '  </url>\n'
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

supportedLocales.forEach(locale => {
  fs.writeFileSync(path.join(distDir, `sitemap-${locale}.xml`), generateLocaleSitemap(locale))
})
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), generateMultilingualSitemap())

console.log(`✅ Sitemap generated successfully! (${supportedLocales.length} locales × ${toolPaths.length + staticPaths.length + 1} URLs)`)
