import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const LOCALE_STORAGE_KEY = 'locale'
const SUPPORTED_LOCALES = ['zh-CN', 'en-US']

/**
 * 语言切换 composable
 * 提供当前语言、切换语言、获取语言列表等功能
 */
export function useLocale() {
  const i18n = useI18n()

  /**
   * 当前语言代码
   */
  const currentLocale = computed(() => i18n.locale.value)

  /**
   * 获取语言列表
   */
  const locales = [
    { code: 'zh-CN', name: '简体中文' },
    { code: 'en-US', name: 'English' },
  ]

  /**
   * 切换语言
   * @param {string} locale - 语言代码 'zh-CN' | 'en-US'
   */
  function setLocale(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      console.warn(`Unsupported locale: ${locale}`)
      return
    }

    // 更新 i18n 实例的语言
    i18n.locale.value = locale

    // 持久化到 localStorage
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)

    // 更新 HTML lang 属性（有助于浏览器和辅助工具识别）
    document.documentElement.lang = locale
  }

  /**
   * 获取当前语言的显示名称
   */
  function getLocaleName(code) {
    const found = locales.find(l => l.code === code)
    return found ? found.name : code
  }

  return {
    currentLocale,
    locales,
    setLocale,
    getLocaleName,
  }
}

export default useLocale
