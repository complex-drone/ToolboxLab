import { createRouter, createWebHistory } from 'vue-router'
import { ALL_TOOLS, isToolAvailable } from './toolsRegistry'

/**
 * 由工具注册表生成路由：/:locale?/tool-path
 * 组件文件尚未实现的工具会被自动过滤
 */
function buildToolRoutes() {
  return ALL_TOOLS.filter(isToolAvailable).map(entry => ({
    path: `/:locale?${entry.path}`,
    name: entry.id,
    component: entry.component,
    props: true,
  }))
}

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/:locale?',
    name: 'home-locale',
    component: () => import('../views/HomeView.vue'),
    props: true,
  },
  ...buildToolRoutes(),
  {
    path: '/:locale?/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
    props: true,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    redirect: '/zh-CN/',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
