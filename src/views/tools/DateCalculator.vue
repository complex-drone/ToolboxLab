<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { clampInt } from '@/utils/number'

const { t, locale } = useI18n()
const toast = useToast()

/**
 * 持久化配置：日期加减的数量与单位、排除周末开关
 * 注意：useStorage 返回 ref，script 中必须用 config.value.xxx 访问
 */
const config = useStorage(
  'tool-date-calculator-config',
  { amount: 1, unit: 'month', excludeWeekend: false },
  undefined,
  { mergeDefaults: true }
)

const UNIT_KEYS = { day: 'unitDay', week: 'unitWeek', month: 'unitMonth', year: 'unitYear' }
const UNITS = Object.keys(UNIT_KEYS)
const DAY_MS = 86400000

/* ---------------- 本地时区日期工具 ----------------
 * new Date('YYYY-MM-DD') 按 UTC 解析，存在时区陷阱；
 * 这里统一手工拆解为 new Date(y, m-1, d) 的本地时区零点。
 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function todayStr() {
  return toDateStr(new Date())
}

/** 'YYYY-MM-DD' → 本地时区零点 Date；非法或不存在（如 2 月 30 日）返回 null */
function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12) return null
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

function daysInMonth(y, moIdx) {
  return new Date(y, moIdx + 1, 0).getDate()
}

/** 月份加减：月末溢出按目标月最后一天钳制（如 1/31 + 1 月 = 2/28 或 2/29） */
function addMonths(date, n) {
  const total = date.getFullYear() * 12 + date.getMonth() + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  return new Date(ny, nm, Math.min(date.getDate(), daysInMonth(ny, nm)))
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

/** a 与 b 之间的完整月数（周年纪念日口径，与月末钳制规则一致） */
function fullMonthsBetween(a, b) {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  while (m > 0 && addMonths(a, m).getTime() > b.getTime()) m--
  return Math.max(0, m)
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/** (a, b] 区间内周一至周五的天数（a ≤ b），闭式计算避免大跨度逐日循环 */
function weekdayCountBetween(a, b) {
  const days = dayDiff(a, b)
  if (days <= 0) return 0
  const fullWeeks = Math.floor(days / 7)
  let count = fullWeeks * 5
  const dow = a.getDay()
  const rem = days - fullWeeks * 7
  for (let i = 1; i <= rem; i++) {
    const w = (dow + i) % 7
    if (w >= 1 && w <= 5) count++
  }
  return count
}

function formatWeekday(date, mode = 'long') {
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: mode }).format(date)
  } catch {
    return ''
  }
}

function copyLine(label, value) {
  return t('tools.dateCalculator.copyLine', { label, value })
}

/* ---------------- 日期差计算 ---------------- */
const startDate = ref(todayStr())
const endDate = ref(todayStr())

const diffState = computed(() => {
  if (!startDate.value && !endDate.value) return { status: 'empty' }
  if (!startDate.value || !endDate.value) return { status: 'partial' }
  const a0 = parseDateStr(startDate.value)
  const b0 = parseDateStr(endDate.value)
  if (!a0 || !b0) return { status: 'invalid' }
  let a = a0
  let b = b0
  let swapped = false
  if (a.getTime() > b.getTime()) {
    const tmp = a
    a = b
    b = tmp
    swapped = true
  }
  const totalDays = dayDiff(a, b)
  const weekdays = weekdayCountBetween(a, b)
  const totalMonths = fullMonthsBetween(a, b)
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths - years * 12
  const days = dayDiff(addMonths(a, totalMonths), b)
  return {
    status: 'ok',
    swapped,
    a,
    b,
    totalDays,
    weeks: Math.floor(totalDays / 7),
    weekRemDays: totalDays % 7,
    weekdays,
    weekendDays: totalDays - weekdays,
    totalMonths,
    years,
    months,
    days,
  }
})

/** 主结果：开启「排除周末」时显示周一至周五的天数 */
const mainDays = computed(() => {
  const s = diffState.value
  if (s.status !== 'ok') return 0
  return config.value.excludeWeekend ? s.weekdays : s.totalDays
})

const mainDaysLabel = computed(() =>
  config.value.excludeWeekend
    ? t('tools.dateCalculator.withoutWeekend')
    : t('tools.dateCalculator.totalDays')
)

function swapDates() {
  const tmp = startDate.value
  startDate.value = endDate.value
  endDate.value = tmp
}

