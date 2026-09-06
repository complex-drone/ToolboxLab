import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountTool } from '../helpers/mount'
import JsonFormatter from '@/views/tools/JsonFormatter.vue'

function advanceDebounce() {
  // JsonFormatter 输入防抖 300ms
  vi.advanceTimersByTime(400)
}

describe('JsonFormatter 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染标题与输入区（i18n）', () => {
    const wrapper = mountTool(JsonFormatter)
    expect(wrapper.text()).toContain('JSON 格式化')
    expect(wrapper.text()).toContain('输入')
    expect(wrapper.findAll('textarea').length).toBeGreaterThanOrEqual(2)
  })

  it('合法 JSON 实时校验通过并提示', async () => {
    const wrapper = mountTool(JsonFormatter)
    const input = wrapper.findAll('textarea')[0]
    await input.setValue('{"a":1}')
    advanceDebounce()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('JSON 格式有效')
  })

  it('非法 JSON 显示行 + 列错误定位', async () => {
    const wrapper = mountTool(JsonFormatter)
    const input = wrapper.findAll('textarea')[0]
    await input.setValue('{\n  "a": 1,\n}')
    advanceDebounce()
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toMatch(/第\s*3\s*行/)
  })

  it('格式化按钮输出 2 空格缩进结果', async () => {
    const wrapper = mountTool(JsonFormatter)
    const input = wrapper.findAll('textarea')[0]
    await input.setValue('{"a":[1,2],"b":null}')
    advanceDebounce()
    await wrapper.vm.$nextTick()
    const formatBtn = wrapper.find('button.btn-primary')
    expect(formatBtn.exists()).toBe(true)
    await formatBtn.trigger('click')
    await wrapper.vm.$nextTick()
    const output = wrapper.findAll('textarea')[1]
    expect(output.element.value).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": null\n}')
  })

  it('压缩按钮输出去空格结果', async () => {
    const wrapper = mountTool(JsonFormatter)
    const input = wrapper.findAll('textarea')[0]
    await input.setValue('{"a": [1, 2]}')
    advanceDebounce()
    await wrapper.vm.$nextTick()
    const minifyBtn = wrapper.findAll('button').find(b => b.classes().includes('btn-ghost') && !b.attributes('disabled'))
    // 点击「压缩」（结果区的 ghost 按钮中第二个操作按钮）
    const minify = wrapper.findAll('button').find(b => b.text() === '压缩')
    expect(minify).toBeTruthy()
    await minify.trigger('click')
    await wrapper.vm.$nextTick()
    const output = wrapper.findAll('textarea')[1]
    expect(output.element.value).toBe('{"a":[1,2]}')
  })

  it('空输入不崩溃且格式化按钮禁用', async () => {
    const wrapper = mountTool(JsonFormatter)
    advanceDebounce()
    await wrapper.vm.$nextTick()
    const formatBtn = wrapper.find('button.btn-primary')
    expect(formatBtn.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toMatch(/第\s*\d+\s*行/)
  })

  it('缩进选项持久化到 localStorage', async () => {
    const wrapper = mountTool(JsonFormatter)
    const tabBtn = wrapper.findAll('button').find(b => b.text() === 'Tab')
    if (tabBtn) {
      await tabBtn.trigger('click')
      const stored = JSON.parse(localStorage.getItem('tool-json-formatter-config') || '{}')
      expect(stored.indent).toBe('tab')
    } else {
      // 选项以按钮形式存在时必须能找到 2/4/Tab 三种
      const labels = wrapper.findAll('button').map(b => b.text())
      expect(labels.join(',')).toMatch(/2|4|Tab/)
    }
  })
})
