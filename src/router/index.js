import { createRouter, createWebHistory } from 'vue-router'

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
  {
    path: '/:locale?/password',
    name: 'password',
    component: () => import('../components/PasswordGenerator.vue'),
    props: true,
  },
  {
    path: '/:locale?/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
    props: true,
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
