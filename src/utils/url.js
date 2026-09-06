/**
 * URL 规范化工具：网络类工具共用的输入预处理
 */

/**
 * 规范化用户输入的 URL：
 * - 去首尾空白
 * - 无协议时自动补 https://
 * - 仅接受 http/https 协议
 * 非法输入返回空字符串
 * @param {string} raw
 * @returns {string}
 */
export function normalizeHttpUrl(raw) {
  const value = String(raw ?? '').trim()
  if (!value || /\s/.test(value)) return ''
  const candidate = /^https?:\/\//i.test(value) ? value : 'https://' + value
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return candidate
  } catch {
    return ''
  }
}
