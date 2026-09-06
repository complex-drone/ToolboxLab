import { describe, it, expect } from 'vitest'
import { mountTool } from '../helpers/mount'
import TextDedupe from '@/views/tools/TextDedupe.vue'

describe('TextDedupe 组件测试', () => {
  async function process(wrapper, input) {
    await wrapper.find('textarea').setValue(input)
    const btn = wrapper.findAll('button').find(b => b.classes().includes('btn-primary'))
    await btn.trigger('click')
    await wrapper.vm.$nextTick()
    const outputs = wrapper.findAll('textarea')
    return outputs[outputs.length - 1].element.value
  }

  it('默认去重保留首次出现', async () => {
    const wrapper = mountTool(TextDedupe)
    const result = await process(wrapper, 'a\nb\na\nc\nb')
    expect(result).toBe('a\nb\nc')
  })

  it('显示去重前后行数变化', async () => {
    const wrapper = mountTool(TextDedupe)
    await process(wrapper, 'a\na\na')
    expect(wrapper.text()).toMatch(/3/)
    expect(wrapper.text()).toMatch(/1/)
  })

  it('升序排序', async () => {
    const wrapper = mountTool(TextDedupe)
    await wrapper.find('select#dedupe-sort').setValue('asc')
    const result = await process(wrapper, 'c\na\nb')
    expect(result).toBe('a\nb\nc')
  })

  it('降序排序', async () => {
    const wrapper = mountTool(TextDedupe)
    await wrapper.find('select#dedupe-sort').setValue('desc')
    const result = await process(wrapper, 'a\nb\nc')
    expect(result).toBe('c\nb\na')
  })

  it('忽略大小写去重（可选开关）', async () => {
    const wrapper = mountTool(TextDedupe)
    const boxes = wrapper.findAll('input[type="checkbox"]')
    // 第一个勾选框是「拼音」（未排序时带 disabled 属性），第二个是「忽略大小写」
    const ignoreCase = boxes.find(b => !b.element.hasAttribute('disabled'))
    expect(ignoreCase).toBeTruthy()
    await ignoreCase.setValue(true)
    const result = await process(wrapper, 'A\na\nB')
    expect(result.split('\n').length).toBe(2)
  })

  it('拼音排序开关在非排序模式时禁用', async () => {
    const wrapper = mountTool(TextDedupe)
    const pinyin = wrapper.findAll('input[type="checkbox"]').find(b => b.element.hasAttribute('disabled'))
    expect(pinyin).toBeTruthy()
  })

  it('随机打乱使用加密随机源（输出为同一元素集合）', async () => {
    const wrapper = mountTool(TextDedupe)
    await wrapper.find('select#dedupe-sort').setValue('shuffle')
    const result = await process(wrapper, '1\n2\n3\n4\n5')
    expect(result.split('\n').sort().join('')).toBe('12345')
  })

  it('空输入不崩溃', async () => {
    const wrapper = mountTool(TextDedupe)
    const result = await process(wrapper, '')
    expect(typeof result).toBe('string')
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })
})
