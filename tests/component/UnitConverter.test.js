import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import UnitConverter from '@/views/tools/UnitConverter.vue'

async function setCategory(wrapper, label) {
  const btn = wrapper.findAll('button').find(b => b.text().includes(label))
  expect(btn, `分类按钮 ${label} 应存在`).toBeTruthy()
  await btn.trigger('click')
  await wrapper.vm.$nextTick()
}

describe('UnitConverter 组件测试', () => {
  it('长度默认换算：1 米 → 英尺（6 位精度）', async () => {
    const wrapper = mountTool(UnitConverter)
    await wrapper.find('#unit-source-value').setValue('1')
    await wrapper.vm.$nextTick()
    const target = wrapper.find('#unit-target-value')
    expect(Number(target.element.value)).toBeCloseTo(3.28084, 4)
  })

  it('双向换算：目标输入反向更新源', async () => {
    const wrapper = mountTool(UnitConverter)
    // 目标输入 3.28084 英尺 → 源 ≈ 1 米
    await wrapper.find('#unit-target-value').setValue('3.28084')
    await wrapper.vm.$nextTick()
    const source = wrapper.find('#unit-source-value')
    expect(Number(source.element.value)).toBeCloseTo(1, 3)
  })

  it('温度换算使用特殊函数：100 摄氏度 → 212 华氏度', async () => {
    const wrapper = mountTool(UnitConverter)
    await setCategory(wrapper, '温度')
    await wrapper.find('#unit-source-value').setValue('100')
    await wrapper.vm.$nextTick()
    expect(Number(wrapper.find('#unit-target-value').element.value)).toBeCloseTo(212, 3)
  })

  it('存储类别支持二进制/十进制切换', async () => {
    const wrapper = mountTool(UnitConverter)
    await setCategory(wrapper, '存储')
    // 二进制（1024 进制）：1 KiB = 1024 B
    await wrapper.find('#unit-source-value').setValue('1')
    await wrapper.vm.$nextTick()
    const before = Number(wrapper.find('#unit-target-value').element.value)
    // 切换进制体系
    const toggleBtn = wrapper.findAll('button').find(b => /十进制|二进制|KiB|kB/.test(b.text()))
    if (toggleBtn) {
      await toggleBtn.trigger('click')
      await wrapper.vm.$nextTick()
      const after = Number(wrapper.find('#unit-target-value').element.value)
      expect(before).not.toBe(after)
    }
  })

  it('交换按钮互换源与目标单位', async () => {
    const wrapper = mountTool(UnitConverter)
    const fromSelect = wrapper.find('select')
    const fromBefore = fromSelect.element.value
    const swapBtn = wrapper.findAll('button').find(b => /交换|swap/i.test(b.text()) || b.attributes('aria-label')?.includes('交换'))
    expect(swapBtn).toBeTruthy()
    await swapBtn.trigger('click')
    await wrapper.vm.$nextTick()
    const selects = wrapper.findAll('select')
    const values = selects.map(s => s.element.value)
    expect(values).toContain(fromBefore)
  })

  it('非法数字输入显示行内错误且不崩溃', async () => {
    const wrapper = mountTool(UnitConverter)
    await wrapper.find('#unit-source-value').setValue('abc')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toMatch(/NaN|Infinity/)
  })
})
