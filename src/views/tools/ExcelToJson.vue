<script setup>
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText, readFileAsArrayBuffer } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

const BASE = 'tools.excelToJson'
const PREVIEW_LIMIT = 20

/* ---------------- 状态 ---------------- */
const file = ref(null) // { name, size }
const busy = ref(false)
const errorMsg = ref('')
const sheetNames = ref([])
const activeSheet = ref('')
const rowsAll = ref([]) // 当前工作表全部行（保留原始值）
// 首行作为表头，持久化
const headerEnabled = useStorage('tool-excel-to-json-header', true)
const showAll = ref(false)

// 懒加载后的模块缓存（非响应式）
let XLSX_MOD = null
let workbook = null

const baseName = computed(() => {
  const name = file.value ? file.value.name || 'sheet' : 'sheet'
  return name.replace(/\.[^.]+$/, '') || 'sheet'
})

const hasData = computed(() => rowsAll.value.length > 0)

const previewRows = computed(() => {
  if (showAll.value) return rowsAll.value
  return rowsAll.value.slice(0, PREVIEW_LIMIT)
})

const isTruncated = computed(() => rowsAll.value.length > PREVIEW_LIMIT && !showAll.value)

/* ---------------- 单元格格式化 ---------------- */
function pad2(n) {
  return String(n).padStart(2, '0')
}

