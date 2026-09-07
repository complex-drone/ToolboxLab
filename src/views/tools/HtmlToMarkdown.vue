<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { downloadText, readFileAsText } from '@/utils/download'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'

/**
 * HTML 转 Markdown
 * - turndown（CJS，动态 import 后取 default）懒加载
 * - 自定义规则：删除线、带语言标注的围栏代码块、GFM 表格（自实现对齐表格，含单元格内联转换）
 * - 转换前可选移除 script/style/noscript；转换后可合并多余空行
 * - 预览 Tab：marked + DOMPurify 快速渲染转换结果，便于比对
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-html-to-markdown-config', {
  cleanNoise: true,
  collapseBlank: true,
})

const SAMPLE_HTML = [
  '<h1>Project Report</h1>',
  '<p>This is a <strong>sample</strong> document with <em>emphasis</em>, <del>deleted text</del>, an <a href="https://example.com">inline link</a> and <code>inline code</code>.</p>',
  '<h2>Features</h2>',
  '<ul><li>Fast conversion<ul><li>Client side</li><li>No upload</li></ul></li><li>Clean output</li></ul>',
  '<ol><li>Paste HTML</li><li>Copy Markdown</li></ol>',
  '<blockquote>Blockquotes support <strong>inline formatting</strong> and nesting.</blockquote>',
  '<h2>Data Table</h2>',
  '<table><thead><tr><th style="text-align:left">Name</th><th style="text-align:center">Status</th><th style="text-align:right">Score</th></tr></thead><tbody><tr><td>alpha</td><td>done</td><td>98.5</td></tr><tr><td>beta</td><td>pending</td><td>72</td></tr></tbody></table>',
  '<h3>Code Sample</h3>',
  '<pre><code class="language-js">const x = 42\nconsole.log("answer:", x)</code></pre>',
  '<p>An image: <img src="https://example.com/logo.png" alt="logo"></p>',
  '<hr>',
  '<script>console.log("noise to be removed")<\/script>',
  '<style>.noise { color: red }<\/style>',
].join('\n')

/* ---------- 状态 ---------- */

const inputHtml = ref('')
const outputMd = ref('')
const error = ref('')
const activeTab = ref('markdown')
const previewHtml = ref('')

const charCount = computed(() => outputMd.value.length)
const lineCount = computed(() => (outputMd.value ? outputMd.value.split('\n').length : 0))

/* ---------- 噪声清理 ---------- */

function stripNoise(src) {
  try {
    const doc = new DOMParser().parseFromString(src, 'text/html')
    for (const sel of ['script', 'style', 'noscript']) {
      for (const el of Array.from(doc.querySelectorAll(sel))) el.remove()
    }
    return doc.body ? doc.body.innerHTML : src
  } catch {
    return src
  }
}

/* ---------- turndown 转换器 ---------- */

/** GFM 单元格内不能有换行，竖线需转义 */
function cleanCellText(text) {
  return text
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}

/** 显示宽度：CJK 等全角字符按 2 列计，用于表格对齐 */
function displayWidth(text) {
  let w = 0
  for (const ch of Array.from(text)) {
    w += ch.codePointAt(0) > 0x2e7f ? 2 : 1
  }
  return w
}

function padCell(text, width, align) {
  const pad = width - displayWidth(text)
  if (pad <= 0) return text
  if (align === 'right') return ' '.repeat(pad) + text
  if (align === 'center') {
    const left = Math.floor(pad / 2)
    return ' '.repeat(left) + text + ' '.repeat(pad - left)
  }
  return text + ' '.repeat(pad)
}

function alignOf(cell) {
  let a = ''
  try {
    a = (cell.getAttribute('align') || (cell.style && cell.style.textAlign) || '').toLowerCase()
  } catch {
    a = ''
  }
  if (a === 'center' || a === 'right' || a === 'left') return a
  return ''
}

