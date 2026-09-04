// ==================== 常量 ====================

const BASE_CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}<>?,.;:~',
}

const AMBIGUOUS_CHARS = {
  uppercase: ['O'],
  lowercase: ['o', 'l'],
  numbers: ['0', '1'],
}

// ==================== 随机数（加密级 + 降级） ====================

const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'

/**
 * 生成 [0, max) 的均匀随机整数
 * 使用拒绝采样避免取模偏差，异常时降级为 Math.random
 */
export function randomInt(max) {
  if (max <= 1) return 0
  if (hasCrypto) {
    try {
      const range = 0x100000000
      const limit = range - (range % max)
      const buf = new Uint32Array(1)
      let value
      do {
        crypto.getRandomValues(buf)
        value = buf[0]
      } while (value >= limit)
      return value % max
    } catch {
      // 降级
    }
  }
  return Math.floor(Math.random() * max)
}

/**
 * Fisher-Yates 洗牌，打散「每类至少一个」造成的头部聚集
 */
export function shuffle(arr) {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

// ==================== 核心生成 ====================

/**
 * 生成密码
 * @param {number} length 密码长度
 * @param {object} options { uppercase, lowercase, numbers, symbols }
 * @param {string[]} excludedSymbols 要排除的特殊符号列表
 * @param {boolean} excludeAmbiguous 是否排除易混淆字符
 */
export function generatePassword(length, options, excludedSymbols = [], excludeAmbiguous = false) {
  if (!length || length < 4) return ''

  // 构建各类型字符池
  const pools = {}
  for (const key of Object.keys(BASE_CHAR_SETS)) {
    let chars = BASE_CHAR_SETS[key].split('')
    // 排除易混淆字符
    if (excludeAmbiguous && AMBIGUOUS_CHARS[key]) {
      chars = chars.filter(c => !AMBIGUOUS_CHARS[key].includes(c))
    }
    // 排除指定符号
    if (key === 'symbols' && excludedSymbols.length > 0) {
      chars = chars.filter(c => !excludedSymbols.includes(c))
    }
    pools[key] = chars
  }

  const selectedKeys = Object.keys(options).filter(key => options[key] && pools[key].length > 0)
  if (selectedKeys.length === 0) return ''

  const allChars = selectedKeys.flatMap(key => pools[key])
  if (allChars.length === 0) return ''

  const result = []

  // 保证每种已选类型至少出现一次
  if (length >= selectedKeys.length) {
    for (const key of selectedKeys) {
      const pool = pools[key]
      result.push(pool[randomInt(pool.length)])
    }
  }

  // 填充剩余字符
  while (result.length < length) {
    result.push(allChars[randomInt(allChars.length)])
  }

  return shuffle(result).join('')
}

// ==================== 强度计算 ====================

export function calculateEntropy(length, poolSize) {
  if (!length || !poolSize || poolSize === 0) return 0
  return Math.round(length * Math.log2(poolSize))
}

export function getStrengthLevel(percent) {
  const levels = [
    { max: 40, color: '#f87171' },
    { max: 70, color: '#fbbf24' },
    { max: 101, color: '#34d399' },
  ]
  if (percent == null || percent < 0) return { percent: 0, color: '#94a3b8' }
  const level = levels.find(item => percent < item.max) || levels[levels.length - 1]
  return { percent, color: level.color }
}
