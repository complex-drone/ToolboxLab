/**
 * 格式化工具
 */

/**
 * 格式化字节数为可读字符串
 * @param {number} bytes
 * @param {number} digits - 小数位数
 * @returns {string}
 */
export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = -1
  do {
    value /= 1024
    i++
  } while (value >= 1024 && i < units.length - 1)
  return `${value.toFixed(digits)} ${units[i]}`
}

/**
 * 获取字符串的 UTF-8 字节长度
 * @param {string} str
 * @returns {number}
 */
export function byteLength(str) {
  if (typeof str !== 'string') return 0
  return new TextEncoder().encode(str).length
}

/**
 * 数字补零
 * @param {number} n
 * @param {number} len
 * @returns {string}
 */
export function padZero(n, len = 2) {
  return String(Math.abs(n)).padStart(len, '0')
}
