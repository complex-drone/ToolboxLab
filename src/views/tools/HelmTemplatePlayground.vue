<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * Helm 模板调试器（轻量）
 * - 手写模拟渲染引擎：切分标记 + 递归下降处理 if / range / end
 * - 支持 .Values / .Release / .Chart 取值、default、quote、nindent、eq 比较
 * - 未知变量渲染为占位标记并收集为警告；语法错误给出行号并高亮
 * - Values 解析：JSON 对象或两层以内嵌套的简易 YAML（含一维数组与对象数组）
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 示例与文档常量 ---------------- */

const EXAMPLE_TEMPLATE = [
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: {{ .Release.Name }}',
  '  namespace: {{ .Release.Namespace }}',
  '  labels:',
  '    chart: {{ .Chart.Name }}',
  '    env: {{ .Values.env }}',
  'spec:',
  '  replicas: {{ default "2" .Values.replicas }}',
  '{{ if eq .Values.env "prod" }}',
  '  strategy:',
  '    type: RollingUpdate',
  '{{ else }}',
  '  strategy:',
  '    type: Recreate',
  '{{ end }}',
  '  template:',
  '    metadata:',
  '      labels:',
  '{{ nindent 8 .Values.podLabels }}',
  '    spec:',
  '      containers:',
  '        - name: app',
  '          image: {{ quote .Values.image }}',
  '          ports:',
  '{{ range $i, $v := .Values.ports }}',
  '            - name: {{ $v.name }}',
  '              containerPort: {{ $v.port }}',
  '{{ end }}',
  '',
].join('\n')

const EXAMPLE_VALUES = [
  'replicas: 3',
  'env: prod',
  'image: nginx:1.27-alpine',
  'podLabels: "app: demo\\nrelease: stable"',
  'ports:',
  '  - name: http',
  '    port: 80',
  '  - name: metrics',
  '    port: 9090',
  '',
].join('\n')

const SYNTAX_HINTS = [
  '{{ .Values.a.b }}',
  '{{ .Release.Name }}、{{ .Release.Namespace }}',
  '{{ .Chart.Name }}',
  '{{ if eq .Values.x "y" }} ... {{ else }} ... {{ end }}',
  '{{ range $i, $v := .Values.list }} ... {{ end }}',
  '{{ default "x" .Values.y }}',
  '{{ quote .Values.s }}',
  '{{ nindent 2 .Values.block }}',
]

/* ---------------- 持久化 ---------------- */

const config = useStorage(
  'tool-helm-template-playground',
  {
    template: '',
    values: '',
    releaseName: 'demo-release',
    releaseNamespace: 'default',
    chartName: 'demo-chart',
  },
  undefined,
  { mergeDefaults: true },
)

/* ---------------- Values 解析 ---------------- */

function parseScalar(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (s === '') return ''
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s)
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    try {
      return JSON.parse(s)
    } catch {
      return inner.split(',').map((x) => parseScalar(x))
    }
  }
  return s
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** 简易 YAML：缩进栈 + 占位对象转数组，支持两层以内嵌套 */
function parseSimpleYaml(text) {
  const lines = String(text).split(/\r?\n/)
  const root = {}
  const stack = [{ indent: -1, container: root, parentObj: null, key: '' }]
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]
    if (!raw.trim()) continue
    const trimmed = raw.trim()
    if (trimmed.startsWith('#')) continue
    const indent = raw.length - raw.replace(/^ +/, '').length
    const isItem = trimmed === '-' || trimmed.startsWith('- ')

    while (stack.length > 1) {
      const top = stack[stack.length - 1]
      const isArr = Array.isArray(top.container)
      const emptyPlaceholder = !isArr && top.parentObj !== null && Object.keys(top.container).length === 0
      if (indent < top.indent) {
        stack.pop()
        continue
      }
      if (indent === top.indent) {
        if (isArr && isItem) break
        if (emptyPlaceholder && isItem) break
        stack.pop()
        continue
      }
      break
    }

    const topFrame = stack[stack.length - 1]
    let parent = topFrame.container

    if (isItem) {
      if (!Array.isArray(parent) && topFrame.parentObj && Object.keys(parent).length === 0) {
        parent = []
        topFrame.parentObj[topFrame.key] = parent
        topFrame.container = parent
      }
      if (!Array.isArray(parent)) throw { code: 'yamlLine', line: li + 1 }
      const itemText = trimmed === '-' ? '' : trimmed.slice(2).trim()
      if (itemText === '') {
        parent.push(null)
        continue
      }
      const ci = itemText.indexOf(':')
      const keyPart = ci > 0 ? itemText.slice(0, ci).trim() : ''
      if (ci > 0 && KEY_RE.test(keyPart)) {
        const item = {}
        item[keyPart] = parseScalar(itemText.slice(ci + 1).trim())
        parent.push(item)
        stack.push({ indent, container: item, parentObj: null, key: '' })
      } else {
        parent.push(parseScalar(itemText))
      }
      continue
    }

    const ci = trimmed.indexOf(':')
    if (ci <= 0) throw { code: 'yamlLine', line: li + 1 }
    const key = trimmed.slice(0, ci).trim()
    if (!KEY_RE.test(key)) throw { code: 'yamlKey', line: li + 1 }
    if (Array.isArray(parent)) throw { code: 'yamlLine', line: li + 1 }
    const valStr = trimmed.slice(ci + 1).trim()
    if (valStr === '') {
      const placeholder = {}
      parent[key] = placeholder
      stack.push({ indent, container: placeholder, parentObj: parent, key })
    } else {
      parent[key] = parseScalar(valStr)
    }
  }
  return root
}

