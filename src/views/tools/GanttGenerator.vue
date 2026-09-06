<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import { downloadText, downloadCanvasAsPng } from '@/utils/download'
// frappe-gantt 的 exports 字段未暴露 ./dist 子路径（Vite 会拒绝解析裸子路径导入），
// 因此以相对路径静态引入其样式表，效果与 import 'frappe-gantt/dist/frappe-gantt.css' 一致
import '../../../node_modules/frappe-gantt/dist/frappe-gantt.css'

/**
 * 甘特图生成器
 * - frappe-gantt 懒加载（函数内 await import），单例实例 + refresh 增量重渲染
 * - 任务层级为简化方案：列表按父子缩进编号展示（子任务前缀 └），图内子任务照常渲染，
 *   含子任务的行显示聚合时间范围
 * - 拖拽（on_date_change / on_progress_change）写回任务列表；写回时抑制 watch 防止循环重渲染
 * - 导出：SVG 克隆图表 svg 根节点、内嵌关键样式并把 HTML 日期表头写回为 svg 文本；
 *   PNG 经 svg → Image → 离屏 canvas 2x → toDataURL
 */

const { t, locale } = useI18n()
const toast = useToast()

/* ---------- 日期工具（全部走本地时区，避免 UTC 偏移） ---------- */

function pad2(n) {
  return String(n).padStart(2, '0')
}

function fmtISO(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

function addDaysISO(iso, days) {
  const parts = iso.split('-').map(Number)
  return fmtISO(new Date(parts[0], parts[1] - 1, parts[2] + days))
}

function isValidStart(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidDuration(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 1
}

function clampDuration(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 3650)
}

function clampProgress(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

let idSeed = 0
function genId() {
  idSeed += 1
  return 't' + Date.now().toString(36) + '-' + idSeed.toString(36)
}

/* ---------- 任务数据（useStorage 数组持久化） ---------- */

function defaultTasks() {
  const today = fmtISO(new Date())
  return [
    { id: 't-phase-1', name: '第一阶段：筹备', start: today, duration: 5, progress: 40, parentId: '' },
    { id: 't-research', name: '需求调研', start: today, duration: 2, progress: 60, parentId: 't-phase-1' },
    { id: 't-design', name: '原型设计', start: addDaysISO(today, 2), duration: 3, progress: 20, parentId: 't-phase-1' },
    { id: 't-phase-2', name: '第二阶段：开发', start: addDaysISO(today, 5), duration: 7, progress: 0, parentId: '' },
  ]
}

function normalizeTask(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  return {
    id: typeof item.id === 'string' && item.id ? item.id : genId(),
    name: typeof item.name === 'string' ? item.name : '',
    start: isValidStart(item.start) ? item.start : '',
    duration: clampDuration(item.duration),
    progress: clampProgress(item.progress),
    parentId: typeof item.parentId === 'string' ? item.parentId : '',
  }
}

const tasks = useStorage('tool-gantt-generator-tasks', defaultTasks())

/* ---------- 视图模式（持久化） ---------- */

const VIEW_MODES = [
  { value: 'Day', key: 'viewDay' },
  { value: 'Week', key: 'viewWeek' },
  { value: 'Month', key: 'viewMonth' },
]

const viewMode = useStorage('tool-gantt-generator-view', 'Week')
if (!VIEW_MODES.some((m) => m.value === viewMode.value)) viewMode.value = 'Week'

/* ---------- 层级排序 / 父任务候选 / 聚合 ---------- */

const orderedTasks = computed(() => {
  const list = Array.isArray(tasks.value) ? tasks.value : []
  const byId = new Map(list.map((item) => [item.id, item]))

  // 解析有效父任务（父不存在或形成环时视为顶级）
  const effectiveParent = new Map()
  for (const item of list) {
    let pid = item.parentId && byId.has(item.parentId) ? item.parentId : ''
    let cur = pid
    let hops = 0
    while (cur) {
      if (cur === item.id || hops > 50) {
        pid = ''
        break
      }
      const parent = byId.get(cur)
      cur = parent && parent.parentId && byId.has(parent.parentId) ? parent.parentId : ''
      hops += 1
    }
    effectiveParent.set(item.id, pid)
  }

  const childrenMap = new Map()
  const roots = []
  for (const item of list) {
    const pid = effectiveParent.get(item.id)
    if (pid) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, [])
      childrenMap.get(pid).push(item)
    } else {
      roots.push(item)
    }
  }

  // 深度优先排序：父子相邻、子任务缩进并带层级编号
  const out = []
  const walk = (items, depth, prefix) => {
    items.forEach((item, index) => {
      const num = prefix ? prefix + '.' + (index + 1) : String(index + 1)
      out.push({ task: item, depth, num })
      const kids = childrenMap.get(item.id)
      if (kids && kids.length) walk(kids, depth + 1, num)
    })
  }
  walk(roots, 0, '')
  return out
})

