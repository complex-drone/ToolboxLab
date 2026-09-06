<script setup>
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadText, readFileAsArrayBuffer } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

const BASE = 'tools.officeConverter'

/* ---------------- 状态 ---------------- */
const file = ref(null) // { name, size }
const kind = ref('') // docx | sheet
const busy = ref(false)
const errorMsg = ref('')

const htmlOut = ref('') // docx 转换出的 HTML 片段
const sheetNames = ref([])
const activeSheet = ref('')
const rows = ref([]) // 当前工作表全部行（数组套数组，字符串）
const previewRows = computed(() => rows.value.slice(0, 50))

// 懒加载后的模块缓存（非响应式）
let XLSX_MOD = null
let workbook = null

const baseName = computed(() => {
  const name = file.value ? file.value.name || 'document' : 'document'
  return name.replace(/\.[^.]+$/, '') || 'document'
})

function resetState() {
  kind.value = ''
  htmlOut.value = ''
  sheetNames.value = []
  activeSheet.value = ''
  rows.value = []
  workbook = null
  errorMsg.value = ''
}

function detectKind(name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.docx')) return 'docx'
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv')) return 'sheet'
  return ''
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ---------------- 解析 ---------------- */
async function loadXlsx() {
  if (!XLSX_MOD) XLSX_MOD = await import('xlsx')
  return XLSX_MOD
}

async function loadMammoth() {
  try {
    const mod = await import('mammoth/mammoth.browser.min.js')
    return mod && mod.default ? mod.default : mod
  } catch {
    // 浏览器独立构建不可用时回退到包主入口
    const mod = await import('mammoth')
    return mod && mod.default ? mod.default : mod
  }
}

function loadSheet(name) {
  if (!workbook || !XLSX_MOD) return
  const ws = workbook.Sheets[name]
  if (!ws) {
    rows.value = []
    return
  }
  try {
    rows.value = XLSX_MOD.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
  } catch {
    rows.value = []
  }
  activeSheet.value = name
}

async function onFile(f) {
  if (!f) return
  const detected = detectKind(f.name)
  if (!detected) {
    toast.error(t(`${BASE}.unsupported`))
    return
  }
  resetState()
  file.value = { name: f.name, size: f.size }
  kind.value = detected
  busy.value = true
  await nextTick()
  try {
    const buf = await readFileAsArrayBuffer(f)
    if (detected === 'docx') {
      const mammoth = await loadMammoth()
      const res = await mammoth.convertToHtml({ arrayBuffer: buf })
      htmlOut.value = res && res.value ? res.value : ''
    } else {
      const XLSX = await loadXlsx()
      workbook = XLSX.read(buf, { type: 'array', codepage: 65001 })
      sheetNames.value = workbook.SheetNames || []
      if (sheetNames.value.length > 0) {
        loadSheet(sheetNames.value[0])
      }
    }
    toast.success(t(`${BASE}.convertDone`))
  } catch {
    errorMsg.value = t(`${BASE}.parseFailed`)
    toast.error(t(`${BASE}.parseFailed`))
  } finally {
    busy.value = false
  }
}

function onSheetChange(name) {
  loadSheet(name)
}

/* ---------------- HTML 构建 ---------------- */
function buildStyledDocument(inner) {
  return [
    '<!DOCTYPE html>',
    '<html lang="utf-8">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${esc(baseName.value)}</title>`,
    '<style>',
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; max-width: 800px; margin: 0 auto; padding: 32px 20px; line-height: 1.7; font-size: 15px; }',
    'h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.2em 0 0.6em; }',
    'p { margin: 0.6em 0; }',
    'img { max-width: 100%; height: auto; }',
    'table { border-collapse: collapse; width: 100%; margin: 1em 0; }',
    'th, td { border: 1px solid #9ca3af; padding: 6px 10px; text-align: left; vertical-align: top; }',
    'th { background: #f3f4f6; }',
    'ul, ol { padding-left: 1.6em; }',
    'a { color: #2563eb; }',
    'blockquote { border-left: 4px solid #d1d5db; margin: 1em 0; padding: 0.2em 1em; color: #4b5563; }',
    'code, pre { background: #f3f4f6; border-radius: 4px; font-size: 0.92em; }',
    'pre { padding: 12px; overflow-x: auto; }',
    '</style>',
    '</head>',
    `<body>${inner}</body>`,
    '</html>',
  ].join('\n')
}

