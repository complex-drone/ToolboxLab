import { mount } from '@vue/test-utils'
import { createTestingI18n } from './i18n'

/**
 * 挂载工具组件的统一入口：注入真实双语 i18n
 * @param {import('vue').Component} component
 * @param {object} [options] - 透传给 mount 的其余选项
 */
export function mountTool(component, options = {}) {
  const { locale = 'zh-CN', ...rest } = options
  return mount(component, {
    global: {
      plugins: [createTestingI18n(locale)],
    },
    ...rest,
  })
}
