<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { escapeHtml } from '@/utils/html'

const { t } = useI18n()
const toast = useToast()

/** 输入持久化（按工具需求） */
const store = useStorage('tool-jsonpath-tester', { json: '', path: '' })
const historyStore = useStorage('tool-jsonpath-history', [])

/** 安全读取层 */
const jsonText = computed({
  get: () => (typeof store.value.json === 'string' ? store.value.json : ''),
  set: v => {
    store.value.json = String(v ?? '')
  },
})
const pathText = computed({
  get: () => (typeof store.value.path === 'string' ? store.value.path : ''),
  set: v => {
    store.value.path = String(v ?? '')
  },
})

/**
 * 常用路径模板：表达式含 @、方括号等特殊字符，
 * 必须放在 JS 常量中，禁止写进语言包
 */
const PATH_TEMPLATES = [
  { path: '$.*', labelKey: 'templateAllProps' },
  { path: '$..name', labelKey: 'templateRecursiveName' },
  { path: '$.items[0]', labelKey: 'templateFirstItem' },
  { path: '$.items[-1:]', labelKey: 'templateLastItem' },
  { path: '$.items[0:2]', labelKey: 'templateSlice' },
  { path: '$..*[?(@.price<10)]', labelKey: 'templateFilter' },
]

/** 示例数据：与模板路径配合演示递归、切片、过滤 */
const SAMPLE_JSON = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99, isbn: '0-553-21311-3' },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
  items: [
    { id: 1, name: 'alpha', price: 5 },
    { id: 2, name: 'beta', price: 12 },
    { id: 3, name: 'gamma', price: 9.5 },
  ],
  name: 'demo-root',
}

/* ------------------------------------------------------------------ */
/* JSON 解析（防抖 400ms，失败行内报错）                                */
/* ------------------------------------------------------------------ */
const parsedState = ref({ status: 'empty', data: null, error: '' }) // empty | ok | error

function parseJsonNow() {
  const src = jsonText.value
  if (!src.trim()) {
    parsedState.value = { status: 'empty', data: null, error: '' }
    return
  }
  try {
    parsedState.value = { status: 'ok', data: JSON.parse(src), error: '' }
  } catch (err) {
    parsedState.value = {
      status: 'error',
      data: null,
      error: err && err.message ? err.message : String(err),
    }
  }
}

const debouncedParse = useDebounceFn(() => parseJsonNow(), 400)
watch(jsonText, () => debouncedParse())

function clearJson() {
  jsonText.value = ''
  parsedState.value = { status: 'empty', data: null, error: '' }
  queryState.value = { done: false, items: [], error: '' }
}

/* ------------------------------------------------------------------ */
/* JSONPath 查询（防抖 300ms，动态加载 jsonpath-plus，带竞态保护）       */
/* ------------------------------------------------------------------ */
const queryState = ref({ done: false, items: [], error: '' })
let queryToken = 0

async function runQuery() {
  const myToken = ++queryToken
  const expr = pathText.value.trim()
  const st = parsedState.value
  if (!expr || st.status !== 'ok') {
    queryState.value = { done: false, items: [], error: '' }
    return
  }
  try {
    const mod = await import('jsonpath-plus')
    const JSONPath =
      typeof mod.JSONPath === 'function'
        ? mod.JSONPath
        : mod.default && typeof mod.default.JSONPath === 'function'
          ? mod.default.JSONPath
          : null
    if (typeof JSONPath !== 'function') throw new Error('jsonpath-plus unavailable')
    const found = JSONPath({ path: expr, json: st.data, wrap: true })
    if (myToken !== queryToken) return
    const items = Array.isArray(found) ? found : [found]
    queryState.value = { done: true, items, error: '' }
    pushHistory(expr)
  } catch (err) {
    if (myToken !== queryToken) return
    queryState.value = {
      done: true,
      items: [],
      error: err && err.message ? err.message : String(err),
    }
  }
}

const debouncedQuery = useDebounceFn(() => runQuery(), 300)
watch([pathText, parsedState], () => debouncedQuery())

