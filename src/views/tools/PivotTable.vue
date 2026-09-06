<script setup>
import { ref, computed, watch } from 'vue'
import { watchDebounced, useStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadText, readFileAsText } from '@/utils/download'

/**
 * 轻量数据透视表：
 * - 粘贴 CSV / JSON（对象数组）或上传 .csv/.json，自动识别格式解析为记录数组
 * - CSV 为自实现状态机解析器（引号/转义/自动嗅探分隔符 , ; \t |）
 * - 行字段 / 列字段（可选）/ 值字段 + 聚合方式（计数/求和/平均/最大/最小）
 * - 值字段非数值或缺失时求和类聚合自动回退为计数并提示
 * - 透视结果含合计行/列；可导出 CSV 与 JSON；字段选择与聚合方式持久化
 */
const { t } = useI18n()
const toast = useToast()

const PREVIEW_ROWS = 20
const NO_COL = '__single__'

const config = useStorage('tool-pivot-table-config', {
  rowField: '',
  colField: '',
  valueField: '',
  agg: 'count',
})

const AGGS = [
  { key: 'count', label: 'aggCount' },
  { key: 'sum', label: 'aggSum' },
  { key: 'avg', label: 'aggAvg' },
  { key: 'max', label: 'aggMax' },
  { key: 'min', label: 'aggMin' },
]

const rawInput = ref('')
const dataText = ref('')

watchDebounced(rawInput, (v) => { dataText.value = v }, { debounce: 300, maxWait: 800 })

/* ---------- CSV：分隔符嗅探 + 状态机解析 ---------- */
function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || ''
  let best = ','
  let bestCount = -1
  for (const cand of [',', ';', '\t', '|']) {
    const count = firstLine.split(cand).length - 1
    if (count > bestCount) {
      best = cand
      bestCount = count
    }
  }
  return best
}

function parseCsvRows(text, delimiter) {
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
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (inQuotes) throw new Error('csv')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) throw new Error('csv')
  return rows
}

function csvToRecords(text) {
  const rows = parseCsvRows(text, detectCsvDelimiter(text))
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
  if (colCount === 0) throw new Error('csv')
  const header = []
  for (let i = 0; i < colCount; i += 1) {
    const name = (rows[0][i] || '').trim()
    header.push(name || 'col' + (i + 1))
  }
  return rows.slice(1).map((r) => {
    const obj = {}
    header.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : ''
    })
    return obj
  })
}

/* ---------- JSON：对象数组 ---------- */
function jsonToRecords(text) {
  const data = JSON.parse(text)
  if (!Array.isArray(data) || data.some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) {
    throw new Error('json')
  }
  const fields = []
  const seen = new Set()
  data.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k)
        fields.push(k)
      }
    })
  })
  return { records: data, fields }
}

/* ---------- 统一解析（懒计算，仅模板/依赖使用时执行一次） ---------- */
const parseCached = computed(() => {
  const text = dataText.value
  if (!text.trim()) return { records: [], fields: [], error: '', detected: '' }
  try {
    const trimmed = text.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const { records, fields } = jsonToRecords(trimmed)
      return { records, fields, error: '', detected: 'json' }
    }
    const records = csvToRecords(trimmed)
    const fields = []
    const seen = new Set()
    records.forEach((r) => {
      Object.keys(r).forEach((k) => {
        if (!seen.has(k)) {
          seen.add(k)
          fields.push(k)
        }
      })
    })
    return { records, fields, error: '', detected: 'csv' }
  } catch (e) {
    return { records: [], fields: [], error: t('tools.pivotTable.errParse'), detected: '' }
  }
})

const fields = computed(() => parseCached.value.fields)
const records = computed(() => parseCached.value.records)

/* 持久化配置与当前字段对齐 */
watch(
  fields,
  (list) => {
    if (!list.length) return
    if (!list.includes(config.value.rowField)) config.value.rowField = list[0]
    if (config.value.colField && !list.includes(config.value.colField)) config.value.colField = ''
    if (config.value.valueField && !list.includes(config.value.valueField)) config.value.valueField = ''
  },
  { immediate: true }
)

