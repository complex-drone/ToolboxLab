<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalePath } from '@/composables/useLocalePath'
import { useRouter, useRoute } from 'vue-router'

const i18n = useI18n()
const route = useRoute()
const router = useRouter()
const { currentLocale } = useLocalePath()

const locales = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en-US', name: 'English' },
]

const currentLocaleValue = computed(() => i18n.locale.value)

function changeLocale(code) {
  if (code === currentLocale.value) return
  // 去掉当前语言前缀，拼上目标语言
  const cleanPath = route.path.replace(new RegExp(`^/${currentLocale.value}`), '') || '/'
  router.push(`/${code}${cleanPath}`)
}
</script>

<template>
  <div class="locale-switcher">
    <select
      :value="currentLocale"
      class="locale-select"
      @change="changeLocale($event.target.value)"
      :aria-label="'Switch language'"
    >
      <option
        v-for="loc in locales"
        :key="loc.code"
        :value="loc.code"
      >
        {{ loc.name }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.locale-switcher {
  display: flex;
  align-items: center;
}

.locale-select {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  transition: all 0.2s;
  outline: none;
}

.locale-select:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(255, 255, 255, 0.85);
}

.locale-select:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.locale-select option {
  color: #334155;
  background: #fff;
}
</style>