<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

const { t, locale } = useI18n()
const toast = useToast()

/**
 * 持久化配置：节假日列表与调休工作日列表（'YYYY-MM-DD' 字符串数组）
 * 注意：useStorage 返回 ref，script 中必须用 config.value.xxx 访问
 */
const config = useStorage(
  'tool-workday-calculator-config',
  { holidays: [], makeups: [] },
  undefined,
  { mergeDefaults: true }
)

const DAY_MS = 86400000
/** 性能保护：区间跨度上限（约 10 年，逐日迭代 < 4000 次） */
const MAX_SPAN_DAYS = 3700

/* ---------------- 本地时区日期工具（手工解析，避免 UTC 口径） ---------------- */
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

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

function formatWeekday(date, mode = 'short') {
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: mode }).format(date)
  } catch {
    return ''
  }
}

function weekdayOfKey(key) {
  const d = parseDateStr(key)
  return d ? formatWeekday(d) : ''
}

function copyLine(label, value) {
  return t('tools.workdayCalculator.copyLine', { label, value })
}

/* ---------------- 日期区间 ---------------- */
const startDate = ref(`${new Date().getFullYear()}-01-01`)
const endDate = ref(todayStr())

const rangeState = computed(() => {
  if (!startDate.value && !endDate.value) return { status: 'empty' }
  if (!startDate.value || !endDate.value) return { status: 'partial' }
  const a = parseDateStr(startDate.value)
  const b = parseDateStr(endDate.value)
  if (!a || !b) return { status: 'invalid' }
  if (a.getTime() > b.getTime()) return { status: 'reversed' }
  const total = dayDiff(a, b) + 1
  if (total > MAX_SPAN_DAYS) return { status: 'tooLarge' }
  return { status: 'ok', a, b }
})

const rangeErrorKey = computed(() => {
  const s = rangeState.value
  if (s.status === 'invalid') return 'invalidDate'
  if (s.status === 'reversed') return 'startAfterEnd'
  if (s.status === 'tooLarge') return 'spanTooLarge'
  return ''
})

/* ---------------- 节假日 / 调休列表（去重排序后使用） ---------------- */
const holidayInput = ref('')
const makeupInput = ref('')
const holidayError = ref('')
const makeupError = ref('')

const sortedHolidays = computed(() =>
  [...config.value.holidays].filter((x) => typeof x === 'string' && parseDateStr(x)).sort()
)
const sortedMakeups = computed(() =>
  [...config.value.makeups].filter((x) => typeof x === 'string' && parseDateStr(x)).sort()
)

function listRefOf(kind) {
  return kind === 'holiday' ? sortedHolidays : sortedMakeups
}

