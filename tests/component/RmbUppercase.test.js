import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountTool } from '../helpers/mount'
import RmbUppercase from '@/views/tools/RmbUppercase.vue'

describe('RmbUppercase 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function convert(wrapper, value) {
    await wrapper.find('input').setValue(value)
    vi.advanceTimersByTime(300) // 防抖 200ms
    await wrapper.vm.$nextTick()
  }

  it('标准金额转换展示大写结果', async () => {
    const wrapper = mountTool(RmbUppercase)
    await convert(wrapper, '1234.56')
    expect(wrapper.text()).toContain('壹仟贰佰叁拾肆元伍角陆分')
  })

  it('零元与整的规则', async () => {
    const wrapper = mountTool(RmbUppercase)
    await convert(wrapper, '0')
    expect(wrapper.text()).toContain('零元整')
    await convert(wrapper, '10')
    expect(wrapper.text()).toContain('壹拾元整')
  })

  it('负数输入显示行内错误', async () => {
    const wrapper = mountTool(RmbUppercase)
    await convert(wrapper, '-5')
    expect(wrapper.text()).toContain('负')
    expect(wrapper.text()).not.toContain('伍元')
  })

  it('超上限输入显示错误', async () => {
    const wrapper = mountTool(RmbUppercase)
    await convert(wrapper, '999900000001')
    // 错误提示出现，结果区不展示大写
    expect(wrapper.text()).not.toContain('玖仟玖佰玖拾玖亿')
  })

  it('第三位小数显示截断提示', async () => {
    const wrapper = mountTool(RmbUppercase)
    await convert(wrapper, '1.234')
    expect(wrapper.text()).toContain('壹元贰角叁分')
    expect(wrapper.text()).toMatch(/截断|舍弃/)
  })

  it('金额输入持久化到 localStorage', async () => {
    const wrapper = mountTool(RmbUppercase)
    await wrapper.find('input').setValue('88.88')
    await wrapper.vm.$nextTick()
    expect(localStorage.getItem('tool-rmb-uppercase-amount')).toBe('88.88')
  })

  it('快捷示例按钮填充金额', async () => {
    const wrapper = mountTool(RmbUppercase)
    const exampleBtn = wrapper.findAll('button').find(b => b.text() === '1234.56')
    await exampleBtn.trigger('click')
    vi.advanceTimersByTime(300)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('壹仟贰佰叁拾肆元伍角陆分')
  })
})
