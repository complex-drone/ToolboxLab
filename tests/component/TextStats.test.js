import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountTool } from '../helpers/mount'
import TextStats from '@/views/tools/TextStats.vue'

function statCard(wrapper, labelPart) {
  const card = wrapper.findAll('.grid > div').find(d => d.text().includes(labelPart))
  return card ? card.text().replace(/\D/g, '') : null
}

describe('TextStats 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('空输入显示 0 与空状态提示', async () => {
    const wrapper = mountTool(TextStats)
    vi.advanceTimersByTime(400)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('0')
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })

  it('混合中英文统计正确（防抖后更新）', async () => {
    const wrapper = mountTool(TextStats)
    const input = wrapper.find('textarea')
    await input.setValue('hello 世界 world\n\n第二段')
    vi.advanceTimersByTime(400)
    await wrapper.vm.$nextTick()
    // 5 词：hello / 世界 / world / 第二段 → 按空白切分为 4 词
    expect(statCard(wrapper, '单词')).toBe('4')
    // 中文：世界第二段 = 5 字
    expect(statCard(wrapper, '中文')).toBe('5')
    // 段落：空行分隔为 2 段
    expect(statCard(wrapper, '段落')).toBe('2')
  })

  it('UTF-8 字节大小展示（中文 3 字节）', async () => {
    const wrapper = mountTool(TextStats)
    await wrapper.find('textarea').setValue('中文')
    vi.advanceTimersByTime(400)
    await wrapper.vm.$nextTick()
    // 「中文」= 6 字节
    expect(wrapper.text()).toMatch(/6/)
  })

  it('仅空白的输入统计为 0 且不产生 NaN', async () => {
    const wrapper = mountTool(TextStats)
    await wrapper.find('textarea').setValue('   \n  \n ')
    vi.advanceTimersByTime(400)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })
})
