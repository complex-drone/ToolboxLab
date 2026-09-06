<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * EVM 挣值管理计算器：
 * 输入 BAC / AC / PV / EV 四个基础值，自动计算 SV、CV、SPI、CPI、EAC、ETC、VAC、TCPI，
 * 除零保护、三档健康状态灯、公式与含义说明、示例数据一键填入，输入本地持久化
 */

const STORAGE_KEY = 'tool-evm-calculator-inputs'

/** 示例数据（SPI ≈ 0.95，黄色预警，便于展示三档状态） */
const EXAMPLE = { bac: '100000', ac: '52000', pv: '60000', ev: '57000' }

/** 指标定义：公式为纯 JS 常量（语言包字符串中不能出现特殊符号），denom 表示该指标依赖的分母 */
const METRICS = [
  { key: 'sv', formula: 'SV = EV - PV' },
  { key: 'cv', formula: 'CV = EV - AC' },
  { key: 'spi', formula: 'SPI = EV / PV' },
  { key: 'cpi', formula: 'CPI = EV / AC' },
  { key: 'eac', formula: 'EAC = BAC / CPI' },
  { key: 'etc', formula: 'ETC = EAC - AC' },
  { key: 'vac', formula: 'VAC = BAC - EAC' },
  { key: 'tcpi', formula: 'TCPI = (BAC - EV) / (BAC - AC)' },
]

const FIELD_KEYS = ['bac', 'ac', 'pv', 'ev']

const { t, locale } = useI18n()
const toast = useToast()

/** 输入持久化 */
const inputs = useStorage(STORAGE_KEY, { bac: '', ac: '', pv: '', ev: '' })

/** 非负数字（整数或最多两位小数）校验 */
function parseField(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN
  const num = Number(text)
  return Number.isFinite(num) ? num : NaN
}

const parsed = computed(() => ({
  bac: parseField(inputs.value.bac),
  ac: parseField(inputs.value.ac),
  pv: parseField(inputs.value.pv),
  ev: parseField(inputs.value.ev),
}))

const fieldInvalid = computed(() => {
  const result = {}
  for (const key of FIELD_KEYS) {
    const raw = String(inputs.value[key] ?? '').trim()
    result[key] = raw !== '' && !Number.isFinite(parsed.value[key])
  }
  return result
})

const allValid = computed(() => FIELD_KEYS.every(key => Number.isFinite(parsed.value[key])))

/** 指标计算：分母为 0 时该指标记为 null（展示为「—」） */
const results = computed(() => {
  if (!allValid.value) return null
  const { bac, ac, pv, ev } = parsed.value
  const spi = pv === 0 ? null : ev / pv
  const cpi = ac === 0 ? null : ev / ac
  const eac = cpi === null ? null : bac / cpi
  const etc = eac === null ? null : eac - ac
  const vac = eac === null ? null : bac - eac
  const tcpiDenom = bac - ac
  const tcpi = tcpiDenom === 0 ? null : (bac - ev) / tcpiDenom
  return { sv: ev - pv, cv: ev - ac, spi, cpi, eac, etc, vac, tcpi }
})

