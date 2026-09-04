<script setup>
import { useI18n } from 'vue-i18n'
import { useLocalePath } from '@/composables/useLocalePath'
import { computed } from 'vue'

const { t } = useI18n()
const { localePath } = useLocalePath()

// 工具列表：预留扩展
const tools = [
  {
    nameKey: 'password.title',
    path: '/password',
    icon: '🔑',
    descKey: 'password.description',
  },
]

// 将工具路径转换为带语言前缀的路径
const localizedTools = computed(() => {
  return tools.map(tool => ({
    ...tool,
    path: localePath(tool.path)
  }))
})
</script>

<template>
  <section class="home-view">
    <!-- 欢迎/介绍区域 -->
    <header class="home-header">
      <h1 class="welcome-title">{{ t('home.title') }}</h1>
      <p class="welcome-desc">{{ t('home.description') }}</p>
    </header>

    <!-- 工具卡片网格 -->
    <div class="tools-grid">
      <RouterLink
        v-for="tool in localizedTools"
        :key="tool.path"
        :to="tool.path"
        class="tool-card"
      >
        <div class="tool-icon">{{ tool.icon }}</div>
        <h2 class="tool-name">{{ t(tool.nameKey) }}</h2>
        <p class="tool-desc">{{ t(tool.descKey) }}</p>
        <div class="tool-arrow">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </RouterLink>
    </div>

    <!-- 提示信息（代替功能页占位） -->
    <div class="home-tip">
      <p>{{ t('home.bottomTip') }}</p>
    </div>
  </section>
</template>

<style scoped>
/* ---------- 首页视图 ---------- */
.home-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: fade-up 0.5s ease both;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 欢迎/介绍区域 ---------- */
.home-header {
  text-align: center;
  margin-bottom: 36px;
  animation: fade-up 0.5s ease 0.1s both;
}

.welcome-title {
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.welcome-desc {
  font-size: 14px;
  color: #64748b;
}

/* ---------- 工具网格 ---------- */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  width: 100%;
  max-width: 800px;
  margin-bottom: 16px;
}

/* ---------- 工具卡片 ---------- */
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 20px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: 0 6px 20px rgba(96, 125, 169, 0.12);
  transition: all 0.2s ease;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

.tool-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(96, 125, 169, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
}

.tool-card:active {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(96, 125, 169, 0.15);
}

/* 选中态高亮（通过 router-view 的 active class 控制） */
.tool-card.router-link-active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.18);
}

.tool-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 26px;
  margin-bottom: 14px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.tool-name {
  font-size: 17px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 6px;
}

.tool-desc {
  font-size: 13px;
  color: #64748b;
  text-align: center;
  line-height: 1.5;
}

.tool-arrow {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
  display: grid;
  place-items: center;
  transition: transform 0.2s;
}

.tool-card:hover .tool-arrow {
  transform: translateX(2px);
}

.tool-arrow svg {
  width: 14px;
  height: 14px;
}

/* ---------- 底部提示 ---------- */
.home-tip {
  margin-top: 12px;
  font-size: 13px;
  color: #94a3b8;
  text-align: center;
  animation: fade-up 0.5s ease 0.2s both;
}

/* ---------- 移动端适配 ---------- */
@media (max-width: 560px) {
  .tools-grid {
    grid-template-columns: 1fr;
    max-width: 400px;
  }

  .welcome-title {
    font-size: 24px;
  }

  .tool-card {
    padding: 22px 16px;
  }
}
</style>
