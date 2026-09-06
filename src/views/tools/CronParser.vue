<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * Cron 表达式解析：
 * - 5/6/7 段合法性先用空格分段判断，再用 croner 的 new Cron(expr) 校验
 * - 自然语言说明由自研解释器逐字段翻译（*、数字、列表、范围、步进）
 * - 最近 5 次执行用 croner 的 nextRuns(5)，按本地时区渲染
 */

const { t, locale } = useI18n()

/** 持久化最后表达式 */
const config = useStorage('tool-cron-parser-config', {
  expr: '*/5 * * * *',
})

const expr = ref(typeof config.value.expr === 'string' ? config.value.expr : '*/5 * * * *')

const error = ref('')
/** 解析结果：{ fields, next, yearLimited } */
const parsed = ref(null)
let cronerModule = null
let parseSeq = 0

const QUICK_PRESETS = [
  { key: 'quickEveryMinute', expr: '* * * * *' },
  { key: 'quickHourly', expr: '0 * * * *' },
  { key: 'quickDaily', expr: '0 0 * * *' },
  { key: 'quickWeekly', expr: '0 9 * * 1' },
]

/** 5/6/7 段对应的字段顺序（6/7 段第 1 位为秒，7 段末位为年） */
const FIELDS_BY_COUNT = {
  5: ['minute', 'hour', 'day', 'month', 'dow'],
  6: ['second', 'minute', 'hour', 'day', 'month', 'dow'],
  7: ['second', 'minute', 'hour', 'day', 'month', 'dow', 'year'],
}

/** 英文月/星期名 → 数字（先归一化再解释） */
const NAME_TO_NUM = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
}

const NUM_RE = /^\d+$/

function normalizeToken(token) {
  const upper = token.toUpperCase()
  return upper in NAME_TO_NUM ? String(NAME_TO_NUM[upper]) : token
}

function normalizePart(part) {
  return part.split(',').map(normalizeToken).join(',')
}

/** 单个取值片段（不含逗号列表）→ 自然语言 */
function describeValue(item) {
  const slashParts = item.split('/')
  const base = slashParts[0]
  const step = slashParts[1]

  if (base === '*' || base === '?') {
    if (step && NUM_RE.test(step)) return t('tools.cronParser.phraseStep', { n: step })
    if (!step) return t('tools.cronParser.phraseAny')
    return t('tools.cronParser.phraseSpecial', { value: item })
  }

  if (step && NUM_RE.test(step)) {
    if (base.includes('-')) {
      const [a, b] = base.split('-')
      if (NUM_RE.test(a) && NUM_RE.test(b)) {
        return t('tools.cronParser.phraseRangeStep', { a, b, n: step })
      }
      return t('tools.cronParser.phraseSpecial', { value: item })
    }
    if (NUM_RE.test(base)) return t('tools.cronParser.phraseStartStep', { a: base, n: step })
    return t('tools.cronParser.phraseSpecial', { value: item })
  }

  if (base.includes('-')) {
    const [a, b] = base.split('-')
    if (NUM_RE.test(a) && NUM_RE.test(b)) return t('tools.cronParser.phraseRange', { a, b })
    return t('tools.cronParser.phraseSpecial', { value: item })
  }

  if (NUM_RE.test(base)) return t('tools.cronParser.phraseValue', { n: base })
  return t('tools.cronParser.phraseSpecial', { value: item })
}

/** 一个字段（可能是逗号列表）→ 自然语言 */
function describePart(rawPart) {
  const part = normalizePart(rawPart.trim())
  const items = part.split(',').filter(Boolean)
  if (items.length === 0) {
    return t('tools.cronParser.phraseSpecial', { value: rawPart })
  }
  const sep = t('tools.cronParser.phraseSeparator')
  return items.map(describeValue).join(sep)
}

