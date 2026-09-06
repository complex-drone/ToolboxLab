<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import zhMessages from '@/locales/tools/zh-CN/httpStatusCodes.js'
import enMessages from '@/locales/tools/en-US/httpStatusCodes.js'

/**
 * HTTP 状态码查询：状态码分组与成员为组件常量，
 * 名称与描述走语言包；搜索基于中英双语索引，输入即过滤
 */

/** 1xx 到 5xx 分组与成员状态码（纯数据） */
const GROUPS = [
  { key: 'g1xx', badge: '1xx', codes: [100, 101, 102, 103] },
  { key: 'g2xx', badge: '2xx', codes: [200, 201, 202, 204, 206] },
  { key: 'g3xx', badge: '3xx', codes: [301, 302, 303, 304, 307, 308] },
  {
    key: 'g4xx',
    badge: '4xx',
    codes: [
      400, 401, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
      415, 416, 417, 418, 422, 428, 429, 431, 451,
    ],
  },
  { key: 'g5xx', badge: '5xx', codes: [500, 501, 502, 503, 504, 505, 506, 507, 508, 511] },
]

/** 分类徽章配色：信息蓝 / 成功绿 / 重定向黄 / 客户端橙 / 服务器红 */
const GROUP_STYLES = {
  g1xx: '!bg-blue-50 !text-blue-600 !border-blue-200',
  g2xx: '!bg-green-50 !text-green-600 !border-green-200',
  g3xx: '!bg-amber-50 !text-amber-600 !border-amber-200',
  g4xx: '!bg-orange-50 !text-orange-600 !border-orange-200',
  g5xx: '!bg-red-50 !text-red-600 !border-red-200',
}

const { t } = useI18n()

const keyword = useStorage('tool-http-status-codes-keyword', '')
const expanded = ref([])

/** 拼接单个状态码的双语检索文本 */
function buildIndexEntry(code, groupKey) {
  const key = 's' + code
  const zh = zhMessages.items[key] || {}
  const en = enMessages.items[key] || {}
  const zhGroup = (zhMessages.groups && zhMessages.groups[groupKey]) || ''
  const enGroup = (enMessages.groups && enMessages.groups[groupKey]) || ''
  return [String(code), zh.name, zh.desc, en.name, en.desc, zhGroup, enGroup]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** 双语搜索索引：无论界面语言，状态码、中英文名称与描述均可命中 */
const SEARCH_INDEX = {}
for (const group of GROUPS) {
  for (const code of group.codes) {
    SEARCH_INDEX[code] = buildIndexEntry(code, group.key)
  }
}

/** 实时过滤：空关键词返回全部分组 */
const filteredGroups = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return GROUPS.map(group => ({
    ...group,
    codes: kw
      ? group.codes.filter(code => SEARCH_INDEX[code].indexOf(kw) !== -1)
      : group.codes,
  })).filter(group => group.codes.length > 0)
})

const totalCount = computed(() =>
  filteredGroups.value.reduce((sum, group) => sum + group.codes.length, 0)
)

function isOpen(code) {
  return expanded.value.indexOf(code) !== -1
}

function toggleCard(code) {
  const index = expanded.value.indexOf(code)
  if (index === -1) expanded.value.push(code)
  else expanded.value.splice(index, 1)
}

function clearKeyword() {
  keyword.value = ''
}
</script>

<template>
  <ToolPage tool-id="httpStatusCodes">
    <!-- 搜索：输入即过滤 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="status-search">{{ t('tools.httpStatusCodes.searchLabel') }}</label>
      <div class="relative">
        <svg
          class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          id="status-search"
          v-model="keyword"
          type="text"
          class="input-base pl-9 pr-16"
          :placeholder="t('tools.httpStatusCodes.searchPlaceholder')"
          autocomplete="off"
        />
        <button
          v-if="keyword"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md transition"
          @click="clearKeyword"
        >
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span>{{ t('toolsCommon.total') }} {{ totalCount }} {{ t('toolsCommon.items') }}</span>
        <span>{{ t('tools.httpStatusCodes.expandHint') }}</span>
      </div>
    </section>

    <!-- 分组列表 -->
    <template v-if="filteredGroups.length">
      <section
        v-for="group in filteredGroups"
        :key="group.key"
        class="glass-card p-4 sm:p-6 mb-4"
      >
        <div class="flex items-center gap-2 mb-3">
          <span class="chip font-mono font-semibold" :class="GROUP_STYLES[group.key]">
            {{ group.badge }}
          </span>
          <h2 class="section-title mb-0">
            {{ t('tools.httpStatusCodes.groups.' + group.key) }}
          </h2>
          <span class="ml-auto text-xs text-slate-400">{{ group.codes.length }}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          <button
            v-for="code in group.codes"
            :key="code"
            type="button"
            class="text-left rounded-xl border border-slate-200 bg-white/70 hover:border-blue-300 hover:bg-blue-50/40 transition p-3 focus:outline-none focus:ring-2 focus:ring-blue-100"
            :aria-expanded="isOpen(code) ? 'true' : 'false'"
            @click="toggleCard(code)"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="flex items-baseline gap-2 min-w-0">
                <span class="font-mono font-bold text-slate-800">{{ code }}</span>
                <span class="text-sm text-slate-600 break-words">
                  {{ t('tools.httpStatusCodes.items.s' + code + '.name') }}
                </span>
              </span>
              <svg
                class="w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform"
                :class="isOpen(code) ? 'rotate-180' : ''"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
            <span
              v-show="isOpen(code)"
              class="block mt-1.5 text-xs leading-relaxed text-slate-500"
            >
              {{ t('tools.httpStatusCodes.items.s' + code + '.desc') }}
            </span>
          </button>
        </div>
      </section>
    </template>

    <!-- 空状态 -->
    <section v-else class="glass-card p-8 sm:p-12 mb-4 text-center">
      <p class="text-sm text-slate-400">{{ t('tools.httpStatusCodes.noMatch') }}</p>
    </section>
  </ToolPage>
</template>