function fmtCell(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const date = `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
    const time = `${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`
    return `${date} ${time}`
  }
  return String(v)
}

function jsonValue(v) {
  if (v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return v
}

/* ---------------- 解析 ---------------- */
async function onFile(f) {
  if (!f) return
  const n = String(f.name || '').toLowerCase()
  if (!n.endsWith('.xlsx') && !n.endsWith('.xls') && !n.endsWith('.csv')) {
    toast.error(t(`${BASE}.unsupported`))
    return
  }
  errorMsg.value = ''
  sheetNames.value = []
  activeSheet.value = ''
  rowsAll.value = []
  workbook = null
  showAll.value = false
  file.value = { name: f.name, size: f.size }
  busy.value = true
  await nextTick()
  try {
    if (!XLSX_MOD) XLSX_MOD = await import('xlsx')
    const buf = await readFileAsArrayBuffer(f)
    // cellDates: true 让日期单元格解析为 Date 对象，保持原始值
    workbook = XLSX_MOD.read(buf, { type: 'array', cellDates: true, codepage: 65001 })
    sheetNames.value = workbook.SheetNames || []
    if (sheetNames.value.length > 0) {
      loadSheet(sheetNames.value[0])
    }
    toast.success(t(`${BASE}.convertDone`))
  } catch {
    workbook = null
    rowsAll.value = []
    errorMsg.value = t(`${BASE}.parseFailed`)
    toast.error(t(`${BASE}.parseFailed`))
  } finally {
    busy.value = false
  }
}

function loadSheet(name) {
  if (!workbook || !XLSX_MOD) return
  activeSheet.value = name
  showAll.value = false
  const ws = workbook.Sheets[name]
  if (!ws) {
    rowsAll.value = []
    return
  }
  try {
    const arr = XLSX_MOD.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
    rowsAll.value = Array.isArray(arr) ? arr : []
  } catch {
    rowsAll.value = []
  }
}

/* ---------------- JSON 构建 ---------------- */
function buildHeaderKeys(headerRow) {
  const seen = new Map()
  return headerRow.map((h, i) => {
    let key = fmtCell(h).trim()
    if (!key) key = `column_${i + 1}`
    const count = seen.get(key) || 0
    seen.set(key, count + 1)
    return count > 0 ? `${key}_${count + 1}` : key
  })
}

const jsonOutput = computed(() => {
  const rows = rowsAll.value
  if (!rows.length) return ''
  try {
    if (headerEnabled.value) {
      const keys = buildHeaderKeys(rows[0])
      const out = []
      for (let r = 1; r < rows.length; r++) {
        const obj = {}
        const row = rows[r]
        keys.forEach((key, c) => {
          obj[key] = jsonValue(row[c])
        })
        out.push(obj)
      }
      return JSON.stringify(out, null, 2)
    }
    return JSON.stringify(rows.map((row) => row.map(jsonValue)), null, 2)
  } catch {
    return ''
  }
})

/* ---------------- 导出 ---------------- */
function downloadJson() {
  if (!jsonOutput.value) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  try {
    downloadText(jsonOutput.value, `${baseName.value}.json`, 'application/json;charset=utf-8')
    toast.success(t(`${BASE}.jsonDownloaded`))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function downloadCsv() {
  if (!workbook || !XLSX_MOD || !activeSheet.value) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  try {
    const ws = workbook.Sheets[activeSheet.value]
    if (!ws) return
    const csv = XLSX_MOD.utils.sheet_to_csv(ws)
    if (!csv.trim()) {
      toast.info(t(`${BASE}.emptySheet`))
      return
    }
    // UTF-8 BOM：保证 Excel 直接打开中文不乱码
    downloadText('\uFEFF' + csv, `${baseName.value}.csv`, 'text/csv;charset=utf-8')
    toast.success(t(`${BASE}.csvDownloaded`))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function toggleShowAll() {
  showAll.value = !showAll.value
}
</script>

<template>
  <ToolPage tool-id="excelToJson">
    <!-- 上传 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.uploadTitle`) }}</h2>
      <FileDropZone
        accept=".xlsx,.xls,.csv"
        :multiple="false"
        :maxSizeMB="20"
        @files="onFile"
      />

      <div v-if="file" class="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <div class="flex gap-2 min-w-0">
          <span class="text-slate-400 shrink-0">{{ t('toolsCommon.input') }}:</span>
          <span class="text-slate-700 break-all">{{ file.name }}</span>
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
    </div>

    <!-- 数据预览 -->
    <div v-if="file && !busy" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.previewTitle`) }}</h2>

      <!-- 工作表选择 -->
      <div v-if="sheetNames.length > 1" class="mb-4">
        <label class="label-base" for="x2j-sheet">{{ t(`${BASE}.sheetLabel`) }}</label>
        <select id="x2j-sheet" class="input-base sm:max-w-xs" :value="activeSheet" @change="loadSheet($event.target.value)">
          <option v-for="name in sheetNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <p v-else-if="sheetNames.length === 1" class="text-xs text-slate-400 mb-3">
        {{ t(`${BASE}.sheetLabel`) }}: {{ sheetNames[0] }}
      </p>

      <template v-if="hasData">
        <!-- 首行表头开关 -->
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <label class="inline-flex items-center gap-2 cursor-pointer select-none">
            <input v-model="headerEnabled" type="checkbox" class="w-4 h-4 accent-blue-600" />
            <span class="text-sm font-medium text-slate-600">{{ t(`${BASE}.headerToggle`) }}</span>
          </label>
          <span class="text-xs text-slate-400">
            {{ headerEnabled ? t(`${BASE}.headerHintOn`) : t(`${BASE}.headerHintOff`) }}
          </span>
        </div>

        <!-- 行数信息 + 显示全部 -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span class="text-xs text-slate-400">
            {{ isTruncated ? t(`${BASE}.previewRows`, { total: rowsAll.length }) : t(`${BASE}.totalRows`, { total: rowsAll.length }) }}
          </span>
          <button v-if="rowsAll.length > PREVIEW_LIMIT" type="button" class="btn-ghost text-xs" @click="toggleShowAll">
            {{ showAll ? t(`${BASE}.showLess`) : t(`${BASE}.showAll`) }}
          </button>
        </div>

        <!-- 表格 -->
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="w-full text-sm border-collapse">
            <thead v-if="headerEnabled">
              <tr class="bg-slate-50">
                <th class="px-3 py-2 text-left text-xs font-medium text-slate-400 border-b border-slate-200">#</th>
                <th
                  v-for="(cell, i) in previewRows[0]"
                  :key="`h${i}`"
                  class="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap"
                >
                  {{ fmtCell(cell) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, r) in headerEnabled ? previewRows.slice(1) : previewRows"
                :key="r"
                class="hover:bg-blue-50/40"
              >
                <td class="px-3 py-1.5 text-xs text-slate-300 border-b border-slate-100 whitespace-nowrap">
                  {{ r + 1 }}
                </td>
                <td
                  v-for="(cell, c) in row"
                  :key="`c${c}`"
                  class="px-3 py-1.5 text-slate-600 border-b border-slate-100 whitespace-nowrap max-w-60 truncate"
                  :title="fmtCell(cell)"
                >
                  {{ fmtCell(cell) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-3 text-xs text-slate-400">{{ t(`${BASE}.rawValueNote`) }}</p>
      </template>

      <!-- 空 sheet -->
      <div v-else class="text-center py-8">
        <p class="text-sm text-slate-500">{{ t(`${BASE}.emptySheet`) }}</p>
        <p class="text-xs text-slate-400 mt-1">{{ t(`${BASE}.emptySheetHint`) }}</p>
      </div>
    </div>

    <!-- JSON / CSV 导出 -->
    <div v-if="file && !busy" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.jsonTitle`) }}</h2>
      <p class="text-xs text-slate-400 mb-3">{{ t(`${BASE}.jsonDesc`) }}</p>

      <template v-if="jsonOutput">
        <div class="relative">
          <pre class="json-block">{{ jsonOutput }}</pre>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <CopyButton :text="jsonOutput" :label="t('toolsCommon.copyAll')" />
          <button type="button" class="btn-primary" @click="downloadJson">
            {{ t(`${BASE}.exportJson`) }}
          </button>
          <button type="button" class="btn-ghost" @click="downloadCsv">
            {{ t(`${BASE}.exportCsv`) }}
          </button>
        </div>
        <p class="mt-3 text-xs text-slate-400">{{ t(`${BASE}.bomNote`) }}</p>
      </template>
      <p v-else class="text-sm text-slate-400 text-center py-6">{{ t('toolsCommon.none') }}</p>
    </div>
  </ToolPage>
</template>

<style scoped>
.json-block {
  max-height: 26rem;
  overflow: auto;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(248, 250, 252, 0.9);
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
  white-space: pre;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
