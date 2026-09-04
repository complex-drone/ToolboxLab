import fs from 'fs'
import path from 'path'

// 定义支持的语言
const supportedLocales = ['zh-CN', 'en-US']

// 定义路由名称列表（不包含语言前缀）
const routes = [
  'home',
  'password',
  'about'
]

// 定义站点域名
const siteUrl = 'https://toolboxlab.pages.dev'

// 定义页面元数据
const pageMetas = {
  home: {
    title: 'app.name',
    description: 'app.description'
  },
  password: {
    title: 'password.title',
    description: 'password.description'
  },
  about: {
    title: 'about.title',
    description: 'about.description'
  }
}

// 生成 sitemap 内容
function generateSitemap() {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

  // 为每个语言和每个路由生成 URL
  supportedLocales.forEach(locale => {
    routes.forEach(route => {
      xml += '  <url>\n'
      xml += `    <loc>${siteUrl}/${locale}/${route}</loc>\n`
      xml += '    <changefreq>weekly</changefreq>\n'
      xml += '    <priority>0.8</priority>\n'
      xml += '  </url>\n'
    })
  })

  xml += '</urlset>'

  return xml
}

// 生成多语言 sitemap
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

// 生成单个语言的 sitemap
function generateLocaleSitemap(locale) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

  routes.forEach(route => {
    xml += '  <url>\n'
    xml += `    <loc>${siteUrl}/${locale}/${route}</loc>\n`
    xml += '    <changefreq>weekly</changefreq>\n'
    xml += '    <priority>0.8</priority>\n'
    xml += '  </url>\n'
  })

  xml += '</urlset>'

  return xml
}

// 创建 dist 目录（如果不存在）
const distDir = path.join(process.cwd(), 'dist')
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

// 生成主 sitemap
const mainSitemap = generateSitemap()
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), mainSitemap)

// 生成多语言 sitemap 索引
const multilingualSitemap = generateMultilingualSitemap()
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), multilingualSitemap)

// 生成每个语言的 sitemap
supportedLocales.forEach(locale => {
  const localeSitemap = generateLocaleSitemap(locale)
  fs.writeFileSync(path.join(distDir, `sitemap-${locale}.xml`), localeSitemap)
})

console.log('✅ Sitemap generated successfully!')