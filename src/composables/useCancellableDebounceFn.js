import { tryOnScopeDispose } from '@vueuse/core'

/**
 * 可取消的防抖函数（替代 @vueuse/core 的 useDebounceFn）
 *
 * @vueuse/core v10 的 useDebounceFn 返回值不带 cancel()，组件卸载时无法
 * 取消挂起任务（离开页面会抛 TypeError）；此实现返回带 cancel 属性的函数，
 * 并在作用域销毁（组件卸载）时自动取消挂起调用。
 *
 * @param {Function} fn 防抖目标函数
 * @param {number} ms 防抖窗口（毫秒）
 * @returns {Function & { cancel: () => void }}
 */
export function useCancellableDebounceFn(fn, ms = 300) {
  let timer = null

  function run(...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  run.cancel = cancel
  tryOnScopeDispose(cancel)
  return run
}
