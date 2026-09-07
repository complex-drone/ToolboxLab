<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useCancellableDebounceFn } from '@/composables/useCancellableDebounceFn'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText, readFileAsText } from '@/utils/download'
import { escapeHtml } from '@/utils/html'

/**
 * CSV 可视化编辑器（轻量）
 * - 粘贴 CSV 文本或上传 .csv；计票法自动检测分隔符（逗号 / Tab / 分号 / 竖线）
 * - 状态机解析器支持引号包裹与双引号转义；首行表头开关
 * - 双击单元格编辑（Enter 确认下移 / Tab 确认左右移动 / Esc 取消），渲染经 escapeHtml 保证安全
 * - 行列增删（上限 500 行 x 50 列，超出截断提示）；撤销快照栈 20 步
 * - 导出 CSV（合规转义）与 JSON（表头开关决定对象数组或二维数组），复制 CSV
 * - 分隔符与表头开关持久化；编辑内容不超过 100KB 时持久化
 */
const { t } = useI18n()
const toast = useToast()

const MAX_ROWS = 500
const MAX_COLS = 50
const MAX_UNDO = 20
const MAX_PERSIST_LENGTH = 100 * 1024

const DELIM_OPTIONS = [
  { value: ',', key: 'delimComma' },
  { value: '\t', key: 'delimTab' },
  { value: ';', key: 'delimSemicolon' },
  { value: '|', key: 'delimPipe' },
]

const config = useStorage('tool-csv-editor-config', {
  delimiter: ',',
  hasHeader: true,
})
const storedTable = useStorage('tool-csv-editor-table', '')

const csvText = ref('')
const rows = ref([])
const editing = ref(null) // { r, c }
const editValue = ref('')
const undoStack = ref([])
const cellEdits = ref(0)
const truncated = ref(false)
const parseError = ref('')
const persistWarning = ref('')

let editInputEl = null

function setEditInput(el) {
  editInputEl = el
  if (el) {
    el.focus()
    el.select()
  }
}

/* ---------- 解析 ---------- */

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  let best = ','
  let bestCount = -1
  for (const opt of DELIM_OPTIONS) {
    const count = sample.split(opt.value).length - 1
    if (count > bestCount) {
      bestCount = count
      best = opt.value
    }
  }
  return bestCount > 0 ? best : ','
}

function parseCsv(text, delim) {
  const result = []
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
    if (ch === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      row.push(field)
      result.push(row)
      row = []
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      result.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    result.push(row)
  }
  return result
}

function normalize(parsed) {
  const sliced = parsed.slice(0, MAX_ROWS)
  const cols = Math.min(MAX_COLS, sliced.reduce((m, r) => Math.max(m, r.length), 0))
  truncated.value = parsed.length > MAX_ROWS || sliced.some(r => r.length > MAX_COLS)
  return sliced.map(r => {
    const cells = r.slice(0, MAX_COLS).map(v => (typeof v === 'string' ? v : ''))
    while (cells.length < cols) cells.push('')
    return cells
  })
}

/**
 * 解析 csvText 为表格
 * @param {boolean} detect - 是否重新检测分隔符（粘贴新内容 / 上传 / 示例时为 true）
 */
function parseFromText(detect = true) {
  parseError.value = ''
  editing.value = null
  const text = csvText.value
  if (!text.trim()) {
    rows.value = []
    undoStack.value = []
    cellEdits.value = 0
    truncated.value = false
    return
  }
  try {
    if (detect) {
      config.value.delimiter = detectDelimiter(text)
    }
    const parsed = parseCsv(text, config.value.delimiter)
    rows.value = normalize(parsed)
    undoStack.value = []
    cellEdits.value = 0
  } catch {
    parseError.value = t('tools.csvEditor.parseFailed')
  }
}

const parseDebounced = useCancellableDebounceFn(() => parseFromText(true), 300)

const colCount = computed(() => rows.value.reduce((m, r) => Math.max(m, r.length), 0))
const headerOffset = computed(() => (config.value.hasHeader ? 1 : 0))
const headerCells = computed(() => (config.value.hasHeader && rows.value.length ? rows.value[0] : null))
const bodyRows = computed(() => (headerOffset.value ? rows.value.slice(1) : rows.value))

/* ---------- 撤销 ---------- */

function pushUndo() {
  undoStack.value.push(JSON.stringify(rows.value))
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
}

