import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import { flushPromises } from '@vue/test-utils'
import DataFormatConverter from '@/views/tools/DataFormatConverter.vue'

async function clickConvert(wrapper) {
  const btn = wrapper.findAll('button').find(b => b.text() === '转换')
  expect(btn, '转换按钮应存在').toBeTruthy()
  await btn.trigger('click')
  // 首次转换需要动态加载 js-yaml，多轮冲刷微任务确保完成
  await flushPromises()
  await new Promise(resolve => setTimeout(resolve, 20))
  await flushPromises()
  await wrapper.vm.$nextTick()
}

function textareas(wrapper) {
  return wrapper.findAll('textarea')
}

describe('DataFormatConverter 集成测试（输入 → 转换 → 输出）', () => {
  it('JSON → YAML 完整流程', async () => {
    const wrapper = mountTool(DataFormatConverter)
    await textareas(wrapper)[0].setValue('{"name": "ToolboxLab", "count": 93, "nested": {"ok": true}}')
    await clickConvert(wrapper)
    const output = textareas(wrapper)[1].element.value
    expect(output).toContain('name: ToolboxLab')
    expect(output).toContain('count: 93')
    expect(output).toContain('ok: true')
  })

  it('YAML → JSON 反向流程', async () => {
    const wrapper = mountTool(DataFormatConverter)
    const selects = wrapper.findAll('select')
    await selects[0].setValue('yaml') // 输入格式
    await selects[1].setValue('json') // 输出格式
    await textareas(wrapper)[0].setValue('name: ToolboxLab\ncount: 93')
    await clickConvert(wrapper)
    const output = textareas(wrapper)[1].element.value
    expect(output).toContain('"name"')
    expect(output).toContain('"count": 93')
  })

  it('交换按钮互换输入输出内容', async () => {
    const wrapper = mountTool(DataFormatConverter)
    await textareas(wrapper)[0].setValue('{"a": 1}')
    await clickConvert(wrapper)
    const swapBtn = wrapper.findAll('button').find(b => b.text() === '交换')
    expect(swapBtn).toBeTruthy()
    await swapBtn.trigger('click')
    await wrapper.vm.$nextTick()
    const [input, output] = textareas(wrapper)
    expect(input.element.value).toContain('a:')
    expect(output.element.value).toContain('"a"')
  })

  it('非法输入显示具体解析错误且不崩溃', async () => {
    const wrapper = mountTool(DataFormatConverter)
    await textareas(wrapper)[0].setValue('{"a": [1,}')
    await clickConvert(wrapper)
    const text = wrapper.text()
    expect(text).not.toMatch(/NaN|undefined/)
    // 输出区保持为空，错误信息可见
    const output = textareas(wrapper)[1].element.value
    expect(output).toBe('')
  })

  it('嵌套对象与数组完整支持', async () => {
    const wrapper = mountTool(DataFormatConverter)
    await textareas(wrapper)[0].setValue('{"list": [1, [2, 3]], "obj": {"deep": {"x": null}}}')
    await clickConvert(wrapper)
    const output = textareas(wrapper)[1].element.value
    expect(output).toContain('list:')
    expect(output).toContain('- 2')
    expect(output).toContain('x: null')
  })
})
