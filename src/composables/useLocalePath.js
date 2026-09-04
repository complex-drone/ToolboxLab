import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export function useLocalePath() {
  const route = useRoute()
  const router = useRouter()

  /**
   * 获取当前语言
   * @returns {string}
   */
  const currentLocale = computed(() => {
    return route.params.locale || 'zh-CN'
  })

  /**
   * 将相对路径转换为带语言前缀的完整路径
   * @param {string} path - 相对路径，如 '/about'
   * @returns {string} 带语言前缀的完整路径，如 '/zh-CN/about'
   */
  function localePath(path) {
    // 如果路径已经是绝对路径，则直接返回
    if (path.startsWith('/')) {
      // 移除可能存在的语言前缀
      const cleanPath = path.replace(/^\/(zh-CN|en-US)\//, '/')
      return `/${currentLocale.value}${cleanPath}`
    }
    return path
  }

  /**
   * 跳转到指定语言和路径
   * @param {string} path - 相对路径，如 '/about'
   * @param {string} locale - 目标语言，如 'zh-CN'
   */
  function localeRedirect(path, locale = currentLocale.value) {
    const newPath = localePath(path)
    router.push(newPath)
  }

  return {
    currentLocale,
    localePath,
    localeRedirect
  }
}