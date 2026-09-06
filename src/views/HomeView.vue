<script setup>
import { useI18n } from 'vue-i18n'
import { useLocalePath } from '@/composables/useLocalePath'
import { computed, ref } from 'vue'
import {
  TOOL_CATEGORIES,
  isToolAvailable,
  toolNameKey,
  toolDescKey,
} from '@/router/toolsRegistry'

const { t } = useI18n()
const { localePath } = useLocalePath()

// 搜索关键词
const keyword = ref('')

// 已上线的工具（组件文件存在）
const availableCategories = computed(() => {
  return TOOL_CATEGORIES.map(cat => ({
    ...cat,
    tools: cat.tools.filter(isToolAvailable),
  })).filter(cat => cat.tools.length > 0)
})

const totalTools = computed(() =>
  availableCategories.value.reduce((sum, cat) => sum + cat.tools.length, 0)
)

// 按关键词过滤（匹配标题与描述）
const filteredCategories = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return availableCategories.value
  return availableCategories.value
    .map(cat => ({
      ...cat,
      tools: cat.tools.filter(tool => {
        const name = t(toolNameKey(tool)).toLowerCase()
        const desc = t(toolDescKey(tool)).toLowerCase()
        return name.includes(q) || desc.includes(q)
      }),
    }))
    .filter(cat => cat.tools.length > 0)
})

// 将工具路径转换为带语言前缀的路径
function localized(path) {
  return localePath(path)
}
</script>

<template>
  <section class="home-view">
    <!-- 欢迎/介绍区域 -->
    <header class="home-header">
      <h1 class="welcome-title">{{ t('home.title') }}</h1>
      <p class="welcome-desc">{{ t('home.description') }}</p>
      <p class="tools-count">{{ t('categories.toolsCount', { count: totalTools }) }}</p>
    </header>

    <!-- 搜索框 -->
    <div class="search-wrap">
      <div class="search-box">
        <svg
          class="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="keyword"
          type="search"
          class="search-input"
          :placeholder="t('categories.searchPlaceholder')"
          :aria-label="t('categories.searchPlaceholder')"
        />
      </div>
    </div>

    <!-- 无搜索结果 -->
    <div v-if="filteredCategories.length === 0" class="search-empty">
      <p>{{ t('categories.searchEmpty') }}</p>
    </div>

    <!-- 分类 + 工具卡片 -->
    <section
      v-for="cat in filteredCategories"
      :key="cat.key"
      class="tool-category"
    >
      <div class="category-header">
        <span class="category-icon" aria-hidden="true">{{ cat.icon }}</span>
        <h2 class="category-name">{{ t(`categories.list.${cat.key}.name`) }}</h2>
      </div>

      <div class="tools-grid">
        <RouterLink
          v-for="tool in cat.tools"
          :key="tool.path"
          :to="localized(tool.path)"
          class="tool-card"
        >
          <div class="tool-icon">{{ tool.icon }}</div>
          <h3 class="tool-name">{{ t(toolNameKey(tool)) }}</h3>
          <p class="tool-desc">{{ t(toolDescKey(tool)) }}</p>
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
    </section>

    <!-- 提示信息 -->
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
  width: 100%;
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
  margin-bottom: 20px;
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

.tools-count {
  margin-top: 6px;
  font-size: 12px;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.22);
  display: inline-block;
  padding: 3px 12px;
  border-radius: 999px;
  font-weight: 600;
}

/* ---------- 搜索框 ---------- */
.search-wrap {
  width: 100%;
  max-width: 560px;
  margin-bottom: 24px;
  animation: fade-up 0.5s ease 0.15s both;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.35);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  box-shadow: 0 4px 16px rgba(96, 125, 169, 0.1);
  transition: all 0.2s;
}

.search-box:focus-within {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.search-icon {
  width: 18px;
  height: 18px;
  color: #94a3b8;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: #334155;
}

.search-input::placeholder {
  color: #94a3b8;
}

.search-empty {
  padding: 40px 0;
  font-size: 14px;
  color: #94a3b8;
  text-align: center;
}

/* ---------- 分类 ---------- */
.tool-category {
  width: 100%;
  max-width: 1080px;
  margin-bottom: 28px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-left: 4px;
}

.category-icon {
  font-size: 18px;
}

.category-name {
  font-size: 16px;
  font-weight: 700;
  color: #334155;
}

/* ---------- 工具网格 ---------- */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  width: 100%;
}

/* ---------- 工具卡片 ---------- */
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 18px 16px 16px;
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

.tool-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  display: grid;
  place-items: center;
  font-size: 22px;
  margin-bottom: 12px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.tool-name {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 5px;
}

.tool-desc {
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-arrow {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
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
  width: 13px;
  height: 13px;
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
  }

  .welcome-title {
    font-size: 24px;
  }

  .tool-card {
    padding: 18px 16px 16px;
  }
}
</style>