function undo() {
  const snap = undoStack.value.pop()
  if (!snap) return
  try {
    rows.value = JSON.parse(snap)
  } catch {
    /* 快照损坏，忽略 */
  }
  editing.value = null
}

/* ---------- 编辑 ---------- */

function startEdit(r, c) {
  const rowArr = rows.value[r]
  if (!rowArr || c >= rowArr.length) return
  editing.value = { r, c }
  editValue.value = rowArr[c]
  nextTick(() => setEditInput(editInputEl))
}

function commitEdit(dr, dc) {
  const cur = editing.value
  if (!cur) return
  const rowArr = rows.value[cur.r]
  if (rowArr && cur.c < rowArr.length && rowArr[cur.c] !== editValue.value) {
    pushUndo()
    rowArr[cur.c] = editValue.value
    cellEdits.value++
  }
  const nr = cur.r + dr
  const nc = cur.c + dc
  const nextRow = rows.value[nr]
  if (nextRow && nc >= 0 && nc < nextRow.length) {
    editing.value = { r: nr, c: nc }
    editValue.value = nextRow[nc]
    nextTick(() => setEditInput(editInputEl))
  } else {
    editing.value = null
  }
}

function cancelEdit() {
  editing.value = null
}

function onEditKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit(1, 0)
  } else if (e.key === 'Tab') {
    e.preventDefault()
    commitEdit(0, e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function onEditBlur() {
  commitEdit(0, 0)
}

function renderCell(value) {
  return escapeHtml(typeof value === 'string' ? value : '')
}

/* ---------- 行列操作 ---------- */

function insertRowAfter(r) {
  if (rows.value.length >= MAX_ROWS) {
    toast.info(t('tools.csvEditor.addRowLimit'))
    return
  }
  pushUndo()
  const cols = colCount.value || 1
  rows.value.splice(r + 1, 0, new Array(cols).fill(''))
}

function addRow() {
  insertRowAfter(rows.value.length - 1 >= 0 ? rows.value.length - 1 : -1)
}

function deleteRow(r) {
  if (!rows.value.length) return
  pushUndo()
  rows.value.splice(r, 1)
  if (editing.value && editing.value.r >= rows.value.length) editing.value = null
}

function addCol() {
  if (colCount.value >= MAX_COLS) {
    toast.info(t('tools.csvEditor.addColLimit'))
    return
  }
  pushUndo()
  if (!rows.value.length) {
    rows.value.push([''])
    return
  }
  rows.value.forEach(row => row.push(''))
}

function deleteCol(c) {
  if (!colCount.value) return
  pushUndo()
  rows.value.forEach(row => {
    if (row.length > c) row.splice(c, 1)
  })
  if (editing.value && editing.value.c === c) editing.value = null
}

/* ---------- 导出 ---------- */

function quoteField(value) {
  const s = typeof value === 'string' ? value : String(value ?? '')
  if (s.indexOf('"') >= 0 || s.indexOf(config.value.delimiter) >= 0 || /[\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

const csvOutput = computed(() =>
  rows.value.map(row => row.map(quoteField).join(config.value.delimiter)).join('\r\n')
)

function buildJson() {
  if (!rows.value.length) return '[]'
  if (!config.value.hasHeader) {
    return JSON.stringify(rows.value, null, 2)
  }
  const header = rows.value[0].map((h, i) => (h && h.trim() ? h.trim() : `column_${i + 1}`))
  const out = []
  for (let r = 1; r < rows.value.length; r++) {
    const obj = {}
    rows.value[r].forEach((cell, c) => {
      const key = header[c] || `column_${c + 1}`
      obj[key] = cell
    })
    out.push(obj)
  }
  return JSON.stringify(out, null, 2)
}

function exportCsv() {
  if (!rows.value.length) return
  try {
    downloadText('\uFEFF' + csvOutput.value, 'table.csv', 'text/csv;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function exportJson() {
  if (!rows.value.length) return
  try {
    downloadText(buildJson(), 'table.json', 'application/json;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------- 输入与示例 ---------- */

async function onFile(f) {
  try {
    const text = await readFileAsText(f)
    csvText.value = text
    parseFromText(true)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function loadSample() {
  csvText.value = t('tools.csvEditor.sampleData')
  parseFromText(true)
}

function clearAll() {
  pushUndo()
  rows.value = []
  csvText.value = ''
  editing.value = null
  truncated.value = false
  parseError.value = ''
}

/* ---------- 持久化 ---------- */

watch(rows, () => {
  if (!rows.value.length) {
    storedTable.value = ''
    persistWarning.value = ''
    return
  }
  const csv = csvOutput.value
  if (csv.length <= MAX_PERSIST_LENGTH) {
    storedTable.value = csv
    persistWarning.value = ''
  } else {
    storedTable.value = ''
    persistWarning.value = t('tools.csvEditor.tooLargeNoPersist')
  }
}, { deep: true })

watch(() => config.value.hasHeader, () => {
  editing.value = null
})

onMounted(() => {
  const saved = storedTable.value
  if (saved && saved.trim()) {
    csvText.value = saved
    parseFromText(false)
  }
})

onBeforeUnmount(() => {
  parseDebounced.cancel()
})
</script>

<template>
  <ToolPage tool-id="csvEditor">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-2 mb-1.5">
        <label for="csv-input" class="label-base flex-1 mb-0">{{ t('tools.csvEditor.inputLabel') }}</label>
        <span class="text-xs text-slate-400">{{ csvText.length }} {{ t('toolsCommon.chars') }}</span>
      </div>
      <textarea
        id="csv-input"
        v-model="csvText"
        class="input-base w-full h-32 resize-y font-mono text-sm"
        :placeholder="t('tools.csvEditor.inputPlaceholder')"
        spellcheck="false"
        @input="parseDebounced()"
      ></textarea>

      <div class="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" class="btn-primary" @click="parseFromText(true)">
          {{ t('tools.csvEditor.parseBtn') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadSample">{{ t('toolsCommon.example') }}</button>
        <button type="button" class="btn-danger" @click="clearAll">{{ t('toolsCommon.clear') }}</button>
      </div>

      <div class="mt-4">
        <FileDropZone accept=".csv,text/csv" :max-size-mb="20" @files="onFile" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label for="csv-delim" class="label-base">{{ t('tools.csvEditor.delimiter') }}</label>
          <select
            id="csv-delim"
            v-model="config.delimiter"
            class="input-base w-full"
            @change="parseFromText(false)"
          >
            <option v-for="opt in DELIM_OPTIONS" :key="opt.value" :value="opt.value">
              {{ t(`tools.csvEditor.${opt.key}`) }}
            </option>
          </select>
        </div>
        <div class="flex items-end pb-2.5">
          <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input v-model="config.hasHeader" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.csvEditor.headerToggle') }}
          </label>
        </div>
      </div>

      <p v-if="parseError" class="mt-3 text-sm text-red-600">{{ parseError }}</p>
      <p v-if="truncated" class="mt-3 text-sm text-amber-600">{{ t('tools.csvEditor.truncated') }}</p>
    </section>

    <!-- 统计 chips -->
    <section v-if="rows.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip bg-blue-100 text-blue-700">{{ rows.length }} {{ t('tools.csvEditor.rowsCount') }}</span>
        <span class="chip bg-blue-100 text-blue-700">{{ colCount }} {{ t('tools.csvEditor.colsCount') }}</span>
        <span class="chip bg-slate-100 text-slate-500">{{ cellEdits }} {{ t('tools.csvEditor.cellEdits') }}</span>
        <span class="chip bg-emerald-100 text-emerald-700">
          {{ t('tools.csvEditor.headerOn') }} {{ config.hasHeader ? t('toolsCommon.yes') : t('toolsCommon.no') }}
        </span>
        <div class="flex flex-wrap gap-2 ml-auto">
          <button type="button" class="btn-ghost" :disabled="!undoStack.length" @click="undo">
            {{ t('tools.csvEditor.undo') }}
          </button>
          <CopyButton :text="csvOutput" :label="t('tools.csvEditor.copyCsv')" :disabled="!rows.length" />
          <button type="button" class="btn-ghost" :disabled="!rows.length" @click="exportCsv">
            {{ t('tools.csvEditor.exportCsv') }}
          </button>
          <button type="button" class="btn-ghost" :disabled="!rows.length" @click="exportJson">
            {{ t('tools.csvEditor.exportJson') }}
          </button>
        </div>
      </div>
      <p v-if="persistWarning" class="mt-2 text-xs text-amber-600">{{ persistWarning }}</p>
    </section>

    <!-- 表格 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="section-title mb-0 flex-1">{{ t('tools.csvEditor.tableTitle') }}</h2>
        <button type="button" class="btn-ghost" :disabled="rows.length >= MAX_ROWS" @click="addRow">
          {{ t('tools.csvEditor.addRow') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="colCount >= MAX_COLS" @click="addCol">
          {{ t('tools.csvEditor.addCol') }}
        </button>
      </div>
      <p class="text-xs text-slate-400 mb-3">{{ t('tools.csvEditor.editHint') }}</p>

      <div v-if="!rows.length" class="py-8 text-center">
        <p class="text-sm text-slate-400">{{ t('tools.csvEditor.emptyTable') }}</p>
      </div>

      <div v-else class="overflow-x-auto rounded-xl border border-slate-200 bg-white/90">
        <table class="min-w-full border-collapse text-xs">
          <thead>
            <!-- 列操作行 -->
            <tr class="bg-slate-100">
              <th class="op-cell border border-slate-200"></th>
              <th v-for="c in colCount" :key="'op-' + c" class="op-cell border border-slate-200">
                <button
                  type="button"
                  class="op-btn text-red-400 hover:text-red-600"
                  :title="t('tools.csvEditor.deleteCol')"
                  @click="deleteCol(c - 1)"
                >
                  ×
                </button>
              </th>
              <th class="op-cell border border-slate-200">
                <button
                  type="button"
                  class="op-btn text-blue-500 hover:text-blue-700 font-bold"
                  :title="t('tools.csvEditor.addCol')"
                  @click="addCol"
                >
                  +
                </button>
              </th>
            </tr>
            <!-- 表头行 -->
            <tr v-if="headerCells" class="bg-slate-50">
              <th class="op-cell border border-slate-200"></th>
              <th
                v-for="(cell, c) in headerCells"
                :key="'h-' + c"
                class="cell-box border border-slate-200 bg-slate-50 font-semibold text-slate-700 min-w-24"
                @dblclick="startEdit(0, c)"
              >
                <input
                  v-if="editing && editing.r === 0 && editing.c === c"
                  v-model="editValue"
                  :ref="setEditInput"
                  class="edit-input"
                  @keydown="onEditKeydown"
                  @blur="onEditBlur"
                />
                <span v-else v-html="renderCell(cell)" class="cell-text"></span>
              </th>
              <th class="op-cell border border-slate-200"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in bodyRows" :key="'r-' + i">
              <td class="op-cell border border-slate-200 text-center">
                <button
                  type="button"
                  class="op-btn text-red-400 hover:text-red-600"
                  :title="t('tools.csvEditor.deleteRow')"
                  @click="deleteRow(i + headerOffset)"
                >
                  ×
                </button>
              </td>
              <td
                v-for="(cell, c) in row"
                :key="'c-' + i + '-' + c"
                class="cell-box border border-slate-200 text-slate-600 min-w-24"
                @dblclick="startEdit(i + headerOffset, c)"
              >
                <input
                  v-if="editing && editing.r === i + headerOffset && editing.c === c"
                  v-model="editValue"
                  :ref="setEditInput"
                  class="edit-input"
                  @keydown="onEditKeydown"
                  @blur="onEditBlur"
                />
                <span v-else v-html="renderCell(cell)" class="cell-text"></span>
              </td>
              <td class="op-cell border border-slate-200 text-center">
                <button
                  type="button"
                  class="op-btn text-blue-500 hover:text-blue-700 font-bold"
                  :title="t('tools.csvEditor.insertRow')"
                  @click="insertRowAfter(i + headerOffset)"
                >
                  +
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </ToolPage>
</template>

<style scoped>
.op-cell {
  width: 32px;
  padding: 2px;
}

.cell-box {
  padding: 4px 8px;
  vertical-align: top;
  cursor: text;
}

.cell-text {
  display: block;
  min-height: 1.1rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.op-btn {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  transition: all 0.15s;
}

.op-btn:hover {
  background: rgba(148, 163, 184, 0.18);
}

.edit-input {
  width: 100%;
  min-width: 80px;
  padding: 2px 4px;
  font-size: 12px;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  outline: none;
  background: #ffffff;
  color: #1e293b;
}

.min-w-24 {
  min-width: 6rem;
}
</style>