// 表达式出错时给出一次 Toast 提示（行内提示常驻）
watch(
  () => queryState.value.error,
  (val, old) => {
    if (val && !old) toast.error(t('toolsCommon.invalidInput'))
  }
)

/* ------------------------------------------------------------------ */
/* 查询历史（最近 10 条，去重，点击回填）                                */
/* ------------------------------------------------------------------ */
function pushHistory(expr) {
  const list = Array.isArray(historyStore.value) ? historyStore.value.filter(x => x !== expr) : []
  list.unshift(expr)
  historyStore.value = list.slice(0, 10)
}

const historyList = computed(() => (Array.isArray(historyStore.value) ? historyStore.value.slice(0, 10) : []))

function applyHistory(expr) {
  pathText.value = expr
  runQuery()
}

function clearHistory() {
  historyStore.value = []
  toast.success(t('toolsCommon.done'))
}

function applyTemplate(tpl) {
  pathText.value = tpl.path
  runQuery()
}

function applySample() {
  jsonText.value = JSON.stringify(SAMPLE_JSON, null, 2)
  parseJsonNow()
}

/* ------------------------------------------------------------------ */
/* 展示：命中值格式化 + 数据高亮                                        */
/* 高亮为字符串级简单处理：相同值会同时标记；对象/数组命中不做高亮        */
/* ------------------------------------------------------------------ */
const prettyJson = computed(() => {
  if (parsedState.value.status !== 'ok') return ''
  try {
    return JSON.stringify(parsedState.value.data, null, 2)
  } catch {
    return ''
  }
})

const highlightedHtml = computed(() => {
  const text = prettyJson.value
  if (!text) return ''
  let html = escapeHtml(text)
  if (queryState.value.done && !queryState.value.error) {
    const tokens = new Set()
    for (const item of queryState.value.items) {
      let tok = null
      if (item === null) tok = 'null'
      else if (typeof item === 'string') tok = JSON.stringify(item)
      else if (typeof item === 'number' || typeof item === 'boolean') tok = String(item)
      if (tok && tok.length >= 2) tokens.add(tok)
    }
    for (const tok of tokens) {
      const esc = escapeHtml(tok)
      if (esc) html = html.split(esc).join(`<mark class="jp-hl">${esc}</mark>`)
    }
  }
  return html
})

