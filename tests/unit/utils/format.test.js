import { describe, it, expect } from 'vitest'
import { formatBytes, byteLength, padZero } from '@/utils/format'

describe('utils/format', () => {
  describe('formatBytes', () => {
    it.each([
      [0, '0 B'],
      [1, '1 B'],
      [512, '512 B'],
      [1024, '1.0 KB'],
      [1536, '1.5 KB'],
      [1048576, '1.0 MB'],
      [1073741824, '1.0 GB'],
    ])('%p → %s', (input, expected) => {
      expect(formatBytes(input)).toBe(expected)
    })

    it.each([-5, NaN, Infinity])('非法输入 %p 返回 "-"', input => {
      expect(formatBytes(input)).toBe('-')
    })

    it('digits 控制小数位', () => {
      expect(formatBytes(1600, 2)).toBe('1.56 KB')
    })
  })

  describe('byteLength（UTF-8 字节数）', () => {
    it.each([
      ['', 0],
      ['abc', 3],
      ['中', 3],
      ['中文测试', 12],
      ['😀', 4],
      ['a😀中', 8],
    ])('%p → %p 字节', (input, expected) => {
      expect(byteLength(input)).toBe(expected)
    })

    it('非字符串返回 0', () => {
      expect(byteLength(null)).toBe(0)
      expect(byteLength(undefined)).toBe(0)
      expect(byteLength(123)).toBe(0)
    })
  })

  describe('padZero', () => {
    it.each([
      [5, 2, '05'],
      [12, 2, '12'],
      [3, 4, '0003'],
      [-3, 2, '03'],
    ])('%p (len=%p) → %p', (n, len, expected) => {
      expect(padZero(n, len)).toBe(expected)
    })
  })
})
