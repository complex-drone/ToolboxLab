<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { escapeHtml } from '@/utils/html'
import { clampInt } from '@/utils/number'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

// ---------------------------------------------------------------------------
// 模块定义：src 为正则源文本，含 | ( ) 等字面量，禁止写入语言包
// ---------------------------------------------------------------------------
const CHAR_MODULES = [
  { key: 'tokenDigit', kind: 'token', src: '\\d' },
  { key: 'tokenAlpha', kind: 'class', src: '[a-zA-Z]' },
  { key: 'tokenWord', kind: 'token', src: '\\w' },
  { key: 'tokenSpace', kind: 'token', src: '\\s' },
  { key: 'tokenDot', kind: 'token', src: '.' },
]
const ANCHOR_MODULES = [
  { key: 'tokenStart', kind: 'anchor', src: '^' },
  { key: 'tokenEnd', kind: 'anchor', src: '$' },
]
const QUANT_MODULES = [
  { key: 'quantStar', kind: 'quant', src: '*' },
  { key: 'quantPlus', kind: 'quant', src: '+' },
  { key: 'quantOpt', kind: 'quant', src: '?' },
]
const STRUCT_MODULES = [
  { key: 'groupOpen', kind: 'open', src: '(' },
  { key: 'groupClose', kind: 'close', src: ')' },
  { key: 'tokenAlt', kind: 'alt', src: '|' },
]

/** 预设模板：一键填充多个片段 */
const PRESETS = [
  {
    key: 'Email',
    frags: [
      { kind: 'class', src: '[A-Za-z0-9._%+-]' },
      { kind: 'quant', src: '+' },
      { kind: 'raw', src: '@', raw: '@' },
      { kind: 'class', src: '[A-Za-z0-9.-]' },
      { kind: 'quant', src: '+' },
      { kind: 'raw', src: '\\.', raw: '.' },
      { kind: 'class', src: '[A-Za-z]' },
      { kind: 'quant', src: '{2,}' },
    ],
  },
  {
    key: 'Phone',
    frags: [
      { kind: 'raw', src: '1', raw: '1' },
      { kind: 'class', src: '[3-9]' },
      { kind: 'token', src: '\\d' },
      { kind: 'quant', src: '{9}' },
    ],
  },
  {
    key: 'Url',
    frags: [
      { kind: 'raw', src: 'http', raw: 'http' },
      { kind: 'raw', src: 's', raw: 's' },
      { kind: 'quant', src: '?' },
      { kind: 'raw', src: '://', raw: '://' },
      { kind: 'class', src: '[^\\s/]' },
      { kind: 'quant', src: '+' },
    ],
  },
]

const KIND_STYLES = {
  token: 'border-blue-200 bg-blue-50 text-blue-700',
  anchor: 'border-amber-200 bg-amber-50 text-amber-700',
  quant: 'border-violet-200 bg-violet-50 text-violet-700',
  raw: 'border-slate-200 bg-white text-slate-700',
  class: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  open: 'border-pink-200 bg-pink-50 text-pink-700',
  close: 'border-pink-200 bg-pink-50 text-pink-700',
  alt: 'border-cyan-200 bg-cyan-50 text-cyan-700',
}
const KIND_LABELS = {
  token: 'typeToken',
  anchor: 'typeAnchor',
  quant: 'typeQuant',
  raw: 'typeRaw',
  class: 'typeClass',
  open: 'typeGroup',
  close: 'typeGroup',
  alt: 'typeAlt',
}

const KINDS = Object.keys(KIND_LABELS)
const MAX_FRAGMENTS = 120
const MAX_UNDO = 100
const MAX_RAW_LEN = 200
const MAX_CLASS_LEN = 100
const MAX_MATCHES = 1000

/** 原样文本转义：正则特殊字符统一加反斜杠 */
function escapeRegExpSource(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// 构建序列（片段数组持久化）
// ---------------------------------------------------------------------------
const config = useStorage('tool-regex-builder-config', {
  fragments: [],
})

let uidCounter = 0

/** 存储数据安全层：任何被破坏的持久化内容都在这里被过滤 */
function normalizeFragments(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    if (!KINDS.includes(item.kind)) continue
    if (typeof item.src !== 'string' || !item.src || item.src.length > 200) continue
    out.push({
      id: ++uidCounter,
      kind: item.kind,
      src: item.src,
      raw: typeof item.raw === 'string' ? item.raw : '',
    })
  }
  if (out.length > MAX_FRAGMENTS) out.length = MAX_FRAGMENTS
  return out
}

