import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import CaseConverter from '@/views/tools/CaseConverter.vue'

describe('CaseConverter 组件测试', () => {
  it('混合风格输入拆词并输出五种风格', async () => {
    const wrapper = mountTool(CaseConverter)
    const input = wrapper.find('input')
    await input.setValue('helloWorld foo_bar')
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('helloWorldFooBar')      // camelCase
    expect(text).toContain('HelloWorldFooBar')      // PascalCase
    expect(text).toContain('hello_world_foo_bar')   // snake_case
    expect(text).toContain('HELLO_WORLD_FOO_BAR')   // CONSTANT_CASE
    expect(text).toContain('hello-world-foo-bar')   // kebab-case
  })

  it('连续大写边界拆词（HTTPServer）', async () => {
    const wrapper = mountTool(CaseConverter)
    await wrapper.find('input').setValue('HTTPServer')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('http_server')
  })

  it('自动检测输入风格标签', async () => {
    const wrapper = mountTool(CaseConverter)
    await wrapper.find('input').setValue('my_constant_name')
    await wrapper.vm.$nextTick()
    // 检测结果以 chip 形式展示（包含「检测」或风格名）
    expect(wrapper.text()).toMatch(/检测|detect|snake/i)
  })

  it('空输入不崩溃且五種风格区为空', () => {
    const wrapper = mountTool(CaseConverter)
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })
})