/* ---------------- 导出 ---------------- */
function currentInnerHtml() {
  if (kind.value === 'docx') return htmlOut.value
  if (kind.value === 'sheet') {
    if (!rows.value.length) return ''
    // 用语义化表格结构输出，首行作为表头
    const [head, ...body] = rows.value
    const headHtml = `<thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
    const bodyHtml = body
      .map((cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('\n')
    return `<table>${headHtml}<tbody>${bodyHtml}</tbody></table>`
  }
  return ''
}

function hasOutput() {
  return Boolean(currentInnerHtml().trim())
}

function downloadHtml() {
  const inner = currentInnerHtml()
  if (!inner) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  try {
    downloadText(buildStyledDocument(inner), `${baseName.value}.html`, 'text/html;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

async function downloadCsv() {
  if (kind.value !== 'sheet' || !workbook || !XLSX_MOD) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  try {
    const ws = workbook.Sheets[activeSheet.value]
    if (!ws) return
    const csv = XLSX_MOD.utils.sheet_to_csv(ws)
    // 加 UTF-8 BOM，保证 Excel 直接打开中文不乱码
    downloadText('\uFEFF' + csv, `${baseName.value}-${activeSheet.value || 'sheet'}.csv`, 'text/csv;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function printOrExportPdf() {
  const inner = currentInnerHtml()
  if (!inner) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  const win = window.open('', '_blank')
  if (!win) {
    toast.error(t(`${BASE}.printBlocked`))
    return
  }
  try {
    win.document.open()
    win.document.write(buildStyledDocument(inner))
    win.document.close()
    win.focus()
    // 等文档写入完成后再调起打印
    setTimeout(() => {
      try {
        win.print()
      } catch {
        // 用户环境不支持自动打印时可手动 Ctrl+P
      }
    }, 350)
    toast.info(t(`${BASE}.printDone`))
  } catch {
    toast.error(t(`${BASE}.printBlocked`))
  }
}

const typeLabel = computed(() => {
  if (kind.value === 'docx') return t(`${BASE}.typeDocx`)
  if (kind.value === 'sheet') return t(`${BASE}.typeSheet`)
  return ''
})
</script>

<template>
  <ToolPage tool-id="officeConverter">
    <!-- 上传 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.uploadTitle`) }}</h2>
      <FileDropZone
        accept=".docx,.xlsx,.xls,.csv"
        :multiple="false"
        :maxSizeMB="20"
        :hint="t(`${BASE}.uploadHint`)"
        @files="onFile"
      />

      <div v-if="file" class="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <div class="flex gap-2 min-w-0">
          <span class="text-slate-400 shrink-0">{{ t('toolsCommon.input') }}:</span>
          <span class="text-slate-700 break-all">{{ file.name }}</span>
        </div>
        <div class="flex gap-2">
          <span class="text-slate-400 shrink-0">{{ t(`${BASE}.detectLabel`) }}:</span>
          <span class="text-slate-700">{{ typeLabel }}</span>
        </div>
        <div class="flex gap-2">
          <span class="text-slate-400 shrink-0">{{ t('toolsCommon.bytes') }}:</span>
          <span class="text-slate-700">{{ formatBytes(file.size) }}</span>
        </div>
      </div>

      <p v-if="busy" class="mt-3 text-sm text-slate-500 flex items-center gap-2">
        <svg class="animate-spin w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
        {{ t('toolsCommon.processing') }}
      </p>

      <p v-if="errorMsg" class="mt-3 text-sm text-red-600">{{ errorMsg }}</p>

      <!-- 说明 -->
      <div class="mt-5 rounded-xl border border-slate-200 bg-white/60 p-3">
        <ul class="text-xs text-slate-500 leading-relaxed list-disc pl-4 space-y-1">
          <li>{{ t(`${BASE}.docxNote`) }}</li>
          <li>{{ t(`${BASE}.sheetNote`) }}</li>
          <li>{{ t(`${BASE}.localNote`) }}</li>
        </ul>
      </div>
    </div>

    <!-- 预览 -->
    <div v-if="file && !busy" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title !mb-0">{{ t(`${BASE}.previewTitle`) }}</h2>
        <span v-if="typeLabel" class="chip">{{ typeLabel }}</span>
      </div>

      <!-- docx 预览 -->
      <template v-if="kind === 'docx'">
        <div v-if="htmlOut.trim()" class="docx-preview max-w-prose mx-auto" v-html="htmlOut"></div>
        <p v-else class="text-sm text-slate-400 text-center py-6">{{ t('toolsCommon.none') }}</p>
      </template>

      <!-- 表格预览 -->
      <template v-else-if="kind === 'sheet'">
        <div v-if="sheetNames.length > 1" class="mb-4">
          <label class="label-base" for="oc-sheet">{{ t(`${BASE}.sheetLabel`) }}</label>
          <select id="oc-sheet" class="input-base sm:max-w-xs" :value="activeSheet" @change="onSheetChange($event.target.value)">
            <option v-for="name in sheetNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>

        <div v-if="rows.length">
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="bg-slate-50">
                  <th class="px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-slate-200 whitespace-nowrap">#</th>
                  <th
                    v-for="(cell, i) in previewRows[0]"
                    :key="i"
                    class="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap"
                  >
                    {{ cell }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, r) in previewRows.slice(1)"
                  :key="r"
                  class="even:bg-white/40 odd:bg-transparent"
                >
                  <td class="px-3 py-1.5 text-xs text-slate-300 border-b border-slate-100 whitespace-nowrap">{{ r + 1 }}</td>
                  <td
                    v-for="(cell, c) in row"
                    :key="c"
                    class="px-3 py-1.5 text-slate-600 border-b border-slate-100 whitespace-nowrap max-w-60 truncate"
                    :title="String(cell)"
                  >
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="rows.length > 50" class="mt-2 text-xs text-slate-400">
            {{ t(`${BASE}.rowsShown`, { n: 50 }) }}
          </p>
        </div>
        <p v-else class="text-sm text-slate-400 text-center py-6">{{ t(`${BASE}.sheetEmpty`) }}</p>
      </template>
    </div>

    <!-- 导出 -->
    <div v-if="file && !busy" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.output') }}</h2>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="!hasOutput()" @click="downloadHtml">
          {{ t(`${BASE}.downloadHtml`) }}
        </button>
        <button
          v-if="kind === 'sheet'"
          type="button"
          class="btn-ghost"
          :disabled="!rows.length"
          @click="downloadCsv"
        >
          {{ t(`${BASE}.downloadCsv`) }}
        </button>
      </div>

      <div class="mt-5 pt-4 border-t border-slate-100">
        <h3 class="section-title">{{ t(`${BASE}.printTitle`) }}</h3>
        <p class="text-sm text-slate-500 mb-3">{{ t(`${BASE}.printDesc`) }}</p>
        <button type="button" class="btn-primary" :disabled="!hasOutput()" @click="printOrExportPdf">
          <svg
            viewBox="0 0 24 24"
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          {{ t(`${BASE}.printBtn`) }}
        </button>
      </div>
    </div>
  </ToolPage>