function isChartable(item) {
  return isValidStart(item.start) && isValidDuration(item.duration)
}

const invalidCount = computed(() => orderedTasks.value.filter((row) => !isChartable(row.task)).length)

const chartTasks = computed(() => {
  const out = []
  for (const row of orderedTasks.value) {
    const item = row.task
    if (!isChartable(item)) continue
    const duration = clampDuration(item.duration)
    out.push({
      id: item.id,
      name: (row.depth > 0 ? '└ ' : '') + (item.name || t('tools.ganttGenerator.newTask')),
      start: item.start,
      // frappe-gantt 的 end 为包含语义（与 start 同为整天），持续 D 天 → end = start + D - 1
      end: addDaysISO(item.start, duration - 1),
      progress: clampProgress(item.progress),
    })
  }
  return out
})

/** 父任务候选：排除自己与自己的后代，防止成环 */
function allowedParents(taskId) {
  const excluded = new Set([taskId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of tasks.value) {
      if (item.parentId && excluded.has(item.parentId) && !excluded.has(item.id)) {
        excluded.add(item.id)
        changed = true
      }
    }
  }
  return orderedTasks.value.filter((row) => !excluded.has(row.task.id))
}

/** 每个含子任务的父任务：直接子任务的聚合时间范围 */
const aggregates = computed(() => {
  const map = new Map()
  for (const row of orderedTasks.value) {
    const item = row.task
    if (!item.parentId || !isChartable(item)) continue
    const end = addDaysISO(item.start, clampDuration(item.duration) - 1)
    const cur = map.get(item.parentId)
    if (!cur) {
      map.set(item.parentId, { count: 1, min: item.start, max: end })
    } else {
      cur.count += 1
      if (item.start < cur.min) cur.min = item.start
      if (end > cur.max) cur.max = end
    }
  }
  return map
})

/* ---------- 任务增删 ---------- */

function addTask() {
  tasks.value.push({
    id: genId(),
    name: '',
    start: fmtISO(new Date()),
    duration: 3,
    progress: 0,
    parentId: '',
  })
}

function removeTask(id) {
  const index = tasks.value.findIndex((item) => item.id === id)
  if (index === -1) return
  const grandParentId = tasks.value[index].parentId || ''
  // 删除后其子任务上移一级
  tasks.value = tasks.value
    .filter((item) => item.id !== id)
    .map((item) => (item.parentId === id ? { ...item, parentId: grandParentId } : item))
}

/* ---------- 甘特图渲染（frappe-gantt 懒加载） ---------- */

const chartWrapper = ref(null)
const renderError = ref('')
const exporting = ref(false)

let ganttInstance = null
let ganttCtorPromise = null
let suppressWatch = false

function loadGanttCtor() {
  if (!ganttCtorPromise) {
    ganttCtorPromise = import('frappe-gantt').then((mod) => mod.default)
  }
  return ganttCtorPromise
}

