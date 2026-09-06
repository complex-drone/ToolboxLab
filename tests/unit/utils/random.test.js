import { describe, it, expect } from 'vitest'
import { randomInt, randomIntBetween, secureShuffle, randomPick, sampleWithoutReplacement } from '@/utils/random'

describe('utils/random 随机源', () => {
  describe('randomInt', () => {
    it('输出严格落在 [0, max) 内', () => {
      for (let i = 0; i < 5000; i++) {
        const v = randomInt(7)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(7)
        expect(Number.isInteger(v)).toBe(true)
      }
    })

    it('覆盖全值域（无取模偏差导致的永久盲区）', () => {
      const seen = new Set()
      for (let i = 0; i < 10000; i++) seen.add(randomInt(5))
      expect(seen).toEqual(new Set([0, 1, 2, 3, 4]))
    })

    it('max=1 时恒为 0', () => {
      for (let i = 0; i < 100; i++) expect(randomInt(1)).toBe(0)
    })

    it.each([0, -1, 1.5, NaN, Infinity])('非法上界 %p 抛出异常', max => {
      expect(() => randomInt(max)).toThrow()
    })
  })

  describe('randomIntBetween', () => {
    it('双端包含 [min, max]', () => {
      const seen = new Set()
      for (let i = 0; i < 5000; i++) seen.add(randomIntBetween(1, 3))
      expect(seen).toEqual(new Set([1, 2, 3]))
    })

    it('min === max 恒定', () => {
      expect(randomIntBetween(5, 5)).toBe(5)
    })
  })

  describe('secureShuffle', () => {
    it('返回置换：元素与数量不变', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8]
      const shuffled = secureShuffle(arr)
      expect([...shuffled].sort((a, b) => a - b)).toEqual(arr)
      expect(shuffled).not.toBe(arr)
    })

    it('不修改原数组', () => {
      const arr = ['a', 'b', 'c']
      const snapshot = [...arr]
      secureShuffle(arr)
      expect(arr).toEqual(snapshot)
    })
  })

  describe('randomPick / sampleWithoutReplacement', () => {
    it('randomPick 返回数组内的元素', () => {
      const arr = ['x', 'y', 'z']
      for (let i = 0; i < 100; i++) expect(arr).toContain(randomPick(arr))
    })

    it('randomPick 空数组抛异常', () => {
      expect(() => randomPick([])).toThrow()
    })

    it('抽样不重复且数量正确', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const sampled = sampleWithoutReplacement(arr, 4)
      expect(sampled).toHaveLength(4)
      expect(new Set(sampled).size).toBe(4)
      sampled.forEach(v => expect(arr).toContain(v))
    })

    it('n ≥ 数组长度时返回全量置换', () => {
      const arr = [1, 2, 3]
      const sampled = sampleWithoutReplacement(arr, 10)
      expect([...sampled].sort()).toEqual(arr)
    })
  })
})
