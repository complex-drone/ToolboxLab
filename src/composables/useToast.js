import { ref } from 'vue'

const toasts = ref([])
let nextId = 0

export function useToast() {
  /**
   * 显示一条 Toast 提示
   * @param {string} message - 提示内容
   * @param {string} type - 类型：'success' | 'info' | 'error'
   * @param {number} duration - 显示时长（毫秒）
   */
  function show(message, type = 'success', duration = 2000) {
    // 直接替换为新数组，确保只显示最新的一条 Toast
    const id = nextId++
    toasts.value = [{ id, message, type, duration }]

    // 自动移除
    setTimeout(() => {
      remove(id)
    }, duration)
  }

  function remove(id) {
    // 如果当前显示的 Toast 就是要移除的那个，清空数组
    if (toasts.value.length > 0 && toasts.value[0].id === id) {
      toasts.value = []
    }
  }

  function clearAll() {
    toasts.value = []
  }

  /** 成功提示 */
  function success(message, duration = 2000) {
    show(message, 'success', duration)
  }

  /** 信息提示 */
  function info(message, duration = 2000) {
    show(message, 'info', duration)
  }

  /** 错误提示 */
  function error(message, duration = 2600) {
    show(message, 'error', duration)
  }

  return { toasts, show, success, info, error, remove, clearAll }
}