/** 表格 → 对齐的 GFM 表格（表头可缺省，列宽按显示宽度补齐） */
function tableToGfm(table, cellConverter) {
  const rows = Array.from(table.rows || [])
  if (!rows.length) return ''

  let headerRow = null
  let bodyRows = rows
  const thead = table.tHead || null
  if (thead && thead.rows && thead.rows.length > 0) {
    headerRow = thead.rows[0]
    bodyRows = rows.filter(r => !thead.contains(r))
  } else {
    const firstCells = Array.from(rows[0].cells || [])
    if (firstCells.length > 0 && firstCells.every(c => c.nodeName === 'TH')) {
      headerRow = rows[0]
      bodyRows = rows.slice(1)
    }
  }

  const columnCount = Math.max(1, ...rows.map(r => (r.cells ? r.cells.length : 0)))

  const toCells = tr => Array.from(tr.cells || []).map(td => cleanCellText(cellConverter.turndown(td)))
  const padRowTo = (cells, n) => {
    const out = [...cells]
    while (out.length < n) out.push('')
    return out
  }

  const headerCells = headerRow ? padRowTo(toCells(headerRow), columnCount) : Array.from({ length: columnCount }, () => '')
  const bodyCellRows = bodyRows.map(tr => padRowTo(toCells(tr), columnCount))

  // 对齐方式：优先表头单元格，其次取该列第一个声明的对齐
  const aligns = []
  for (let c = 0; c < columnCount; c++) {
    let align = headerRow && headerRow.cells[c] ? alignOf(headerRow.cells[c]) : ''
    if (!align) {
      for (const tr of bodyRows) {
        const cell = tr.cells && tr.cells[c]
        if (cell) {
          align = alignOf(cell)
          if (align) break
        }
      }
    }
    aligns.push(align)
  }

  const widths = []
  for (let c = 0; c < columnCount; c++) {
    let w = displayWidth(headerCells[c])
    for (const row of bodyCellRows) w = Math.max(w, displayWidth(row[c]))
    widths.push(Math.max(w, 3))
  }

  const fmtRow = cells => '| ' + cells.map((cell, i) => padCell(cell, widths[i], aligns[i])).join(' | ') + ' |'
  const sepCells = widths.map((w, i) => {
    if (aligns[i] === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':'
    if (aligns[i] === 'left') return ':' + '-'.repeat(Math.max(2, w - 1))
    if (aligns[i] === 'right') return '-'.repeat(Math.max(2, w - 1)) + ':'
    return '-'.repeat(w)
  })

  const lines = [fmtRow(headerCells), '| ' + sepCells.join(' | ') + ' |', ...bodyCellRows.map(fmtRow)]
  return '\n\n' + lines.join('\n') + '\n\n'
}

/**
 * 创建 turndown 实例；cellConverter=true 时不注册表格规则，
 * 用于表格单元格的内联转换，避免嵌套表格递归
 */
function createConverter(TurndownService, isCellConverter) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---',
    bulletListMarker: '-',
    strongDelimiter: '**',
    emDelimiter: '*',
    linkStyle: 'inlined',
  })

  // 删除线（del/s/strike）
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement(content) {
      return '~~' + content + '~~'
    },
  })

  // 围栏代码块（保留 language-xxx 语言标注）
  td.addRule('fencedCodeBlock', {
    filter(node) {
      return node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE'
    },
    replacement(content, node) {
      const code = node.firstChild
      const cls = code.getAttribute('class') || ''
      const m = cls.match(/language-([\w+-]+)/)
      const lang = m ? m[1] : ''
      const text = (code.textContent || '').replace(/\n$/, '')
      return '\n\n```' + lang + '\n' + text + '\n```\n\n'
    },
  })

  if (!isCellConverter) {
    const cellConverter = createConverter(TurndownService, true)
    td.addRule('gfmTable', {
      filter(node) {
        return node.nodeName === 'TABLE'
      },
      replacement(content, node) {
        return tableToGfm(node, cellConverter)
      },
    })
  }

  return td
}

/* ---------- 转换 ---------- */

