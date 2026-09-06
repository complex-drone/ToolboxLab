<script setup>
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useLocalePath } from '@/composables/useLocalePath'
import Toast from '@/components/Toast.vue'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import { onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { currentLocale, localePath } = useLocalePath()

// 站点信息
const SITE_VERSION = 'v1.0.0'
const currentYear = new Date().getFullYear()

// 项目仓库与问题反馈入口
const REPO_URL = 'https://github.com/complex-drone/ToolboxLab'
const ISSUES_URL = 'https://github.com/complex-drone/ToolboxLab/issues'

// 全局 Toast
const { toasts, remove } = useToast()

// 支持的语言列表
const supportedLocales = ['zh-CN', 'en-US']

// 页面元数据配置
const pageMetas = {
  home: {
    title: 'app.name',
    description: 'app.description'
  },
  password: {
    title: 'password.title',
    description: 'password.description'
  },
  about: {
    title: 'about.title',
    description: 'about.description'
  }
}

/**
 * 设置页面元数据
 */
function setPageMetadata() {
  const currentRouteName = route.name

  // 页面元数据：静态页面用 pageMetas，工具页回退到 tools.<name>.title/description
  const meta = pageMetas[currentRouteName] ||
    (typeof currentRouteName === 'string' && te(`tools.${currentRouteName}.title`)
      ? { title: `tools.${currentRouteName}.title`, description: `tools.${currentRouteName}.description` }
      : null)

  if (!meta) {
    return
  }

  const titleKey = meta.title
  const descriptionKey = meta.description
  const currentLocaleValue = currentLocale.value
  
  // 设置标题
  const title = t(titleKey)
  document.title = title
  
  // 设置描述
  const description = t(descriptionKey)
  let descriptionEl = document.querySelector('meta[name="description"]')
  if (descriptionEl) {
    descriptionEl.setAttribute('content', description)
  } else {
    descriptionEl = document.createElement('meta')
    descriptionEl.name = 'description'
    descriptionEl.content = description
    document.head.appendChild(descriptionEl)
  }
  
  // 设置 canonical URL
  const canonicalUrl = `${window.location.origin}/${currentLocaleValue}${route.path.replace(`/${currentLocaleValue}`, '')}`
  let canonicalEl = document.querySelector('link[rel="canonical"]')
  if (canonicalEl) {
    canonicalEl.setAttribute('href', canonicalUrl)
  } else {
    canonicalEl = document.createElement('link')
    canonicalEl.rel = 'canonical'
    canonicalEl.href = canonicalUrl
    document.head.appendChild(canonicalEl)
  }
  
  // 设置 hreflang 标签
  const hreflangLinks = document.querySelectorAll('link[rel="alternate"][hreflang]')
  hreflangLinks.forEach(el => el.remove())
  
  supportedLocales.forEach(lang => {
    const href = lang === currentLocaleValue 
      ? canonicalUrl 
      : `${window.location.origin}/${lang}${route.path.replace(`/${currentLocaleValue}`, '')}`
    
    const link = document.createElement('link')
    link.rel = 'alternate'
    link.hreflang = lang === 'zh-CN' ? 'zh' : lang
    link.href = href
    
    // 添加 x-default
    if (lang === 'zh-CN') {
      const xDefaultLink = document.createElement('link')
      xDefaultLink.rel = 'alternate'
      xDefaultLink.hreflang = 'x-default'
      xDefaultLink.href = canonicalUrl
      document.head.appendChild(xDefaultLink)
    }
    
    document.head.appendChild(link)
  })
}

/**
 * 处理语言变更
 */
function handleLocaleChange(newLocale) {
  // 保存到 localStorage
  localStorage.setItem('locale', newLocale)
  // 更新 vue-i18n
  locale.value = newLocale
  // 更新 html lang 属性
  document.documentElement.lang = newLocale
}

/**
 * 重定向到带语言的路径（仅在缺少或非法语言前缀时使用）
 */
function redirectToLocalePath() {
  // 如果当前路径是根路径且没有语言参数，则重定向到默认语言
  if (route.path === '/' && !route.params.locale) {
    router.replace('/zh-CN/')
    return
  }
  
  // 如果语言参数不合法，重定向到默认语言
  if (route.params.locale && !supportedLocales.includes(route.params.locale)) {
    router.replace('/zh-CN' + route.path.replace(`/${route.params.locale}`, ''))
    return
  }
}

// 在组件挂载时初始化（等待首次路由解析完成，避免把深链接误判为根路径而重定向）
onMounted(async () => {
  await router.isReady()
  redirectToLocalePath()
  // URL 中的语言前缀优先于 localStorage 偏好（深链接 / 全页加载场景）
  if (supportedLocales.includes(currentLocale.value) && currentLocale.value !== locale.value) {
    handleLocaleChange(currentLocale.value)
  }
  setPageMetadata()
})

// 监听路由中的语言参数变化，同步更新 i18n
watch(currentLocale, (newLocale) => {
  if (supportedLocales.includes(newLocale) && newLocale !== locale.value) {
    handleLocaleChange(newLocale)
  }
})

// 监听语言变化，更新页面元数据
watch(locale, () => {
  setPageMetadata()
})
</script>

<template>
  <!-- 背景装饰（纯视觉，不参与交互） -->
  <div class="bg-decor" aria-hidden="true">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
  </div>

  <div class="site">
    <!-- 顶栏：站点名称 + 版本号 + 导航 -->
    <header class="site-header">
      <div class="container header-inner">
        <RouterLink to="/" class="brand" aria-label="返回首页">
          <span class="brand-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              />
            </svg>
          </span>
          <h1 class="brand-name">{{ t('app.name') }}</h1>
        </RouterLink>
        <div class="header-actions">
          <span class="version-badge">{{ SITE_VERSION }}</span>
          <LocaleSwitcher />
        </div>
      </div>

      <!-- 顶部导航菜单 -->
      <nav class="top-nav">
        <div class="container nav-container">
          <RouterLink :to="localePath('/')" class="nav-link" active-class="active">{{ t('nav.home') }}</RouterLink>
          <RouterLink :to="localePath('/about')" class="nav-link" active-class="active">{{ t('nav.about') }}</RouterLink>
        </div>
      </nav>
    </header>

    <!-- 主区域：路由出口 -->
    <main class="container site-main">
      <router-view />
    </main>

    <!-- 页脚：版权 + 隐私声明 + 问题反馈 -->
    <footer class="site-footer">
      <div class="container">
        <p class="copyright">© {{ currentYear }} {{ t('app.name') }} · {{ t('footer.copyright') }}</p>
        <p class="privacy">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{{ t('footer.privacy') }}</span>
        </p>
        <p class="feedback-links">
          <a
            class="feedback-link"
            :href="REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>{{ t('footer.repo') }}</span>
          </a>
          <span class="feedback-divider" aria-hidden="true">·</span>
          <a
            class="feedback-link"
            :href="ISSUES_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{{ t('footer.feedback') }}</span>
          </a>
        </p>
      </div>
    </footer>
  </div>

  <!-- Toast 通知容器 -->
  <div class="toast-container">
    <Toast
      v-if="toasts.length"
      :key="toasts[0].id"
      :id="toasts[0].id"
      :message="toasts[0].message"
      :type="toasts[0].type"
    />
  </div>
</template>

<style>
/* ---------- 全局基础样式 ---------- */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
  color: #334155;
  background: linear-gradient(160deg, #edf3fb 0%, #e5edf8 45%, #eef1f7 100%);
  background-attachment: fixed;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button,
input {
  font-family: inherit;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<style scoped>
/* ---------- 背景装饰 ---------- */
.bg-decor {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
}

.blob-1 {
  width: 500px;
  height: 500px;
  background: rgba(147, 197, 253, 0.5);
  top: -160px;
  left: -120px;
}

.blob-2 {
  width: 420px;
  height: 420px;
  background: rgba(191, 219, 254, 0.45);
  bottom: -140px;
  right: -100px;
}

.blob-3 {
  width: 300px;
  height: 300px;
  background: rgba(224, 231, 255, 0.55);
  top: 40%;
  left: 55%;
}

/* ---------- 页面骨架 ---------- */
.site {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.container {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 20px;
}

/* ---------- 顶栏（毛玻璃） ---------- */
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: 0 1px 12px rgba(96, 125, 169, 0.08);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.brand-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 3px 10px rgba(37, 99, 235, 0.35);
}

.brand-icon svg {
  width: 18px;
  height: 18px;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: 0.5px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-badge {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.22);
  font-variant-numeric: tabular-nums;
}

/* ---------- 顶部导航菜单 ---------- */
.top-nav {
  border-top: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.3);
}

.nav-container {
  display: flex;
  gap: 8px;
  padding: 10px 0;
}

.nav-link {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #475569;
  text-decoration: none;
  transition: all 0.2s;
}

.nav-link:hover {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.08);
}

.nav-link.active {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.12);
  font-weight: 600;
}

/* ---------- 主区域 ---------- */
.site-main {
  flex: 1;
  padding-top: 36px;
  padding-bottom: 48px;
}

/* ---------- 页脚 ---------- */
.site-footer {
  padding: 22px 16px 26px;
  text-align: center;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.copyright {
  font-size: 13px;
  color: #64748b;
}

.privacy {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
}

.privacy svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

/* ---------- 问题反馈链接 ---------- */
.feedback-links {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
}

.feedback-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #64748b;
  text-decoration: none;
  transition: color 0.2s;
}

.feedback-link:hover {
  color: #2563eb;
}

.feedback-link svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.feedback-divider {
  color: #cbd5e1;
}

/* ---------- Toast 容器 ---------- */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
}

/* Toast 组件自身的进入动画已在组件内定义，此处无需额外动画 */

/* ---------- 移动端适配 ---------- */
@media (max-width: 560px) {
  .site-main {
    padding-top: 20px;
    padding-bottom: 32px;
  }

  .container {
    padding: 0 14px;
  }

  .nav-container {
    justify-content: center;
  }

  .header-actions {
    gap: 8px;
  }
}
</style>