</template>

<style scoped>
/* v-html 内容无法命中 scoped 规则，需要 :deep */
.docx-preview :deep(h1) { font-size: 1.6em; font-weight: 700; margin: 1em 0 0.5em; }
.docx-preview :deep(h2) { font-size: 1.35em; font-weight: 700; margin: 1em 0 0.5em; }
.docx-preview :deep(h3) { font-size: 1.15em; font-weight: 600; margin: 0.9em 0 0.5em; }
.docx-preview :deep(h4),
.docx-preview :deep(h5),
.docx-preview :deep(h6) { font-size: 1em; font-weight: 600; margin: 0.9em 0 0.4em; }
.docx-preview :deep(p) { margin: 0.6em 0; line-height: 1.75; color: #334155; }
.docx-preview :deep(ul),
.docx-preview :deep(ol) { padding-left: 1.6em; margin: 0.6em 0; color: #334155; }
.docx-preview :deep(li) { margin: 0.25em 0; }
.docx-preview :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.docx-preview :deep(table) { border-collapse: collapse; width: 100%; margin: 1em 0; }
.docx-preview :deep(th),
.docx-preview :deep(td) { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
.docx-preview :deep(a) { color: #2563eb; text-decoration: underline; }
.docx-preview :deep(blockquote) { border-left: 4px solid #cbd5e1; padding-left: 1em; color: #64748b; }
</style>