function describeFields(parts) {
  const keys = FIELDS_BY_COUNT[parts.length] || []
  return keys.map((key, idx) => ({
    key,
    // 语言包键为驼峰扁平命名：fieldMinute / fieldDow / fieldYear ...
    label: t(`tools.cronParser.field${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    phrase: describePart(parts[idx]),
  }))
}

async function ensureCroner() {
  if (!cronerModule) {
    cronerModule = await import('croner')
  }
  return cronerModule
}

function formatRunDate(date) {
  try {
    return date.toLocaleString(locale.value === 'en-US' ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return date.toLocaleString()
  }
}

async function runParse() {
  const seq = ++parseSeq
  const raw = expr.value.trim()
  error.value = ''
  parsed.value = null
  if (!raw) return

  const parts = raw.split(/\s+/)
  if (parts.length < 5 || parts.length > 7) {
    error.value = t('tools.cronParser.fieldCountError')
    return
  }

  // 字段说明由自研解释器完成，不依赖 croner 是否支持
  const fields = describeFields(parts)

  // 用 croner 校验并取最近 5 次执行
  try {
    const { Cron } = await ensureCroner()
    const job = new Cron(raw)
    const next = job.nextRuns(5)
    if (seq !== parseSeq) return
    parsed.value = { fields, next: next.map(formatRunDate), yearLimited: false }
  } catch (err) {
    if (seq !== parseSeq) return
    if (parts.length === 7) {
      // croner 对含年份的 7 段支持有限：友好提示，仅展示字段说明
      error.value = ''
      parsed.value = { fields, next: [], yearLimited: true }
    } else {
      // 展示 croner 的具体报错信息；无信息时退回通用无效提示
      const detail = err && err.message ? err.message : ''
      error.value = detail || t('toolsCommon.invalidInput')
      parsed.value = null
    }
  }
}
const debouncedRunParse = useDebounceFn(runParse, 300)

watch(expr, value => {
  config.value.expr = value
  debouncedRunParse()
})

onMounted(() => {
  runParse()
})

onBeforeUnmount(() => {
  parseSeq++
})

function applyPreset(preset) {
  expr.value = preset.expr
  config.value.expr = preset.expr
  runParse()
}

function clearExpr() {
  expr.value = ''
  config.value.expr = ''
  error.value = ''
  parsed.value = null
}

const isValid = computed(() => !!parsed.value && !parsed.value.yearLimited)
</script>

<template>
  <ToolPage tool-id="cronParser">
    <!-- 表达式输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="cron-expr-input">{{ t('tools.cronParser.exprLabel') }}</label>
        <button
          type="button"
          class="btn-danger"
          :disabled="!expr"
          :aria-label="t('toolsCommon.clear')"
          @click="clearExpr"
        >
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <input
        id="cron-expr-input"
        v-model="expr"
        type="text"
        class="input-base w-full font-mono"
        :placeholder="t('tools.cronParser.exprPlaceholder')"
        :aria-label="t('tools.cronParser.exprLabel')"
        spellcheck="false"
        autocomplete="off"
      />

      <div class="mt-3">
        <span class="text-xs font-medium text-slate-500 mr-2">{{ t('tools.cronParser.quickTitle') }}</span>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <button
            v-for="preset in QUICK_PRESETS"
            :key="preset.key"
            type="button"
            class="btn-ghost !py-1"
            :aria-label="t(`tools.cronParser.${preset.key}`)"
            @click="applyPreset(preset)"
          >
            {{ t(`tools.cronParser.${preset.key}`) }}
          </button>
        </div>
      </div>

      <p v-if="error" class="mt-2 text-red-600 text-sm">{{ error }}</p>
      <p v-else-if="isValid" class="mt-2 text-sm text-green-600">{{ t('tools.cronParser.valid') }}</p>
    </section>

    <!-- 字段说明 -->
    <section v-if="parsed" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.cronParser.fieldsTitle') }}</h2>
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <li
          v-for="field in parsed.fields"
          :key="field.key"
          class="flex items-baseline gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
        >
          <span class="chip shrink-0 min-w-[2.5rem] justify-center">{{ field.label }}</span>
          <span class="text-sm text-slate-700">{{ field.phrase }}</span>
        </li>
      </ul>
    </section>

    <!-- 最近执行时间 -->
    <section v-if="parsed" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.cronParser.nextRunsTitle') }}</h2>
      <ol v-if="parsed.next.length" class="space-y-1.5">
        <li
          v-for="(run, idx) in parsed.next"
          :key="idx"
          class="flex items-center gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
        >
          <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200 min-w-[2rem] justify-center">
            {{ idx + 1 }}
          </span>
          <span class="font-mono text-sm text-slate-700">{{ run }}</span>
        </li>
      </ol>
      <p v-else class="text-sm text-slate-400">{{ t('tools.cronParser.nextRunsUnavailable') }}</p>
      <p v-if="parsed.yearLimited" class="mt-2 text-red-600 text-sm">
        {{ t('tools.cronParser.yearNotSupported') }}
      </p>
    </section>
  </ToolPage>
</template>