/* ---------- 上传 ---------- */
async function onFiles(payload) {
  const file = Array.isArray(payload) ? payload[0] : payload
  if (!file) return
  try {
    const text = await readFileAsText(file)
    rawInput.value = text
    dataText.value = text
    toast.success(t('toolsCommon.loaded'))
  } catch (e) {
    toast.error(t('toolsCommon.loadFailed'))
  }
}

/* ---------- 聚合 ---------- */
function cleanNum(x) {
  return Math.round(x * 1e9) / 1e9
}

function isBlank(v) {
  return v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function numericValues(recs, field) {
  const nums = []
  for (const r of recs) {
    if (isBlank(r[field])) continue
    const n = Number(r[field])
    if (Number.isFinite(n)) nums.push(n)
  }
  return nums
}

function aggregateRecs(recs, agg, field) {
  if (agg === 'count') return recs.length
  const nums = numericValues(recs, field)
  if (!nums.length) return 0
  if (agg === 'sum') return cleanNum(nums.reduce((a, b) => a + b, 0))
  if (agg === 'avg') return cleanNum(nums.reduce((a, b) => a + b, 0) / nums.length)
  if (agg === 'max') return nums.reduce((a, b) => (b > a ? b : a))
  return nums.reduce((a, b) => (b < a ? b : a))
}

const needsValueField = computed(() => config.value.agg !== 'count')

const valueFieldReady = computed(() => {
  if (!needsValueField.value) return true
  const vf = config.value.valueField
  if (!vf || !fields.value.includes(vf)) return false
  // 字段内所有非空值必须可转为数值
  return records.value.every((r) => {
    if (isBlank(r[vf])) return true
    return Number.isFinite(Number(r[vf]))
  })
})

const effectiveAgg = computed(() => (needsValueField.value && !valueFieldReady.value ? 'count' : config.value.agg))
const showFallback = computed(() => needsValueField.value && !valueFieldReady.value)

/* ---------- 透视构建 ---------- */
function displayVal(v) {
  return isBlank(v) ? '-' : String(v)
}

const pivot = computed(() => {
  const recs = records.value
  const list = fields.value
  const rf = config.value.rowField
  if (!recs.length || !rf || !list.includes(rf)) return null
  const cf = config.value.colField && list.includes(config.value.colField) ? config.value.colField : ''
  const agg = effectiveAgg.value
  const vf = config.value.valueField

  const rowVals = []
  const rowSet = new Set()
  const colVals = []
  const colSet = new Set()
  const groups = new Map()
  for (const r of recs) {
    const rv = displayVal(r[rf])
    const cv = cf ? displayVal(r[cf]) : NO_COL
    if (!rowSet.has(rv)) {
      rowSet.add(rv)
      rowVals.push(rv)
    }
    if (!colSet.has(cv)) {
      colSet.add(cv)
      colVals.push(cv)
    }
    let rowMap = groups.get(rv)
    if (!rowMap) {
      rowMap = new Map()
      groups.set(rv, rowMap)
    }
    let arr = rowMap.get(cv)
    if (!arr) {
      arr = []
      rowMap.set(cv, arr)
    }
    arr.push(r)
  }

  const emptyCell = agg === 'count' ? 0 : ''
  const colHeaders = cf
    ? colVals
    : [agg === 'count' || !vf ? t('tools.pivotTable.countColName') : vf]

  const rows = rowVals.map((rv) => {
    const rowMap = groups.get(rv)
    const cells = colVals.map((cv) => {
      const arr = rowMap.get(cv)
      return arr ? aggregateRecs(arr, agg, vf) : emptyCell
    })
    const all = []
    rowMap.forEach((a) => all.push(...a))
    return { label: rv, cells, total: aggregateRecs(all, agg, vf) }
  })

  const colTotals = colVals.map((cv) => {
    const all = []
    groups.forEach((m) => {
      const a = m.get(cv)
      if (a) all.push(...a)
    })
    return aggregateRecs(all, agg, vf)
  })
  const grandTotal = aggregateRecs(recs, agg, vf)

  return { hasColField: !!cf, colHeaders, rows, colTotals, grandTotal }
})

const comboCount = computed(() => {
  if (!pivot.value) return 0
  return pivot.value.rows.length * pivot.value.colHeaders.length
})

/* ---------- 导出 ---------- */
function escapeCsvCell(cell, delim) {
  const c = String(cell)
  if (c.includes(delim) || c.includes('"') || /[\r\n]/.test(c)) {
    return '"' + c.replace(/"/g, '""') + '"'
  }
  return c
}

function exportCsv() {
  if (!pivot.value) return
  try {
    const delim = ','
    const totalLabel = t('tools.pivotTable.grandTotal')
    const lines = []
    lines.push([config.value.rowField, ...pivot.value.colHeaders, totalLabel].map((h) => escapeCsvCell(h, delim)).join(delim))
    pivot.value.rows.forEach((row) => {
      lines.push([row.label, ...row.cells, row.total].map((c) => escapeCsvCell(c, delim)).join(delim))
    })
    lines.push([totalLabel, ...pivot.value.colTotals, pivot.value.grandTotal].map((c) => escapeCsvCell(c, delim)).join(delim))
    downloadText(lines.join('\r\n'), 'pivot-table.csv', 'text/csv;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

function exportJson() {
  if (!pivot.value) return
  try {
    const totalLabel = t('tools.pivotTable.grandTotal')
    const arr = pivot.value.rows.map((row) => {
      const obj = {}
      obj[config.value.rowField] = row.label
      pivot.value.colHeaders.forEach((h, i) => {
        obj[h] = row.cells[i]
      })
      obj[totalLabel] = row.total
      return obj
    })
    downloadText(JSON.stringify(arr, null, 2), 'pivot-table.json', 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

function clearInput() {
  rawInput.value = ''
  dataText.value = ''
}
</script>

<template>
  <ToolPage tool-id="pivotTable">
    <!-- 数据输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-1.5">
        <span class="label-base flex-1 mb-0">{{ t('toolsCommon.input') }}</span>
        <span v-if="parseCached.detected" class="chip">
          {{ t('tools.pivotTable.detectedLabel') }}: {{ t(`tools.pivotTable.fmt${parseCached.detected === 'csv' ? 'Csv' : 'Json'}`) }}
        </span>
        <button type="button" class="btn-ghost" @click="clearInput">{{ t('toolsCommon.clear') }}</button>
      </div>
      <textarea
        v-model="rawInput"
        class="input-base w-full font-mono h-40 resize-y"
        :placeholder="t('tools.pivotTable.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="parseCached.error" class="mt-2 text-sm text-red-600">{{ parseCached.error }}</p>

      <div class="mt-4">
        <FileDropZone
          accept=".csv,.json,text/csv,application/json"
          :multiple="false"
          :maxSizeMB="5"
          :hint="t('tools.pivotTable.uploadHint')"
          @files="onFiles"
        />
      </div>

      <!-- 字段列表 -->
      <div v-if="fields.length" class="mt-4">
        <span class="section-title">{{ t('tools.pivotTable.fieldsTitle') }}</span>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="f in fields" :key="f" class="chip">{{ f }}</span>
        </div>
      </div>
    </section>

    <!-- 数据预览 -->
    <section v-if="records.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title mb-0 mr-auto">{{ t('toolsCommon.preview') }}</span>
        <span class="chip">{{ t('tools.pivotTable.previewNote', { n: Math.min(PREVIEW_ROWS, records.length) }) }}</span>
        <span class="chip">{{ t('toolsCommon.total') }} {{ records.length }} {{ t('toolsCommon.items') }}</span>
      </div>
      <div class="overflow-x-auto rounded-xl border border-slate-200">
        <table class="w-full text-sm">
          <thead>
            <tr>
              <th v-for="f in fields" :key="f" class="px-3 py-2 text-left whitespace-nowrap bg-slate-50 font-semibold text-slate-700">{{ f }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, ri) in records.slice(0, PREVIEW_ROWS)" :key="ri" class="odd:bg-white even:bg-slate-50">
              <td v-for="f in fields" :key="f" class="px-3 py-1.5 text-left text-slate-600 whitespace-nowrap">{{ displayVal(r[f]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 配置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label class="label-base" for="pivot-row-field">{{ t('tools.pivotTable.rowFieldLabel') }}</label>
          <select id="pivot-row-field" v-model="config.rowField" class="input-base">
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
        <div>
          <label class="label-base" for="pivot-col-field">{{ t('tools.pivotTable.colFieldLabel') }}</label>
          <select id="pivot-col-field" v-model="config.colField" class="input-base">
            <option value="">{{ t('tools.pivotTable.colNone') }}</option>
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
        <div>
          <label class="label-base" for="pivot-value-field">{{ t('tools.pivotTable.valueFieldLabel') }}</label>
          <select id="pivot-value-field" v-model="config.valueField" class="input-base">
            <option value="">{{ t('tools.pivotTable.colNone') }}</option>
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
        <div>
          <label class="label-base" for="pivot-agg">{{ t('tools.pivotTable.aggLabel') }}</label>
          <select id="pivot-agg" v-model="config.agg" class="input-base">
            <option v-for="a in AGGS" :key="a.key" :value="a.key">{{ t(`tools.pivotTable.${a.label}`) }}</option>
          </select>
        </div>
      </div>
      <p v-if="showFallback" class="mt-3 text-sm text-amber-600">{{ t('tools.pivotTable.fallbackNotice') }}</p>
      <div v-if="records.length" class="flex flex-wrap items-center gap-2 mt-3">
        <span class="chip">{{ t('tools.pivotTable.recordsStat') }}: {{ records.length }}</span>
        <template v-if="pivot">
          <span class="chip">{{ t('tools.pivotTable.rowsStat') }} {{ pivot.rows.length }} × {{ t('tools.pivotTable.colsStat') }} {{ pivot.colHeaders.length }}</span>
          <span class="chip">{{ t('tools.pivotTable.combosStat') }}: {{ comboCount }}</span>
        </template>
      </div>
    </section>

    <!-- 透视结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title mb-0 mr-auto">{{ t('tools.pivotTable.resultTitle') }}</span>
        <button type="button" class="btn-ghost" :disabled="!pivot" @click="exportCsv">{{ t('tools.pivotTable.exportCsv') }}</button>
        <button type="button" class="btn-ghost" :disabled="!pivot" @click="exportJson">{{ t('tools.pivotTable.exportJson') }}</button>
      </div>

      <div v-if="!pivot" class="text-sm text-slate-400 py-10 text-center rounded-xl border border-slate-200 bg-white/70">
        {{ t('tools.pivotTable.emptyHint') }}
      </div>
      <div v-else class="overflow-x-auto rounded-xl border border-slate-200">
        <table class="w-full text-sm">
          <thead>
            <tr>
              <th class="px-3 py-2 text-left bg-slate-50 font-semibold text-slate-700 whitespace-nowrap">{{ config.rowField }}</th>
              <th v-for="h in pivot.colHeaders" :key="'h' + h" class="px-3 py-2 text-right bg-slate-50 font-semibold text-slate-700 whitespace-nowrap">{{ h }}</th>
              <th class="px-3 py-2 text-right bg-blue-50 font-semibold text-blue-700 whitespace-nowrap">{{ t('tools.pivotTable.grandTotal') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pivot.rows" :key="row.label" class="odd:bg-white even:bg-slate-50">
              <td class="px-3 py-1.5 text-left text-slate-700 font-medium whitespace-nowrap">{{ row.label }}</td>
              <td v-for="(cell, ci) in row.cells" :key="'c' + ci" class="px-3 py-1.5 text-right text-slate-600 font-mono text-xs whitespace-nowrap">{{ cell }}</td>
              <td class="px-3 py-1.5 text-right text-blue-700 font-mono text-xs font-semibold whitespace-nowrap">{{ row.total }}</td>
            </tr>
            <tr class="bg-blue-50/60 border-t border-slate-200">
              <td class="px-3 py-2 text-left text-blue-700 font-semibold whitespace-nowrap">{{ t('tools.pivotTable.grandTotal') }}</td>
              <td v-for="(cv, ci) in pivot.colTotals" :key="'t' + ci" class="px-3 py-2 text-right text-blue-700 font-mono text-xs font-semibold whitespace-nowrap">{{ cv }}</td>
              <td class="px-3 py-2 text-right text-blue-700 font-mono text-xs font-bold whitespace-nowrap">{{ pivot.grandTotal }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </ToolPage>
</template>