function parseValuesText(text) {
  const trimmed = String(text || '').trim()
  if (trimmed === '') return {}
  if (trimmed.startsWith('{')) {
    let v
    try {
      v = JSON.parse(trimmed)
    } catch {
      throw { code: 'jsonParse' }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw { code: 'jsonParse' }
    return v
  }
  return parseSimpleYaml(trimmed)
}

/* ---------------- 模板分词 ---------------- */

function lineAt(src, index) {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line += 1
  }
  return line
}

const ACTION_RE = /\{\{-?\s*([\s\S]*?)\s*-?\}\}/g

function tokenizeTemplate(src) {
  const tokens = []
  const re = new RegExp(ACTION_RE.source, 'g')
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: src.slice(last, m.index), line: lineAt(src, last) })
    tokens.push({ type: 'action', value: m[1].trim(), line: lineAt(src, m.index) })
    last = re.lastIndex
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last), line: lineAt(src, last) })
  for (const tok of tokens) {
    if (tok.type !== 'text') continue
    const openIdx = tok.value.indexOf('{{')
    if (openIdx >= 0) throw { code: 'unclosed', line: tok.line + lineAt(tok.value, openIdx) - 1 }
    const closeIdx = tok.value.indexOf('}}')
    if (closeIdx >= 0) throw { code: 'strayClose', line: tok.line + lineAt(tok.value, closeIdx) - 1 }
  }
  return tokens
}

/* ---------------- AST：if / range / end 栈 ---------------- */

function parseAst(tokens) {
  const root = { type: 'block', children: [] }
  const stack = [{ node: root, list: root.children }]
  const top = () => stack[stack.length - 1]
  for (const tok of tokens) {
    if (tok.type === 'text') {
      top().list.push({ type: 'text', value: tok.value })
      continue
    }
    const src = tok.value
    if (src === 'end') {
      if (stack.length === 1) throw { code: 'strayEnd', line: tok.line }
      stack.pop()
    } else if (src === 'else') {
      const frame = top()
      if (frame.node.type !== 'if') throw { code: 'strayElse', line: tok.line }
      frame.list = frame.node.elseChildren
    } else if (/^if\b/.test(src)) {
      const node = { type: 'if', condSrc: src.replace(/^if\b/, '').trim(), children: [], elseChildren: [], line: tok.line }
      top().list.push(node)
      stack.push({ node, list: node.children })
    } else if (/^range\b/.test(src)) {
      const node = { type: 'range', declSrc: src.replace(/^range\b/, '').trim(), children: [], line: tok.line }
      top().list.push(node)
      stack.push({ node, list: node.children })
    } else {
      top().list.push({ type: 'action', src, line: tok.line })
    }
  }
  if (stack.length > 1) throw { code: 'unclosedBlock', line: stack[stack.length - 1].node.line }
  return root
}

/* ---------------- 求值与渲染 ---------------- */

