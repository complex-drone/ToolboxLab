<script setup>
import { ref, computed, watch } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * 表格格式转换：Markdown / CSV / HTML 输入 → Markdown / CSV / JSON / HTML 输出
 * - 自动检测输入格式（可手动切换）；CSV 为自实现状态机解析器（支持引号字段）
 * - 解析失败行内报错；转换需点击按钮触发，结果生成后随输入/选项实时更新
 * - Markdown 输出按显示宽度（CJK 记 2）对齐列宽；JSON 键名取首行
 * - 输入格式 / 输出格式 / 分隔符持久化
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-table-converter-config', {
  inputFormat: 'auto',
  outputFormat: 'markdown',
  csvDelimiter: 'auto',
})

const inputText = ref('')
const converted = ref(false)

const INPUT_FORMATS = [
  { key: 'auto', label: 'fmtAuto' },
  { key: 'markdown', label: 'fmtMarkdown' },
  { key: 'csv', label: 'fmtCsv' },
  { key: 'html', label: 'fmtHtml' },
]

const OUTPUT_FORMATS = [
  { key: 'markdown', label: 'outMarkdown' },
  { key: 'csv', label: 'outCsv' },
  { key: 'json', label: 'outJson' },
  { key: 'html', label: 'outHtml' },
]

const DELIMITERS = [
  { key: 'auto', label: 'delimAuto', value: 'auto' },
  { key: 'comma', label: 'delimComma', value: ',' },
  { key: 'semicolon', label: 'delimSemicolon', value: ';' },
  { key: 'tab', label: 'delimTab', value: '\t' },
]

/* ---------- 解析错误码 → 文案 ---------- */
const ERROR_KEYS = {
  empty: 'errEmpty',
  unknown: 'errUnknown',
  markdown: 'errMarkdown',
  csv: 'errCsv',
  html: 'errHtml',
}

function parseError(code) {
  const err = new Error(code)
  err.code = code
  return err
}

/* ---------- 格式检测 ---------- */
const MD_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function detectFormat(text) {
  const trimmed = text.trim()
  if (/^<table[\s>]/i.test(trimmed)) return 'html'
  const lines = trimmed.split(/\r?\n/)
  const hasPipe = lines.some((l) => l.includes('|'))
  const hasSep = lines.some((l) => l.includes('|') && MD_SEP_RE.test(l))
  if (hasPipe && hasSep) return 'markdown'
  const firstLine = lines[0] || ''
  const multiLine = lines.length >= 2
  if (multiLine && /[,;\t]/.test(firstLine)) return 'csv'
  return null
}

/* ---------- Markdown 解析 ---------- */
function splitMarkdownRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim().replace(/\\\|/g, '|'))
}

function parseMarkdown(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() !== '')
  const tableLines = lines.filter((l) => l.includes('|'))
  const sepIdx = tableLines.findIndex((l, i) => i > 0 && MD_SEP_RE.test(l))
  if (tableLines.length < 2 || sepIdx === -1) throw parseError('markdown')
  const rows = []
  tableLines.forEach((l, i) => {
    if (i === sepIdx) return
    rows.push(splitMarkdownRow(l))
  })
  if (!rows.length) throw parseError('markdown')
  return rows
}

/* ---------- CSV 解析（状态机） ---------- */
function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || ''
  let best = ','
  let bestCount = 0
  for (const cand of [',', ';', '\t']) {
    const count = firstLine.split(cand).length - 1
    if (count > bestCount) {
      best = cand
      bestCount = count
    }
  }
  return best
}

function parseCsv(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (inQuotes) throw parseError('csv')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) throw parseError('csv')
  return rows
}

/* ---------- HTML 解析 ---------- */
function parseHtml(text) {
  let table
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    table = doc.querySelector('table')
  } catch (e) {
    throw parseError('html')
  }
  if (!table) throw parseError('html')
  const rows = []
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = []
    tr.querySelectorAll('th,td').forEach((c) => cells.push((c.textContent || '').trim()))
    if (cells.length) rows.push(cells)
  })
  if (!rows.length) throw parseError('html')
  return rows
}

/* ---------- 统一解析入口 ---------- */
function resolveDelimiter(text) {
  if (config.value.csvDelimiter !== 'auto') return config.value.csvDelimiter
  return detectCsvDelimiter(text)
}

const parseResult = computed(() => {
  const text = inputText.value
  if (!text.trim()) return { rows: null, detected: null, error: '' }
  try {
    let fmt = config.value.inputFormat
    if (fmt === 'auto') {
      fmt = detectFormat(text)
      if (!fmt) throw parseError('unknown')
    }
    let rows
    if (fmt === 'markdown') rows = parseMarkdown(text)
    else if (fmt === 'csv') rows = parseCsv(text, resolveDelimiter(text))
    else rows = parseHtml(text)
    if (!rows.length) throw parseError('empty')
    return { rows, detected: fmt, error: '' }
  } catch (e) {
    const code = e && e.code && ERROR_KEYS[e.code] ? e.code : 'unknown'
    return { rows: null, detected: null, error: t(`tools.tableConverter.${ERROR_KEYS[code]}`) }
  }
})

