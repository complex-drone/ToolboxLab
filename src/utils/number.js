/**
 * 数值钳制工具：统一各工具滑块/输入框的取值范围保护
 */

/**
 * 钳制到 [min, max]；无法转为有限数字时返回 fallback
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback=min]
 * @returns {number}
 */
export function clampNumber(value, min, max, fallback = min) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 钳制到 [min, max] 并四舍五入为整数
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback=min]
 * @returns {number}
 */
export function clampInt(value, min, max, fallback = min) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