function splitOperands(s) {
  const tokens = []
  let cur = ''
  let quote = null
  for (const ch of String(s)) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

function stringify(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function isTruthy(v) {
  if (v === undefined || v === null || v === false || v === '') return false
  if (typeof v === 'number' && v === 0) return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function recordUndefined(warnings, line, path) {
  warnings.push({ code: 'undefined', line, path })
}

function resolvePath(path, ctx, warnings, line) {
  let base
  let parts
  if (path.startsWith('$')) {
    const segs = path.slice(1).split('.').filter(Boolean)
    base = ctx.vars ? ctx.vars['$' + segs[0]] : undefined
    parts = segs.slice(1)
    if (base === undefined) {
      recordUndefined(warnings, line, path)
      return undefined
    }
  } else {
    const segs = path.split('.').filter(Boolean)
    const rootName = segs[0]
    if (rootName === 'Values') base = ctx.Values
    else if (rootName === 'Release') base = ctx.Release
    else if (rootName === 'Chart') base = ctx.Chart
    else {
      recordUndefined(warnings, line, path)
      return undefined
    }
    parts = segs.slice(1)
  }
  let cur = base
  for (const p of parts) {
    if (cur === null || cur === undefined) {
      recordUndefined(warnings, line, path)
      return undefined
    }
    cur = cur[p]
  }
  if (cur === undefined || cur === null) {
    recordUndefined(warnings, line, path)
    return undefined
  }
  return cur
}

function evalOperand(tok, ctx, warnings, line) {
  if (tok === undefined || tok === '') return undefined
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok)
  if (tok.startsWith('.') || tok.startsWith('$')) return resolvePath(tok, ctx, warnings, line)
  return tok
}

function evalCond(src, ctx, warnings, line) {
  const s = String(src || '').trim()
  if (s === '') return false
  const m = /^(eq|ne)\b\s*([\s\S]*)$/.exec(s)
  if (m) {
    const ops = splitOperands(m[2])
    if (ops.length < 2) return false
    const a = evalOperand(ops[0], ctx, warnings, line)
    const b = evalOperand(ops[1], ctx, warnings, line)
    const same = stringify(a) === stringify(b)
    return m[1] === 'eq' ? same : !same
  }
  return isTruthy(evalOperand(s, ctx, warnings, line))
}

function undefinedMarkup(path) {
  return '<' + t('tools.helmTemplatePlayground.undefinedRef', { path }) + '>'
}

function evalAction(src, ctx, warnings, line) {
  const tokens = splitOperands(src)
  if (tokens.length === 0) return ''
  const head = tokens[0]
  if (head.startsWith('.') || head.startsWith('$')) {
    if (tokens.length > 1) {
      warnings.push({ code: 'unknownFn', line, fn: head })
      return '{{ ' + src + ' }}'
    }
    const v = evalOperand(head, ctx, warnings, line)
    if (v === undefined || v === null) return undefinedMarkup(head)
    return stringify(v)
  }
  if (head === 'default') {
    const def = tokens[1] !== undefined ? evalOperand(tokens[1], ctx, warnings, line) : ''
    const val = tokens[2] !== undefined ? evalOperand(tokens[2], ctx, warnings, line) : undefined
    if (val === undefined || val === null || val === '') return stringify(def)
    return stringify(val)
  }
  if (head === 'quote') {
    const v = tokens[1] !== undefined ? evalOperand(tokens[1], ctx, warnings, line) : ''
    return '"' + stringify(v) + '"'
  }
  if (head === 'nindent') {
    const n = Number(tokens[1])
    const v = tokens[2] !== undefined ? evalOperand(tokens[2], ctx, warnings, line) : ''
    const pad = Number.isInteger(n) && n > 0 ? ' '.repeat(Math.min(n, 16)) : ''
    return '\n' + pad + stringify(v)
  }
  warnings.push({ code: 'unknownFn', line, fn: head })
  return '{{ ' + src + ' }}'
}

function parseRangeDecl(src) {
  const m2 = /^\$([A-Za-z_][A-Za-z0-9_]*)\s*,\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([\s\S]+)$/.exec(src)
  if (m2) return { keyVar: '$' + m2[1], valVar: '$' + m2[2], expr: m2[3].trim() }
  const m1 = /^\$([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*([\s\S]+)$/.exec(src)
  if (m1) return { keyVar: null, valVar: '$' + m1[1], expr: m1[2].trim() }
  return { keyVar: null, valVar: null, expr: src.trim() }
}

function renderNodes(nodes, ctx, out, warnings) {
  for (const node of nodes) renderNode(node, ctx, out, warnings)
}

function renderNode(node, ctx, out, warnings) {
  if (node.type === 'text') {
    out.push(node.value)
    return
  }
  if (node.type === 'if') {
    const ok = evalCond(node.condSrc, ctx, warnings, node.line)
    renderNodes(ok ? node.children : node.elseChildren, ctx, out, warnings)
    return
  }
  if (node.type === 'range') {
    const decl = parseRangeDecl(node.declSrc)
    const coll = evalOperand(decl.expr, ctx, warnings, node.line)
    let entries
    if (Array.isArray(coll)) entries = coll.map((v, i) => [i, v])
    else if (coll && typeof coll === 'object') entries = Object.entries(coll)
    else {
      warnings.push({ code: 'rangeTarget', line: node.line })
      return
    }
    for (const [k, v] of entries) {
      const vars = Object.assign({}, ctx.vars)
      if (decl.keyVar) vars[decl.keyVar] = k
      if (decl.valVar) vars[decl.valVar] = v
      renderNodes(node.children, Object.assign({}, ctx, { vars }), out, warnings)
    }
    return
  }
  out.push(evalAction(node.src, ctx, warnings, node.line))
}

/* ---------------- 实时渲染 ---------------- */

function errItem(e) {
  const code = e && e.code ? e.code : ''
  const keyMap = {
    unclosed: 'errUnclosed',
    strayClose: 'errStrayClose',
    strayEnd: 'errStrayEnd',
    strayElse: 'errStrayElse',
    unclosedBlock: 'errUnclosedBlock',
    jsonParse: 'errJsonParse',
    yamlLine: 'errYamlLine',
    yamlKey: 'errYamlKey',
  }
  const key = keyMap[code]
  if (!key) return { line: 0, text: t('toolsCommon.error') }
  const line = typeof e.line === 'number' ? e.line : 0
  return { line, text: t('tools.helmTemplatePlayground.' + key, { line }) }
}

function dedupeWarnings(list) {
  const seen = new Set()
  const out = []
  for (const w of list) {
    const key = w.code + ':' + (w.path || w.fn || '') + ':' + (w.code === 'rangeTarget' ? w.line : '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

const result = computed(() => {
  const tpl = String(config.value.template || '')
  if (tpl.trim() === '') return { empty: true, output: '', warnings: [], errors: [] }
  const warnings = []
  let values
  try {
    values = parseValuesText(config.value.values)
  } catch (e) {
    return { empty: false, output: '', warnings: [], errors: [errItem(e)] }
  }
  try {
    const tokens = tokenizeTemplate(tpl)
    const ast = parseAst(tokens)
    const ctx = {
      Values: values,
      Release: {
        Name: String(config.value.releaseName || 'demo-release'),
        Namespace: String(config.value.releaseNamespace || 'default'),
      },
      Chart: { Name: String(config.value.chartName || 'demo-chart') },
      vars: {},
    }
    const out = []
    renderNodes(ast.children, ctx, out, warnings)
    return { empty: false, output: out.join(''), warnings: dedupeWarnings(warnings), errors: [] }
  } catch (e) {
    return { empty: false, output: '', warnings: [], errors: [errItem(e)] }
  }
})

const templateLines = computed(() => String(config.value.template || '').split('\n'))

const errorLineSet = computed(() => {
  const set = new Set()
  for (const e of result.value.errors) {
    if (e.line > 0) set.add(e.line)
  }
  return set
})

function warningText(w) {
  if (w.code === 'undefined') {
    return t('tools.helmTemplatePlayground.warnUndefined', { path: w.path, line: w.line })
  }
  if (w.code === 'rangeTarget') {
    return t('tools.helmTemplatePlayground.warnRangeTarget', { line: w.line })
  }
  return t('tools.helmTemplatePlayground.warnUnknownFn', { fn: w.fn, line: w.line })
}

/* ---------------- 操作 ---------------- */

function loadExample() {
  config.value.template = EXAMPLE_TEMPLATE
  config.value.values = EXAMPLE_VALUES
  toast.success(t('tools.helmTemplatePlayground.exampleLoaded'))
}

function clearAll() {
  config.value.template = ''
  config.value.values = ''
}
</script>

<template>
  <ToolPage tool-id="helmTemplatePlayground">
    <!-- 模板 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.helmTemplatePlayground.templateTitle') }}</h2>
        <button type="button" class="btn-ghost" @click="clearAll">
          {{ t('tools.helmTemplatePlayground.clearAll') }}
        </button>
        <button type="button" class="btn-primary" @click="loadExample">
          {{ t('tools.helmTemplatePlayground.exampleBtn') }}
        </button>
      </div>
      <textarea
        v-model="config.template"
        rows="14"
        class="input-base font-mono text-xs sm:text-sm"
        :placeholder="t('tools.helmTemplatePlayground.templatePlaceholder')"
        spellcheck="false"
      ></textarea>

      <details class="mt-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3">
        <summary class="cursor-pointer select-none text-sm font-medium text-slate-600">
          {{ t('tools.helmTemplatePlayground.syntaxDocTitle') }}
        </summary>
        <ul class="mt-2 space-y-1">
          <li v-for="hint in SYNTAX_HINTS" :key="hint" class="font-mono text-xs text-slate-500 break-all">
            {{ hint }}
          </li>
        </ul>
      </details>
    </section>

    <!-- Values + 内置对象 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.helmTemplatePlayground.valuesTitle') }}</h2>
      <textarea
        v-model="config.values"
        rows="9"
        class="input-base font-mono text-xs sm:text-sm"
        :placeholder="t('tools.helmTemplatePlayground.valuesPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p class="mt-2 text-xs text-slate-400 leading-relaxed">
        {{ t('tools.helmTemplatePlayground.valuesDoc') }}
      </p>

      <h3 class="text-sm font-semibold text-slate-600 mt-4 mb-2">
        {{ t('tools.helmTemplatePlayground.objectsTitle') }}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="label-base" for="helm-release">{{ t('tools.helmTemplatePlayground.releaseNameLabel') }}</label>
          <input
            id="helm-release"
            v-model="config.releaseName"
            type="text"
            class="input-base font-mono"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div>
          <label class="label-base" for="helm-ns">{{ t('tools.helmTemplatePlayground.releaseNamespaceLabel') }}</label>
          <input
            id="helm-ns"
            v-model="config.releaseNamespace"
            type="text"
            class="input-base font-mono"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div>
          <label class="label-base" for="helm-chart">{{ t('tools.helmTemplatePlayground.chartNameLabel') }}</label>
          <input
            id="helm-chart"
            v-model="config.chartName"
            type="text"
            class="input-base font-mono"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>
    </section>

    <!-- 渲染结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.helmTemplatePlayground.outputTitle') }}</h2>
        <CopyButton :text="result.output" :label="t('toolsCommon.copy')" :disabled="!result.output" />
      </div>

      <pre
        v-if="!result.empty && result.output"
        class="font-mono text-xs sm:text-sm leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[480px] whitespace-pre-wrap break-words"
        tabindex="0"
      >{{ result.output }}</pre>
      <div
        v-if="result.empty"
        class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400"
      >
        {{ t('tools.helmTemplatePlayground.emptyOutput') }}
      </div>

      <!-- 语法错误 -->
      <div v-if="result.errors.length" class="mt-4" role="alert">
        <h3 class="text-sm font-semibold text-rose-600 mb-2">
          {{ t('tools.helmTemplatePlayground.errorsTitle') }}
        </h3>
        <ul class="space-y-1.5">
          <li
            v-for="(e, i) in result.errors"
            :key="i"
            class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600"
          >
            {{ e.text }}
          </li>
        </ul>

        <div v-if="errorLineSet.size" class="mt-3">
          <h4 class="text-xs font-medium text-slate-500 mb-1.5">
            {{ t('tools.helmTemplatePlayground.errorLinesTitle') }}
          </h4>
          <pre class="font-mono text-xs leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-72"><span
              v-for="(ln, i) in templateLines"
              :key="i"
              class="block"
              :class="errorLineSet.has(i + 1) ? 'bg-rose-500/40 text-rose-100' : ''"
            >{{ ln === '' ? ' ' : ln }}</span></pre>
        </div>
      </div>

      <!-- 警告 chips -->
      <div class="mt-4">
        <h3 class="text-sm font-semibold text-slate-600 mb-2">
          {{ t('tools.helmTemplatePlayground.warningsTitle') }}
        </h3>
        <p v-if="result.warnings.length === 0" class="text-sm text-emerald-600">
          {{ t('tools.helmTemplatePlayground.noWarnings') }}
        </p>
        <div v-else class="flex flex-wrap gap-1.5">
          <span
            v-for="(w, i) in result.warnings"
            :key="i"
            class="chip text-amber-600 border border-amber-200 bg-amber-50 break-all"
          >
            {{ warningText(w) }}
          </span>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