const colCount = computed(() => {
  const rows = parseResult.value.rows
  if (!rows) return 0
  return rows.reduce((m, r) => Math.max(m, r.length), 0)
})

/* ---------- 输出生成 ---------- */
function charWidth(ch) {
  return ch.charCodeAt(0) > 0xff ? 2 : 1
}

function displayWidth(s) {
  let w = 0
  for (const ch of s) w += charWidth(ch)
  return w
}

function padCell(s, width) {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)))
}

function normalizeRows(rows, fill) {
  const count = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return rows.map((r) => {
    const c = r.map((cell) => String(cell))
    while (c.length < count) c.push(fill)
    return c
  })
}

function toMarkdownOutput(rows) {
  const norm = normalizeRows(rows, '').map((r) =>
    r.map((cell) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '))
  )
  const count = norm[0].length
  const widths = Array.from({ length: count }, (_, c) =>
    Math.max(3, ...norm.map((r) => displayWidth(r[c])))
  )
  const line = (cells) => '| ' + cells.map((cell, i) => padCell(cell, widths[i])).join(' | ') + ' |'
  const sep = '|' + widths.map((w) => ' ' + '-'.repeat(w) + ' ').join('|') + '|'
  return [line(norm[0]), sep, ...norm.slice(1).map(line)].join('\n')
}

function escapeCsvCell(cell, delim) {
  const c = String(cell)
  if (c.includes(delim) || c.includes('"') || /[\r\n]/.test(c)) {
    return '"' + c.replace(/"/g, '""') + '"'
  }
  return c
}

function toCsvOutput(rows, delim) {
  const norm = normalizeRows(rows, '')
  return norm.map((r) => r.map((c) => escapeCsvCell(c, delim)).join(delim)).join('\n')
}

function toJsonOutput(rows) {
  const norm = normalizeRows(rows, '')
  const header = norm[0].map((h, i) => h || `col${i + 1}`)
  const objects = norm.slice(1).map((r) => {
    const obj = {}
    header.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : ''
    })
    return obj
  })
  return JSON.stringify(objects, null, 2)
}


function toHtmlOutput(rows) {
  const norm = normalizeRows(rows, '')
  const cellStyle = ' style="border:1px solid #d0d7de;padding:6px 12px;text-align:left;"'
  const th = (c) => `      <th${cellStyle}>${escapeHtml(c)}</th>`
  const td = (c) => `      <td${cellStyle}>${escapeHtml(c)}</td>`
  const tr = (cells, fn) => '    <tr>\n' + cells.map(fn).join('\n') + '\n    </tr>'
  const parts = ['<table style="border-collapse:collapse;font-family:sans-serif;">']
  parts.push('  <thead>')
  parts.push(tr(norm[0], th))
  parts.push('  </thead>')
  if (norm.length > 1) {
    parts.push('  <tbody>')
    norm.slice(1).forEach((r) => parts.push(tr(r, td)))
    parts.push('  </tbody>')
  }
  parts.push('</table>')
  return parts.join('\n')
}

const resultText = computed(() => {
  const rows = parseResult.value.rows
  if (!rows || !converted.value) return ''
  try {
    const fmt = config.value.outputFormat
    if (fmt === 'markdown') return toMarkdownOutput(rows)
    if (fmt === 'csv') return toCsvOutput(rows, resolveDelimiter(inputText.value || ','))
    if (fmt === 'json') return toJsonOutput(rows)
    return toHtmlOutput(rows)
  } catch (e) {
    return ''
  }
})

/* ---------- 转换 / 下载 ---------- */
function doConvert() {
  if (!inputText.value.trim()) {
    toast.error(t('tools.tableConverter.errEmpty'))
    return
  }
  if (!parseResult.value.rows) {
    toast.error(parseResult.value.error || t('toolsCommon.invalidInput'))
    return
  }
  converted.value = true
  toast.success(t('toolsCommon.done'))
}

function resetAll() {
  inputText.value = ''
  converted.value = false
}

watch([inputText, () => config.value.inputFormat, () => config.value.csvDelimiter], () => {
  converted.value = false
})

const DOWNLOAD_META = {
  markdown: { ext: 'md', mime: 'text/markdown;charset=utf-8' },
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8' },
}

