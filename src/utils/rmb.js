/**
 * 人民币大写转换（纯函数，字符串运算避免浮点误差）
 * 从 RmbUppercase.vue 提取，便于单元测试与复用
 */

/** 大写数字表 */
export const UPPER_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
/** 四位组内的单位 */
const INT_UNITS = ['', '拾', '佰', '仟']
/** 每 4 位一组的权位单位（上限 9999 亿，最多 3 组） */
const GROUP_UNITS = ['', '万', '亿']

/** 金额上限：9999 亿 */
export const MAX_AMOUNT = 999900000000

/**
 * 四位数字组转大写：组内连续零合并为一个「零」，末尾零丢弃
 * @param {string} group - 长度 1~4 的数字字符串
 */
function fourGroupToUppercase(group) {
  let out = ''
  let pendingZero = false
  for (let i = 0; i < group.length; i++) {
    const digit = Number(group[i])
    if (digit === 0) {
      pendingZero = true
      continue
    }
    if (pendingZero) {
      out += '零'
      pendingZero = false
    }
    out += UPPER_DIGITS[digit] + INT_UNITS[group.length - 1 - i]
  }
  return out
}

/**
 * 整数部分（纯数字字符串）转大写：处理跨组连续零
 * @param {string} intStr
 */
function integerToUppercase(intStr) {
  const trimmed = intStr.replace(/^0+(?=\d)/, '')
  if (trimmed === '' || trimmed === '0') return '零'
  const groups = []
  let rest = trimmed
  while (rest.length > 0) {
    groups.unshift(rest.slice(-4))
    rest = rest.slice(0, -4)
  }
  let out = ''
  for (let i = 0; i < groups.length; i++) {
    const groupText = fourGroupToUppercase(groups[i])
    if (!groupText) continue
    out += groupText + GROUP_UNITS[groups.length - 1 - i]
  }
  return out || '零'
}

/**
 * 金额字符串转人民币大写
 * @param {string} raw
 * @returns {{ ok: boolean, text: string, error: string, truncated: boolean }}
 * error 取值：empty | negative | invalid | overLimit
 */
export function convertToRmbUppercase(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { ok: false, text: '', error: 'empty', truncated: false }
  if (!/^\d+(?:\.\d*)?$/.test(text)) {
    return { ok: false, text: '', error: text.startsWith('-') ? 'negative' : 'invalid', truncated: false }
  }

  const dotIndex = text.indexOf('.')
  const intStr = dotIndex === -1 ? text : text.slice(0, dotIndex)
  const decRaw = dotIndex === -1 ? '' : text.slice(dotIndex + 1)
  const truncated = decRaw.length > 2
  const decStr = (decRaw.slice(0, 2) + '00').slice(0, 2)
  const jiao = Number(decStr[0])
  const fen = Number(decStr[1])

  const intValue = Number(intStr)
  if (intValue > MAX_AMOUNT) {
    return { ok: false, text: '', error: 'overLimit', truncated: false }
  }

  let result
  if (intValue === 0) {
    if (jiao === 0 && fen === 0) {
      result = '零元整'
    } else if (jiao > 0) {
      result = UPPER_DIGITS[jiao] + '角' + (fen > 0 ? UPPER_DIGITS[fen] + '分' : '')
    } else {
      result = UPPER_DIGITS[fen] + '分'
    }
  } else {
    result = integerToUppercase(intStr) + '元'
    if (jiao === 0 && fen === 0) {
      result += '整'
    } else if (jiao > 0) {
      result += UPPER_DIGITS[jiao] + '角' + (fen > 0 ? UPPER_DIGITS[fen] + '分' : '')
    } else {
      result += '零' + UPPER_DIGITS[fen] + '分'
    }
  }
  return { ok: true, text: result, error: '', truncated }
}
