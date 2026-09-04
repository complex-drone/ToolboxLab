import fs from 'fs'
import path from 'path'

/**
 * 验证 Cloudflare Analytics 配置
 */
function validateAnalyticsConfig() {
  console.log('🔍 验证 Cloudflare Analytics 配置...\n')

  // 1. 检查环境变量文件
  const envExampleExists = fs.existsSync('.env.example')
  const envLocalExists = fs.existsSync('.env.local')
  
  console.log('📁 环境变量文件检查:')
  console.log(`  .env.example: ${envExampleExists ? '✅ 存在' : '❌ 缺失'}`)
  console.log(`  .env.local: ${envLocalExists ? '✅ 存在' : '⚠️  缺失（生产环境不需要）'}`)

  // 2. 检查 Vite 配置
  const viteConfigPath = 'vite.config.js'
  if (fs.existsSync(viteConfigPath)) {
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf8')
    const hasAnalyticsDefine = viteConfig.includes('__VITE_CLOUDFLARE_ANALYTICS_TOKEN__')
    console.log('\n⚙️  Vite 配置检查:')
    console.log(`  Analytics define: ${hasAnalyticsDefine ? '✅ 已配置' : '❌ 缺失'}`)
  }

  // 3. 检查 HTML 模板
  const indexPath = 'index.html'
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf8')
    const hasAnalyticsScript = indexContent.includes('Cloudflare Web Analytics')
    const hasTokenReference = indexContent.includes('__VITE_CLOUDFLARE_ANALYTICS_TOKEN__')
    
    console.log('\n📄 HTML 模板检查:')
    console.log(`  Analytics 注释: ${hasAnalyticsScript ? '✅ 已添加' : '❌ 缺失'}`)
    console.log(`  Token 引用: ${hasTokenReference ? '✅ 已引用' : '❌ 缺失'}`)
  }

  // 4. 检查文档
  const docsPath = 'CLOUDFLARE_ANALYTICS.md'
  console.log('\n📚 文档检查:')
  console.log(`  配置文档: ${fs.existsSync(docsPath) ? '✅ 存在' : '❌ 缺失'}`)

  // 5. 读取本地 token（如果存在）
  if (envLocalExists) {
    const envLocalContent = fs.readFileSync('.env.local', 'utf8')
    const tokenMatch = envLocalContent.match(/VITE_CLOUDFLARE_ANALYTICS_TOKEN=(.+)/)
    
    if (tokenMatch) {
      const token = tokenMatch[1].trim()
      console.log('\n🔑 本地 Token 检查:')
      if (token === 'your_cloudflare_token_here') {
        console.log('  Token: ⚠️  使用示例 token（需要替换）')
      } else if (token.includes('xxxxxxxx')) {
        console.log('  Token: ⚠️  使用掩码 token（需要替换）')
      } else if (token.length > 20) {
        console.log('  Token: ✅ 看起来像真实 token')
      } else {
        console.log('  Token: ❌ 格式不正确')
      }
    } else {
      console.log('\n🔑 本地 Token 检查:')
      console.log('  Token: ❌ 环境变量格式错误')
    }
  }

  console.log('\n✅ 验证完成！')
  console.log('\n📋 部署检查清单:')
  console.log('  ☐ 确保生产环境设置了 VITE_CLOUDFLARE_ANALYTICS_TOKEN 环境变量')
  console.log('  ☐ 验证 Cloudflare Analytics Token 格式正确')
  console.log('  ☐ 测试生产构建包含正确的 analytics 脚本')
  console.log('  ☐ 检查浏览器开发者工具确认脚本加载')
}

// 运行验证
validateAnalyticsConfig()