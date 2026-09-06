import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.js'
import enUS from './en-US.js'

/**
 * 加载各工具的独立语言包片段（src/locales/tools/<lang>/<toolId>.js）
 * 每个片段挂载到 messages.tools.<toolId> 下
 * 注意：import.meta.glob 只接受字符串字面量，不能使用模板字符串
 */
function loadZhToolMessages() {
  const modules = import.meta.glob('./tools/zh-CN/*.js', { eager: true })
  const messages = {}
  for (const filePath of Object.keys(modules)) {
    const toolId = filePath.split('/').pop().replace(/\.js$/, '')
    messages[toolId] = modules[filePath].default
  }
  return messages
}

function loadEnToolMessages() {
  const modules = import.meta.glob('./tools/en-US/*.js', { eager: true })
  const messages = {}
  for (const filePath of Object.keys(modules)) {
    const toolId = filePath.split('/').pop().replace(/\.js$/, '')
    messages[toolId] = modules[filePath].default
  }
  return messages
}

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
  legacy: false, // 使用组合式 API
  locale: determineLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': { ...zhCN, tools: loadZhToolMessages() },
    'en-US': { ...enUS, tools: loadEnToolMessages() },
  },
  allowLinked: false, // 禁用链接语法，避免 !@#$% 等特殊字符被误解析
})

export default i18n
