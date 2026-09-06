import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import HttpStatusCodes from '@/views/tools/HttpStatusCodes.vue'

describe('HttpStatusCodes 组件测试', () => {
  it('默认渲染全部分组（1xx~5xx）', () => {
    const wrapper = mountTool(HttpStatusCodes)
    const text = wrapper.text()
    expect(text).toContain('404')
    expect(text).toContain('500')
    expect(text).toContain('301')
  })

  it('搜索 404 只剩一条结果', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    await wrapper.find('input').setValue('404')
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('404')
    expect(text).not.toContain('502')
  })

  it('关键词搜索（中文描述）实时过滤', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    await wrapper.find('input').setValue('重定向')
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('301')
    expect(text).not.toContain('404')
  })

  it('英文关键词可命中（任何界面语言）', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    await wrapper.find('input').setValue('not found')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('404')
  })

  it('正则特殊字符输入不崩溃（字符串匹配实现）', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    await wrapper.find('input').setValue('([')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })

  it('无匹配显示空状态', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    await wrapper.find('input').setValue('这个状态码不存在999')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('200')
  })

  it('点击状态码卡片可展开描述', async () => {
    const wrapper = mountTool(HttpStatusCodes)
    const card = wrapper.findAll('button').find(b => b.text().includes('404'))
    expect(card).toBeTruthy()
    await card.trigger('click')
    await wrapper.vm.$nextTick()
    // 展开后描述可见（Not Found 或中文描述）
    expect(wrapper.text()).toMatch(/Not Found|找不到|未找到/)
  })
})
