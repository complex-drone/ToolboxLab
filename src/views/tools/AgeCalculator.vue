<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t, locale } = useI18n()

/**
 * 持久化配置：出生日期（低敏感度）
 * 注意：useStorage 返回 ref，script 中必须用 config.value.xxx 访问
 */
const config = useStorage('tool-age-calculator-config', { birth: '' }, undefined, {
  mergeDefaults: true,
})

const DAY_MS = 86400000

/** 生肖顺序：(year - 4) % 12 → 0 鼠 … 11 猪 */
const ZODIAC_KEYS = [
  'Rat',
  'Ox',
  'Tiger',
  'Rabbit',
  'Dragon',
  'Snake',
  'Horse',
  'Goat',
  'Monkey',
  'Rooster',
  'Dog',
  'Pig',
]

/** 星座起始边界（含当天），此前归入上一个星座；默认摩羯座（12/22 - 1/19） */
const SIGN_BOUNDS = [
  [1, 20, 'Aquarius'],
  [2, 19, 'Pisces'],
  [3, 21, 'Aries'],
  [4, 20, 'Taurus'],
  [5, 21, 'Gemini'],
  [6, 22, 'Cancer'],
  [7, 23, 'Leo'],
  [8, 23, 'Virgo'],
  [9, 23, 'Libra'],
  [10, 24, 'Scorpio'],
  [11, 23, 'Sagittarius'],
  [12, 22, 'Capricorn'],
]

/* ---------------- 当前时间（1 秒心跳，驱动倒计时） ---------------- */
const nowMs = ref(Date.now())
let timer = null
onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

/* ---------------- 本地时区日期工具（手工解析，避免 UTC 口径） ---------------- */
function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
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

/** 月份加减：月末溢出按目标月最后一天钳制（2/29 出生者非闰年生日按 2/28） */
function addMonths(date, n) {
  const total = date.getFullYear() * 12 + date.getMonth() + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  return new Date(ny, nm, Math.min(date.getDate(), daysInMonth(ny, nm)))
}

/** a 与 b 之间的完整月数（先整年后整月的日历口径） */
function fullMonthsBetween(a, b) {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  while (m > 0 && addMonths(a, m).getTime() > b.getTime()) m--
  return Math.max(0, m)
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

function formatWeekday(date, mode = 'long') {
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: mode }).format(date)
  } catch {
    return ''
  }
}

function copyLine(label, value) {
  return t('tools.ageCalculator.copyLine', { label, value })
}

/* ---------------- 出生日期解析 ---------------- */
const todayMid = computed(() => {
  const n = new Date(nowMs.value)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
})
const todayStr = computed(() => toDateStr(todayMid.value))

const birthState = computed(() => {
  if (!config.value.birth) return { status: 'empty' }
  const b = parseDateStr(config.value.birth)
  if (!b) return { status: 'invalid' }
  if (b.getTime() > todayMid.value.getTime()) return { status: 'future' }
  return { status: 'ok', birth: b }
})

/* ---------------- 精确年龄（X 年 X 月 X 天） ---------------- */
const ageInfo = computed(() => {
  const st = birthState.value
  if (st.status !== 'ok') return null
  const birth = st.birth
  const today = todayMid.value
  const totalMonths = fullMonthsBetween(birth, today)
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths - years * 12
  const days = dayDiff(addMonths(birth, totalMonths), today)
  return {
    years,
    months,
    days,
    totalDays: dayDiff(birth, today),
  }
})

/* ---------------- 下次生日倒计时 ---------------- */
/** 某年的生日：2/29 出生者非闰年自动钳制为 2/28 */
function birthdayInYear(birth, year) {
  return addMonths(birth, (year - birth.getFullYear()) * 12)
}

const birthdayInfo = computed(() => {
  const st = birthState.value
  if (st.status !== 'ok') return null
  const birth = st.birth
  const today = todayMid.value
  let next = birthdayInYear(birth, today.getFullYear())
  if (next.getTime() < today.getTime()) {
    next = birthdayInYear(birth, today.getFullYear() + 1)
  }
  const isToday = next.getTime() === today.getTime()
  const remainingMs = Math.max(0, next.getTime() - nowMs.value)
  return {
    next,
    isToday,
    days: Math.floor(remainingMs / DAY_MS),
    hours: Math.floor(remainingMs / 3600000) % 24,
    minutes: Math.floor(remainingMs / 60000) % 60,
    seconds: Math.floor(remainingMs / 1000) % 60,
  }
})

/* ---------------- 生肖（按公历年份近似） ---------------- */
const zodiacLabel = computed(() => {
  const st = birthState.value
  if (st.status !== 'ok') return ''
  const idx = (((st.birth.getFullYear() - 4) % 12) + 12) % 12
  return t(`tools.ageCalculator.zodiac${ZODIAC_KEYS[idx]}`)
})

/* ---------------- 星座（按公历月日区间） ---------------- */
function signKeyOf(month, day) {
  let key = 'Capricorn'
  for (const [m, d, k] of SIGN_BOUNDS) {
    if (month > m || (month === m && day >= d)) key = k
  }
  return key
}

const signLabel = computed(() => {
  const st = birthState.value
  if (st.status !== 'ok') return ''
  const b = st.birth
  return t(`tools.ageCalculator.sign${signKeyOf(b.getMonth() + 1, b.getDate())}`)
})

