<script setup>
import { computed, watch, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { escapeHtml } from '@/utils/html'

const { t } = useI18n()
const toast = useToast()

/** 模板与输入持久化 */
const store = useStorage('tool-xpath-tester', { source: '', xpath: '' })

const sourceText = computed({
  get: () => (typeof store.value.source === 'string' ? store.value.source : ''),
  set: v => {
    store.value.source = String(v ?? '')
  },
})
const xpathText = computed({
  get: () => (typeof store.value.xpath === 'string' ? store.value.xpath : ''),
  set: v => {
    store.value.xpath = String(v ?? '')
  },
})

/**
 * 常用表达式模板：含 @ 等语言包禁用字符，必须放在 JS 常量中
 */
const XPATH_TEMPLATES = [
  { expr: '//div', labelKey: 'templateDivs' },
  { expr: '//a/@href', labelKey: 'templateLinkHref' },
  { expr: '//img/@src', labelKey: 'templateImgSrc' },
  { expr: '//li[last()]', labelKey: 'templateLastLi' },
  { expr: '//h1/text()', labelKey: 'templateH1Text' },
  { expr: 'count(//p)', labelKey: 'templateCountP' },
]

const SAMPLE_HTML = [
  '<!DOCTYPE html>',
  '<html>',
  '<head>',
  '  <title>Demo Page</title>',
  '</head>',
  '<body>',
  '  <h1 class="page-title">Toolbox Demo</h1>',
  '  <div class="card" id="main">',
  '    <p>First paragraph with a link to <a href="https://example.com/a">Example A</a>.</p>',
  '    <p>Second paragraph for counting.</p>',
  '    <ul class="list">',
  '      <li>alpha</li>',
  '      <li>beta</li>',
  '      <li>gamma</li>',
  '    </ul>',
  '    <img src="/images/logo.png" alt="logo">',
  '  </div>',
  '  <div class="footer">',
  '    <p>Footer paragraph text.</p>',
  '  </div>',
  '</body>',
  '</html>',
].join('\n')

const MAX_NODES = 200
const MAX_SIGS = 40
const MAX_MARKS = 300

/** 文档类型嗅探：含 DOCTYPE html 或 html 标签按 HTML 解析，否则按 XML */
function sniffMime(src) {
  return /<!DOCTYPE\s+html|<html[\s>]/i.test(src) ? 'text/html' : 'application/xml'
}

const mimeMode = computed(() => sniffMime(sourceText.value))

function truncate(s, n) {
  const str = String(s ?? '')
  return str.length > n ? str.slice(0, n) + '…' : str
}

/* ------------------------------------------------------------------ */
/* XPath 查询（防抖 300ms，DOMParser + evaluate，同步执行）              */
/* ------------------------------------------------------------------ */
// 浅 ref：结果中保存原始 DOM 节点，避免被深度代理
const resultState = shallowRef({
  done: false,
  error: '',
  nodes: [], // 原始节点
  scalar: null, // string | number | boolean 标量结果
  scalarKind: '', // 'string' | 'number' | 'boolean'
  count: 0,
  truncated: false,
})

function resetResult() {
  resultState.value = { done: false, error: '', nodes: [], scalar: null, scalarKind: '', count: 0, truncated: false }
}

function runEvaluate() {
  const src = sourceText.value
  const expr = xpathText.value.trim()
  if (!src.trim() || !expr) {
    resetResult()
    return
  }
  const mime = sniffMime(src)
  try {
    const doc = new DOMParser().parseFromString(src, mime)
    if (mime === 'application/xml') {
      const perr = doc.getElementsByTagName('parsererror')
      if (perr.length > 0) {
        const msg = perr[0].textContent ? truncate(perr[0].textContent.replace(/\s+/g, ' ').trim(), 200) : ''
        resultState.value = { done: true, error: msg, nodes: [], scalar: null, scalarKind: '', count: 0, truncated: false }
        return
      }
    }
    const res = doc.evaluate(expr, doc, null, XPathResult.ANY_TYPE, null)
    if (
      res.resultType === XPathResult.STRING_TYPE ||
      res.resultType === XPathResult.NUMBER_TYPE ||
      res.resultType === XPathResult.BOOLEAN_TYPE
    ) {
      const value = res.resultType === XPathResult.STRING_TYPE ? res.stringValue : res.resultType === XPathResult.NUMBER_TYPE ? res.numberValue : res.booleanValue
      const kind = res.resultType === XPathResult.STRING_TYPE ? 'string' : res.resultType === XPathResult.NUMBER_TYPE ? 'number' : 'boolean'
      resultState.value = { done: true, error: '', nodes: [], scalar: value, scalarKind: kind, count: 1, truncated: false }
      return
    }
    const nodes = []
    let truncated = false
    let node
    while ((node = res.iterateNext()) !== null) {
      nodes.push(node)
      if (nodes.length >= MAX_NODES) {
        truncated = true
        break
      }
    }
    resultState.value = { done: true, error: '', nodes, scalar: null, scalarKind: '', count: nodes.length, truncated }
  } catch (err) {
    resultState.value = {
      done: true,
      error: err && err.message ? err.message : String(err),
      nodes: [],
      scalar: null,
      scalarKind: '',
      count: 0,
      truncated: false,
    }
  }
}

const debouncedEvaluate = useDebounceFn(() => runEvaluate(), 300)
watch([xpathText, sourceText], () => debouncedEvaluate())

// 表达式或文档出错时给出一次 Toast 提示（行内提示常驻）
watch(
  () => resultState.value.error,
  (val, old) => {
    if (val && !old) toast.error(t('toolsCommon.invalidInput'))
  }
)

/* ------------------------------------------------------------------ */
/* 节点展示：按节点类型分类                                             */
/* ------------------------------------------------------------------ */
function describeNode(node) {
  const nt = node.nodeType
  if (nt === 1) {
    let preview = ''
    try {
      preview = node.outerHTML || ''
    } catch {
      preview = ''
    }
    return { kind: 'kindElement', label: node.nodeName, preview: truncate(preview, 200) }
  }
  if (nt === 2) {
    const label = `${node.name}="${truncate(node.value, 120)}"`
    return { kind: 'kindAttr', label, preview: truncate(`${node.name}="${node.value}"`, 200) }
  }
  if (nt === 3) {
    return { kind: 'kindText', label: 'text()', preview: truncate((node.nodeValue || '').trim(), 200) }
  }
  if (nt === 4) {
    return { kind: 'kindCdata', label: 'CDATA', preview: truncate(node.nodeValue || '', 200) }
  }
  if (nt === 8) {
    return { kind: 'kindComment', label: 'comment()', preview: truncate(node.nodeValue || '', 200) }
  }
  return { kind: 'kindOther', label: `nodeType ${nt}`, preview: truncate(node.nodeValue ?? '', 200) }
}

const displayNodes = computed(() => resultState.value.nodes.map(n => describeNode(n)))

const scalarText = computed(() => {
  const st = resultState.value
  if (st.scalarKind === 'number') return String(st.scalar)
  if (st.scalarKind === 'boolean') return st.scalar ? 'true' : 'false'
  return String(st.scalar ?? '')
})

/* ------------------------------------------------------------------ */
/* 高亮：字符串级按「标签名 + 首个特征属性」匹配原文，同名特征全部标记     */
/* 局限：不追踪节点在原文中的精确位置，相同特征片段会同时高亮              */
/* ------------------------------------------------------------------ */
function signatureVariantsOf(node) {
  if (node.nodeType === 2) {
    const v = String(node.value ?? '')
    if (!v) return []
    return [`${node.name}="${v}"`, `${node.name}='${v}'`]
  }
  if (node.nodeType !== 1) return []
  const tag = String(node.nodeName || '').toLowerCase()
  const attrNames = ['id', 'class', 'href', 'src', 'name', 'type']
  for (const a of attrNames) {
    let v = null
    try {
      v = node.getAttribute(a)
    } catch {
      v = null
    }
    if (v) return [`${tag} ${a}="${v}"`, `${tag} ${a}='${v}'`]
  }
  return [`<${tag}`]
}

function collectRanges(text, variants) {
  const lower = text.toLowerCase()
  const ranges = []
  for (const v of variants) {
    const needle = v.toLowerCase()
    if (!needle) continue
    let idx = lower.indexOf(needle)
    while (idx !== -1 && ranges.length < MAX_MARKS) {
      ranges.push([idx, idx + needle.length])
      idx = lower.indexOf(needle, idx + needle.length)
    }
    if (ranges.length >= MAX_MARKS) break
  }
  return ranges
}

const highlightedHtml = computed(() => {
  const text = sourceText.value
  if (!text) return ''
  const st = resultState.value
  let html = escapeHtml(text)
  if (st.done && !st.error && st.nodes.length > 0) {
    const seen = new Set()
    const variants = []
    for (const node of st.nodes) {
      for (const sig of signatureVariantsOf(node)) {
        const key = sig.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        variants.push(sig)
        if (variants.length >= MAX_SIGS) break
      }
      if (variants.length >= MAX_SIGS) break
    }
    let ranges = []
    for (const v of variants) ranges = ranges.concat(collectRanges(text, [v]))
    // 合并重叠区间后重建 HTML
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const merged = []
    for (const r of ranges) {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1])
        continue
      }
      merged.push([r[0], r[1]])
    }
    let out = ''
    let pos = 0
    for (const [s, e] of merged) {
      if (s < pos) continue
      out += escapeHtml(text.slice(pos, s))
      out += `<mark class="xp-hl">${escapeHtml(text.slice(s, e))}</mark>`
      pos = e
    }
    out += escapeHtml(text.slice(pos))
    html = out
  }
  return html
})

