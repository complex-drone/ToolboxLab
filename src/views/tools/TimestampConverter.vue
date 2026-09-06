<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t, locale } = useI18n()
const toast = useToast()

/** 持久化配置：时区显示偏好（local / utc） */
const config = useStorage('tool-timestamp-converter-config', { timezone: 'local' })

const tsInput = ref('')
const dateLocal = ref('')
const dateMs = ref('0')
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

/* ---------------- 时间戳解析（自动识别秒 / 毫秒） ---------------- */
function parseTimestamp(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return { status: 'empty' }
  if (!/^\d{1,16}$/.test(s)) return { status: 'invalid' }
  // 13 位及以上按毫秒解析，否则按秒
  const isMs = s.length >= 13
  const ms = isMs ? Number(s) : Number(s) * 1000
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) return { status: 'invalid' }
  return { status: 'ok', ms, isMs, digits: s.length, date }
}

const tsParsed = computed(() => parseTimestamp(tsInput.value))

const detectText = computed(() => {
  const s = tsParsed.value
  if (s.status !== 'ok') return ''
  return t('tools.timestampConverter.detected', {
    unit: s.isMs ? t('tools.timestampConverter.unitMs') : t('tools.timestampConverter.unitSec'),
    n: s.digits,
  })
})

/* ---------------- 时区格式化（Intl timeZone） ---------------- */
function tzArg() {
  return config.value.timezone === 'utc' ? 'UTC' : undefined
}

function tzParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tzArg(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = {}
  for (const p of fmt.formatToParts(new Date(ms))) parts[p.type] = p.value
  return parts
}

function formatDateTime(ms) {
  try {
    const p = tzParts(ms)
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
  } catch {
    return ''
  }
}

function formatWeekday(ms) {
  try {
    return new Intl.DateTimeFormat(locale.value, {
      weekday: 'long',
      timeZone: tzArg(),
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

const localOffsetLabel = computed(() => {
  const offset = -new Date().getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
})

/* ---------------- 时间戳 → 日期 ---------------- */
const tsDateText = computed(() =>
  tsParsed.value.status === 'ok' ? formatDateTime(tsParsed.value.ms) : ''
)
const tsMsSuffix = computed(() =>
  tsParsed.value.status === 'ok'
    ? String(tsParsed.value.ms % 1000).padStart(3, '0')
    : ''
)
const tsWeekday = computed(() =>
  tsParsed.value.status === 'ok' ? formatWeekday(tsParsed.value.ms) : ''
)
const tsIso = computed(() =>
  tsParsed.value.status === 'ok' ? tsParsed.value.date.toISOString() : ''
)
const tsSecText = computed(() =>
  tsParsed.value.status === 'ok'
    ? String(Math.floor(tsParsed.value.ms / 1000))
    : ''
)
const tsMsText = computed(() =>
  tsParsed.value.status === 'ok' ? String(tsParsed.value.ms) : ''
)

/* ---------------- 日期 → 时间戳（datetime-local + 毫秒） ---------------- */
function localPartsOf(ms) {
  const d = new Date(ms)
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ms: d.getMilliseconds(),
  }
}

/** 双向同步防循环标记 */
let syncing = false

function applyTimestampToDates() {
  if (tsParsed.value.status !== 'ok') return
  const p = localPartsOf(tsParsed.value.ms)
  dateLocal.value = p.date
  dateMs.value = String(p.ms)
}

function onTsInput() {
  if (syncing) return
  syncing = true
  applyTimestampToDates()
  syncing = false
}

function parseDateFields() {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(dateLocal.value || '')
  )
  if (!m) return null
  const msPart = Math.min(Math.max(parseInt(dateMs.value, 10) || 0, 0), 999)
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0),
    msPart
  )
  const time = d.getTime()
  if (!Number.isFinite(time)) return null
  return time
}

const dateTs = computed(() => (dateLocal.value ? parseDateFields() : null))

const dateTsMsText = computed(() =>
  dateTs.value === null ? '' : String(dateTs.value)
)
const dateTsSecText = computed(() =>
  dateTs.value === null ? '' : String(Math.floor(dateTs.value / 1000))
)

function onDateInput() {
  if (syncing) return
  const time = parseDateFields()
  if (time === null) return
  syncing = true
  tsInput.value = String(time)
  syncing = false
}

/* ---------------- 当前时间 ---------------- */
const nowText = computed(() => formatDateTime(nowMs.value))
const nowWeekday = computed(() => formatWeekday(nowMs.value))

function fillNow() {
  tsInput.value = String(Date.now())
  syncing = true
  applyTimestampToDates()
  syncing = false
  toast.success(t('toolsCommon.done'))
}

