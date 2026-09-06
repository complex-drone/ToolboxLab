import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach } from 'vitest'

// jsdom 可能缺少 Web Crypto（randomInt / UUID 生成依赖它）
if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = function randomUUID() {
    const buf = new Uint8Array(16)
    globalThis.crypto.getRandomValues(buf)
    buf[6] = (buf[6] & 0x0f) | 0x40
    buf[8] = (buf[8] & 0x3f) | 0x80
    const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}

// 每个用例前清空 localStorage，避免 useStorage 跨用例污染
beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  // 恢复被 vi.useFakeTimers 劫持的定时器（若有）
  if (vi.isFakeTimers()) vi.useRealTimers()
  document.title = 'ToolboxLab'
  vi.restoreAllMocks()
})
