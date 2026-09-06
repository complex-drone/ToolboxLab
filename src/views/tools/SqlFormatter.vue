<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * SQL 格式化 & 校验：
 * - sql-formatter 动态 import（v15），format(sql, { language, tabWidth, keywordCase })
 * - 方言：mysql / postgresql / plsql(Oracle) / sqlite / transactsql(SQL Server)
 * - 缩进 2/4 空格，关键字大小写 preserve/upper
 * - 300ms 防抖实时格式化；解析错误 try/catch 捕获，
 *   从「at line L column C」消息中定位行列，无位置信息时展示原始错误消息
 */
const { t } = useI18n()
const toast = useToast()

/** 示例 SQL（放组件常量，避免进语言包） */
const SAMPLE_SQL = [
  'select u.id, u.name, count(o.id) as order_count, sum(o.amount) as total_amount',
  'from users u',
  'left join orders o on o.user_id = u.id and o.status = \'paid\'',
  'where u.created_at >= \'2024-01-01\' and u.country in (\'CN\', \'US\')',
  'group by u.id, u.name',
  'having sum(o.amount) > 1000',
  'order by total_amount desc',
  'limit 20;',
].join('\n')

const DIALECTS = [
  { value: 'mysql', labelKey: 'dialectMysql' },
  { value: 'postgresql', labelKey: 'dialectPostgresql' },
  { value: 'plsql', labelKey: 'dialectPlsql' },
  { value: 'sqlite', labelKey: 'dialectSqlite' },
  { value: 'transactsql', labelKey: 'dialectTransactsql' },
]
const TAB_WIDTHS = [2, 4]
const KEYWORD_CASES = [
  { value: 'preserve', labelKey: 'casePreserve' },
  { value: 'upper', labelKey: 'caseUpper' },
]

const VALID_DIALECTS = DIALECTS.map(d => d.value)

/** 持久化：SQL 文本 + 方言 + 缩进 + 关键字大小写 */
const config = useStorage('tool-sql-formatter-config', {
  sql: SAMPLE_SQL,
  dialect: 'mysql',
  tabWidth: 2,
  keywordCase: 'preserve',
})

const sqlText = ref(
  typeof config.value.sql === 'string' ? config.value.sql : SAMPLE_SQL
)
const dialect = ref(
  VALID_DIALECTS.includes(config.value.dialect) ? config.value.dialect : 'mysql'
)
const tabWidth = ref(
  TAB_WIDTHS.includes(config.value.tabWidth) ? config.value.tabWidth : 2
)
const keywordCase = ref(
  ['preserve', 'upper'].includes(config.value.keywordCase) ? config.value.keywordCase : 'preserve'
)

const output = ref('')
/** { message, line, col | null } */
const formatError = ref(null)
const isFormatting = ref(false)
let formatterModule = null
let formatSeq = 0
let hadErrorToast = false

async function ensureFormatter() {
  if (!formatterModule) {
    formatterModule = await import('sql-formatter')
  }
  return formatterModule
}

async function runFormat() {
  const seq = ++formatSeq
  const sql = sqlText.value
  if (!sql.trim()) {
    output.value = ''
    formatError.value = null
    hadErrorToast = false
    return
  }
  isFormatting.value = true
  try {
    const { format } = await ensureFormatter()
    const result = format(sql, {
      language: dialect.value,
      tabWidth: tabWidth.value,
      keywordCase: keywordCase.value,
    })
    if (seq !== formatSeq) return
    output.value = result
    formatError.value = null
    hadErrorToast = false
  } catch (err) {
    if (seq !== formatSeq) return
    output.value = ''
    const message = err && err.message ? String(err.message) : ''
    // sql-formatter 的解析错误形如「Parse error at token: X at line L column C」
    const match = message.match(/at line (\d+)\s*,?\s*column (\d+)/i)
    formatError.value = {
      message: message || t('toolsCommon.error'),
      line: match ? Number(match[1]) : null,
      col: match ? Number(match[2]) : null,
    }
    // 仅在错误状态从无到有时提示一次，避免实时输入时刷屏
    if (!hadErrorToast) {
      toast.error(t('tools.sqlFormatter.parseErrorToast'))
      hadErrorToast = true
    }
  } finally {
    if (seq === formatSeq) {
      isFormatting.value = false
    }
  }
}
const debouncedFormat = useDebounceFn(runFormat, 300)

