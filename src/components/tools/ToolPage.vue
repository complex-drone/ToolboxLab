<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TOOL_CATEGORIES, ALL_TOOLS, toolNameKey } from '@/router/toolsRegistry'
import { useLocalePath } from '@/composables/useLocalePath'

/**
 * 工具页统一外壳：面包屑 + 标题 + 描述 + 内容插槽 + FAQ + 相关工具
 * 各工具在此组件内自行用 .glass-card 包裹内容区块
 */
const props = defineProps({
  /** 工具 id（camelCase），对应 tools.<id>.title / tools.<id>.description */
  toolId: { type: String, required: true },
})

const { t, te } = useI18n()
const { localePath } = useLocalePath()

const title = computed(() =>
  te(`tools.${props.toolId}.title`) ? t(`tools.${props.toolId}.title`) : t(toolNameKey({ id: props.toolId })),
)

/* 面包屑：注册表定位工具所属分类（密码生成器等无分类时为两级） */
const category = computed(() => {
  const entry = ALL_TOOLS.find(x => x.id === props.toolId)
  if (!entry) return null
  return TOOL_CATEGORIES.find(c => c.key === entry.category) || null
})

/* FAQ：语言包中存在 faq1q/faq1a… 键时渲染（最多 3 组） */
const faqItems = computed(() => {
  const items = []
  for (let i = 1; i <= 3; i++) {
    if (te(`tools.${props.toolId}.faq${i}q`)) {
      items.push({
        q: t(`tools.${props.toolId}.faq${i}q`),
        a: t(`tools.${props.toolId}.faq${i}a`),
      })
    }
  }
  return items
})

/* 相关工具：同分类下最多 4 个 */
const relatedTools = computed(() => {
  if (!category.value) return []
  return category.value.tools
    .filter(x => x.id !== props.toolId)
    .slice(0, 4)
    .map(x => ({
      id: x.id,
      path: x.path,
      icon: x.icon,
      name: t(toolNameKey(x)),
    }))
})
</script>

<template>
  <div class="tool-page mx-auto w-full max-w-4xl">
    <header class="mb-6">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <RouterLink :to="localePath('/')" class="breadcrumb-link">{{ t('nav.home') }}</RouterLink>
        <template v-if="category">
          <span class="breadcrumb-sep" aria-hidden="true">›</span>
          <RouterLink
            :to="`${localePath('/')}#cat-${category.key}`"
            class="breadcrumb-link"
          >
            {{ t(`categories.list.${category.key}.name`) }}
          </RouterLink>
        </template>
        <span class="breadcrumb-sep" aria-hidden="true">›</span>
        <span class="breadcrumb-current" aria-current="page">{{ title }}</span>
      </nav>
      <h1 class="text-2xl font-bold text-slate-800 mb-1.5 tracking-wide mt-2">
        {{ title }}
      </h1>
      <p class="text-sm text-slate-500 leading-relaxed">
        {{ t(`tools.${toolId}.description`) }}
      </p>
    </header>
    <slot />

    <!-- FAQ（语言包提供 faq1q/faq1a… 时渲染） -->
    <section v-if="faqItems.length" class="glass-card p-4 sm:p-6 mt-6">
      <h2 class="section-title">{{ t('toolsCommon.faqTitle') }}</h2>
      <dl class="mt-3">
        <template v-for="(item, i) in faqItems" :key="i">
          <dt class="text-sm font-semibold text-slate-700 mt-3 first:mt-0">{{ item.q }}</dt>
          <dd class="text-sm text-slate-500 leading-relaxed mt-1">{{ item.a }}</dd>
        </template>
      </dl>
    </section>

    <!-- 相关工具（同分类） -->
    <section v-if="relatedTools.length" class="mt-6">
      <h2 class="section-title">{{ t('toolsCommon.relatedTitle') }}</h2>
      <div class="flex flex-wrap gap-2 mt-3">
        <RouterLink
          v-for="r in relatedTools"
          :key="r.id"
          :to="localePath(r.path)"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-white/70 border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600 transition"
        >
          <span aria-hidden="true">{{ r.icon }}</span>
          {{ r.name }}
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tool-page {
  animation: fade-up 0.4s ease both;
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: #94a3b8;
}

.breadcrumb-link {
  color: #64748b;
  transition: color 0.2s;
}

.breadcrumb-link:hover {
  color: #3b82f6;
}

.breadcrumb-sep {
  color: #cbd5e1;
}

.breadcrumb-current {
  color: #475569;
  font-weight: 500;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
