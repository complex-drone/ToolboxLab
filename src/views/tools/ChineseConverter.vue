<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 繁简体转换：基于 opencc-js（懒加载）的简繁实时互转
 * - 简→繁可选台湾正体（twp，含词汇转换）/ 香港繁体（hk）/ 开放繁体（t）
 * - 大文本输入防抖 300ms 后实时转换；方向或变体变化时重建 converter
 */

const DEBOUNCE_MS = 300
const VARIANTS = ['twp', 'hk', 't']

const { t } = useI18n()
const toast = useToast()

/** 方向与繁体变体持久化 */
const config = useStorage('tool-chinese-converter-config', {
  direction: 's2t',
  variant: 'twp',
})
const direction = ref(config.value.direction === 't2s' ? 't2s' : 's2t')
const variant = ref(VARIANTS.includes(config.value.variant) ? config.value.variant : 'twp')

const input = ref('')
const output = ref('')
const busy = ref(false)
const libError = ref(false)

let openccModule = null
let converter = null
let converterKey = ''
let convertToken = 0

/** 惰性加载 opencc-js（兼容 default 导出与命名导出两种形态） */
async function getOpenCC() {
  if (!openccModule) {
    openccModule = await import('opencc-js')
  }
  return openccModule.default || openccModule
}

/** 当前方向的 Converter 配置 */
function converterOptions() {
  return direction.value === 's2t'
    ? { from: 'cn', to: variant.value }
    : { from: 't', to: 'cn' }
}

function currentKey() {
  return direction.value === 's2t' ? 'cn:' + variant.value : 't:cn'
}

/** 执行转换（converter 按方向 + 变体缓存，变化时重建） */
async function runConvert() {
  const token = ++convertToken
  libError.value = false
  const text = input.value
  if (!text) {
    output.value = ''
    busy.value = false
    return
  }
  busy.value = true
  try {
    const key = currentKey()
    if (!converter || key !== converterKey) {
      const OpenCC = await getOpenCC()
      const created = OpenCC.Converter(converterOptions())
      converter = created
      converterKey = key
    }
    const result = converter(text)
    if (token !== convertToken) return
    output.value = result
  } catch {
    if (token !== convertToken) return
    converter = null
    converterKey = ''
    output.value = ''
    libError.value = true
    toast.error(t('tools.chineseConverter.errLibrary'))
  } finally {
    if (token === convertToken) busy.value = false
  }
}

/** 大文本输入防抖 300ms 实时转换 */
watchDebounced(input, () => {
  runConvert()
}, { debounce: DEBOUNCE_MS })

watch(direction, value => {
  config.value.direction = value
  runConvert()
})

watch(variant, value => {
  config.value.variant = value
  runConvert()
})

/** 交换：输出回填到输入，并切换转换方向 */
function swapDirection() {
  const previousOutput = output.value
  if (previousOutput) {
    input.value = previousOutput
  }
  direction.value = direction.value === 's2t' ? 't2s' : 's2t'
}

function clearInput() {
  input.value = ''
  output.value = ''
}
</script>

<template>
  <ToolPage tool-id="chineseConverter">
    <!-- 方向与变体 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div
        class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        role="tablist"
        :aria-label="t('tools.chineseConverter.directionLabel')"
      >
        <button
          type="button"
          role="tab"
          class="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            direction === 's2t'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="direction === 's2t'"
          @click="direction = 's2t'"
        >
          {{ t('tools.chineseConverter.dirS2t') }}
        </button>
        <button
          type="button"
          role="tab"
          class="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            direction === 't2s'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="direction === 't2s'"
          @click="direction = 't2s'"
        >
          {{ t('tools.chineseConverter.dirT2s') }}
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-end gap-3">
        <div v-if="direction === 's2t'" class="w-full sm:w-64">
          <label class="label-base" for="chinese-variant-select">{{ t('tools.chineseConverter.variantLabel') }}</label>
          <select id="chinese-variant-select" v-model="variant" class="input-base">
            <option value="twp">{{ t('tools.chineseConverter.variantTwp') }}</option>
            <option value="hk">{{ t('tools.chineseConverter.variantHk') }}</option>
            <option value="t">{{ t('tools.chineseConverter.variantT') }}</option>
          </select>
        </div>
        <button
          type="button"
          class="btn-ghost shrink-0 flex items-center gap-1.5"
          :title="t('tools.chineseConverter.swapTitle')"
          @click="swapDirection"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {{ t('toolsCommon.swap') }}
        </button>
        <button type="button" class="btn-ghost shrink-0" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <p class="label-base mb-0">{{ t('toolsCommon.input') }}</p>
        <span class="chip">{{ t('tools.chineseConverter.charCount', { n: input.length }) }}</span>
      </div>
      <textarea
        v-model="input"
        rows="7"
        class="input-base w-full resize-y leading-relaxed"
        :placeholder="t('tools.chineseConverter.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
    </section>

    <!-- 输出区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <div class="flex items-center gap-2">
          <p class="label-base mb-0">{{ t('toolsCommon.output') }}</p>
          <span
            v-if="busy"
            class="inline-block w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
            aria-hidden="true"
          ></span>
        </div>
        <span class="chip">{{ t('tools.chineseConverter.charCount', { n: output.length }) }}</span>
      </div>
      <p v-if="libError" class="mb-2 text-sm text-red-600">{{ t('tools.chineseConverter.errLibrary') }}</p>
      <textarea
        readonly
        :value="output"
        rows="7"
        class="input-base w-full resize-y leading-relaxed bg-slate-50/60"
        :placeholder="t('tools.chineseConverter.outputHint')"
        aria-readonly="true"
      ></textarea>
      <div class="mt-3 flex justify-end">
        <CopyButton :text="output" :label="t('toolsCommon.copyAll')" :disabled="!output" />
      </div>
    </section>

    <!-- 转换说明 -->
    <div
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5"
      role="note"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-blue-500"
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.chineseConverter.note') }}</p>
    </div>
  </ToolPage>
</template>
