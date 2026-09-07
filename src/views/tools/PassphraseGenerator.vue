<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { randomInt } from '@/utils/random'
import { EFF_WORDS, WORDLIST_SIZE } from '@/utils/effWordlist'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 密码短语生成器（Diceware）
 * - 内置 EFF Large Wordlist（7776 词，CC BY 3.0）
 * - 随机抽取使用 crypto 拒绝采样（randomInt），禁用 Math.random
 * - 熵值 = 词数 × log2(词表大小) + 数字附加位 + 大写附加位
 * - 结果仅在手动点击「重新生成」时更新
 */
const { t } = useI18n()
const toast = useToast()

const MIN_WORDS = 3
const MAX_WORDS = 6
const MIN_COUNT = 1
const MAX_COUNT = 10

const SEPARATOR_OPTIONS = [
  { key: 'hyphen', value: '-' },
  { key: 'space', value: ' ' },
  { key: 'underscore', value: '_' },
  { key: 'dot', value: '.' },
  { key: 'custom', value: '' },
]

/* ---------- 选项持久化 ---------- */

const config = useStorage('tool-passphrase-generator-config', {
  wordCount: 4,
  separator: 'hyphen',
  customSeparator: '+',
  appendNumber: false,
  capitalize: false,
  count: 5,
})

const results = ref([])

/* ---------- 分隔符 ---------- */

function isValidCustomSep(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 3
}

const customSepInvalid = computed(
  () => config.value.separator === 'custom' && !isValidCustomSep(config.value.customSeparator)
)

const effectiveSeparator = computed(() => {
  if (config.value.separator !== 'custom') {
    const found = SEPARATOR_OPTIONS.find(s => s.key === config.value.separator)
    return found && found.key !== 'custom' ? found.value : '-'
  }
  return isValidCustomSep(config.value.customSeparator) ? config.value.customSeparator : '-'
})

/* ---------- 熵值与强度 ---------- */

function clampInt(v, min, max) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

const wordCount = computed(() => clampInt(config.value.wordCount, MIN_WORDS, MAX_WORDS))

const entropyBits = computed(() => {
  const n = wordCount.value
  let bits = n * Math.log2(WORDLIST_SIZE)
  if (config.value.appendNumber) {
    bits += Math.log2(10)
    if (n > 1) bits += Math.log2(n)
  }
  if (config.value.capitalize && n > 1) bits += Math.log2(n)
  return bits
})

const strength = computed(() => {
  const b = entropyBits.value
  if (b < 60) return { key: 'weak', chipCls: 'bg-red-50 text-red-600 border-red-100' }
  if (b < 80) return { key: 'medium', chipCls: 'bg-amber-50 text-amber-600 border-amber-100' }
  if (b < 100) return { key: 'strong', chipCls: 'bg-blue-50 text-blue-600 border-blue-100' }
  return { key: 'extreme', chipCls: 'bg-emerald-50 text-emerald-600 border-emerald-100' }
})

const entropyExplainHint = computed(() => t('tools.passphraseGenerator.hint_' + strength.value.key))

/* ---------- 生成（仅手动触发） ---------- */

function buildPassphrase() {
  const n = wordCount.value
  const words = []
  for (let i = 0; i < n; i++) {
    words.push(EFF_WORDS[randomInt(WORDLIST_SIZE)])
  }
  const digitPos = config.value.appendNumber ? randomInt(n) : -1
  const capPos = config.value.capitalize ? (n > 1 ? randomInt(n) : 0) : -1
  const sep = effectiveSeparator.value
  return words
    .map((w, i) => {
      let part = w
      if (i === capPos) part = part.charAt(0).toUpperCase() + part.slice(1)
      if (i === digitPos) part += String(randomInt(10))
      return part
    })
    .join(sep)
}

