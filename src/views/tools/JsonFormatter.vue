<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { byteLength, formatBytes } from '@/utils/format'
import { downloadText } from '@/utils/download'

const { t } = useI18n()
const toast = useToast()

/** 示例数据（含花括号，放在 JS 常量中） */
const SAMPLE_JSON =
  '{\n  "name": "ToolboxLab",\n  "version": 2,\n  "features": ["format", "minify", "validate"],\n  "meta": { "offline": true, "rating": 4.5, "tags": ["json", "dev"] }\n}'

/** 持久化配置：缩进方式（2 空格 / 4 空格 / Tab） */
const config = useStorage('tool-json-formatter-config', { indent: '2' })

const rawInput = ref('')
const debouncedInput = ref('')
const resultMode = ref('pretty')

/** 大文本防抖实时处理（300ms） */
const updateDebounced = useDebounceFn(() => {
  debouncedInput.value = rawInput.value
}, 300)
watch(rawInput, () => updateDebounced())

const indentOptions = computed(() => [
  { value: '2', label: t('tools.jsonFormatter.indent2') },
  { value: '4', label: t('tools.jsonFormatter.indent4') },
  { value: 'tab', label: t('tools.jsonFormatter.indentTab') },
])

function indentString() {
  if (config.value.indent === 'tab') return '\t'
  if (config.value.indent === '4') return '    '
  return '  '
}

/**
 * 从 JSON.parse 的错误消息中提取出错位置
 * 兼容 V8「position N」与 Firefox「line L column C」两种格式
 */
function locateJsonError(text, err) {
  const message = err && err.message ? err.message : String(err || '')
  const lineCol = /line\s+(\d+)\s+.*?column\s+(\d+)/i.exec(message)
  if (lineCol) {
    return { line: Number(lineCol[1]), col: Number(lineCol[2]), message, lineText: '' }
  }
  const posMatch = /position\s+(\d+)/i.exec(message)
  if (posMatch) {
    const pos = Math.min(Number(posMatch[1]), Math.max(text.length - 1, 0))
    let line = 1
    let col = 1
    let lineStart = 0
    for (let i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) {
        line++
        col = 1
        lineStart = i + 1
      } else {
        col++
      }
    }
    const lineEnd = text.indexOf('\n', lineStart)
    const lineText = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    return { line, col, message, lineText }
  }
  return { line: 0, col: 0, message, lineText: '' }
}

const parseState = computed(() => {
  const text = debouncedInput.value
  if (!text.trim()) return { status: 'empty' }
  try {
    return { status: 'ok', value: JSON.parse(text) }
  } catch (err) {
    return { status: 'error', error: locateJsonError(text, err) }
  }
})

const parseError = computed(() =>
  parseState.value.status === 'error' ? parseState.value.error : null
)

const prettyText = computed(() => {
  if (parseState.value.status !== 'ok') return ''
  try {
    return JSON.stringify(parseState.value.value, null, indentString())
  } catch {
    return ''
  }
})

const minifiedText = computed(() => {
  if (parseState.value.status !== 'ok') return ''
  try {
    return JSON.stringify(parseState.value.value)
  } catch {
    return ''
  }
})

const resultText = computed(() =>
  resultMode.value === 'minified' ? minifiedText.value : prettyText.value
)

const resultSizeLabel = computed(() =>
  resultText.value ? formatBytes(byteLength(resultText.value)) : ''
)

/** 递归统计节点数（对象 / 数组 / 原始值） */
function countNodes(value) {
  if (value === null || typeof value !== 'object') return 1
  let n = 1
  if (Array.isArray(value)) {
    for (const item of value) n += countNodes(item)
  } else {
    for (const key of Object.keys(value)) n += countNodes(value[key])
  }
  return n
}

const nodeCount = computed(() => {
  if (parseState.value.status !== 'ok') return 0
  try {
    return countNodes(parseState.value.value)
  } catch {
    return 0
  }
})

const inputLineCount = computed(() =>
  rawInput.value ? rawInput.value.split('\n').length : 0
)

/** 立即处理（跳过防抖），用于按钮触发 */
function forceProcess() {
  debouncedInput.value = rawInput.value
}

function applyFormat() {
  forceProcess()
  resultMode.value = 'pretty'
  if (parseState.value.status === 'error') {
    toast.error(t('toolsCommon.invalidInput'))
  }
}

function applyMinify() {
  forceProcess()
  resultMode.value = 'minified'
  if (parseState.value.status === 'error') {
    toast.error(t('toolsCommon.invalidInput'))
  }
}

