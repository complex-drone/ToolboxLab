/**
 * HTML 转义工具：用于把任意字符串安全地插入 v-html / innerHTML
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * 转义字符串中的 HTML 特殊字符（& < > " '）
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ESCAPE_MAP[ch])
}