function generate() {
  try {
    const total = clampInt(config.value.count, MIN_COUNT, MAX_COUNT)
    const items = []
    for (let i = 0; i < total; i++) items.push(buildPassphrase())
    results.value = items
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

const allText = computed(() => results.value.join('\n'))

onMounted(() => {
  generate()
})
</script>

<template>
  <ToolPage tool-id="passphraseGenerator">
    <!-- 选项区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        <!-- 单词数量 -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="label-base mb-0">{{ t('tools.passphraseGenerator.wordCount') }}</span>
            <span class="chip font-mono">
              {{ wordCount }} {{ t('tools.passphraseGenerator.unitWords') }}
            </span>
          </div>
          <input
            v-model.number="config.wordCount"
            type="range"
            :min="MIN_WORDS"
            :max="MAX_WORDS"
            step="1"
            class="w-full accent-blue-600 cursor-pointer"
          />
          <div class="flex justify-between text-xs text-slate-400 mt-1">
            <span>3</span>
            <span>6</span>
          </div>
        </div>

        <!-- 生成条数 -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="label-base mb-0">{{ t('tools.passphraseGenerator.passphraseCount') }}</span>
            <span class="chip font-mono">{{ config.count }} {{ t('tools.passphraseGenerator.unitItem') }}</span>
          </div>
          <input
            v-model.number="config.count"
            type="range"
            :min="MIN_COUNT"
            :max="MAX_COUNT"
            step="1"
            class="w-full accent-blue-600 cursor-pointer"
          />
          <div class="flex justify-between text-xs text-slate-400 mt-1">
            <span>1</span>
            <span>10</span>
          </div>
        </div>
      </div>

      <!-- 分隔符 -->
      <div class="mt-5">
        <span class="label-base">{{ t('tools.passphraseGenerator.separator') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in SEPARATOR_OPTIONS"
            :key="s.key"
            type="button"
            class="px-3 py-1.5 rounded-lg text-sm border transition select-none"
            :class="
              config.separator === s.key
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : 'bg-white/70 border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
            "
            @click="config.separator = s.key"
          >
            {{ t(`tools.passphraseGenerator.sep_${s.key}`) }}
          </button>
        </div>
        <div v-if="config.separator === 'custom'" class="mt-2 max-w-xs">
          <input
            v-model="config.customSeparator"
            type="text"
            maxlength="3"
            class="input-base font-mono"
            :placeholder="t('tools.passphraseGenerator.customPlaceholder')"
          />
          <p v-if="customSepInvalid" class="text-xs text-red-600 mt-1">
            {{ t('tools.passphraseGenerator.customInvalid') }}
          </p>
        </div>
      </div>

      <!-- 附加选项 -->
      <div class="flex flex-col gap-2 mt-5">
        <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.appendNumber" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
          <span>{{ t('tools.passphraseGenerator.appendNumber') }}</span>
        </label>
        <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.capitalize" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
          <span>{{ t('tools.passphraseGenerator.capitalize') }}</span>
        </label>
      </div>

      <div class="mt-5">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="generate">
          {{ t('tools.passphraseGenerator.generate') }}
        </button>
      </div>
    </section>

    <!-- 熵值说明 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip font-mono">{{ WORDLIST_SIZE }} {{ t('tools.passphraseGenerator.unitWords') }}</span>
        <span class="chip font-mono">
          {{ t('tools.passphraseGenerator.entropy') }} {{ entropyBits.toFixed(1) }}
          {{ t('tools.passphraseGenerator.bits') }}
        </span>
        <span class="chip" :class="strength.chipCls">
          {{ t('tools.passphraseGenerator.strengthLabel') }} ·
          {{ t(`tools.passphraseGenerator.strength_${strength.key}`) }}
        </span>
      </div>
      <p class="text-xs text-slate-500 mt-2.5">{{ entropyExplainHint }}</p>
      <p class="text-xs text-slate-400 mt-1.5 leading-relaxed">
        {{ t('tools.passphraseGenerator.entropyExplain') }}
      </p>
      <p class="text-xs text-slate-400 mt-1.5">{{ t('tools.passphraseGenerator.wordlistInfo') }}</p>
    </section>

    <!-- 结果列表 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('tools.passphraseGenerator.resultSection') }}</span>
        <CopyButton
          :text="allText"
          :label="t('toolsCommon.copyAll')"
          :disabled="results.length === 0"
        />
        <button type="button" class="btn-ghost" @click="generate">
          {{ t('tools.passphraseGenerator.generate') }}
        </button>
      </div>

      <p v-if="results.length === 0" class="text-sm text-slate-400 py-6 text-center">
        {{ t('tools.passphraseGenerator.emptyResult') }}
      </p>
      <ul v-else>
        <li
          v-for="(item, i) in results"
          :key="i"
          class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0"
        >
          <span class="w-6 shrink-0 text-right text-xs text-slate-400 font-mono">{{ i + 1 }}</span>
          <span class="flex-1 min-w-0 font-mono text-sm text-slate-800 break-all">{{ item }}</span>
          <CopyButton :text="item" compact />
        </li>
      </ul>
    </section>
  </ToolPage>
</template>
