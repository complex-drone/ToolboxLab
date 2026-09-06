import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.js'
import enUS from '@/locales/en-US.js'

// 与 src/locales/index.js 相同的片段合并逻辑
// 注意：import.meta.glob 只接受字符串字面量，不能使用模板字符串
function loadZhToolMessages() {
  const modules = import.meta.glob('../../src/locales/tools/zh-CN/*.js', { eager: true })
  const messages = {}
  for (const filePath of Object.keys(modules)) {
    const toolId = filePath.split('/').pop().replace(/\.js$/, '')
    messages[toolId] = modules[filePath].default
  }
  return messages
}

function loadEnToolMessages() {
  const modules = import.meta.glob('../../src/locales/tools/en-US/*.js', { eager: true })
  const messages = {}
  for (const filePath of Object.keys(modules)) {
    const toolId = filePath.split('/').pop().replace(/\.js$/, '')
    messages[toolId] = modules[filePath].default
  }
  return messages
}

let cached = null

/**
 * 构造与线上完全一致的双语 i18n 实例（用于组件测试）
 * 使用真实语言包 —— 缺键会直接导致断言失败，从而暴露 i18n 回归
 */
export function createTestingI18n(locale = 'zh-CN') {
  if (!cached) {
    cached = {
      'zh-CN': { ...zhCN, tools: loadZhToolMessages() },
      'en-US': { ...enUS, tools: loadEnToolMessages() },
    }
  }
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: cached,
    allowLinked: false,
    missingWarn: false,
    fallbackWarn: false,
  })
}
