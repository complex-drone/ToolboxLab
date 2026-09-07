import { describe, it, expect, vi, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useCancellableDebounceFn } from '@/composables/useCancellableDebounceFn'

afterEach(() => {
  vi.useRealTimers()
})

describe('useCancellableDebounceFn（可取消防抖）', () => {
  it('窗口内多次调用只执行一次，取最后一次参数', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = useCancellableDebounceFn(fn, 300)

    debounced('a')
    debounced('b')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('cancel() 阻止挂起执行，且可继续使用', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = useCancellableDebounceFn(fn, 300)

    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()

    debounced()
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('作用域销毁（组件卸载）时自动取消挂起调用', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const scope = effectScope()
    scope.run(() => {
      useCancellableDebounceFn(fn, 300)()
    })

    scope.stop()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('返回的函数带 cancel 方法', () => {
    const debounced = useCancellableDebounceFn(() => {}, 300)
    expect(typeof debounced.cancel).toBe('function')
  })
})
