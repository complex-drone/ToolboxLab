<script setup>
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { refDebounced, useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { convertToRmbUppercase, UPPER_DIGITS } from '@/utils/rmb'

/**
 * 人民币大写转换：金额即时（防抖 200ms）转换为标准中文大写
 * 核心转换为纯函数（src/utils/rmb.js），此处仅处理状态与展示
 */

const STORAGE_KEY = 'tool-rmb-uppercase-amount'

/** 快捷示例 */
const EXAMPLES = ['0.5', '10', '1234.56', '1000000.08']

const { t, locale } = useI18n()

/** 金额非敏感，输入持久化 */
const amountInput = useStorage(STORAGE_KEY, '')

/** 输入即时转换：200ms 防抖 */
const debouncedInput = refDebounced(amountInput, 200)

const outcome = computed(() => {
  try {
    return convertToRmbUppercase(debouncedInput.value)
  } catch {
    return { ok: false, text: '', error: 'invalid', truncated: false }
  }
})

const errorText = computed(() => {
  if (outcome.value.ok || outcome.value.error === 'empty') return ''
  return t(`tools.rmbUppercase.errors.${outcome.value.error}`)
})

const prettyAmount = computed(() => {
  const text = debouncedInput.value.trim()
  if (!outcome.value.ok) return ''
  const num = Number(text)
  if (!Number.isFinite(num)) return ''
  return num.toLocaleString(locale.value, { maximumFractionDigits: 2 })
})

function clearAll() {
  amountInput.value = ''
}

function fillExample(value) {
  amountInput.value = value
}

/** 输入长度保护：超长数字串直接截断，避免极端输入 */
watch(amountInput, value => {
  if (typeof value === 'string' && value.length > 20) {
    amountInput.value = value.slice(0, 20)
  }
})
</script>

<template>
  <ToolPage tool-id="rmbUppercase">
    <!-- 金额输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="rmb-amount">{{ t('tools.rmbUppercase.amountLabel') }}</label>
      <input
        id="rmb-amount"
        v-model="amountInput"
        type="text"
        inputmode="decimal"
        class="input-base font-mono text-lg"
        :placeholder="t('tools.rmbUppercase.amountPlaceholder')"
        autocomplete="off"
      />
      <p v-if="errorText" class="mt-1.5 text-xs text-red-600">{{ errorText }}</p>
      <p v-else-if="outcome.truncated" class="mt-1.5 text-xs text-amber-600">
        {{ t('tools.rmbUppercase.truncatedHint') }}
      </p>
      <div class="mt-3 flex items-center gap-2 flex-wrap">
        <span class="text-xs text-slate-400">{{ t('tools.rmbUppercase.examples') }}</span>
        <button
          v-for="example in EXAMPLES"
          :key="example"
          type="button"
          class="btn-ghost !px-2.5 !py-1 !text-xs font-mono"
          @click="fillExample(example)"
        >
          {{ example }}
        </button>
      </div>
    </section>

    <!-- 大写结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.result') }}</h2>
      <div class="rounded-xl border border-slate-100 bg-white/70 px-4 py-6 text-center min-h-[96px] flex flex-col justify-center">
        <template v-if="outcome.ok">
          <p class="text-xs text-slate-400 font-mono mb-2">{{ prettyAmount }}</p>
          <p class="text-2xl sm:text-3xl font-bold text-slate-800 break-all leading-relaxed tracking-wide">
            {{ outcome.text }}
          </p>
        </template>
        <p v-else class="text-sm text-slate-400">{{ t('tools.rmbUppercase.resultPlaceholder') }}</p>
      </div>
      <div class="mt-4 flex items-center gap-2 flex-wrap">
        <CopyButton :text="outcome.ok ? outcome.text : ''" :label="t('toolsCommon.copy')" :disabled="!outcome.ok" />
        <button type="button" class="btn-danger" :disabled="!amountInput" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 大写数字表与规则说明 -->
    <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100" role="note">
      <div class="flex items-start gap-2.5">
        <svg class="w-5 h-5 shrink-0 mt-0.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div class="text-sm text-blue-700 leading-relaxed space-y-1.5">
          <p>
            <span class="font-semibold">{{ t('tools.rmbUppercase.digitTable') }}</span>
            <span class="font-mono">{{ UPPER_DIGITS.join(' ') }}</span>
          </p>
          <p>
            <span class="font-semibold">{{ t('tools.rmbUppercase.unitTable') }}</span>
            <span class="font-mono">{{ ['拾', '佰', '仟', '万', '亿', '元', '角', '分', '整'].join(' ') }}</span>
          </p>
          <p>{{ t('tools.rmbUppercase.note') }}</p>
        </div>
      </div>
    </div>
  </ToolPage>
</template>