function buildGanttOptions() {
  return {
    view_mode: viewMode.value,
    date_format: 'YYYY-MM-DD',
    view_mode_select: false,
    today_button: false,
    infinite_padding: false,
    scroll_to: 'start',
    language: locale.value && locale.value.startsWith('zh') ? 'zh-CN' : 'en',
    on_click: (task) => {
      const row = tasks.value.find((item) => item.id === task.id)
      if (!row) return
      const end = isValidStart(row.start) ? addDaysISO(row.start, clampDuration(row.duration) - 1) : '-'
      const name = row.name || t('tools.ganttGenerator.newTask')
      toast.info(name + ' · ' + (row.start || '-') + ' ~ ' + end + ' · ' + clampProgress(row.progress) + '%')
    },
    on_date_change: (task, start, end) => {
      // end 为包含语义的最后一天（23:59:59），持续天数 = 日期差（向上取整天数）
      const days = Math.max(1, Math.round((Number(end) - Number(start)) / 86400000))
      syncFromChart(task.id, { start: fmtISO(new Date(start)), duration: days })
    },
    on_progress_change: (task, progress) => {
      syncFromChart(task.id, { progress: clampProgress(progress) })
    },
  }
}

/** 图表拖拽产生的修改写回任务列表；抑制 watch 防止触发重渲染循环 */
function syncFromChart(id, patch) {
  const index = tasks.value.findIndex((item) => item.id === id)
  if (index === -1) return
  suppressWatch = true
  tasks.value[index] = { ...tasks.value[index], ...patch }
  nextTick(() => {
    suppressWatch = false
  })
}