/** 结果统一保留两位小数 */
function fmt(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString(locale.value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** 三档健康状态：good（绿）/ warn（黄）/ bad（红）/ idle（待输入） */
const health = computed(() => {
  const r = results.value
  if (!r) return 'idle'
  const indexes = [r.spi, r.cpi].filter(v => v !== null)
  if (!indexes.length) return 'idle'
  const worst = Math.min(...indexes)
  if (worst >= 1) return 'good'
  if (worst >= 0.9) return 'warn'
  return 'bad'
})

const HEALTH_STYLE = {
  good: { dot: 'bg-emerald-500', ring: 'bg-emerald-400/40', text: 'text-emerald-600' },
  warn: { dot: 'bg-amber-500', ring: 'bg-amber-400/40', text: 'text-amber-600' },
  bad: { dot: 'bg-red-500', ring: 'bg-red-400/40', text: 'text-red-600' },
  idle: { dot: 'bg-slate-300', ring: 'bg-slate-200/60', text: 'text-slate-400' },
}

/** 指标数值着色：偏差类按正负，指数类按阈值，估算类不着色 */
function valueClass(key, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-slate-400'
  if (key === 'sv' || key === 'cv' || key === 'vac') {
    if (value > 0) return 'text-emerald-600'
    if (value < 0) return 'text-red-600'
    return 'text-slate-700'
  }
  if (key === 'spi' || key === 'cpi') {
    if (value >= 1) return 'text-emerald-600'
    if (value >= 0.9) return 'text-amber-600'
    return 'text-red-600'
  }
  return 'text-slate-700'
}

function fillExample() {
  inputs.value = { ...EXAMPLE }
  toast.info(t('tools.evmCalculator.exampleFilled'))
}

function clearAll() {
  inputs.value = { bac: '', ac: '', pv: '', ev: '' }
}
</script>

<template>
  <ToolPage tool-id="evmCalculator">
    <!-- 基础输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.evmCalculator.inputsTitle') }}</h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div v-for="key in FIELD_KEYS" :key="key">
          <label class="label-base" :for="'evm-' + key">
            {{ t(`tools.evmCalculator.fields.${key}.label`) }}
          </label>
          <input
            :id="'evm-' + key"
            v-model="inputs[key]"
            type="text"
            inputmode="decimal"
            class="input-base font-mono"
            :placeholder="t(`tools.evmCalculator.fields.${key}.placeholder`)"
            autocomplete="off"
          />
          <p v-if="fieldInvalid[key]" class="mt-1.5 text-xs text-red-600">
            {{ t('tools.evmCalculator.errNonNegative') }}
          </p>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2 flex-wrap">
        <button type="button" class="btn-ghost" @click="fillExample">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          {{ t('tools.evmCalculator.fillExample') }}
        </button>
        <button type="button" class="btn-danger" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 健康状态灯 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.evmCalculator.statusTitle') }}</h2>
      <div class="flex items-center gap-4">
        <span class="relative flex shrink-0 w-8 h-8 items-center justify-center">
          <span class="absolute inline-flex w-8 h-8 rounded-full opacity-60" :class="HEALTH_STYLE[health].ring"></span>
          <span class="relative inline-flex w-5 h-5 rounded-full" :class="HEALTH_STYLE[health].dot"></span>
        </span>
        <div class="min-w-0">
          <p class="text-base font-bold" :class="HEALTH_STYLE[health].text">
            {{ t(`tools.evmCalculator.status.${health}`) }}
          </p>
          <p class="text-sm text-slate-500 leading-relaxed">
            {{ t(`tools.evmCalculator.advice.${health}`) }}
          </p>
        </div>
      </div>
    </section>

    <!-- 指标结果 -->
    <section v-if="results" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.evmCalculator.metricsTitle') }}</h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          v-for="metric in METRICS"
          :key="metric.key"
          class="rounded-xl border border-slate-100 bg-white/70 p-3"
          :title="t(`tools.evmCalculator.metrics.${metric.key}.meaning`)"
        >
          <div class="flex items-center gap-1 mb-1">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {{ t(`tools.evmCalculator.metrics.${metric.key}.name`) }}
            </span>
            <svg class="w-3 h-3 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <p class="text-xl font-bold font-mono truncate" :class="valueClass(metric.key, results[metric.key])">
            {{ fmt(results[metric.key]) }}
          </p>
          <p class="mt-1 text-[11px] font-mono text-slate-400 break-all">{{ metric.formula }}</p>
          <p class="mt-0.5 text-[11px] text-slate-400 leading-snug">
            {{ t(`tools.evmCalculator.metrics.${metric.key}.meaning`) }}
          </p>
          <p v-if="results[metric.key] === null" class="mt-1 text-[11px] text-amber-600 leading-snug">
            {{ t('tools.evmCalculator.divZeroHint') }}
          </p>
        </div>
      </div>
    </section>

    <!-- 说明 -->
    <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5" role="note">
      <svg class="w-5 h-5 shrink-0 mt-0.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.evmCalculator.note') }}</p>
    </div>
  </ToolPage>
</template>
