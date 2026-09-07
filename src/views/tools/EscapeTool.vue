<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useCancellableDebounceFn } from '@/composables/useCancellableDebounceFn'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 转义 / 反转义：
 * - JSON / SQL / Shell / HTML 四种模式，Tab 切换，各模式输入独立保留
 * - 每种模式支持转义与反转义两个方向，方向切换或「交换」按钮均可
 * - 实时转换防抖 300ms；持久化选中模式与 SQL 反斜杠选项
 */

const MODES = [
  { id: 'json', labelKey: 'modeJson', hintKey: 'jsonHint' },
  { id: 'sql', labelKey: 'modeSql', hintKey: 'sqlHint' },
  { id: 'shell', labelKey: 'modeShell', hintKey: 'shellHint' },
  { id: 'html', labelKey: 'modeHtml', hintKey: 'htmlHint' },
]

const { t } = useI18n()
const toast = useToast()

/** 持久化选中模式与 SQL 转义风格选项 */
const config = useStorage('tool-escape-tool-config', {
  mode: 'json',
  sqlBackslash: false,
})
if (!MODES.some(m => m.id === config.value.mode)) config.value.mode = 'json'

const mode = computed({
  get: () => config.value.mode,
  set: value => {
    config.value.mode = value
  },
})

/** 方向：escape（原始 → 转义）/ unescape（转义 → 原始） */
const direction = ref('escape')

/** 每种模式独立的输入状态（切换模式/方向后内容保留） */
const inputs = reactive({
  json: { raw: '', escaped: '' },
  sql: { raw: '', escaped: '' },
  shell: { raw: '', escaped: '' },
  html: { raw: '', escaped: '' },
})

/** 每模式每方向的输出：{ text, error } */
const outputs = reactive({
  json: { escape: { text: '', error: '' }, unescape: { text: '', error: '' } },
  sql: { escape: { text: '', error: '' }, unescape: { text: '', error: '' } },
  shell: { escape: { text: '', error: '' }, unescape: { text: '', error: '' } },
  html: { escape: { text: '', error: '' }, unescape: { text: '', error: '' } },
})

/* ---------- 转义 / 反转义实现 ---------- */

function escapeJson(s) {
  return JSON.stringify(s)
}

function unescapeJson(s) {
  const value = s.trim()
  if (!value) return ''
  // 标准字符串字面量
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'string') return parsed
  } catch {
    /* 继续尝试宽松解析 */
  }
  // 宽松：允许省略外层引号
  try {
    const parsed = JSON.parse(`"${value}"`)
    if (typeof parsed === 'string') return parsed
  } catch {
    /* 两种方式都失败则报错 */
  }
  throw new Error('invalid-json-literal')
}

function escapeSql(s, backslash) {
  if (backslash) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }
  return s.replace(/'/g, "''")
}