const diffCopyText = computed(() => {
  const s = diffState.value
  if (s.status !== 'ok') return ''
  const lines = [
    copyLine(t('tools.dateCalculator.startDate'), `${toDateStr(s.a)} ${formatWeekday(s.a)}`),
    copyLine(t('tools.dateCalculator.endDate'), `${toDateStr(s.b)} ${formatWeekday(s.b)}`),
    copyLine(
      t('tools.dateCalculator.totalDays'),
      t('tools.dateCalculator.daysValue', { n: s.totalDays })
    ),
    copyLine(
      t('tools.dateCalculator.weeksDays'),
      t('tools.dateCalculator.weeksDaysValue', { w: s.weeks, d: s.weekRemDays })
    ),
    copyLine(
      t('tools.dateCalculator.totalMonths'),
      t('tools.dateCalculator.totalMonthsValue', { n: s.totalMonths })
    ),
    copyLine(
      t('tools.dateCalculator.breakdown'),
      t('tools.dateCalculator.breakdownValue', { y: s.years, m: s.months, d: s.days })
    ),
    copyLine(
      t('tools.dateCalculator.withWeekend'),
      t('tools.dateCalculator.daysValue', { n: s.totalDays })
    ),
    copyLine(
      t('tools.dateCalculator.withoutWeekend'),
      t('tools.dateCalculator.daysValue', { n: s.weekdays })
    ),
  ]
  return lines.join('\n')
})

/* ---------------- 日期加减（± N 天/周/月/年） ---------------- */
const addBase = ref(todayStr())

const addResult = computed(() => {
  const base = parseDateStr(addBase.value)
  if (!base) return null
  const unit = UNITS.includes(config.value.unit) ? config.value.unit : 'month'
  const n = clampInt(config.value.amount, -99999, 99999, 0)
  let result
  if (unit === 'day') result = addDays(base, n)
  else if (unit === 'week') result = addDays(base, n * 7)
  else if (unit === 'month') result = addMonths(base, n)
  else result = addMonths(base, n * 12)
  return { base, unit, n, result }
})

const addExprText = computed(() => {
  const r = addResult.value
  if (!r) return ''
  const unitLabel = t(`tools.dateCalculator.${UNIT_KEYS[r.unit]}`)
  const op = r.n >= 0 ? '+' : '-'
  return `${toDateStr(r.base)} ${op} ${Math.abs(r.n)} ${unitLabel}`
})

function useAsStart() {
  const r = addResult.value
  if (!r) return
  startDate.value = toDateStr(r.result)
  toast.success(t('toolsCommon.done'))
}

function useAsEnd() {
  const r = addResult.value
  if (!r) return
  endDate.value = toDateStr(r.result)
  toast.success(t('toolsCommon.done'))
}

/* ---------------- 样式辅助 ---------------- */
function chipClass(active) {
  return active
    ? 'chip chip-toggle cursor-pointer select-none'
    : 'chip-toggle inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/70 text-slate-500 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer select-none'
}

function tileClass(active) {
  return active
    ? 'rounded-xl border border-blue-200 bg-blue-50/70 p-3'
    : 'rounded-xl border border-slate-100 bg-white/70 p-3'
}
</script>

