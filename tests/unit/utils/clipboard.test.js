import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { copyText } from '@/utils/clipboard'

describe('utils/clipboard 剪贴板', () => {
  let execCommandMock

  beforeEach(() => {
    // jsdom 未实现 execCommand，直接挂 mock
    execCommandMock = vi.fn().mockReturnValue(true)
    document.execCommand = execCommandMock
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete document.execCommand
  })

  it('Clipboard API 可用时写入并返回 true', async () => {
    // jsdom 的 isSecureContext 为 false，模拟生产 https 环境
    vi.stubGlobal('isSecureContext', true)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(execCommandMock).not.toHaveBeenCalled()
  })

  it('API 写入失败时降级 execCommand 并成功', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const ok = await copyText('fallback')
    expect(ok).toBe(true)
    expect(execCommandMock).toHaveBeenCalledWith('copy')
  })

  it('execCommand 也失败时返回 false', async () => {
    execCommandMock.mockReturnValue(false)
    vi.stubGlobal('navigator', {})
    expect(await copyText('nope')).toBe(false)
  })

  it('非字符串输入直接返回 false', async () => {
    expect(await copyText(null)).toBe(false)
    expect(await copyText(123)).toBe(false)
    expect(await copyText(undefined)).toBe(false)
    expect(execCommandMock).not.toHaveBeenCalled()
  })
})