function fillExample() {
  rawInput.value = SAMPLE_JSON
  forceProcess()
}

function clearInput() {
  rawInput.value = ''
  forceProcess()
}

function downloadResult() {
  if (!resultText.value) return
  try {
    const filename =
      resultMode.value === 'minified' ? 'minified.json' : 'formatted.json'
    downloadText(resultText.value, filename, 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function chipClass(active) {
  return active
    ? 'chip chip-toggle cursor-pointer select-none'
    : 'chip-toggle inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/70 text-slate-500 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer select-none'
}
</script>

<template>
  <ToolPage tool-id="jsonFormatter">
    <!-- 输入 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 class="section-title mb-0">{{ t('toolsCommon.input') }}</h2>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" @click="fillExample">
            {{ t('toolsCommon.example') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!rawInput"
            @click="clearInput"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="rawInput"
        class="input-base w-full font-mono"
        rows="8"
        spellcheck="false"
        :placeholder="t('tools.jsonFormatter.placeholder')"
        :aria-label="t('tools.jsonFormatter.inputLabel')"
      ></textarea>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
        <span>{{ t('toolsCommon.chars') }} {{ rawInput.length }}</span>
        <span>{{ t('toolsCommon.lines') }} {{ inputLineCount }}</span>
      </div>

      <!-- 精准错误定位 -->
      <div
        v-if="parseError"
        class="mt-3 rounded-xl border border-red-100 bg-red-50/70 p-3"
      >
        <p class="text-red-600 text-sm font-semibold">
          {{
            parseError.line > 0
              ? t('tools.jsonFormatter.errorAt', {
                  line: parseError.line,
                  col: parseError.col,
                })
              : t('tools.jsonFormatter.errorTitle')
          }}
        </p>
        <p
          v-if="parseError.lineText"
          class="mt-1 font-mono text-xs text-red-500 break-all whitespace-pre-wrap"
        >
          {{ parseError.lineText }}
        </p>
        <p class="mt-1 text-xs text-red-500 break-all">{{ parseError.message }}</p>
      </div>
      <p
        v-else-if="parseState.status === 'ok'"
        class="mt-3 text-sm font-medium text-green-600"
      >
        ✓ {{ t('tools.jsonFormatter.validJson') }}
      </p>
    </div>

    <!-- 选项与操作 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-600">
          {{ t('tools.jsonFormatter.indent') }}
        </span>
        <button
          v-for="opt in indentOptions"
          :key="opt.value"
          type="button"
          :class="chipClass(config.indent === opt.value)"
          :aria-pressed="config.indent === opt.value"
          @click="config.indent = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          class="btn-primary"
          :disabled="!rawInput.trim()"
          @click="applyFormat"
        >
          {{ t('tools.jsonFormatter.format') }}
        </button>
        <button
          type="button"
          class="btn-ghost"
          :disabled="!rawInput.trim()"
          @click="applyMinify"
        >
          {{ t('tools.jsonFormatter.minify') }}
        </button>
      </div>
    </div>

    <!-- 结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 class="section-title mb-0">{{ t('toolsCommon.result') }}</h2>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            :class="chipClass(resultMode === 'pretty')"
            :aria-pressed="resultMode === 'pretty'"
            @click="resultMode = 'pretty'"
          >
            {{ t('tools.jsonFormatter.prettyResult') }}
          </button>
          <button
            type="button"
            :class="chipClass(resultMode === 'minified')"
            :aria-pressed="resultMode === 'minified'"
            @click="resultMode = 'minified'"
          >
            {{ t('tools.jsonFormatter.minifiedResult') }}
          </button>
        </div>
      </div>
      <textarea
        readonly
        :value="resultText"
        class="input-base w-full font-mono"
        rows="12"
        spellcheck="false"
        :placeholder="t('toolsCommon.none')"
        :aria-label="t('toolsCommon.result')"
      ></textarea>
      <div class="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span v-if="resultSizeLabel">
            {{ t('tools.jsonFormatter.sizeLabel') }}: {{ resultSizeLabel }}
          </span>
          <span v-if="parseState.status === 'ok'">
            {{ t('tools.jsonFormatter.nodeCount', { n: nodeCount }) }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <CopyButton
            :text="resultText"
            :label="t('toolsCommon.copyAll')"
            :disabled="!resultText"
          />
          <button
            type="button"
            class="btn-ghost"
            :disabled="!resultText"
            @click="downloadResult"
          >
            {{ t('toolsCommon.download') }}
          </button>
        </div>
      </div>
    </div>
  </ToolPage>
</template>