function chipClass(active) {
  return active
    ? 'chip cursor-pointer select-none'
    : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/70 text-slate-500 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer select-none'
}
</script>

<template>
  <ToolPage tool-id="timestampConverter">
    <!-- 时区切换 + 当前时间 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-600">
          {{ t('tools.timestampConverter.timezone') }}
        </span>
        <button
          type="button"
          :class="chipClass(config.timezone === 'local')"
          :aria-pressed="config.timezone === 'local'"
          @click="config.timezone = 'local'"
        >
          {{ t('tools.timestampConverter.tzLocalOffset', { offset: localOffsetLabel }) }}
        </button>
        <button
          type="button"
          :class="chipClass(config.timezone === 'utc')"
          :aria-pressed="config.timezone === 'utc'"
          @click="config.timezone = 'utc'"
        >
          {{ t('tools.timestampConverter.tzUtc') }}
        </button>
      </div>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs text-slate-400">
            {{ t('tools.timestampConverter.nowLabel') }}
          </p>
          <p class="font-mono text-lg text-slate-700 tabular-nums break-all">
            {{ nowText }}
          </p>
          <p class="text-xs text-slate-400">{{ nowWeekday }}</p>
        </div>
        <button type="button" class="btn-primary" @click="fillNow">
          {{ t('tools.timestampConverter.fillNow') }}
        </button>
      </div>
    </div>

    <!-- 时间戳 → 日期 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 class="section-title mb-0">
          {{ t('tools.timestampConverter.tsToDate') }}
        </h2>
        <span v-if="detectText" class="chip">{{ detectText }}</span>
      </div>
      <input
        v-model="tsInput"
        type="text"
        inputmode="numeric"
        class="input-base font-mono"
        :placeholder="t('tools.timestampConverter.tsPlaceholder')"
        :aria-label="t('tools.timestampConverter.tsLabel')"
        @input="onTsInput"
      />
      <p v-if="tsParsed.status === 'invalid'" class="text-red-600 text-sm mt-2">
        {{ t('tools.timestampConverter.invalidTs') }}
      </p>

      <div
        v-if="tsParsed.status === 'ok'"
        class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-4"
      >
        <div class="sm:col-span-2">
          <p class="label-base">{{ t('tools.timestampConverter.dateLabel') }}</p>
          <p class="font-mono text-base text-slate-700 break-all">
            {{ tsDateText }}<span class="text-slate-400">.{{ tsMsSuffix }}</span>
          </p>
        </div>
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.weekdayLabel') }}</p>
          <p class="text-sm text-slate-700">{{ tsWeekday }}</p>
        </div>
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.isoLabel') }}</p>
          <p class="font-mono text-sm text-slate-700 break-all">{{ tsIso }}</p>
        </div>
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.tsSecLabel') }}</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm text-slate-700 break-all">{{ tsSecText }}</p>
            <CopyButton
              compact
              :text="tsSecText"
              :label="t('tools.timestampConverter.copyTs')"
            />
          </div>
        </div>
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.tsMsLabel') }}</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm text-slate-700 break-all">{{ tsMsText }}</p>
            <CopyButton
              compact
              :text="tsMsText"
              :label="t('tools.timestampConverter.copyTs')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 日期 → 时间戳 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.timestampConverter.dateToTs') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-2">
          <label class="label-base" for="tsc-date">
            {{ t('tools.timestampConverter.dateLabel') }}
          </label>
          <input
            id="tsc-date"
            v-model="dateLocal"
            type="datetime-local"
            step="1"
            class="input-base font-mono"
            :aria-label="t('tools.timestampConverter.dateLabel')"
            @input="onDateInput"
          />
        </div>
        <div>
          <label class="label-base" for="tsc-ms">
            {{ t('tools.timestampConverter.msLabel') }}
          </label>
          <input
            id="tsc-ms"
            v-model="dateMs"
            type="number"
            min="0"
            max="999"
            step="1"
            class="input-base font-mono"
            :aria-label="t('tools.timestampConverter.msLabel')"
            @input="onDateInput"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.tsMsLabel') }}</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm text-slate-700 break-all">
              {{ dateTsMsText || t('toolsCommon.none') }}
            </p>
            <CopyButton
              compact
              :text="dateTsMsText"
              :label="t('tools.timestampConverter.copyTs')"
            />
          </div>
        </div>
        <div>
          <p class="label-base">{{ t('tools.timestampConverter.tsSecLabel') }}</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm text-slate-700 break-all">
              {{ dateTsSecText || t('toolsCommon.none') }}
            </p>
            <CopyButton
              compact
              :text="dateTsSecText"
              :label="t('tools.timestampConverter.copyTs')"
            />
          </div>
        </div>
      </div>
    </div>
  </ToolPage>
</template>