function downloadResult() {
  if (!resultText.value) return
  const fmt = config.value.outputFormat
  const meta = DOWNLOAD_META[fmt] || DOWNLOAD_META.markdown
  try {
    downloadText(resultText.value, `table.${meta.ext}`, meta.mime)
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="tableConverter">
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 输入格式 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="label-base mb-0 mr-1">{{ t('tools.tableConverter.inputFormatLabel') }}</span>
        <button
          v-for="f in INPUT_FORMATS"
          :key="f.key"
          type="button"
          class="btn-ghost !px-2.5 !py-1 text-xs"
          :class="config.inputFormat === f.key ? 'text-blue-600 border-blue-400 bg-blue-50' : ''"
          @click="config.inputFormat = f.key"
        >
          {{ t(`tools.tableConverter.${f.label}`) }}
        </button>
        <span v-if="config.inputFormat === 'auto' && parseResult.detected" class="chip">
          {{ t('tools.tableConverter.detectedLabel') }}: {{ t(`tools.tableConverter.fmt${parseResult.detected.charAt(0).toUpperCase() + parseResult.detected.slice(1)}`) }}
        </span>
      </div>

      <!-- CSV 分隔符 -->
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <span class="label-base mb-0 mr-1">{{ t('tools.tableConverter.delimiterLabel') }}</span>
        <button
          v-for="d in DELIMITERS"
          :key="d.key"
          type="button"
          class="btn-ghost !px-2.5 !py-1 text-xs"
          :class="config.csvDelimiter === d.value ? 'text-blue-600 border-blue-400 bg-blue-50' : ''"
          @click="config.csvDelimiter = d.value"
        >
          {{ t(`tools.tableConverter.${d.label}`) }}
        </button>
      </div>

      <!-- 输入 -->
      <div class="mt-4">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="label-base flex-1 mb-0">{{ t('toolsCommon.input') }}</span>
          <button type="button" class="btn-ghost" @click="resetAll">{{ t('toolsCommon.clear') }}</button>
        </div>
        <textarea
          v-model="inputText"
          class="input-base w-full font-mono h-52 resize-y"
          :placeholder="t('tools.tableConverter.inputPlaceholder')"
          spellcheck="false"
        ></textarea>
        <p v-if="parseResult.error" class="mt-2 text-sm text-red-600">{{ parseResult.error }}</p>
      </div>
    </section>

    <!-- 预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title mb-0 mr-auto">{{ t('toolsCommon.preview') }}</span>
        <template v-if="parseResult.rows">
          <span class="chip">{{ t('tools.tableConverter.rowsCols', { rows: parseResult.rows.length, cols: colCount }) }}</span>
          <span class="chip">{{ t('tools.tableConverter.headerRow') }}</span>
        </template>
      </div>
      <div v-if="!parseResult.rows" class="text-sm text-slate-400 py-6 text-center">
        {{ t('toolsCommon.none') }}
      </div>
      <div v-else class="overflow-x-auto rounded-xl border border-slate-200">
        <table class="table-preview w-full text-sm">
          <thead>
            <tr>
              <th v-for="(cell, i) in parseResult.rows[0]" :key="'h' + i" class="px-3 py-2 text-left">{{ cell }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in parseResult.rows.slice(1)" :key="'r' + ri" class="odd:bg-white even:bg-slate-50">
              <td v-for="(cell, ci) in colCount ? Array.from({ length: colCount }, (_, i) => row[i] || '') : []" :key="'c' + ci" class="px-3 py-1.5 text-left">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 输出格式 + 转换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="label-base mb-0 mr-1">{{ t('tools.tableConverter.outputFormatLabel') }}</span>
        <button
          v-for="f in OUTPUT_FORMATS"
          :key="f.key"
          type="button"
          class="btn-ghost !px-2.5 !py-1 text-xs"
          :class="config.outputFormat === f.key ? 'text-blue-600 border-blue-400 bg-blue-50' : ''"
          @click="config.outputFormat = f.key"
        >
          {{ t(`tools.tableConverter.${f.label}`) }}
        </button>
        <button type="button" class="btn-primary ml-auto" @click="doConvert">
          {{ t('toolsCommon.convert') }}
        </button>
      </div>

      <!-- 结果 -->
      <div class="mt-4">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="label-base flex-1 mb-0">{{ t('toolsCommon.result') }}</span>
          <CopyButton :text="resultText" :disabled="!resultText" />
          <button type="button" class="btn-ghost" :disabled="!resultText" @click="downloadResult">
            {{ t('toolsCommon.download') }}
          </button>
        </div>
        <div v-if="!resultText" class="text-sm text-slate-400 py-6 text-center rounded-xl border border-slate-200 bg-white/70">
          {{ t('toolsCommon.none') }}
        </div>
        <pre
          v-else
          class="result-block font-mono text-xs leading-relaxed rounded-xl border border-slate-200 bg-slate-50 p-3 overflow-auto max-h-96 whitespace-pre"
        >{{ resultText }}</pre>
      </div>
    </section>
  </ToolPage>
</template>

<style scoped>
.table-preview th {
  background: rgba(241, 245, 249, 0.9);
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
}

.table-preview td {
  color: #334155;
  word-break: break-word;
}
</style>