async function convert() {
  const src = inputHtml.value
  if (!src.trim()) {
    outputMd.value = ''
    error.value = ''
    return
  }
  try {
    error.value = ''
    const TurndownService = (await import('turndown')).default
    const cleaned = config.value.cleanNoise ? stripNoise(src) : src
    const converter = createConverter(TurndownService, false)
    let md = converter.turndown(cleaned)
    if (config.value.collapseBlank) {
      md = md.replace(/\n{3,}/g, '\n\n').trim()
    }
    outputMd.value = md
  } catch (e) {
    outputMd.value = ''
    error.value = e && e.message ? e.message : t('toolsCommon.error')
  }
}

const convertDebounced = useDebounceFn(convert, 350)

watch([inputHtml, () => config.value.cleanNoise, () => config.value.collapseBlank], () => convertDebounced())

onMounted(() => {
  convert()
})

/* ---------- 预览渲染（marked + DOMPurify 快速渲染） ---------- */

let markedRef = null

async function renderPreview() {
  if (activeTab.value !== 'preview') return
  try {
    if (!outputMd.value) {
      previewHtml.value = ''
      return
    }
    if (!markedRef) {
      const mod = await import('marked')
      markedRef = mod.marked
    }
    const raw = markedRef.parse(outputMd.value, { gfm: true, breaks: false })
    const DOMPurify = (await import('dompurify')).default
    previewHtml.value = DOMPurify.sanitize(raw)
  } catch {
    previewHtml.value = ''
  }
}

watch([outputMd, activeTab], () => {
  if (activeTab.value === 'preview') renderPreview()
})

/* ---------- 上传 / 示例 / 下载 ---------- */

async function onFile(file) {
  try {
    inputHtml.value = await readFileAsText(file)
    toast.success(t('toolsCommon.loaded'))
  } catch {
    toast.error(t('tools.htmlToMarkdown.readError'))
  }
}

function loadSample() {
  inputHtml.value = SAMPLE_HTML
}

