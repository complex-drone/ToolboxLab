import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'
import enUS from './en-US.js'

/**
 * 确定初始语言
 * 优先级：localStorage > 浏览器语言 > 默认语言 (zh-CN)
 */
function determineLocale() {
  // 1. 从 localStorage 读取用户偏好
  const savedLocale = localStorage.getItem('locale')
  if (savedLocale && ['zh-CN', 'en-US'].includes(savedLocale)) {
    return savedLocale
  }

  // 2. 检测浏览器语言
  const browserLang = navigator.language
  if (browserLang.startsWith('zh')) {
    return 'zh-CN'
  }
  if (browserLang.startsWith('en')) {
    return 'en-US'
  }

  // 3. 回退到默认语言
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false, // ✅ 修复：禁用传统模式，使用组合式 API
  locale: determineLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
  allowLinked: false, // ✅ 关键修复：禁用链接语法，避免 !@#$% 等特殊字符被误解析
})

export default i18n