async function renderChart() {
  const wrapper = chartWrapper.value
  if (!wrapper) return
  const list = chartTasks.value
  if (!list.length) {
    ganttInstance = null
    wrapper.innerHTML = ''
    return
  }
  try {
    const payload = list.map((item) => ({ ...item }))
    if (!ganttInstance) {
      const Gantt = await loadGanttCtor()
      wrapper.innerHTML = ''
      ganttInstance = new Gantt(wrapper, payload, buildGanttOptions())
    } else {
      ganttInstance.refresh(payload)
    }
    renderError.value = ''
  } catch (err) {
    ganttInstance = null
    renderError.value = err && err.message ? String(err.message) : t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}

const scheduleRender = useDebounceFn(renderChart, 200)

watch(chartTasks, () => {
  if (suppressWatch) return
  scheduleRender()
})

function setViewMode(mode) {
  viewMode.value = mode
  if (!ganttInstance) return
  try {
    ganttInstance.change_view_mode(mode, true)
  } catch {
    scheduleRender()
  }
}

onMounted(() => {
  if (Array.isArray(tasks.value)) {
    tasks.value = tasks.value.map(normalizeTask)
  } else {
    tasks.value = defaultTasks()
  }
  renderChart()
})

onBeforeUnmount(() => {
  ganttInstance = null
})

/* ---------- 导出 ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg'

// 导出内嵌的关键样式（配色与页面中设置的 CSS 变量保持一致）
const CRITICAL_CSS = [
  'svg{--g-weekend-highlight-color:#f7f7f7}',
  '.gantt .grid-background{fill:none}',
  '.gantt .grid-row{fill:#fdfdfd}',
  '.gantt .row-line{stroke:#ebeff2}',
  '.gantt .tick{stroke:#f3f3f3;stroke-width:0.4}',
  '.gantt .tick.thick{stroke:#ededed;stroke-width:0.7}',
  '.gantt .arrow{fill:none;stroke:#94a3b8;stroke-width:1.5}',
  '.gantt .bar-wrapper .bar{fill:#bfdbfe;stroke:#93c5fd;stroke-width:1}',
  '.gantt .bar-progress{fill:#3b82f6}',
  '.gantt .bar-label{fill:#1e293b;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:400}',
  '.gantt .bar-label.big{fill:#1e293b}',
  '.gantt .handle{fill:#334155}',
  '.gantt .bar-invalid{fill:transparent;stroke:#93c5fd;stroke-width:1;stroke-dasharray:5}',
].join('')

/**
 * 构建可独立打开的 SVG：
 * - 克隆图表 svg 根节点并补 xmlns
 * - 原内容整体下移表头高度，白底置底，关键样式内嵌
 * - 日期表头原为 HTML 元素，按其在容器内的实际位置写回为 svg 文本
 */
function buildExportSvg() {
  const wrapper = chartWrapper.value
  const svgEl = wrapper && wrapper.querySelector('svg')
  if (!svgEl) throw new Error('chart not rendered')

  // 仅接受纯数字尺寸（width 属性可能为 '100%'，parseFloat 会误判为 100）
  const numAttr = (value) => (value && /^\d+(\.\d+)?$/.test(value) ? parseFloat(value) : NaN)
  const attrW = numAttr(svgEl.getAttribute('width'))
  const attrH = numAttr(svgEl.getAttribute('height'))
  const rect = svgEl.getBoundingClientRect()
  const width = Math.max(1, Math.round(Number.isFinite(attrW) && attrW > 1 ? attrW : rect.width))
  const height = Math.max(1, Math.round(Number.isFinite(attrH) && attrH > 1 ? attrH : rect.height))

  const container = wrapper.querySelector('.gantt-container')
  const header = wrapper.querySelector('.grid-header')
  const headerH = header ? Math.max(0, Math.round(header.getBoundingClientRect().height)) : 0
  const cRect = container ? container.getBoundingClientRect() : rect

  const clone = svgEl.cloneNode(true)

  // 原内容整体下移，为表头腾出空间
  const inner = document.createElementNS(SVG_NS, 'g')
  inner.setAttribute('transform', 'translate(0 ' + headerH + ')')
  while (clone.firstChild) inner.appendChild(clone.firstChild)

  const styleEl = document.createElementNS(SVG_NS, 'style')
  styleEl.textContent = CRITICAL_CSS
  clone.appendChild(styleEl)

  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(width))
  bg.setAttribute('height', String(height + headerH))
  bg.setAttribute('fill', '#ffffff')
  clone.appendChild(bg)
  clone.appendChild(inner)

  // 表头吸顶定位，位置相对容器即为内容坐标（current-upper 需按滚动量还原）
  if (headerH > 0 && container) {
    const scrollLeft = container.scrollLeft || 0
    wrapper.querySelectorAll('.upper-text, .lower-text').forEach((div) => {
      try {
        const r = div.getBoundingClientRect()
        if (!r.width && !r.height) return
        const fontSize = parseFloat(getComputedStyle(div).fontSize) || 12
        const isUpper = div.classList.contains('upper-text')
        const x = div.classList.contains('current-upper') ? scrollLeft + 17 : r.left - cRect.left
        const y = r.top - cRect.top + r.height / 2 + fontSize * 0.35
        const text = document.createElementNS(SVG_NS, 'text')
        text.setAttribute('x', String(Math.round(x * 10) / 10))
        text.setAttribute('y', String(Math.round(y * 10) / 10))
        text.setAttribute('fill', isUpper ? '#171717' : '#7c7c7c')
        text.setAttribute('font-family', 'Helvetica, Arial, sans-serif')
        text.setAttribute('font-size', String(fontSize))
        if (isUpper) text.setAttribute('font-weight', '500')
        text.textContent = div.textContent
        clone.appendChild(text)
      } catch {
        // 单个表头文本失败可忽略，不影响整体导出
      }
    })
  }

  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height + headerH))
  clone.setAttribute('viewBox', '0 0 ' + width + ' ' + (height + headerH))
  return new XMLSerializer().serializeToString(clone)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = src
  })
}

