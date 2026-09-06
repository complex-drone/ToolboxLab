<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { byteLength, formatBytes } from '@/utils/format'

const { t } = useI18n()

const input = ref('')
const debouncedInput = ref('')

const syncDebounced = useDebounceFn(value => {
  debouncedInput.value = typeof value === 'string' ? value : ''
}, 300)

watch(input, value => syncDebounced(value))

/** 全部统计：空输入时各项目均为 0，不抛错 */
const stats = computed(() => {
  const s = debouncedInput.value
  if (!s) {
    return { total: 0, noSpace: 0, words: 0, lines: 0, paragraphs: 0, chinese: 0, bytes: 0 }
  }
  let chinese = 0
  try {
    chinese = (s.match(/[\u4e00-\u9fff]/g) || []).length
  } catch {
    chinese = 0
  }
  return {
    total: s.length,
    noSpace: s.replace(/\s/g, '').length,
    words: s.trim() ? s.split(/\s+/).filter(Boolean).length : 0,
    lines: s.split('\n').length,
    paragraphs: s.split(/\n\s*\n+/).filter(p => p.trim().length > 0).length,
    chinese,
    bytes: byteLength(s),
  }
})

/** 统计卡片定义 */
const CARDS = [
  { key: 'total', labelKey: 'statTotalChars' },
  { key: 'noSpace', labelKey: 'statCharsNoSpace' },
  { key: 'words', labelKey: 'statWords' },
  { key: 'lines', labelKey: 'statLines' },
  { key: 'paragraphs', labelKey: 'statParagraphs' },
  { key: 'chinese', labelKey: 'statChineseChars' },
]

const isEmpty = computed(() => debouncedInput.value.length === 0)

const byteLabel = computed(() => {
  try {
    return formatBytes(stats.value.bytes)
  } catch {
    return '0 B'
  }
})

const SAMPLE_TEXT = [
  'ToolboxLab 是一个纯前端工具站，所有数据仅在本地处理。',
  'All data is processed locally in your browser.',
  '',
  '统计维度包括：总字符数、不含空格字符数、单词数、行数、段落数、中文字数与 UTF-8 字节大小。',
].join('\n')

function fillSample() {
  input.value = SAMPLE_TEXT
  debouncedInput.value = SAMPLE_TEXT
}

function clearInput() {
  input.value = ''
  debouncedInput.value = ''
}
</script>

<template>
  <ToolPage tool-id="textStats">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.textStats.inputLabel') }}</h2>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" @click="fillSample">
            {{ t('tools.textStats.sample') }}
          </button>
          <button type="button" class="btn-danger" :disabled="!input" @click="clearInput">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="input"
        rows="10"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.textStats.inputPlaceholder')"
        :aria-label="t('tools.textStats.inputLabel')"
      ></textarea>
    </section>

    <!-- 统计结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.result') }}</h2>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div
          v-for="card in CARDS"
          :key="card.key"
          class="rounded-xl border border-slate-100 bg-white/70 p-3 sm:p-4"
        >
          <div class="mb-1 text-xs leading-snug text-slate-500">
            {{ t(`tools.textStats.${card.labelKey}`) }}
          </div>
          <div class="font-mono text-2xl font-bold tabular-nums text-slate-800">
            {{ stats[card.key] }}
          </div>
        </div>
      </div>

      <div
        class="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3 sm:p-4"
      >
        <span class="text-xs text-slate-500">{{ t('tools.textStats.byteSize') }}</span>
        <span class="font-mono text-lg font-bold text-blue-700">{{ byteLabel }}</span>
      </div>

      <!-- 空状态提示 -->
      <p v-if="isEmpty" class="mt-3 text-sm text-slate-400">
        {{ t('tools.textStats.emptyHint') }}
      </p>
    </section>
  </ToolPage>
</template>
