<script setup>
import { useI18n } from 'vue-i18n'

/**
 * 工具页统一外壳：标题 + 描述 + 内容插槽
 * 各工具在此组件内自行用 .glass-card 包裹内容区块
 */
const props = defineProps({
  /** 工具 id（camelCase），对应 tools.<id>.title / tools.<id>.description */
  toolId: { type: String, required: true },
})

const { t } = useI18n()
</script>

<template>
  <div class="tool-page mx-auto w-full max-w-4xl">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800 mb-1.5 tracking-wide">
        {{ t(`tools.${toolId}.title`) }}
      </h1>
      <p class="text-sm text-slate-500 leading-relaxed">
        {{ t(`tools.${toolId}.description`) }}
      </p>
    </header>
    <slot />
  </div>
</template>

<style scoped>
.tool-page {
  animation: fade-up 0.4s ease both;
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