function exportSvg() {
  if (!chartTasks.value.length || exporting.value) return
  try {
    downloadText(buildExportSvg(), 'gantt-chart.svg', 'image/svg+xml;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('tools.ganttGenerator.exportFailed'))
  }
}

async function exportPng() {
  if (!chartTasks.value.length || exporting.value) return
  exporting.value = true
  try {
    const box = document.createElement('div')
    box.innerHTML = buildExportSvg()
    const el = box.querySelector('svg')
    if (!el) throw new Error('invalid svg')
    const w = parseFloat(el.getAttribute('width')) || 800
    const h = parseFloat(el.getAttribute('height')) || 600
    const xml = new XMLSerializer().serializeToString(el)
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml))
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    downloadCanvasAsPng(canvas, 'gantt-chart.png')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('tools.ganttGenerator.exportFailed'))
  } finally {
    exporting.value = false
  }
}

/* 图表配色：通过 CSS 变量微调 frappe-gantt 默认灰阶为蓝色系（导出样式与之一致） */
const ganttStyleVars = {
  '--g-bar-color': '#bfdbfe',
  '--g-bar-border': '#93c5fd',
  '--g-progress-color': '#3b82f6',
  '--g-arrow-color': '#94a3b8',
  '--g-handle-color': '#334155',
}
</script>