<template>
  <ToolPage tool-id="dateCalculator">
    <!-- 区块一：日期差计算 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">
          {{ t('tools.dateCalculator.diffSection') }}
        </h2>
        <button type="button" class="btn-ghost" @click="swapDates">
          {{ t('toolsCommon.swap') }}
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="label-base" for="dc-start">
            {{ t('tools.dateCalculator.startDate') }}
          </label>
          <input
            id="dc-start"
            v-model="startDate"
            type="date"
            class="input-base font-mono"
            :aria-label="t('tools.dateCalculator.startDate')"
          />
        </div>
        <div>
          <label class="label-base" for="dc-end">
            {{ t('tools.dateCalculator.endDate') }}
          </label>
          <input
            id="dc-end"
            v-model="endDate"
            type="date"
            class="input-base font-mono"
            :aria-label="t('tools.dateCalculator.endDate')"
          />
        </div>
      </div>
      <p v-if="diffState.status === 'invalid'" class="text-red-600 text-sm mt-2">
        {{ t('tools.dateCalculator.invalidDate') }}
      </p>

      <!-- 排除周末开关 -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-600">
          {{ t('tools.dateCalculator.excludeWeekend') }}
        </span>
        <button
          type="button"
          :class="chipClass(config.excludeWeekend)"
          :aria-pressed="config.excludeWeekend"
          @click="config.excludeWeekend = !config.excludeWeekend"
        >
          {{ config.excludeWeekend ? t('toolsCommon.yes') : t('toolsCommon.no') }}
        </button>
        <span class="text-xs text-slate-400">
          {{ t('tools.dateCalculator.excludeWeekendHint') }}
        </span>
      </div>

      <!-- 差值结果 -->
      <div v-if="diffState.status === 'ok'" class="mt-4">
        <p v-if="diffState.swapped" class="text-xs text-amber-600 mb-2">
          {{ t('tools.dateCalculator.autoSwapped') }}
        </p>
        <div class="flex items-center justify-between gap-2 mb-3">
          <div>
            <p class="label-base mb-0.5">{{ mainDaysLabel }}</p>
            <p class="font-mono text-3xl font-semibold text-blue-600 tabular-nums">
              {{ mainDays }}
            </p>
          </div>
          <CopyButton
            :text="diffCopyText"
            :label="t('tools.dateCalculator.copyResult')"
          />
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div :class="tileClass(!config.excludeWeekend)">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.dateCalculator.withWeekend') }}
            </p>
            <p class="font-mono text-lg text-slate-700 tabular-nums">
              {{ diffState.totalDays }}
            </p>
          </div>
          <div :class="tileClass(config.excludeWeekend)">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.dateCalculator.withoutWeekend') }}
            </p>
            <p class="font-mono text-lg text-slate-700 tabular-nums">
              {{ diffState.weekdays }}
            </p>
          </div>
          <div :class="tileClass(false)">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.dateCalculator.weeksDays') }}
            </p>
            <p class="text-sm text-slate-700 tabular-nums">
              {{
                t('tools.dateCalculator.weeksDaysValue', {
                  w: diffState.weeks,
                  d: diffState.weekRemDays,
                })
              }}
            </p>
          </div>
          <div :class="tileClass(false)">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.dateCalculator.totalMonths') }}
            </p>
            <p class="text-sm text-slate-700 tabular-nums">
              {{
                t('tools.dateCalculator.totalMonthsValue', { n: diffState.totalMonths })
              }}
            </p>
          </div>
          <div class="col-span-2 sm:col-span-1" :class="tileClass(false)">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.dateCalculator.breakdown') }}
            </p>
            <p class="text-sm text-slate-700 tabular-nums">
              {{
                t('tools.dateCalculator.breakdownValue', {
                  y: diffState.years,
                  m: diffState.months,
                  d: diffState.days,
                })
              }}
            </p>
          </div>
        </div>
      </div>
      <p
        v-else-if="diffState.status === 'empty' || diffState.status === 'partial'"
        class="text-sm text-slate-400 mt-4"
      >
        {{ t('tools.dateCalculator.needBoth') }}
      </p>
    </div>

    <!-- 区块二：日期加减 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.dateCalculator.addSection') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="label-base" for="dc-base">
            {{ t('tools.dateCalculator.baseDate') }}
          </label>
          <input
            id="dc-base"
            v-model="addBase"
            type="date"
            class="input-base font-mono"
            :aria-label="t('tools.dateCalculator.baseDate')"
          />
        </div>
        <div>
          <label class="label-base" for="dc-amount">
            {{ t('tools.dateCalculator.amount') }}
          </label>
          <input
            id="dc-amount"
            v-model.number="config.amount"
            type="number"
            step="1"
            min="-99999"
            max="99999"
            class="input-base font-mono"
            :placeholder="t('tools.dateCalculator.amountPlaceholder')"
            :aria-label="t('tools.dateCalculator.amount')"
          />
        </div>
        <div>
          <label class="label-base" for="dc-unit">
            {{ t('tools.dateCalculator.unit') }}
          </label>
          <select
            id="dc-unit"
            v-model="config.unit"
            class="input-base"
            :aria-label="t('tools.dateCalculator.unit')"
          >
            <option value="day">{{ t('tools.dateCalculator.unitDay') }}</option>
            <option value="week">{{ t('tools.dateCalculator.unitWeek') }}</option>
            <option value="month">{{ t('tools.dateCalculator.unitMonth') }}</option>
            <option value="year">{{ t('tools.dateCalculator.unitYear') }}</option>
          </select>
        </div>
      </div>

      <div
        v-if="addResult"
        class="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <p class="text-xs text-slate-500 font-mono break-all">
            {{ t('tools.dateCalculator.expressionLabel') }}：{{ addExprText }}
          </p>
          <p class="font-mono text-2xl font-semibold text-blue-600 tabular-nums mt-1">
            {{ toDateStr(addResult.result) }}
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            {{ formatWeekday(addResult.result) }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-ghost" @click="useAsStart">
            {{ t('tools.dateCalculator.useAsStart') }}
          </button>
          <button type="button" class="btn-ghost" @click="useAsEnd">
            {{ t('tools.dateCalculator.useAsEnd') }}
          </button>
          <CopyButton
            :text="toDateStr(addResult.result)"
            :label="t('tools.dateCalculator.copyResult')"
          />
        </div>
      </div>
      <p v-else class="text-sm text-slate-400 mt-4">
        {{ t('tools.dateCalculator.pickBase') }}
      </p>
    </div>
  </ToolPage>
</template>