const fragments = ref(normalizeFragments(config.value.fragments))
const undoStack = ref([])
const inlineError = ref('')

watch(
  fragments,
  value => {
    config.value.fragments = value.map(f =>
      f.raw ? { kind: f.kind, src: f.src, raw: f.raw } : { kind: f.kind, src: f.src }
    )
  },
  { deep: true }
)

function pushUndo() {
  undoStack.value.push(fragments.value.map(f => ({ ...f })))
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
}

/** 组合合法性校验：量词必须有可量化对象等 */
function validateAppend(kind) {
  const list = fragments.value
  const last = list.length ? list[list.length - 1] : null
  if (kind === 'quant') {
    if (!last || last.kind === 'quant' || last.kind === 'anchor' || last.kind === 'open' || last.kind === 'alt') {
      return 'errQuantNoTarget'
    }
    return ''
  }
  if (kind === 'alt') {
    if (!last || last.kind === 'alt') return 'errAltNoTarget'
    return ''
  }
  if (kind === 'close') {
    const opens = list.filter(f => f.kind === 'open').length
    const closes = list.filter(f => f.kind === 'close').length
    if (opens <= closes) return 'errParenClose'
    return ''
  }
  return ''
}

/** 追加片段，返回是否成功 */
function pushFragment(kind, src, raw) {
  if (fragments.value.length >= MAX_FRAGMENTS) {
    toast.error(t('tools.regexBuilder.limitReached'))
    return false
  }
  const errKey = validateAppend(kind)
  if (errKey) {
    inlineError.value = errKey
    toast.error(t('toolsCommon.invalidInput'))
    return false
  }
  pushUndo()
  fragments.value.push({ id: ++uidCounter, kind, src, raw: raw || '' })
  inlineError.value = ''
  return true
}

function addModule(mod) {
  pushFragment(mod.kind, mod.src)
}

function removeFragment(id) {
  const idx = fragments.value.findIndex(f => f.id === id)
  if (idx === -1) return
  pushUndo()
  fragments.value.splice(idx, 1)
  inlineError.value = ''
}

function undo() {
  if (!undoStack.value.length) {
    toast.info(t('tools.regexBuilder.nothingToUndo'))
    return
  }
  fragments.value = undoStack.value.pop()
  inlineError.value = ''
}

function clearAll() {
  if (!fragments.value.length) return
  pushUndo()
  fragments.value = []
  inlineError.value = ''
}

function applyPreset(preset) {
  if (!preset || !Array.isArray(preset.frags)) return
  pushUndo()
  fragments.value = preset.frags
    .filter(f => KINDS.includes(f.kind) && typeof f.src === 'string')
    .map(f => ({ id: ++uidCounter, kind: f.kind, src: f.src, raw: f.raw || '' }))
  inlineError.value = ''
}

// ---------------------------------------------------------------------------
// 行内小表单：量词 {n,m} / 原样文本 / 字符类（不用 prompt）
// ---------------------------------------------------------------------------
const activeForm = ref('') // '' | 'quant' | 'raw' | 'class'
const quantMin = ref('3')
const quantMax = ref('5')
const quantOpen = ref(false)
const rawInput = ref('')
const classInput = ref('')

function openForm(name) {
  activeForm.value = activeForm.value === name ? '' : name
  inlineError.value = ''
}

function cancelForm() {
  activeForm.value = ''
  inlineError.value = ''
}

function applyQuantForm() {
  const min = clampInt(quantMin.value, 0, 999, 0)
  let src
  if (quantOpen.value) {
    src = '{' + min + ',}'
  } else {
    const max = clampInt(quantMax.value, 0, 999, min)
    if (max < min) {
      inlineError.value = 'errQuantRange'
      toast.error(t('toolsCommon.invalidInput'))
      return
    }
    src = min === max ? '{' + min + '}' : '{' + min + ',' + max + '}'
  }
  if (pushFragment('quant', src)) {
    cancelForm()
  }
}

function applyRawForm() {
  const text = rawInput.value
  if (!text) return
  const clipped = text.length > MAX_RAW_LEN ? text.slice(0, MAX_RAW_LEN) : text
  if (pushFragment('raw', escapeRegExpSource(clipped), clipped)) {
    rawInput.value = ''
    cancelForm()
  }
}