function unescapeSql(s, backslash) {
  if (backslash) {
    return s.replace(/\\(['\\])/g, '$1')
  }
  return s.replace(/''/g, "'")
}

function escapeShell(s) {
  // POSIX：整体单引号包裹，内部单引号写成 '\''（结束引号 + 反斜杠转义引号 + 重新开始引号）
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function unescapeShell(s) {
  const value = s.trim()
  if (!value) return ''
  let core = value
  if (value.length >= 2 && value.startsWith(`'`) && value.endsWith(`'`)) {
    core = value.slice(1, -1)
  }
  return core.replace(/'\\''/g, `'`)
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}


function unescapeHtml(s) {
  if (!s) return ''
  const doc = new DOMParser().parseFromString(s, 'text/html')
  return doc.documentElement.textContent
}

function runEscape(modeId, raw) {
  switch (modeId) {
    case 'json':
      return escapeJson(raw)
    case 'sql':
      return escapeSql(raw, !!config.value.sqlBackslash)
    case 'shell':
      return escapeShell(raw)
    case 'html':
      return escapeHtml(raw)
    default:
      return raw
  }
}

function runUnescape(modeId, escaped) {
  switch (modeId) {
    case 'json':
      return unescapeJson(escaped)
    case 'sql':
      return unescapeSql(escaped, !!config.value.sqlBackslash)
    case 'shell':
      return unescapeShell(escaped)
    case 'html':
      return unescapeHtml(escaped)
    default:
      return escaped
  }
}

function convertOne(modeId, dir) {
  const source = dir === 'escape' ? inputs[modeId].raw : inputs[modeId].escaped
  const out = outputs[modeId][dir]
  if (!source) {
    out.text = ''
    out.error = ''
    return
  }
  try {
    out.text = dir === 'escape' ? runEscape(modeId, source) : runUnescape(modeId, source)
    out.error = ''
  } catch {
    out.text = ''
    out.error =
      dir === 'escape'
        ? t('tools.escapeTool.errEscape')
        : modeId === 'json'
          ? t('tools.escapeTool.errJsonUnescape')
          : t('tools.escapeTool.errUnescape')
  }
}

function convertAll() {
  for (const m of MODES) {
    convertOne(m.id, 'escape')
    convertOne(m.id, 'unescape')
  }
}
const debouncedConvertAll = useCancellableDebounceFn(convertAll, 300)

watch(
  () => [
    inputs.json.raw, inputs.json.escaped,
    inputs.sql.raw, inputs.sql.escaped,
    inputs.shell.raw, inputs.shell.escaped,
    inputs.html.raw, inputs.html.escaped,
    config.value.sqlBackslash,
  ],
  () => debouncedConvertAll(),
)

onMounted(() => {
  convertAll()
})

onBeforeUnmount(() => {
  debouncedConvertAll.cancel()
})

/** 当前视图绑定：输入随方向切换而独立保留 */
const currentInput = computed({
  get: () => (direction.value === 'escape' ? inputs[mode.value].raw : inputs[mode.value].escaped),
  set: value => {
    if (direction.value === 'escape') inputs[mode.value].raw = value
    else inputs[mode.value].escaped = value
  },
})

const currentOutput = computed(() => outputs[mode.value][direction.value])

const inputLabel = computed(() =>
  direction.value === 'escape' ? t('tools.escapeTool.rawLabel') : t('tools.escapeTool.escapedLabel')
)
const outputLabel = computed(() =>
  direction.value === 'escape' ? t('tools.escapeTool.escapeOutput') : t('tools.escapeTool.unescapeOutput')
)

const currentModeMeta = computed(() => MODES.find(m => m.id === mode.value) || MODES[0])
const hintLine = computed(() => {
  if (mode.value === 'sql' && config.value.sqlBackslash) {
    return `${t('tools.escapeTool.sqlHint')} · ${t('tools.escapeTool.sqlBackslash')}`
  }
  return t(`tools.escapeTool.${currentModeMeta.value.hintKey}`)
})

/** 交换：把当前输出作为反方向的输入并切换方向 */
function swapDirection() {
  const out = outputs[mode.value][direction.value]
  if (out.error || !out.text) return
  if (direction.value === 'escape') {
    inputs[mode.value].escaped = out.text
    direction.value = 'unescape'
  } else {
    inputs[mode.value].raw = out.text
    direction.value = 'escape'
  }
  convertAll() // 立即刷新，避免等待防抖
  toast.info(t('tools.escapeTool.swap'))
}

function clearCurrent() {
  if (direction.value === 'escape') {
    inputs[mode.value].raw = ''
    outputs[mode.value].escape = { text: '', error: '' }
  } else {
    inputs[mode.value].escaped = ''
    outputs[mode.value].unescape = { text: '', error: '' }
  }
}
</script>

<template>
  <ToolPage tool-id="escapeTool">
    <!-- 模式与方向 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-medium text-slate-500 mr-1">{{ t('toolsCommon.options') }}</span>
          <button
            v-for="m in MODES"
            :key="m.id"
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': mode === m.id }"
            :aria-pressed="mode === m.id"
            :aria-label="t(`tools.escapeTool.${m.labelKey}`)"
            @click="mode = m.id"
          >
            {{ t(`tools.escapeTool.${m.labelKey}`) }}
          </button>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xs font-medium text-slate-500 mr-1">{{ t('tools.escapeTool.direction') }}</span>
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': direction === 'escape' }"
            :aria-pressed="direction === 'escape'"
            @click="direction = 'escape'"
          >
            {{ t('tools.escapeTool.dirEscape') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': direction === 'unescape' }"
            :aria-pressed="direction === 'unescape'"
            @click="direction = 'unescape'"
          >
            {{ t('tools.escapeTool.dirUnescape') }}
          </button>
          <button
            type="button"
            class="btn-primary !px-3 !py-1.5 !text-sm"
            :aria-label="t('tools.escapeTool.swap')"
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
              <path d="M3 5V4a2 2 0 0 1 2-2h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 19v1a2 2 0 0 1-2 2H5" />
            </svg>
            {{ t('tools.escapeTool.swap') }}
          </button>
        </div>
      </div>

      <p class="mt-3 text-xs text-slate-400 leading-relaxed">{{ hintLine }}</p>

      <div v-if="mode === 'sql'" class="mt-3 flex items-center gap-2">
        <input
          id="sql-backslash-toggle"
          v-model="config.sqlBackslash"
          type="checkbox"
          class="w-4 h-4 accent-blue-600"
        />
        <label for="sql-backslash-toggle" class="text-sm text-slate-600 select-none cursor-pointer">
          {{ t('tools.escapeTool.sqlBackslash') }}
        </label>
      </div>
    </section>

    <!-- 输入 / 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <!-- 输入 -->
        <div class="min-w-0">
          <div class="flex items-center justify-between mb-1.5">
            <label class="label-base mb-0" for="escape-input">{{ inputLabel }}</label>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-slate-400">
                {{ t('toolsCommon.chars') }} {{ currentInput.length }}
              </span>
              <button
                type="button"
                class="btn-danger !py-1"
                :disabled="!currentInput"
                :aria-label="t('toolsCommon.clear')"
                @click="clearCurrent"
              >
                {{ t('toolsCommon.clear') }}
              </button>
            </div>
          </div>
          <textarea
            id="escape-input"
            v-model="currentInput"
            rows="8"
            class="input-base w-full font-mono"
            :placeholder="t('toolsCommon.input')"
            :aria-label="inputLabel"
            spellcheck="false"
          ></textarea>
        </div>

        <!-- 输出 -->
        <div class="min-w-0">
          <div class="flex items-center justify-between mb-1.5">
            <span class="label-base mb-0">{{ outputLabel }}</span>
            <CopyButton
              compact
              :text="currentOutput.text"
              :disabled="!currentOutput.text || !!currentOutput.error"
            />
          </div>
          <textarea
            readonly
            rows="8"
            :value="currentOutput.text"
            class="input-base w-full font-mono bg-slate-50/80"
            :aria-label="outputLabel"
          ></textarea>
          <p v-if="currentOutput.error" class="mt-2 text-red-600 text-sm">{{ currentOutput.error }}</p>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
