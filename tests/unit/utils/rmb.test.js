import { describe, it, expect } from 'vitest'
import { convertToRmbUppercase, UPPER_DIGITS, MAX_AMOUNT } from '@/utils/rmb'

describe('utils/rmb 人民币大写转换', () => {
  describe('标准转换', () => {
    it.each([
      ['1234.56', '壹仟贰佰叁拾肆元伍角陆分'],
      ['10', '壹拾元整'],
      ['0', '零元整'],
      ['1234.00', '壹仟贰佰叁拾肆元整'],
      ['1', '壹元整'],
      ['1000000.08', '壹佰万元零捌分'],
    ])('%p → %p', (input, expected) => {
      const r = convertToRmbUppercase(input)
      expect(r).toEqual({ ok: true, text: expected, error: '', truncated: false })
    })
  })

  describe('角分边界', () => {
    it.each([
      ['0.5', '伍角'],
      ['0.05', '伍分'],
      ['0.56', '伍角陆分'],
      ['12.05', '壹拾贰元零伍分'],
      ['12.5', '壹拾贰元伍角'],
    ])('%p → %p', (input, expected) => {
      expect(convertToRmbUppercase(input).text).toBe(expected)
    })
  })

  describe('零与跨组补零', () => {
    it.each([
      ['1002', '壹仟零贰元整'],
      ['110', '壹佰壹拾元整'],
      ['20', '贰拾元整'],
      ['1000000', '壹佰万元整'],
      ['100000005', '壹亿零伍元整'],
      ['10000', '壹万元整'],
      ['100000000', '壹亿元整'],
    ])('%p → %p', (input, expected) => {
      expect(convertToRmbUppercase(input).text).toBe(expected)
    })
  })

  describe('截断提示', () => {
    it('第三位小数截断并标记 truncated', () => {
      const r = convertToRmbUppercase('1.234')
      expect(r.ok).toBe(true)
      expect(r.text).toBe('壹元贰角叁分')
      expect(r.truncated).toBe(true)
    })

    it('两位以内不标记截断', () => {
      expect(convertToRmbUppercase('1.23').truncated).toBe(false)
    })
  })

  describe('异常输入', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'empty'],
      ['-5', 'negative'],
      ['abc', 'invalid'],
      ['12a.3', 'invalid'],
      ['1.2.3', 'invalid'],
    ])('%p → error=%p 且不产生结果', (input, error) => {
      const r = convertToRmbUppercase(input)
      expect(r.ok).toBe(false)
      expect(r.text).toBe('')
      expect(r.error).toBe(error)
    })

    it('超过 9999 亿上限返回 overLimit', () => {
      expect(convertToRmbUppercase(String(MAX_AMOUNT)).ok).toBe(true)
      expect(convertToRmbUppercase('999900000001').error).toBe('overLimit')
    })

    it('null / undefined 视为空输入', () => {
      expect(convertToRmbUppercase(null).error).toBe('empty')
      expect(convertToRmbUppercase(undefined).error).toBe('empty')
    })
  })

  it('大写数字表完整且有序', () => {
    expect(UPPER_DIGITS).toEqual(['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'])
  })
})
