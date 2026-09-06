import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import { flushPromises } from '@vue/test-utils'
import MarkdownPreview from '@/views/tools/MarkdownPreview.vue'

const SAMPLE = [
  '# 标题一',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- [x] 已完成',
  '- [ ] 待办',
  '',
  '```js',
  'const x = 1',
  '```',
].join('\n')

// 注意：此组件渲染管线依赖 marked/highlight.js/DOMPurify 的动态 import，
// Vitest 假定时器会阻断动态模块解析，因此这里使用真实定时器。
// 等待方式为轮询渲染结果（高负载下固定 sleep 不稳定）。
async function render(wrapper, markdown) {
  await wrapper.find('textarea').setValue(markdown)
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    await flushPromises()
    await wrapper.vm.$nextTick()
    const state = wrapper.vm.$.setupState
    if (state && typeof state.html === 'string' && state.html.length > 0) return
    // 空输入场景：html 始终为空，靠超时退出
  }
  await wrapper.vm.$nextTick()
}

describe('MarkdownPreview 集成测试（编辑 → 渲染 → 安全）', () => {
  it('GFM 表格渲染为 HTML 表格', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, SAMPLE)
    const table = wrapper.find('table')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('列A')
    expect(table.findAll('td').length).toBeGreaterThanOrEqual(2)
  })

  it('任务列表渲染复选框', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, SAMPLE)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('代码块获得语法高亮 class', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, SAMPLE)
    const code = wrapper.find('pre code')
    expect(code.exists()).toBe(true)
    expect(code.classes().join(' ')).toMatch(/hljs|language-js/)
  })

  it('注入的 script 标签被 DOMPurify 清洗（安全）', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, `${SAMPLE}\n\n<script>alert(1)<\/script>\n\n[点击](javascript:alert(1))`)
    const html = wrapper.html()
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:alert')
  })

  it('标题正确渲染', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, '# 标题一')
    // 页面 h1 第一个是工具标题，渲染出的 h1 在预览区
    const headings = wrapper.findAll('h1').map(h => h.text())
    expect(headings).toContain('标题一')
  })

  it('空输入不渲染任何内容且不崩溃', async () => {
    const wrapper = mountTool(MarkdownPreview)
    await render(wrapper, '')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })
})