function addToList(kind) {
  const raw = kind === 'holiday' ? holidayInput : makeupInput
  const err = kind === 'holiday' ? holidayError : makeupError
  err.value = ''
  const d = parseDateStr(raw.value)
  if (!d) {
    err.value = t('tools.workdayCalculator.invalidDate')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  const key = toDateStr(d)
  if (listRefOf(kind).value.includes(key)) {
    err.value = t('tools.workdayCalculator.duplicateDate')
    toast.error(t('tools.workdayCalculator.duplicateDate'))
    return
  }
  const list = kind === 'holiday' ? config.value.holidays : config.value.makeups
  list.push(key)
  raw.value = ''
  toast.success(t('toolsCommon.done'))
}

function removeFromList(kind, key) {
  const list = kind === 'holiday' ? config.value.holidays : config.value.makeups
  const idx = list.indexOf(key)
  if (idx !== -1) list.splice(idx, 1)
}

function clearList(kind) {
  if (kind === 'holiday') config.value.holidays = []
  else config.value.makeups = []
  toast.success(t('toolsCommon.done'))
}

/* ---------------- JSON 导入 / 导出 ---------------- */
const importTarget = ref('holiday')
const importText = ref('')
const importError = ref('')

const exportJsonText = computed(() =>
  JSON.stringify(listRefOf(importTarget.value).value, null, 2)
)

function downloadJson() {
  try {
    const filename =
      importTarget.value === 'holiday' ? 'workday-holidays.json' : 'workday-makeups.json'
    downloadText(exportJsonText.value, filename, 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function doImport() {
  importError.value = ''
  let arr = null
  try {
    arr = JSON.parse(importText.value)
  } catch {
    arr = null
  }
  if (!Array.isArray(arr)) {
    importError.value = t('tools.workdayCalculator.importInvalid')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  const list = importTarget.value === 'holiday' ? config.value.holidays : config.value.makeups
  const seen = new Set(listRefOf(importTarget.value).value)
  const added = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const d = parseDateStr(item)
    if (!d) continue
    const key = toDateStr(d)
    if (seen.has(key)) continue
    seen.add(key)
    added.push(key)
  }
  if (added.length === 0) {
    importError.value = t('tools.workdayCalculator.importInvalid')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  list.push(...added)
  importText.value = ''
  toast.success(t('tools.workdayCalculator.importSuccess', { n: added.length }))
}

/* ---------------- 统计（逐日迭代，区间已限制在约 10 年内） ---------------- */
const stats = computed(() => {
  const r = rangeState.value
  if (r.status !== 'ok') return null
  const holidaySet = new Set(sortedHolidays.value)
  const makeupSet = new Set(sortedMakeups.value)
  let total = 0
  let work = 0
  let weekend = 0
  let holiday = 0
  const monthMap = new Map()
  const holidaysHit = []
  const makeupsHit = []
  const cur = new Date(r.a.getTime())
  while (cur.getTime() <= r.b.getTime()) {
    total++
    const key = toDateStr(cur)
    const dow = cur.getDay()
    const isWeekend = dow === 0 || dow === 6
    const isHoliday = holidaySet.has(key)
    const isMakeup = makeupSet.has(key)
    // 调休日（周末上班）计入工作日；节假日不计入工作日；节假日与周末重叠不重复计数
    const isWork = isMakeup || (!isWeekend && !isHoliday)
    if (isWeekend) weekend++
    if (isHoliday) holiday++
    if (isWork) work++
    const mk = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}`
    const bucket = monthMap.get(mk) || { month: mk, total: 0, weekend: 0, holiday: 0, work: 0 }
    bucket.total++
    if (isWeekend) bucket.weekend++
    if (isHoliday) bucket.holiday++
    if (isWork) bucket.work++
    monthMap.set(mk, bucket)
    if (isHoliday) holidaysHit.push(key)
    if (isMakeup) makeupsHit.push(key)
    cur.setDate(cur.getDate() + 1)
  }
  return {
    total,
    work,
    weekend,
    holiday,
    rest: total - work,
    months: Array.from(monthMap.values()),
    holidaysHit,
    makeupsHit,
  }
})

/* ---------------- 结果复制（多行明细） ---------------- */
const resultCopyText = computed(() => {
  const st = stats.value
  if (!st) return ''
  const sep = t('tools.workdayCalculator.enumSeparator')
  const lines = [
    copyLine(t('tools.workdayCalculator.startDate'), startDate.value),
    copyLine(t('tools.workdayCalculator.endDate'), endDate.value),
    copyLine(t('tools.workdayCalculator.totalDays'), String(st.total)),
    copyLine(t('tools.workdayCalculator.workdays'), String(st.work)),
    copyLine(t('tools.workdayCalculator.weekendDays'), String(st.weekend)),
    copyLine(t('tools.workdayCalculator.holidaysHit'), String(st.holiday)),
    copyLine(t('tools.workdayCalculator.restDays'), String(st.rest)),
    '',
    t('tools.workdayCalculator.monthlySection'),
  ]
  for (const m of st.months) {
    lines.push(
      t('tools.workdayCalculator.monthLine', {
        month: m.month,
        total: m.total,
        weekend: m.weekend,
        holiday: m.holiday,
        work: m.work,
      })
    )
  }
  if (st.holidaysHit.length > 0) {
    lines.push(copyLine(t('tools.workdayCalculator.hitHolidaysLabel'), st.holidaysHit.join(sep)))
  }
  if (st.makeupsHit.length > 0) {
    lines.push(copyLine(t('tools.workdayCalculator.hitMakeupsLabel'), st.makeupsHit.join(sep)))
  }
  return lines.join('\n')
})

/* ---------------- 样式辅助 ---------------- */
function chipClass(active) {
  return active
    ? 'chip chip-toggle cursor-pointer select-none'
    : 'chip-toggle inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/70 text-slate-500 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer select-none'
}
</script>

<template>
  <ToolPage tool-id="workdayCalculator">
    <!-- 区块一：日期区间 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.workdayCalculator.rangeSection') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="label-base" for="wc-start">
            {{ t('tools.workdayCalculator.startDate') }}
          </label>
          <input
            id="wc-start"
            v-model="startDate"
            type="date"
            class="input-base font-mono"
            :aria-label="t('tools.workdayCalculator.startDate')"
          />
        </div>
        <div>
          <label class="label-base" for="wc-end">
            {{ t('tools.workdayCalculator.endDate') }}
          </label>
          <input
            id="wc-end"
            v-model="endDate"
            type="date"
            class="input-base font-mono"
            :aria-label="t('tools.workdayCalculator.endDate')"
          />
        </div>
      </div>
      <p v-if="rangeErrorKey" class="text-red-600 text-sm mt-2">
        {{ t(`tools.workdayCalculator.${rangeErrorKey}`) }}
      </p>
      <p
        v-else-if="rangeState.status === 'empty' || rangeState.status === 'partial'"
        class="text-sm text-slate-400 mt-2"
      >
        {{ t('tools.workdayCalculator.needBoth') }}
      </p>
      <p class="text-xs text-slate-400 mt-2">
        {{ t('tools.workdayCalculator.rangeNote') }}
      </p>
    </div>

    <!-- 区块二：节假日与调休 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.workdayCalculator.listsSection') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- 节假日列表 -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <p class="text-sm font-medium text-slate-600">
              {{ t('tools.workdayCalculator.holidayList') }}
            </p>
            <span class="chip">
              {{ sortedHolidays.length }}
            </span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="holidayInput"
              type="date"
              class="input-base font-mono flex-1 min-w-0"
              :aria-label="t('tools.workdayCalculator.addHolidayPlaceholder')"
              :placeholder="t('tools.workdayCalculator.addHolidayPlaceholder')"
            />
            <button
              type="button"
              class="btn-primary shrink-0"
              @click="addToList('holiday')"
            >
              {{ t('tools.workdayCalculator.addBtn') }}
            </button>
          </div>
          <p v-if="holidayError" class="text-red-600 text-sm mt-1.5">
            {{ holidayError }}
          </p>
          <ul
            v-if="sortedHolidays.length > 0"
            class="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-100 bg-white/70 divide-y divide-slate-100"
          >
            <li
              v-for="key in sortedHolidays"
              :key="key"
              class="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <span class="font-mono text-sm text-slate-700">
                {{ key }}
                <span class="text-slate-400 text-xs ml-1">{{ weekdayOfKey(key) }}</span>
              </span>
              <button
                type="button"
                class="text-xs px-2 py-0.5 rounded-md text-red-500 hover:bg-red-50 transition shrink-0"
                :aria-label="t('tools.workdayCalculator.removeItem')"
                @click="removeFromList('holiday', key)"
              >
                {{ t('tools.workdayCalculator.removeIcon') }}
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-400 mt-2">
            {{ t('toolsCommon.none') }}
          </p>
          <button
            v-if="sortedHolidays.length > 0"
            type="button"
            class="btn-danger mt-2"
            @click="clearList('holiday')"
          >
            {{ t('tools.workdayCalculator.clearList') }}
          </button>
        </div>

        <!-- 调休工作日列表 -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <p class="text-sm font-medium text-slate-600">
              {{ t('tools.workdayCalculator.makeupList') }}
            </p>
            <span class="chip">
              {{ sortedMakeups.length }}
            </span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="makeupInput"
              type="date"
              class="input-base font-mono flex-1 min-w-0"
              :aria-label="t('tools.workdayCalculator.addMakeupPlaceholder')"
              :placeholder="t('tools.workdayCalculator.addMakeupPlaceholder')"
            />
            <button
              type="button"
              class="btn-primary shrink-0"
              @click="addToList('makeup')"
            >
              {{ t('tools.workdayCalculator.addBtn') }}
            </button>
          </div>
          <p v-if="makeupError" class="text-red-600 text-sm mt-1.5">
            {{ makeupError }}
          </p>
          <ul
            v-if="sortedMakeups.length > 0"
            class="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-100 bg-white/70 divide-y divide-slate-100"
          >
            <li
              v-for="key in sortedMakeups"
              :key="key"
              class="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <span class="font-mono text-sm text-slate-700">
                {{ key }}
                <span class="text-slate-400 text-xs ml-1">{{ weekdayOfKey(key) }}</span>
              </span>
              <button
                type="button"
                class="text-xs px-2 py-0.5 rounded-md text-red-500 hover:bg-red-50 transition shrink-0"
                :aria-label="t('tools.workdayCalculator.removeItem')"
                @click="removeFromList('makeup', key)"
              >
                {{ t('tools.workdayCalculator.removeIcon') }}
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-400 mt-2">
            {{ t('toolsCommon.none') }}
          </p>
          <button
            v-if="sortedMakeups.length > 0"
            type="button"
            class="btn-danger mt-2"
            @click="clearList('makeup')"
          >
            {{ t('tools.workdayCalculator.clearList') }}
          </button>
        </div>
      </div>

      <!-- JSON 导入 / 导出 -->
      <div class="mt-5 pt-4 border-t border-slate-100">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h3 class="text-sm font-medium text-slate-600">
            {{ t('tools.workdayCalculator.importExport') }}
          </h3>
          <button
            type="button"
            :class="chipClass(importTarget === 'holiday')"
            :aria-pressed="importTarget === 'holiday'"
            @click="importTarget = 'holiday'"
          >
            {{ t('tools.workdayCalculator.targetHoliday') }}
          </button>
          <button
            type="button"
            :class="chipClass(importTarget === 'makeup')"
            :aria-pressed="importTarget === 'makeup'"
            @click="importTarget = 'makeup'"
          >
            {{ t('tools.workdayCalculator.targetMakeup') }}
          </button>
        </div>
        <textarea
          v-model="importText"
          rows="3"
          class="input-base font-mono"
          :placeholder="t('tools.workdayCalculator.importPlaceholder')"
          :aria-label="t('tools.workdayCalculator.importBtn')"
        ></textarea>
        <p v-if="importError" class="text-red-600 text-sm mt-1.5">
          {{ importError }}
        </p>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <button type="button" class="btn-primary" @click="doImport">
            {{ t('tools.workdayCalculator.importBtn') }}
          </button>
          <CopyButton
            :text="exportJsonText"
            :label="t('tools.workdayCalculator.exportJson')"
            :disabled="exportJsonText === '[]'"
          />
          <button type="button" class="btn-ghost" @click="downloadJson">
            {{ t('toolsCommon.download') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 区块三：统计结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.workdayCalculator.resultSection') }}</h2>
        <CopyButton
          v-if="stats"
          :text="resultCopyText"
          :label="t('tools.workdayCalculator.copyResult')"
        />
      </div>

      <template v-if="stats">
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.workdayCalculator.totalDays') }}
            </p>
            <p class="font-mono text-xl text-slate-700 tabular-nums">{{ stats.total }}</p>
          </div>
          <div class="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.workdayCalculator.workdays') }}
            </p>
            <p class="font-mono text-xl text-blue-600 tabular-nums">{{ stats.work }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.workdayCalculator.weekendDays') }}
            </p>
            <p class="font-mono text-xl text-slate-700 tabular-nums">{{ stats.weekend }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.workdayCalculator.holidaysHit') }}
            </p>
            <p class="font-mono text-xl text-slate-700 tabular-nums">{{ stats.holiday }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.workdayCalculator.restDays') }}
            </p>
            <p class="font-mono text-xl text-slate-700 tabular-nums">{{ stats.rest }}</p>
          </div>
        </div>
        <p class="text-xs text-slate-400 mt-3">
          {{ t('tools.workdayCalculator.restFormula') }}
        </p>
      </template>
      <p v-else class="text-sm text-slate-400">
        {{ t('toolsCommon.none') }}
      </p>
    </div>

    <!-- 区块四：按月拆解 -->
    <div v-if="stats" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.workdayCalculator.monthlySection') }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[26rem]">
          <thead>
            <tr class="text-left text-xs text-slate-400 border-b border-slate-100">
              <th class="py-2 pr-3 font-medium">
                {{ t('tools.workdayCalculator.thMonth') }}
              </th>
              <th class="py-2 pr-3 font-medium text-right">
                {{ t('tools.workdayCalculator.thTotal') }}
              </th>
              <th class="py-2 pr-3 font-medium text-right">
                {{ t('tools.workdayCalculator.thWeekend') }}
              </th>
              <th class="py-2 pr-3 font-medium text-right">
                {{ t('tools.workdayCalculator.thHoliday') }}
              </th>
              <th class="py-2 font-medium text-right">
                {{ t('tools.workdayCalculator.thWorkday') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            <tr v-for="m in stats.months" :key="m.month">
              <td class="py-2 pr-3 font-mono text-slate-700">{{ m.month }}</td>
              <td class="py-2 pr-3 text-right font-mono text-slate-600 tabular-nums">
                {{ m.total }}
              </td>
              <td class="py-2 pr-3 text-right font-mono text-slate-600 tabular-nums">
                {{ m.weekend }}
              </td>
              <td class="py-2 pr-3 text-right font-mono text-slate-600 tabular-nums">
                {{ m.holiday }}
              </td>
              <td class="py-2 text-right font-mono text-blue-600 tabular-nums">
                {{ m.work }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </ToolPage>
</template>