function downloadMd() {
  try {
    if (!outputMd.value) return
    downloadText(outputMd.value, 'converted.md', 'text/markdown;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="htmlToMarkdown">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="section-title flex-1 mb-0">{{ t('tools.htmlToMarkdown.inputSection') }}</span>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger" @click="inputHtml = ''">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <textarea
        v-model="inputHtml"
        class="input-base font-mono h-48 resize-y"
        :placeholder="t('tools.htmlToMarkdown.inputPlaceholder')"
        spellcheck="false"
      ></textarea>

      <div class="mt-3">
        <FileDropZone
          accept=".html,.htm,text/html"
          :max-size-mb="5"
          :hint="t('tools.htmlToMarkdown.uploadHint')"
          @files="onFile"
        />
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mt-4">
        <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.cleanNoise" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
          {{ t('tools.htmlToMarkdown.cleanNoise') }}
        </label>
        <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.collapseBlank" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
          {{ t('tools.htmlToMarkdown.collapseBlank') }}
        </label>
        <span class="flex-1"></span>
        <button type="button" class="btn-primary" @click="convert">
          {{ t('tools.htmlToMarkdown.convertBtn') }}
        </button>
      </div>
    </section>

    <!-- 输出区 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <div class="flex rounded-xl border border-slate-200 overflow-hidden">
          <button
            type="button"
            class="px-3 py-1.5 text-sm transition select-none"
            :class="activeTab === 'markdown' ? 'bg-blue-600 text-white' : 'bg-white/70 text-slate-600 hover:text-blue-600'"
            @click="activeTab = 'markdown'"
          >
            {{ t('tools.htmlToMarkdown.tabMarkdown') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm transition select-none"
            :class="activeTab === 'preview' ? 'bg-blue-600 text-white' : 'bg-white/70 text-slate-600 hover:text-blue-600'"
            @click="activeTab = 'preview'"
          >
            {{ t('tools.htmlToMarkdown.tabPreview') }}
          </button>
        </div>
        <span class="flex-1"></span>
        <span class="text-xs text-slate-400 whitespace-nowrap">
          {{ charCount }} {{ t('toolsCommon.chars') }} · {{ lineCount }} {{ t('toolsCommon.lines') }}
        </span>
        <CopyButton :text="outputMd" :label="t('toolsCommon.copy')" :disabled="!outputMd" />
        <button type="button" class="btn-ghost" :disabled="!outputMd" @click="downloadMd">
          {{ t('tools.htmlToMarkdown.downloadMd') }}
        </button>
      </div>

      <p v-if="error" class="text-red-600 text-sm mb-2 break-all">{{ error }}</p>

      <template v-if="activeTab === 'markdown'">
        <p v-if="!outputMd && !error" class="text-sm text-slate-400 py-8 text-center">
          {{ t('tools.htmlToMarkdown.emptyOutput') }}
        </p>
        <div
          v-else
          class="font-mono text-sm text-slate-800 whitespace-pre-wrap break-words bg-white/70 rounded-xl border border-slate-200 px-4 py-3 max-h-[560px] overflow-y-auto"
        >{{ outputMd }}</div>
      </template>

      <template v-else>
        <p v-if="!previewHtml" class="text-sm text-slate-400 py-8 text-center">
          {{ t('tools.htmlToMarkdown.emptyOutput') }}
        </p>
        <div
          v-else
          class="md-preview max-h-[560px] overflow-y-auto rounded-xl border border-slate-200 bg-white/80 px-4 py-3"
          role="region"
          :aria-label="t('toolsCommon.preview')"
          v-html="previewHtml"
        ></div>
      </template>
    </section>
  </ToolPage>
</template>

<style scoped>
/* v-html 注入的节点不带 scoped 属性，通过父级 .md-preview + :deep() 命中 */
.md-preview {
  line-height: 1.7;
  color: #334155;
  font-size: 14px;
  word-break: break-word;
}

.md-preview :deep(h1),
.md-preview :deep(h2),
.md-preview :deep(h3),
.md-preview :deep(h4) {
  font-weight: 700;
  color: #1e293b;
  margin: 1em 0 0.4em;
  line-height: 1.35;
}

.md-preview :deep(h1) {
  font-size: 1.5em;
}

.md-preview :deep(h2) {
  font-size: 1.28em;
}

.md-preview :deep(h1:first-child),
.md-preview :deep(h2:first-child),
.md-preview :deep(p:first-child) {
  margin-top: 0;
}

.md-preview :deep(p) {
  margin: 0.55em 0;
}

.md-preview :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.md-preview :deep(ul),
.md-preview :deep(ol) {
  margin: 0.55em 0;
  padding-left: 1.5em;
}

.md-preview :deep(ul) {
  list-style: disc;
}

.md-preview :deep(ol) {
  list-style: decimal;
}

.md-preview :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.4em 0.9em;
  border-left: 4px solid #93c5fd;
  border-radius: 0 8px 8px 0;
  background: rgba(59, 130, 246, 0.06);
  color: #64748b;
}

.md-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.88em;
}

.md-preview :deep(:not(pre) > code) {
  background: rgba(148, 163, 184, 0.16);
  color: #dc2626;
  padding: 0.15em 0.4em;
  border-radius: 6px;
}

.md-preview :deep(pre) {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0.7em 0;
  overflow-x: auto;
  line-height: 1.55;
}

.md-preview :deep(pre code) {
  background: transparent;
  color: #334155;
  padding: 0;
  font-size: 13px;
}

.md-preview :deep(table) {
  border-collapse: collapse;
  margin: 0.7em 0;
  width: 100%;
  font-size: 13px;
}

.md-preview :deep(th),
.md-preview :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  text-align: left;
}

.md-preview :deep(th) {
  background: #f1f5f9;
  font-weight: 600;
  color: #1e293b;
}

.md-preview :deep(hr) {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1em 0;
}

.md-preview :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}
</style>
