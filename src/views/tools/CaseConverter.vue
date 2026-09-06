<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t } = useI18n()

const input = ref('')

/**
 * 拆词：按下划线 / 连字符 / 空格 / 大小写边界拆分。
 * 连续大写视为一个缩写词：HTTPServer -> HTTP Server，
 * 混合输入 helloWorld foo_bar 也会被统一拆开（整体转换）。
 */
function splitWords(raw) {
  const pre = String(raw || '').replace(/[_\-\s]+/g, ' ')
  const tokens = pre.split(' ').filter(Boolean)
  const words = []
  for (const token of tokens) {
    const parts = token
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // HTTPServer -> HTTP Server
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar -> foo Bar
      .split(/\s+/)
    for (const p of parts) {
      if (p) words.push(p)
    }
  }
  return words
}

/** 风格检测：按分隔符与大小写特征判断 */
function detectStyle(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const hasUnderscore = s.indexOf('_') !== -1
  const hasHyphen = s.indexOf('-') !== -1
  const hasSpace = /\s/.test(s)
  if (hasSpace || (hasUnderscore && hasHyphen)) return 'mixed'
  if (hasHyphen) return 'kebab'
  if (hasUnderscore) return /^[A-Z0-9]+$/.test(s) ? 'constant' : 'snake'
  if (/^[a-z0-9]+$/.test(s)) return 'lower'
  if (/^[A-Z0-9]+$/.test(s)) return 'upper'
  if (/^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(s)) return 'pascal'
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(s)) return 'camel'
  return 'unknown'
}

const DETECT_KEYS = {
  camel: 'styleCamel',
  pascal: 'stylePascal',
  snake: 'styleSnake',
  constant: 'styleConstant',
  kebab: 'styleKebab',
  upper: 'styleUpper',
  lower: 'styleLower',
  mixed: 'styleMixed',
  unknown: 'styleUnknown',
}

function toUpperFirst(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

const words = computed(() => {
  try {
    return splitWords(input.value)
  } catch {
    return []
  }
})

const detected = computed(() => {
  try {
    return detectStyle(input.value)
  } catch {
    return 'unknown'
  }
})

const detectedLabel = computed(() =>
  detected.value
    ? t(`tools.caseConverter.${DETECT_KEYS[detected.value] || 'styleUnknown'}`)
    : ''
)

/** 五种风格结果同时计算（整体转换） */
const results = computed(() => {
  const w = words.value
  if (!w.length) return []
  const lower = s => s.toLowerCase()
  return [
    {
      key: 'camel',
      labelKey: 'resultCamel',
      value: w.map((x, i) => (i === 0 ? lower(x) : toUpperFirst(x))).join(''),
    },
    { key: 'pascal', labelKey: 'resultPascal', value: w.map(toUpperFirst).join('') },
    { key: 'snake', labelKey: 'resultSnake', value: w.map(lower).join('_') },
    {
      key: 'constant',
      labelKey: 'resultConstant',
      value: w.map(x => x.toUpperCase()).join('_'),
    },
    { key: 'kebab', labelKey: 'resultKebab', value: w.map(lower).join('-') },
  ]
})

function clearInput() {
  input.value = ''
}
</script>

<template>
  <ToolPage tool-id="caseConverter">
    <!-- 输入与检测 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label class="section-title mb-0" for="case-input">
          {{ t('tools.caseConverter.inputLabel') }}
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="detectedLabel" class="chip">
            {{ t('tools.caseConverter.detected') }}: {{ detectedLabel }}
          </span>
          <button type="button" class="btn-ghost" :disabled="!input" @click="clearInput">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <input
        id="case-input"
        v-model="input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="input-base font-mono"
        :placeholder="t('tools.caseConverter.inputPlaceholder')"
        :aria-label="t('tools.caseConverter.inputLabel')"
      />

      <!-- 拆词结果 -->
      <div v-if="words.length" class="mt-4">
        <div class="mb-1.5 text-xs text-slate-500">
          {{ t('tools.caseConverter.wordsCount', { n: words.length }) }}
        </div>
        <div class="flex flex-wrap gap-1.5" :aria-label="t('tools.caseConverter.wordsTitle')">
          <span v-for="(w, i) in words" :key="i" class="chip font-mono">{{ w }}</span>
        </div>
      </div>
      <p v-else class="mt-3 text-sm text-slate-400">
        {{ t('tools.caseConverter.emptyHint') }}
      </p>
    </section>

    <!-- 转换结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.caseConverter.results') }}</h2>
      <div v-if="results.length" class="grid gap-2">
        <div
          v-for="r in results"
          :key="r.key"
          class="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5"
        >
          <span class="chip w-28 shrink-0 justify-center text-center sm:w-36">
            {{ t(`tools.caseConverter.${r.labelKey}`) }}
          </span>
          <code class="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">
            {{ r.value }}
          </code>
          <CopyButton :text="r.value" compact :label="t('toolsCommon.copy')" />
        </div>
      </div>
      <p v-else class="text-sm text-slate-400">
        {{ t('tools.caseConverter.emptyHint') }}
      </p>
    </section>
  </ToolPage>
</template>
