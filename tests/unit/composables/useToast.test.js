import { describe, it, expect, vi, afterEach } from 'vitest'
import { useToast } from '@/composables/useToast'

afterEach(() => {
  useToast().clearAll()
  vi.useRealTimers()
})

describe('composables/useToast', () => {
  it('success / info / error 设置正确类型', () => {
    const toast = useToast()
    toast.success('a')
    expect(toast.toasts.value[0].type).toBe('success')
    toast.info('b')
    expect(toast.toasts.value[0].type).toBe('info')
    toast.error('c')
    expect(toast.toasts.value[0].type).toBe('error')
  })

  it('show 默认为 success 类型', () => {
    const toast = useToast()
    toast.show('msg')
    expect(toast.toasts.value[0].type).toBe('success')
  })

  it('新 Toast 替换旧 Toast（单条展示）', () => {
    const toast = useToast()
    toast.success('first')
    toast.success('second')
    expect(toast.toasts.value).toHaveLength(1)
    expect(toast.toasts.value[0].message).toBe('second')
  })

  it('到期自动移除（fake timers）', () => {
    vi.useFakeTimers()
    const toast = useToast()
    toast.show('temp', 'info', 2000)
    expect(toast.toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1999)
    expect(toast.toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toast.toasts.value).toHaveLength(0)
  })

  it('remove 仅在移除当前显示那条时清空', () => {
    const toast = useToast()
    toast.show('one')
    const id = toast.toasts.value[0].id
    toast.remove(id + 999) // 不属于当前显示的 id
    expect(toast.toasts.value).toHaveLength(1)
    toast.remove(id)
    expect(toast.toasts.value).toHaveLength(0)
  })

  it('clearAll 立即清空', () => {
    const toast = useToast()
    toast.show('x')
    toast.clearAll()
    expect(toast.toasts.value).toHaveLength(0)
  })
})