/* ---------------- 结果复制 ---------------- */
const summaryCopyText = computed(() => {
  const st = birthState.value
  const age = ageInfo.value
  const bd = birthdayInfo.value
  if (st.status !== 'ok' || !age || !bd) return ''
  const lines = [
    copyLine(t('tools.ageCalculator.birthDate'), `${toDateStr(st.birth)} ${formatWeekday(st.birth)}`),
    copyLine(
      t('tools.ageCalculator.ageExact'),
      t('tools.ageCalculator.ageValue', { y: age.years, m: age.months, d: age.days })
    ),
    copyLine(
      t('tools.ageCalculator.totalDaysLabel'),
      t('tools.ageCalculator.totalDaysValue', { n: age.totalDays })
    ),
    copyLine(t('tools.ageCalculator.nextBirthdayDate'), `${toDateStr(bd.next)} ${formatWeekday(bd.next)}`),
    copyLine(t('tools.ageCalculator.zodiac'), zodiacLabel.value),
    copyLine(t('tools.ageCalculator.sign'), signLabel.value),
  ]
  return lines.join('\n')
})
</script>

<template>
  <ToolPage tool-id="ageCalculator">
    <!-- 区块一：出生日期 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.ageCalculator.birthSection') }}</h2>
      <label class="label-base" for="ac-birth">
        {{ t('tools.ageCalculator.birthDate') }}
      </label>
      <input
        id="ac-birth"
        v-model="config.birth"
        type="date"
        class="input-base font-mono sm:max-w-xs"
        :max="todayStr"
        :aria-label="t('tools.ageCalculator.birthDate')"
      />
      <p v-if="birthState.status === 'invalid'" class="text-red-600 text-sm mt-2">
        {{ t('tools.ageCalculator.invalidBirth') }}
      </p>
      <p v-else-if="birthState.status === 'future'" class="text-red-600 text-sm mt-2">
        {{ t('tools.ageCalculator.futureBirth') }}
      </p>
      <p v-else-if="birthState.status === 'empty'" class="text-sm text-slate-400 mt-2">
        {{ t('tools.ageCalculator.pickBirth') }}
      </p>
      <p class="text-xs text-slate-400 mt-2">
        {{ t('tools.ageCalculator.leapNote') }}
      </p>
    </div>

    <template v-if="birthState.status === 'ok'">
      <!-- 区块二：计算结果 -->
      <div class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.ageCalculator.ageSection') }}</h2>
          <CopyButton
            :text="summaryCopyText"
            :label="t('tools.ageCalculator.copySummary')"
          />
        </div>

        <div class="rounded-xl border border-blue-100 bg-blue-50/60 p-4 mb-3">
          <p class="label-base mb-0.5">{{ t('tools.ageCalculator.ageExact') }}</p>
          <p class="text-2xl sm:text-3xl font-semibold text-blue-600 tabular-nums">
            {{
              t('tools.ageCalculator.ageValue', {
                y: ageInfo.years,
                m: ageInfo.months,
                d: ageInfo.days,
              })
            }}
          </p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.ageCalculator.totalDaysLabel') }}
            </p>
            <p class="font-mono text-lg text-slate-700 tabular-nums">
              {{ t('tools.ageCalculator.totalDaysValue', { n: ageInfo.totalDays }) }}
            </p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">
              {{ t('tools.ageCalculator.birthWeekday') }}
            </p>
            <p class="text-sm text-slate-700">
              {{ formatWeekday(birthState.birth) }}
            </p>
          </div>
        </div>
      </div>

      <!-- 区块三：下次生日倒计时 -->
      <div class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.ageCalculator.nextBirthdaySection') }}</h2>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
          <div>
            <p class="label-base mb-0.5">{{ t('tools.ageCalculator.nextBirthdayDate') }}</p>
            <p class="font-mono text-lg text-slate-700 tabular-nums">
              {{ toDateStr(birthdayInfo.next) }}
            </p>
          </div>
          <div>
            <p class="label-base mb-0.5">{{ t('tools.ageCalculator.birthWeekday') }}</p>
            <p class="text-sm text-slate-700">{{ formatWeekday(birthdayInfo.next) }}</p>
          </div>
        </div>

        <div
          v-if="birthdayInfo.isToday"
          class="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-center"
        >
          <span class="chip mb-2">{{ t('tools.ageCalculator.isTodayBirthday') }}</span>
          <p class="text-lg font-semibold text-blue-600">
            {{ t('tools.ageCalculator.isTodayBirthday') }}
          </p>
        </div>
        <div v-else>
          <p class="label-base mb-0.5">{{ t('tools.ageCalculator.countdownLabel') }}</p>
          <p class="font-mono text-2xl sm:text-3xl font-semibold text-slate-700 tabular-nums">
            {{
              t('tools.ageCalculator.countdownValue', {
                d: birthdayInfo.days,
                h: birthdayInfo.hours,
                m: birthdayInfo.minutes,
                s: birthdayInfo.seconds,
              })
            }}
          </p>
        </div>
      </div>

      <!-- 区块四：生肖与星座 -->
      <div class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.ageCalculator.zodiacSection') }}</h2>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="rounded-xl border border-slate-100 bg-white/70 p-4 text-center">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.ageCalculator.zodiac') }}</p>
            <p class="text-2xl font-semibold text-slate-700">{{ zodiacLabel }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 p-4 text-center">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.ageCalculator.sign') }}</p>
            <p class="text-2xl font-semibold text-slate-700">{{ signLabel }}</p>
          </div>
        </div>
        <p class="text-xs text-slate-400">
          {{ t('tools.ageCalculator.zodiacApproxNote') }}
        </p>
      </div>
    </template>
  </ToolPage>
</template>