function applyClassForm() {
  const inner = classInput.value.trim()
  if (!inner) return
  const clipped = inner.length > MAX_CLASS_LEN ? inner.slice(0, MAX_CLASS_LEN) : inner
  const src = '[' + clipped + ']'
  try {
    new RegExp(src)
  } catch {
    inlineError.value = 'errBadClass'
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  if (pushFragment('class', src)) {
    classInput.value = ''
    cancelForm()
  }
}

// ---------------------------------------------------------------------------
// 生成的正则与合法性检查
// ---------------------------------------------------------------------------
const regexState = computed(() => {
  const source = fragments.value.map(f => f.src).join('')
  if (!source) return { source: '', error: '', empty: true }
  try {
    new RegExp(source)
    return { source, error: '', empty: false }
  } catch (err) {
    return { source, error: err && err.message ? String(err.message) : 'Invalid RegExp', empty: false }
  }
})

// ---------------------------------------------------------------------------
// 内置测试区：实时高亮匹配（escapeHtml + mark 安全模式）
// ---------------------------------------------------------------------------
const testText = ref('')
const debouncedTestText = ref('')
const scheduleTestText = useDebounceFn(() => {
  debouncedTestText.value = testText.value
}, 300)
watch(testText, () => scheduleTestText())

const testState = computed(() => {
  const input = debouncedTestText.value
  const source = regexState.value.source
  if (!source || regexState.value.error) {
    return { error: regexState.value.error, empty: !source, matches: [] }
  }
  let re
  try {
    re = new RegExp(source, 'g')
  } catch (err) {
    return { error: err && err.message ? String(err.message) : 'Invalid RegExp', empty: false, matches: [] }
  }
  const matches = []
  try {
    let m
    while ((m = re.exec(input)) !== null) {
      matches.push(m)
      // 空匹配时手动前进，避免死循环
      if (m[0].length === 0) re.lastIndex += 1
      if (matches.length >= MAX_MATCHES) break
    }
  } catch (err) {
    return { error: err && err.message ? String(err.message) : 'Match failed', empty: false, matches: [] }
  } finally {
    re.lastIndex = 0
  }
  return { error: '', empty: false, matches }
})

/** 高亮 HTML：先整体转义，再为匹配片段包上 mark 标签，防 XSS */
const highlightedHtml = computed(() => {
  const input = debouncedTestText.value
  if (!input) return ''
  const state = testState.value
  if (state.error || state.empty || state.matches.length === 0) {
    return escapeHtml(input)
  }
  let html = ''
  let last = 0
  for (const m of state.matches) {
    const start = m.index
    const end = start + m[0].length
    if (start < last) continue
    html += escapeHtml(input.slice(last, start))
    if (m[0].length === 0) {
      html += '<mark class="rb-hl rb-hl-empty"></mark>'
    } else {
      html += `<mark class="rb-hl">${escapeHtml(input.slice(start, end))}</mark>`
    }
    last = Math.max(last, end)
  }
  html += escapeHtml(input.slice(last))
  return html
})
</script>

<template>
  <ToolPage tool-id="regexBuilder">
    <!-- 模块面板 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('tools.regexBuilder.paletteChars') }}</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="m in CHAR_MODULES"
          :key="m.key"
          type="button"
          class="btn-ghost"
          @click="addModule(m)"
        >
          {{ t(`tools.regexBuilder.${m.key}`) }}
          <code class="font-mono text-xs text-blue-500">{{ m.src }}</code>
        </button>
      </div>

      <div class="section-title mt-4">{{ t('tools.regexBuilder.paletteAnchors') }}</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="m in ANCHOR_MODULES"
          :key="m.key"
          type="button"
          class="btn-ghost"
          @click="addModule(m)"
        >
          {{ t(`tools.regexBuilder.${m.key}`) }}
          <code class="font-mono text-xs text-amber-500">{{ m.src }}</code>
        </button>
      </div>

      <div class="section-title mt-4">{{ t('tools.regexBuilder.paletteQuant') }}</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="m in QUANT_MODULES"
          :key="m.key"
          type="button"
          class="btn-ghost"
          @click="addModule(m)"
        >
          {{ t(`tools.regexBuilder.${m.key}`) }}
          <code class="font-mono text-xs text-violet-500">{{ m.src }}</code>
        </button>
        <button type="button" class="btn-ghost" @click="openForm('quant')">
          {{ t('tools.regexBuilder.quantRange') }}
          <code class="font-mono text-xs text-violet-500">{n,m}</code>
        </button>
      </div>

      <!-- 量词 {n,m} 行内表单 -->
      <div v-if="activeForm === 'quant'" class="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label-base mb-1" for="quant-min">{{ t('tools.regexBuilder.quantMin') }}</label>
            <input id="quant-min" v-model="quantMin" type="number" min="0" max="999" class="input-base w-24" />
          </div>
          <div v-if="!quantOpen">
            <label class="label-base mb-1" for="quant-max">{{ t('tools.regexBuilder.quantMax') }}</label>
            <input id="quant-max" v-model="quantMax" type="number" min="0" max="999" class="input-base w-24" />
          </div>
          <label class="chip cursor-pointer select-none pb-2" :class="{ 'opacity-50': quantOpen }">
            <input v-model="quantOpen" type="checkbox" class="mr-1 accent-violet-600" />
            {{ t('tools.regexBuilder.quantOpenEnd') }}
          </label>
          <div class="flex gap-2 pb-0.5">
            <button type="button" class="btn-primary" @click="applyQuantForm">
              {{ t('tools.regexBuilder.insert') }}
            </button>
            <button type="button" class="btn-ghost" @click="cancelForm">
              {{ t('tools.regexBuilder.cancel') }}
            </button>
          </div>
        </div>
        <p v-if="inlineError === 'errQuantRange'" class="mt-2 text-xs text-red-600" role="alert">
          {{ t('tools.regexBuilder.errQuantRange') }}
        </p>
      </div>

      <div class="section-title mt-4">{{ t('tools.regexBuilder.paletteStruct') }}</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="m in STRUCT_MODULES"
          :key="m.key"
          type="button"
          class="btn-ghost"
          @click="addModule(m)"
        >
          {{ t(`tools.regexBuilder.${m.key}`) }}
          <code class="font-mono text-xs text-pink-500">{{ m.src }}</code>
        </button>
        <button type="button" class="btn-ghost" @click="openForm('raw')">
          {{ t('tools.regexBuilder.rawModule') }}
        </button>
        <button type="button" class="btn-ghost" @click="openForm('class')">
          {{ t('tools.regexBuilder.classModule') }}
        </button>
      </div>

      <!-- 原样文本行内表单 -->
      <div v-if="activeForm === 'raw'" class="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3">
        <label class="label-base" for="raw-input">{{ t('tools.regexBuilder.rawModule') }}</label>
        <div class="flex flex-wrap items-center gap-2">
          <input
            id="raw-input"
            v-model="rawInput"
            type="text"
            spellcheck="false"
            class="input-base flex-1 min-w-40"
            :placeholder="t('tools.regexBuilder.rawPlaceholder')"
            @keyup.enter="applyRawForm"
          />
          <button type="button" class="btn-primary" @click="applyRawForm">
            {{ t('tools.regexBuilder.insert') }}
          </button>
          <button type="button" class="btn-ghost" @click="cancelForm">
            {{ t('tools.regexBuilder.cancel') }}
          </button>
        </div>
        <p class="mt-1.5 text-xs text-slate-400">{{ t('tools.regexBuilder.rawEscapedHint') }}</p>
      </div>

      <!-- 字符类行内表单 -->
      <div v-if="activeForm === 'class'" class="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
        <label class="label-base" for="class-input">{{ t('tools.regexBuilder.classModule') }}</label>
        <div class="flex flex-wrap items-center gap-2">
          <code class="font-mono text-emerald-600">[</code>
          <input
            id="class-input"
            v-model="classInput"
            type="text"
            spellcheck="false"
            class="input-base flex-1 min-w-40 font-mono"
            :placeholder="t('tools.regexBuilder.classPlaceholder')"
            @keyup.enter="applyClassForm"
          />
          <code class="font-mono text-emerald-600">]</code>
          <button type="button" class="btn-primary" @click="applyClassForm">
            {{ t('tools.regexBuilder.insert') }}
          </button>
          <button type="button" class="btn-ghost" @click="cancelForm">
            {{ t('tools.regexBuilder.cancel') }}
          </button>
        </div>
      </div>

      <!-- 预设模板 -->
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.regexBuilder.presets') }}</span>
        <button
          v-for="p in PRESETS"
          :key="p.key"
          type="button"
          class="btn-ghost"
          @click="applyPreset(p)"
        >
          {{ t(`tools.regexBuilder.preset${p.key}`) }}
        </button>
      </div>
    </section>

    <!-- 构建序列 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.regexBuilder.sequenceTitle') }}</h2>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!undoStack.length"
            @click="undo"
          >
            {{ t('tools.regexBuilder.undo') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!fragments.length"
            @click="clearAll"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>

      <p v-if="!fragments.length" class="py-6 text-center text-sm text-slate-400">
        {{ t('tools.regexBuilder.sequenceEmptyHint') }}
      </p>
      <div v-else class="flex flex-wrap gap-2">
        <span
          v-for="f in fragments"
          :key="f.id"
          class="chip gap-1 py-1 border"
          :class="KIND_STYLES[f.kind] || KIND_STYLES.token"
          :title="t(`tools.regexBuilder.${KIND_LABELS[f.kind] || 'typeToken'}`)"
        >
          <code class="font-mono break-all max-w-60">{{ f.kind === 'raw' && f.raw ? f.raw : f.src }}</code>
          <button
            type="button"
            class="ml-0.5 rounded-full w-4 h-4 leading-none text-xs hover:bg-black/10"
            :aria-label="t('toolsCommon.clear')"
            @click="removeFragment(f.id)"
          >
            ×
          </button>
        </span>
      </div>

      <p v-if="inlineError && inlineError !== 'errQuantRange'" class="mt-3 text-red-600 text-sm" role="alert">
        {{ t(`tools.regexBuilder.${inlineError}`) }}
      </p>

      <!-- 生成的正则 -->
      <div class="section-title mt-5">{{ t('tools.regexBuilder.generatedTitle') }}</div>
      <div class="flex flex-wrap items-stretch gap-2">
        <code
          class="flex-1 min-w-0 rounded-xl border px-3 py-2 font-mono text-sm break-all"
          :class="regexState.error ? 'border-red-200 bg-red-50/70 text-red-600' : 'border-slate-200 bg-white/80 text-slate-800'"
        >
          {{ regexState.source || '…' }}
        </code>
        <CopyButton :text="regexState.source" :disabled="!regexState.source" />
      </div>
      <p v-if="regexState.error" class="mt-2 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.regexBuilder.invalidRegex') }}
        <span class="text-red-400">（{{ regexState.error }}）</span>
      </p>
    </section>

    <!-- 内置测试区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.regexBuilder.testTitle') }}</h2>
        <span
          v-if="!testState.empty && !testState.error && debouncedTestText"
          class="chip font-mono"
        >
          {{ t('tools.regexBuilder.matchCount', { n: testState.matches.length }) }}
        </span>
      </div>

      <label class="label-base" for="builder-test-text">{{ t('tools.regexBuilder.testText') }}</label>
      <textarea
        id="builder-test-text"
        v-model="testText"
        rows="4"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.regexBuilder.testPlaceholder')"
        :aria-label="t('tools.regexBuilder.testText')"
      ></textarea>

      <div class="section-title mt-4">{{ t('tools.regexBuilder.highlightTitle') }}</div>
      <!-- v-html 内容已全部经过 escapeHtml 转义 -->
      <div
        v-if="debouncedTestText"
        class="rb-preview rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-800"
        v-html="highlightedHtml"
      ></div>
      <p v-else class="text-sm text-slate-400">{{ t('tools.regexBuilder.emptyTextHint') }}</p>
      <p v-if="debouncedTestText && !testState.error && !testState.matches.length" class="mt-2 text-sm text-slate-400">
        {{ t('tools.regexBuilder.noMatches') }}
      </p>
    </section>
  </ToolPage>
</template>

<style scoped>
.rb-preview {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
}

.rb-preview :deep(mark.rb-hl) {
  background-color: #fde047;
  color: #854d0e;
  border-radius: 3px;
  padding: 0 1px;
}

.rb-preview :deep(mark.rb-hl-empty) {
  display: inline-block;
  width: 3px;
  height: 1em;
  padding: 0;
  vertical-align: text-bottom;
}
</style>