/* ------------------------------------------------------------------ */
/* 操作                                                                */
/* ------------------------------------------------------------------ */
function applyTemplate(tpl) {
  xpathText.value = tpl.expr
  runEvaluate()
}

function applySample() {
  sourceText.value = SAMPLE_HTML
  runEvaluate()
}

function clearAll() {
  sourceText.value = ''
  xpathText.value = ''
  resetResult()
}

const statusHint = computed(() => {
  if (resultState.value.error) return ''
  if (!sourceText.value.trim()) return t('tools.xpathTester.emptySourceHint')
  if (!xpathText.value.trim()) return t('tools.xpathTester.emptyPathHint')
  return ''
})

/* 初始化：恢复持久化输入后立即执行一次查询 */
runEvaluate()
</script>

<template>
  <ToolPage tool-id="xpathTester">
    <!-- 文档输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <label class="label-base mb-0" for="xp-source">{{ t('tools.xpathTester.source') }}</label>
        <div class="flex items-center gap-2">
          <span class="chip">{{ mimeMode === 'text/html' ? t('tools.xpathTester.sourceTypeHtml') : t('tools.xpathTester.sourceTypeXml') }}</span>
          <button type="button" class="btn-ghost" @click="applySample">{{ t('tools.xpathTester.sample') }}</button>
          <button type="button" class="btn-ghost" :disabled="!sourceText && !xpathText" @click="clearAll">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="xp-source"
        v-model="sourceText"
        rows="9"
        spellcheck="false"
        autocomplete="off"
        class="input-base w-full font-mono"
        :placeholder="t('tools.xpathTester.sourcePlaceholder')"
        :aria-label="t('tools.xpathTester.source')"
      ></textarea>
    </section>

    <!-- 表达式输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="xp-expr">{{ t('tools.xpathTester.expression') }}</label>
      <input
        id="xp-expr"
        v-model="xpathText"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="input-base font-mono"
        :class="resultState.error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
        :placeholder="t('tools.xpathTester.expressionPlaceholder')"
        :aria-invalid="resultState.error ? 'true' : 'false'"
        :aria-label="t('tools.xpathTester.expression')"
      />

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.xpathTester.templates') }}</span>
        <button
          v-for="tpl in XPATH_TEMPLATES"
          :key="tpl.expr"
          type="button"
          class="btn-ghost font-mono"
          @click="applyTemplate(tpl)"
        >
          {{ t(`tools.xpathTester.${tpl.labelKey}`) }}
        </button>
      </div>

      <p v-if="resultState.error" class="mt-2 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.xpathTester.queryError') }}: {{ resultState.error }}
      </p>
    </section>

    <!-- 查询结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.xpathTester.results') }}</h2>
        <span v-if="resultState.done && !resultState.error" class="chip font-mono">
          {{ t('tools.xpathTester.hitCount', { n: resultState.count }) }}
        </span>
      </div>

      <p v-if="statusHint" class="text-sm text-slate-400">{{ statusHint }}</p>
      <p v-else-if="resultState.done && !resultState.error && resultState.count === 0" class="text-sm text-slate-400">
        {{ t('tools.xpathTester.noHits') }}
      </p>

      <!-- 标量结果：count() 等函数返回值 -->
      <div v-if="resultState.done && !resultState.error && resultState.scalarKind" class="rounded-xl border border-slate-100 bg-white/70 p-3">
        <div class="flex items-center gap-2">
          <span class="chip shrink-0">{{ t('tools.xpathTester.scalarResult') }}</span>
          <code class="min-w-0 flex-1 font-mono text-sm text-slate-800 break-all">{{ scalarText }}</code>
          <CopyButton compact :text="scalarText" />
        </div>
      </div>

      <ol v-else-if="displayNodes.length" class="space-y-2">
        <li
          v-for="(item, i) in displayNodes"
          :key="i"
          class="rounded-xl border border-slate-100 bg-white/70 p-3"
        >
          <div class="flex items-center gap-2">
            <span class="chip shrink-0">{{ t(`tools.xpathTester.${item.kind}`) }}</span>
            <code class="min-w-0 flex-1 font-mono text-xs text-slate-500 break-all">{{ item.label }}</code>
            <CopyButton compact :text="item.preview" />
          </div>
          <pre class="mt-2 font-mono text-xs text-slate-800 whitespace-pre-wrap break-all">{{ item.preview }}</pre>
        </li>
      </ol>

      <p v-if="resultState.truncated" class="mt-2 text-xs text-amber-600">
        {{ t('tools.xpathTester.truncatedList', { n: MAX_NODES }) }}
      </p>
    </section>

    <!-- 文档高亮 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.xpathTester.highlightTitle') }}</h2>
      <div
        v-if="sourceText"
        class="xp-preview rounded-xl border border-slate-200 bg-white/80 p-3 font-mono text-sm text-slate-800"
        v-html="highlightedHtml"
      ></div>
      <p v-else class="text-sm text-slate-400">{{ t('tools.xpathTester.emptySourceHint') }}</p>
      <p v-if="sourceText" class="mt-2 text-xs text-slate-400">{{ t('tools.xpathTester.highlightNote') }}</p>
    </section>
  </ToolPage>
</template>

<style scoped>
.xp-preview {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow-y: auto;
}

.xp-preview :deep(mark.xp-hl) {
  background-color: #fde047;
  color: #854d0e;
  border-radius: 3px;
  padding: 0 1px;
}
</style>