function displayValue(v) {
  if (v === null) return 'null'
  const ty = typeof v
  if (ty === 'string') return v
  if (ty === 'number' || ty === 'boolean') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function isStructured(v) {
  return v !== null && typeof v === 'object'
}

const resultCount = computed(() => (queryState.value.done && !queryState.value.error ? queryState.value.items.length : 0))

const allResultText = computed(() => {
  if (!resultCount.value) return ''
  try {
    return JSON.stringify(queryState.value.items, null, 2)
  } catch {
    return ''
  }
})

const statusHint = computed(() => {
  if (parsedState.value.status === 'error') return ''
  if (parsedState.value.status === 'empty') return t('tools.jsonPathTester.emptyJsonHint')
  if (!pathText.value.trim()) return t('tools.jsonPathTester.emptyPathHint')
  return ''
})

/* 初始化：恢复持久化输入后立即解析并执行一次查询 */
parseJsonNow()
runQuery()
</script>

<template>
  <ToolPage tool-id="jsonPathTester">
    <!-- 数据输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <label class="label-base mb-0" for="jp-json">{{ t('tools.jsonPathTester.jsonData') }}</label>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-ghost" @click="applySample">{{ t('tools.jsonPathTester.sample') }}</button>
          <button type="button" class="btn-ghost" :disabled="!jsonText" @click="clearJson">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="jp-json"
        v-model="jsonText"
        rows="8"
        spellcheck="false"
        autocomplete="off"
        class="input-base w-full font-mono"
        :class="parsedState.status === 'error' ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
        :placeholder="t('tools.jsonPathTester.jsonPlaceholder')"
        :aria-invalid="parsedState.status === 'error' ? 'true' : 'false'"
        :aria-label="t('tools.jsonPathTester.jsonData')"
      ></textarea>
      <p v-if="parsedState.status === 'error'" class="mt-2 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.jsonPathTester.jsonInvalid') }}: {{ parsedState.error }}
      </p>
    </section>

    <!-- 表达式输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="jp-path">{{ t('tools.jsonPathTester.expression') }}</label>
      <input
        id="jp-path"
        v-model="pathText"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="input-base font-mono"
        :class="queryState.error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
        :placeholder="t('tools.jsonPathTester.expressionPlaceholder')"
        :aria-invalid="queryState.error ? 'true' : 'false'"
        :aria-label="t('tools.jsonPathTester.expression')"
      />

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.jsonPathTester.templates') }}</span>
        <button
          v-for="tpl in PATH_TEMPLATES"
          :key="tpl.path"
          type="button"
          class="btn-ghost font-mono"
          @click="applyTemplate(tpl)"
        >
          {{ t(`tools.jsonPathTester.${tpl.labelKey}`) }}
        </button>
      </div>

      <!-- 查询历史 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.jsonPathTester.history') }}</span>
        <template v-if="historyList.length">
          <button
            v-for="h in historyList"
            :key="h"
            type="button"
            class="chip cursor-pointer font-mono max-w-full truncate"
            :title="h"
            @click="applyHistory(h)"
          >
            {{ h }}
          </button>
          <button type="button" class="btn-ghost" @click="clearHistory">{{ t('tools.jsonPathTester.clearHistory') }}</button>
        </template>
        <span v-else class="text-sm text-slate-400">{{ t('tools.jsonPathTester.historyEmpty') }}</span>
      </div>
    </section>

    <!-- 查询结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.jsonPathTester.results') }}</h2>
        <span v-if="queryState.done && !queryState.error" class="chip font-mono">
          {{ t('tools.jsonPathTester.hitCount', { n: resultCount }) }}
        </span>
      </div>

      <p v-if="queryState.error" class="mb-3 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.jsonPathTester.queryError') }}: {{ queryState.error }}
      </p>
      <p v-else-if="statusHint" class="text-sm text-slate-400">{{ statusHint }}</p>
      <p v-else-if="!resultCount" class="text-sm text-slate-400">{{ t('tools.jsonPathTester.noHits') }}</p>

      <template v-if="resultCount">
        <ol class="space-y-2">
          <li
            v-for="(item, i) in queryState.items"
            :key="i"
            class="rounded-xl border border-slate-100 bg-white/70 p-3"
          >
            <div class="flex items-center gap-2">
              <span class="chip shrink-0 font-mono">{{ i + 1 }}</span>
              <code v-if="!isStructured(item)" class="min-w-0 flex-1 font-mono text-sm text-slate-800 break-all">
                {{ displayValue(item) }}
              </code>
              <span v-else class="text-xs text-slate-400">{{ t('tools.jsonPathTester.structuredValue') }}</span>
              <CopyButton compact :text="typeof item === 'string' ? item : JSON.stringify(item)" />
            </div>
            <pre
              v-if="isStructured(item)"
              class="mt-2 rounded-lg border border-slate-100 bg-white/80 p-2 font-mono text-xs text-slate-800 whitespace-pre-wrap break-all max-h-48 overflow-y-auto"
            >{{ displayValue(item) }}</pre>
          </li>
        </ol>
        <div class="mt-3">
          <CopyButton :text="allResultText" :label="t('toolsCommon.copyAll')" />
        </div>
      </template>
    </section>

    <!-- 数据高亮 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.jsonPathTester.highlightTitle') }}</h2>
      <div
        v-if="prettyJson"
        class="jp-preview rounded-xl border border-slate-200 bg-white/80 p-3 font-mono text-sm text-slate-800"
        v-html="highlightedHtml"
      ></div>
      <p v-else class="text-sm text-slate-400">{{ t('tools.jsonPathTester.emptyJsonHint') }}</p>
      <p v-if="prettyJson" class="mt-2 text-xs text-slate-400">{{ t('tools.jsonPathTester.highlightNote') }}</p>
    </section>
  </ToolPage>
</template>

<style scoped>
.jp-preview {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow-y: auto;
}

.jp-preview :deep(mark.jp-hl) {
  background-color: #fde047;
  color: #854d0e;
  border-radius: 3px;
  padding: 0 1px;
}
</style>
