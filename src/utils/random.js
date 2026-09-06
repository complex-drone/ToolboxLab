/**
 * 加密级随机数工具：基于 crypto.getRandomValues 的拒绝采样，避免取模偏差
 */

/**
 * 生成 [0, maxExclusive) 范围内的加密安全随机整数（拒绝采样）
 * @param {number} maxExclusive - 上界（不含）
 * @returns {number}
 */
export function randomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('randomInt: maxExclusive must be a positive integer')
  }
  if (maxExclusive === 1) return 0
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  let value
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % maxExclusive
}

/**
 * 返回 [min, max] 范围内的加密安全随机整数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomIntBetween(min, max) {
  if (max < min) throw new Error('randomIntBetween: max must be >= min')
  return min + randomInt(max - min + 1)
}

/**
 * 加密安全的 Fisher-Yates 洗牌（返回新数组）
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function secureShuffle(arr) {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * 随机选取数组中的一个元素
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function randomPick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('randomPick: empty array')
  return arr[randomInt(arr.length)]
}

/**
 * 从数组中不重复抽取 n 个元素
 * @template T
 * @param {T[]} arr
 * @param {number} n
 * @returns {T[]}
 */
export function sampleWithoutReplacement(arr, n) {
  if (n >= arr.length) return secureShuffle(arr)
  return secureShuffle(arr).slice(0, n)
}
