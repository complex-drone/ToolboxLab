import { mount } from '@vue/test-utils'
import { createTestingI18n } from './i18n'
import { createRouter, createMemoryHistory } from 'vue-router'

/**
 * 轻量路由：ToolPage 的面包屑/相关工具依赖 useRoute 与 RouterLink
 */
function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:locale?/:pathMatch(.*)*', name: 'catchall', component: { template: '<div />' } }],
  })
}

/**
 * 挂载工具组件的统一入口：注入真实双语 i18n 与路由
 * @param {import('vue').Component} component
 * @param {object} [options] - 透传给 mount 的其余选项
 */
export function mountTool(component, options = {}) {
  const { locale = 'zh-CN', ...rest } = options
  return mount(component, {
    global: {
      plugins: [createTestingI18n(locale), createTestRouter()],
    },
    ...rest,
  })
}
