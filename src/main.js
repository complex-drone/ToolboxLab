import { createApp as createVueApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './locales/index.js'

// 导出工厂函数供 vite-ssg 使用（预渲染时必须）
export function createApp() {
  const app = createVueApp(App)
  app.use(router)
  app.use(i18n)
  return { app, router }   // 必须返回包含 router 的对象
}

// 仅在浏览器环境中执行挂载（开发 / 预览时正常渲染）
if (typeof window !== 'undefined') {
  const { app } = createApp()
  app.mount('#app')
}