watch([sqlText, dialect, tabWidth, keywordCase], () => {
  config.value = {
    sql: sqlText.value,
    dialect: dialect.value,
    tabWidth: tabWidth.value,
    keywordCase: keywordCase.value,
  }
  debouncedFormat()
})

onMounted(() => {
  runFormat()
})

onBeforeUnmount(() => {
  formatSeq++
})

function applySample() {
  sqlText.value = SAMPLE_SQL
  runFormat()
}

function clearSql() {
  sqlText.value = ''
  output.value = ''
  formatError.value = null
  hadErrorToast = false
}

const outputLines = computed(() =>
  output.value ? output.value.split('\n').length : 0
)
</script>

<template>
  <ToolPage tool-id="sqlFormatter">
    <!-- 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="label-base" for="sql-dialect">{{ t('tools.sqlFormatter.dialectLabel') }}</label>
          <select id="sql-dialect" v-model="dialect" class="input-base">
            <option v-for="d in DIALECTS" :key="d.value" :value="d.value">
              {{ t(`tools.sqlFormatter.${d.labelKey}`) }}
            </option>
          </select>
        </div>
        <div>
          <label class="label-base" for="sql-tab-width">{{ t('tools.sqlFormatter.indentLabel') }}</label>
          <select id="sql-tab-width" v-model.number="tabWidth" class="input-base">
            <option v-for="w in TAB_WIDTHS" :key="w" :value="w">
              {{ t('tools.sqlFormatter.indentOption', { n: w }) }}
            </option>
          </select>
        </div>
        <div>
          <label class="label-base" for="sql-keyword-case">{{ t('tools.sqlFormatter.keywordCaseLabel') }}</label>
          <select id="sql-keyword-case" v-model="keywordCase" class="input-base">
            <option v-for="c in KEYWORD_CASES" :key="c.value" :value="c.value">
              {{ t(`tools.sqlFormatter.${c.labelKey}`) }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="sql-input">{{ t('toolsCommon.input') }}</label>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-ghost"
            :aria-label="t('toolsCommon.example')"
            @click="applySample"
          >
            {{ t('toolsCommon.example') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!sqlText"
            :aria-label="t('toolsCommon.clear')"
            @click="clearSql"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="sql-input"
        v-model="sqlText"
        rows="9"
        class="input-base font-mono resize-y leading-relaxed"
        :placeholder="t('tools.sqlFormatter.inputPlaceholder')"
        :aria-label="t('toolsCommon.input')"
        spellcheck="false"
        autocomplete="off"
      ></textarea>

      <p v-if="formatError" class="mt-2.5 text-red-600 text-sm" role="alert">
        <template v-if="formatError.line !== null">
          {{ t('tools.sqlFormatter.errorAtLine', { line: formatError.line, col: formatError.col }) }}
        </template>
        <template v-else>{{ t('tools.sqlFormatter.parseErrorTitle') }}</template>
        <code class="block mt-1 font-mono text-xs text-red-500 break-all whitespace-pre-wrap">
          {{ formatError.message }}
        </code>
      </p>
    </section>

    <!-- 结果 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <h2 class="section-title mb-0">
          {{ t('toolsCommon.result') }}
          <span v-if="output" class="ml-1.5 text-xs font-normal text-slate-400">
            {{ outputLines }} {{ t('toolsCommon.lines') }}
          </span>
        </h2>
        <div class="flex items-center gap-2">
          <span v-if="isFormatting" class="text-xs text-slate-400">{{ t('toolsCommon.processing') }}</span>
          <CopyButton
            :text="output"
            :label="t('toolsCommon.copy')"
            :disabled="!output"
          />
        </div>
      </div>
      <div
        v-if="output"
        class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5 overflow-x-auto max-h-[28rem] overflow-y-auto"
        aria-live="polite"
      >
        <pre class="font-mono text-sm text-slate-700 whitespace-pre leading-relaxed">{{ output }}</pre>
      </div>
      <p v-else class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>
    </section>
  </ToolPage>
</template>