<template>
  <ToolPage tool-id="ganttGenerator">
    <!-- 任务列表 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-2">
        <span class="section-title flex-1 mb-0">{{ t('toolsCommon.total') }} {{ tasks.length }} {{ t('toolsCommon.items') }}</span>
        <button type="button" class="btn-primary" @click="addTask">
          {{ t('tools.ganttGenerator.addTask') }}
        </button>
      </div>

      <!-- 空态引导 -->
      <div v-if="!orderedTasks.length" class="text-center py-10 px-4">
        <h2 class="text-base font-semibold text-slate-600 mb-1.5">{{ t('tools.ganttGenerator.emptyTitle') }}</h2>
        <p class="text-sm text-slate-400 mb-4">{{ t('tools.ganttGenerator.emptyHint') }}</p>
        <button type="button" class="btn-primary" @click="addTask">
          {{ t('tools.ganttGenerator.addTask') }}
        </button>
      </div>

      <!-- 任务行：父子缩进 + 层级编号（子任务前缀 └） -->
      <div class="mt-3 space-y-2.5">
        <div
          v-for="row in orderedTasks"
          :key="row.task.id"
          class="rounded-xl border border-slate-200 bg-white/70 p-3 transition-colors"
          :class="row.depth > 0 ? 'ml-4 sm:ml-8 border-l-2 border-l-blue-200' : ''"
        >
          <div class="flex items-center gap-2">
            <span class="chip shrink-0 font-mono">{{ row.depth > 0 ? '└ ' : '' }}{{ row.num }}</span>
            <input
              v-model="row.task.name"
              type="text"
              class="input-base flex-1"
              :placeholder="t('tools.ganttGenerator.taskNamePlaceholder')"
              :aria-label="t('tools.ganttGenerator.taskName')"
            />
            <button
              type="button"
              class="btn-danger shrink-0 px-2.5"
              :aria-label="t('tools.ganttGenerator.delete')"
              @click="removeTask(row.task.id)"
            >
              ×
            </button>
          </div>

          <div class="grid grid-cols-2 gap-x-3 gap-y-2 mt-2.5">
            <div>
              <label class="label-base text-xs mb-1" :for="'start-' + row.task.id">
                {{ t('tools.ganttGenerator.startDate') }}
              </label>
              <input
                :id="'start-' + row.task.id"
                v-model="row.task.start"
                type="date"
                class="input-base"
              />
            </div>
            <div>
              <label class="label-base text-xs mb-1" :for="'duration-' + row.task.id">
                {{ t('tools.ganttGenerator.duration') }}
              </label>
              <div class="flex items-center gap-1.5">
                <input
                  :id="'duration-' + row.task.id"
                  v-model.number="row.task.duration"
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  class="input-base w-full"
                />
                <span class="text-xs text-slate-400 shrink-0">{{ t('tools.ganttGenerator.durationUnit') }}</span>
              </div>
            </div>
            <div class="col-span-2">
              <label class="label-base text-xs mb-1" :for="'progress-' + row.task.id">
                {{ t('tools.ganttGenerator.progress') }}
              </label>
              <div class="flex items-center gap-2">
                <input
                  :id="'progress-' + row.task.id"
                  v-model.number="row.task.progress"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  class="flex-1 accent-blue-600"
                />
                <span class="text-xs text-slate-500 w-10 text-right shrink-0">{{ row.task.progress }}%</span>
              </div>
            </div>
            <div class="col-span-2">
              <label class="label-base text-xs mb-1" :for="'parent-' + row.task.id">
                {{ t('tools.ganttGenerator.parentTask') }}
              </label>
              <select :id="'parent-' + row.task.id" v-model="row.task.parentId" class="input-base">
                <option value="">{{ t('tools.ganttGenerator.parentNone') }}</option>
                <option v-for="p in allowedParents(row.task.id)" :key="p.task.id" :value="p.task.id">
                  {{ p.num }}. {{ p.task.name || t('tools.ganttGenerator.newTask') }}
                </option>
              </select>
            </div>
          </div>

          <!-- 父任务条聚合：显示子任务聚合时间范围 -->
          <p v-if="aggregates.get(row.task.id)" class="mt-2 text-xs text-slate-400">
            {{ t('tools.ganttGenerator.aggregateLabel') }}:
            {{ aggregates.get(row.task.id).min }} ~ {{ aggregates.get(row.task.id).max }}
            · {{ aggregates.get(row.task.id).count }} {{ t('tools.ganttGenerator.childrenUnit') }}
          </p>
        </div>
      </div>
    </section>

    <!-- 甘特图 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="section-title flex-1 mb-0">{{ t('tools.ganttGenerator.chartTitle') }}</span>
        <div class="flex gap-1.5">
          <button
            v-for="m in VIEW_MODES"
            :key="m.value"
            type="button"
            :class="viewMode === m.value ? 'btn-primary' : 'btn-ghost'"
            @click="setViewMode(m.value)"
          >
            {{ t(`tools.ganttGenerator.${m.key}`) }}
          </button>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!chartTasks.length || exporting"
            @click="exportSvg"
          >
            {{ t('tools.ganttGenerator.exportSvg') }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="!chartTasks.length || exporting"
            @click="exportPng"
          >
            {{ t('tools.ganttGenerator.exportPng') }}
          </button>
        </div>
      </div>

      <p v-if="invalidCount" class="text-amber-600 text-xs mt-2">
        {{ t('tools.ganttGenerator.invalidHint') }}
      </p>
      <p v-if="renderError" class="text-red-600 text-sm mt-2">{{ renderError }}</p>

      <div
        v-show="chartTasks.length"
        class="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden"
        :style="ganttStyleVars"
      >
        <div ref="chartWrapper"></div>
      </div>

      <!-- 空态 -->
      <div v-if="!chartTasks.length" class="text-center py-10 px-4">
        <h2 class="text-base font-semibold text-slate-600 mb-1.5">{{ t('tools.ganttGenerator.emptyTitle') }}</h2>
        <p class="text-sm text-slate-400">{{ t('tools.ganttGenerator.emptyHint') }}</p>
      </div>

      <div class="mt-4 space-y-1.5 text-xs text-slate-400 leading-relaxed">
        <p><span class="font-medium text-slate-500">{{ t('tools.ganttGenerator.hierarchyTitle') }}:</span> {{ t('tools.ganttGenerator.hierarchyNote') }}</p>
        <p>{{ t('tools.ganttGenerator.dragNote') }}</p>
        <p>{{ t('tools.ganttGenerator.exportNote') }}</p>
      </div>
    </section>
  </ToolPage>
</template>
