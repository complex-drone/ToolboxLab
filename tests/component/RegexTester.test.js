import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountTool } from '../helpers/mount'
import RegexTester from '@/views/tools/RegexTester.vue'

describe('RegexTester 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function setInput(wrapper, pattern, text) {
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue(pattern)
    await wrapper.find('textarea').setValue(text)
    vi.advanceTimersByTime(400) // 防抖 300ms
    await wrapper.vm.$nextTick()
  }

  it('匹配计数与高亮（捕获分组）', async () => {
    const wrapper = mountTool(RegexTester)
    await setInput(wrapper, 'a(b)c', 'abc abc')
    const marks = wrapper.findAll('mark')
    expect(marks.length).toBe(2)
    expect(wrapper.text()).toMatch(/2/)
  })

  it('非法正则显示错误且不崩溃', async () => {
    const wrapper = mountTool(RegexTester)
    await setInput(wrapper, '([', 'abc')
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
    // 错误提示存在（i18n 或原始 message）
    expect(wrapper.text()).toMatch(/无效|错误|Invalid|无法/)
  })

  it('无 g 修饰符只匹配第一处', async () => {
    const wrapper = mountTool(RegexTester)
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('abc')
    const gCheckbox = wrapper.findAll('input[type="checkbox"]').find(c => c.attributes('value') === 'g')
    if (gCheckbox) await gCheckbox.setValue(false)
    await wrapper.find('textarea').setValue('abc abc')
    vi.advanceTimersByTime(400)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('mark').length).toBeLessThanOrEqual(1)
  })

  it('测试文本中的 HTML 被转义（防 XSS）', async () => {
    const wrapper = mountTool(RegexTester)
    await setInput(wrapper, '.*', '<img src=x onerror=alert(1)>')
    expect(wrapper.findAll('img').length).toBe(0)
    expect(wrapper.html()).toContain('&lt;img')
  })

  it('修饰符持久化到 localStorage', async () => {
    const wrapper = mountTool(RegexTester)
    const iCheckbox = wrapper.findAll('input[type="checkbox"]').find(c => c.attributes('value') === 'i')
    if (iCheckbox) {
      await iCheckbox.setValue(true)
      const stored = JSON.parse(localStorage.getItem('tool-regex-tester-config') || '{}')
      expect(stored.flags).toContain('i')
    }
  })
})
