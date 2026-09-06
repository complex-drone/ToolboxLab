<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadText, readFileAsText, downloadCanvasAsPng } from '@/utils/download'

/**
 * 轻量流程图编辑器（纯 SVG + 指针事件，无外部依赖）：
 * - 面板点击在画布中心添加节点，或拖到画布任意位置放下
 * - 节点拖拽移动（pointer capture），双击行内编辑文字（回车/失焦确认，Esc 取消）
 * - 从节点四边圆点手柄拖到另一节点释放，生成带箭头正交折线（中点转折）
 * - 节点/连线可选中，Delete 键或按钮删除（节点删除时同步移除关联连线）
 * - 导出/导入 JSON（{nodes,edges}）、导出 PNG（SVG 序列化 → canvas 2x），导出前清理选中态
 * - 画布逻辑尺寸 1200×800，SVG pattern 网格背景，快照栈撤销（保留 20 步）
 */
const { t } = useI18n()
const toast = useToast()

const CANVAS_W = 1200
const CANVAS_H = 800
const HISTORY_LIMIT = 20
const DRAG_THRESHOLD = 4

const NODE_STYLE = {
  start: { w: 120, h: 48, rx: 24, fill: '#dcfce7', stroke: '#16a34a', text: '#14532d', key: 'nodeStart', defKey: 'defaultStart' },
  end: { w: 120, h: 48, rx: 24, fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d', key: 'nodeEnd', defKey: 'defaultEnd' },
  process: { w: 160, h: 56, rx: 8, fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a', key: 'nodeProcess', defKey: 'defaultProcess' },
  decision: { w: 150, h: 90, rx: 0, fill: '#fef9c3', stroke: '#ca8a04', text: '#713f12', key: 'nodeDecision', defKey: 'defaultDecision' },
  subprocess: { w: 176, h: 60, rx: 4, fill: '#ede9fe', stroke: '#7c3aed', text: '#4c1d95', key: 'nodeSubprocess', defKey: 'defaultSubprocess' },
}

const PALETTE = ['start', 'end', 'process', 'decision', 'subprocess']
const SIDES = ['top', 'right', 'bottom', 'left']
const TIPS = ['tipClick', 'tipDrag', 'tipMove', 'tipLink', 'tipSelect', 'tipUndo']

/* ---------- 状态 ---------- */
const nodes = ref([])
const edges = ref([])
const selectedNodeId = ref(null)
const selectedEdgeId = ref(null)
const editing = ref(null) // { id, text }
const link = ref(null) // { fromId, side, from, cur, pointerId }
const history = ref([])
const showImport = ref(false)
const importError = ref('')
const exportingPng = ref(false)
const svgRef = ref(null)
const editInputRef = ref(null)

let nextNodeId = 1
let nextEdgeId = 1
let drag = null // 节点拖拽（非渲染状态，无需响应式）
let paletteDrag = null

/* ---------- 初始示例图 ---------- */
function seed() {
  const add = (type, x, y) => {
    const st = NODE_STYLE[type]
    const node = { id: nextNodeId++, type, x, y, text: t(`tools.flowchartEditor.${st.defKey}`) }
    nodes.value.push(node)
    return node
  }
  const a = add('start', 600, 110)
  const b = add('process', 600, 290)
  const c = add('decision', 600, 490)
  const d = add('end', 600, 690)
  edges.value.push({ id: nextEdgeId++, from: a.id, to: b.id })
  edges.value.push({ id: nextEdgeId++, from: b.id, to: c.id })
  edges.value.push({ id: nextEdgeId++, from: c.id, to: d.id })
}
seed()

/* ---------- 基础工具 ---------- */
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max)
}

function styleOf(node) {
  return NODE_STYLE[node.type] || NODE_STYLE.process
}

function nodeById(id) {
  return nodes.value.find((n) => n.id === id) || null
}

const editNode = computed(() => (editing.value ? nodeById(editing.value.id) : null))

function toSvgPoint(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return { x: 0, y: 0 }
  return {
    x: (clientX - rect.left) * (CANVAS_W / rect.width),
    y: (clientY - rect.top) * (CANVAS_H / rect.height),
  }
}

function portPos(node, side) {
  const st = styleOf(node)
  if (side === 'top') return { x: node.x, y: node.y - st.h / 2 }
  if (side === 'bottom') return { x: node.x, y: node.y + st.h / 2 }
  if (side === 'left') return { x: node.x - st.w / 2, y: node.y }
  return { x: node.x + st.w / 2, y: node.y }
}

function diamondPoints(node) {
  const st = styleOf(node)
  return (
    node.x + ',' + (node.y - st.h / 2) +
    ' ' + (node.x + st.w / 2) + ',' + node.y +
    ' ' + node.x + ',' + (node.y + st.h / 2) +
    ' ' + (node.x - st.w / 2) + ',' + node.y
  )
}

function findNodeAt(x, y) {
  for (let i = nodes.value.length - 1; i >= 0; i -= 1) {
    const node = nodes.value[i]
    const st = styleOf(node)
    const dx = x - node.x
    const dy = y - node.y
    if (node.type === 'decision') {
      if (Math.abs(dx) / (st.w / 2) + Math.abs(dy) / (st.h / 2) <= 1) return node
    } else if (Math.abs(dx) <= st.w / 2 && Math.abs(dy) <= st.h / 2) {
      return node
    }
  }
  return null
}

/* ---------- 撤销快照 ---------- */
function pushHistory() {
  history.value.push(JSON.stringify({ nodes: nodes.value, edges: edges.value }))
  if (history.value.length > HISTORY_LIMIT) history.value.shift()
}

function undo() {
  if (!history.value.length) return
  let snap
  try {
    snap = JSON.parse(history.value.pop())
  } catch (e) {
    return
  }
  nodes.value = Array.isArray(snap.nodes) ? snap.nodes : []
  edges.value = Array.isArray(snap.edges) ? snap.edges : []
  selectedNodeId.value = null
  selectedEdgeId.value = null
  editing.value = null
  link.value = null
}

/* ---------- 选择 / 删除 ---------- */
function selectNode(id) {
  selectedNodeId.value = id
  selectedEdgeId.value = null
}

function selectEdge(id) {
  selectedEdgeId.value = id
  selectedNodeId.value = null
}

function onCanvasPointerDown() {
  selectedNodeId.value = null
  selectedEdgeId.value = null
}

function deleteEdge(id) {
  pushHistory()
  edges.value = edges.value.filter((e) => e.id !== id)
  selectedEdgeId.value = null
}

function deleteNode(id) {
  pushHistory()
  edges.value = edges.value.filter((e) => e.from !== id && e.to !== id)
  nodes.value = nodes.value.filter((n) => n.id !== id)
  if (selectedNodeId.value === id) selectedNodeId.value = null
}

const deleteButtonLabel = computed(() => {
  if (selectedEdgeId.value != null) return t('tools.flowchartEditor.deleteEdge')
  return t('tools.flowchartEditor.deleteNode')
})

function deleteSelected() {
  if (editing.value) return
  if (selectedEdgeId.value != null) {
    deleteEdge(selectedEdgeId.value)
    return
  }
  if (selectedNodeId.value != null) deleteNode(selectedNodeId.value)
}

function clearCanvas() {
  pushHistory()
  nodes.value = []
  edges.value = []
  selectedNodeId.value = null
  selectedEdgeId.value = null
  editing.value = null
}

/* ---------- 添加节点（面板点击 / 拖放） ---------- */
function addNodeAt(type, x, y) {
  const st = NODE_STYLE[type]
  if (!st) return
  pushHistory()
  const spread = ((nodes.value.length % 5) - 2) * 32
  const node = {
    id: nextNodeId++,
    type,
    x: clamp(typeof x === 'number' ? x : CANVAS_W / 2 + spread, st.w / 2 + 6, CANVAS_W - st.w / 2 - 6),
    y: clamp(typeof y === 'number' ? y : CANVAS_H / 2 + spread * 0.6, st.h / 2 + 6, CANVAS_H - st.h / 2 - 6),
    text: t(`tools.flowchartEditor.${st.defKey}`),
  }
  nodes.value.push(node)
  selectNode(node.id)
}

function onPalettePointerDown(e, type) {
  paletteDrag = { type, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId }
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
}

function onPalettePointerMove(e) {
  if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return
  if (!paletteDrag.moved && Math.hypot(e.clientX - paletteDrag.startX, e.clientY - paletteDrag.startY) > DRAG_THRESHOLD) {
    paletteDrag.moved = true
  }
}

function onPalettePointerUp(e) {
  const pd = paletteDrag
  if (!pd || e.pointerId !== pd.pointerId) return
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
  paletteDrag = null
  const svg = svgRef.value
  if (svg) {
    const rect = svg.getBoundingClientRect()
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      const p = toSvgPoint(e.clientX, e.clientY)
      addNodeAt(pd.type, p.x, p.y)
      return
    }
  }
  if (!pd.moved) addNodeAt(pd.type, null, null)
}

/* ---------- 节点拖拽 ---------- */
function onNodePointerDown(e, node) {
  if (editing.value) return
  selectNode(node.id)
  drag = { id: node.id, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y, moved: false, pushed: false, pointerId: e.pointerId }
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
}

function onNodePointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  const node = nodeById(drag.id)
  if (!node) {
    drag = null
    return
  }
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true
  if (!drag.moved) return
  if (!drag.pushed) {
    pushHistory()
    drag.pushed = true
  }
  const svg = svgRef.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const st = styleOf(node)
  node.x = clamp(drag.origX + dx * (CANVAS_W / rect.width), st.w / 2 + 4, CANVAS_W - st.w / 2 - 4)
  node.y = clamp(drag.origY + dy * (CANVAS_H / rect.height), st.h / 2 + 4, CANVAS_H - st.h / 2 - 4)
}

function onNodePointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
  drag = null
}

/* ---------- 连线：端口拖拽 ---------- */
function onPortPointerDown(e, node, side) {
  e.stopPropagation()
  e.preventDefault()
  selectNode(node.id)
  link.value = { fromId: node.id, side, from: portPos(node, side), cur: portPos(node, side), pointerId: e.pointerId }
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
}

function onPortPointerMove(e) {
  const lk = link.value
  if (!lk || e.pointerId !== lk.pointerId) return
  link.value = { ...lk, cur: toSvgPoint(e.clientX, e.clientY) }
}

function onPortPointerUp(e) {
  const lk = link.value
  if (!lk || e.pointerId !== lk.pointerId) return
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch (err) {
    /* 忽略 */
  }
  link.value = null
  const p = toSvgPoint(e.clientX, e.clientY)
  const target = findNodeAt(p.x, p.y)
  if (!target || target.id === lk.fromId) return
  if (edges.value.some((ed) => ed.from === lk.fromId && ed.to === target.id)) {
    toast.info(t('tools.flowchartEditor.edgeExists'))
    return
  }
  pushHistory()
  edges.value.push({ id: nextEdgeId++, from: lk.fromId, to: target.id })
}

/* ---------- 正交折线（中点转折） ---------- */
function edgeD(edge) {
  const a = nodeById(edge.from)
  const b = nodeById(edge.to)
  if (!a || !b) return ''
  const dx = b.x - a.x
  const dy = b.y - a.y
  let sideA
  let sideB
  if (Math.abs(dx) >= Math.abs(dy)) {
    sideA = dx >= 0 ? 'right' : 'left'
    sideB = dx >= 0 ? 'left' : 'right'
  } else {
    sideA = dy >= 0 ? 'bottom' : 'top'
    sideB = dy >= 0 ? 'top' : 'bottom'
  }
  const p1 = portPos(a, sideA)
  const p2 = portPos(b, sideB)
  if (sideA === 'left' || sideA === 'right') {
    const mx = (p1.x + p2.x) / 2
    return `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`
  }
  const my = (p1.y + p2.y) / 2
  return `M ${p1.x} ${p1.y} L ${p1.x} ${my} L ${p2.x} ${my} L ${p2.x} ${p2.y}`
}

/* ---------- 文字编辑 ---------- */
function startEdit(node) {
  selectNode(node.id)
  editing.value = { id: node.id, text: node.text }
  nextTick(() => {
    const el = editInputRef.value
    if (el) {
      el.focus()
      el.select()
    }
  })
}

function confirmEdit() {
  const ed = editing.value
  if (!ed) return
  const node = nodeById(ed.id)
  const val = ed.text.trim()
  if (node && val && val !== node.text) {
    pushHistory()
    node.text = val
  }
  editing.value = null
}

function cancelEdit() {
  editing.value = null
}

function editStyle(node) {
  if (!node) return {}
  const st = styleOf(node)
  return {
    left: (node.x / CANVAS_W) * 100 + '%',
    top: (node.y / CANVAS_H) * 100 + '%',
    width: Math.max(110, Math.round(st.w * 0.85)) + 'px',
  }
}

/* ---------- 导出 / 导入 ---------- */
function exportJson() {
  try {
    const data = {
      nodes: nodes.value.map((n) => ({
        id: n.id,
        type: n.type,
        x: Math.round(n.x * 10) / 10,
        y: Math.round(n.y * 10) / 10,
        text: n.text,
      })),
      edges: edges.value.map((e) => ({ id: e.id, from: e.from, to: e.to })),
    }
    downloadText(JSON.stringify(data, null, 2), 'flowchart.json', 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

function applyImportText(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    importError.value = t('tools.flowchartEditor.errImport')
    toast.error(importError.value)
    return
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    importError.value = t('tools.flowchartEditor.errImport')
    toast.error(importError.value)
    return
  }
  pushHistory()
  // 先依据导入数据抬高自增计数，避免 id 冲突
  let maxId = 0
  raw.nodes.forEach((n) => {
    const id = Number(n.id)
    if (Number.isFinite(id) && id > maxId) maxId = id
  })
  if (maxId + 1 > nextNodeId) nextNodeId = maxId + 1

  const seen = new Set()
  const idMap = new Map()
  const newNodes = []
  for (const n of raw.nodes) {
    let id = Number(n.id)
    if (!Number.isFinite(id) || seen.has(id)) id = nextNodeId++
    seen.add(id)
    idMap.set(String(n.id), id)
    const st = NODE_STYLE[n.type] || NODE_STYLE.process
    const x = Number(n.x)
    const y = Number(n.y)
    newNodes.push({
      id,
      type: st === NODE_STYLE[n.type] ? n.type : 'process',
      x: clamp(Number.isFinite(x) ? x : CANVAS_W / 2, st.w / 2 + 4, CANVAS_W - st.w / 2 - 4),
      y: clamp(Number.isFinite(y) ? y : CANVAS_H / 2, st.h / 2 + 4, CANVAS_H - st.h / 2 - 4),
      text: typeof n.text === 'string' ? n.text : '',
    })
  }
  const newEdges = []
  for (const e of raw.edges) {
    const from = idMap.get(String(e.from))
    const to = idMap.get(String(e.to))
    if (from == null || to == null || from === to) continue
    if (newEdges.some((ed) => ed.from === from && ed.to === to)) continue
    newEdges.push({ id: nextEdgeId++, from, to })
  }
  nodes.value = newNodes
  edges.value = newEdges
  selectedNodeId.value = null
  selectedEdgeId.value = null
  editing.value = null
  importError.value = ''
  showImport.value = false
  toast.success(t('toolsCommon.done'))
}

async function onImportFile(payload) {
  const file = Array.isArray(payload) ? payload[0] : payload
  if (!file) return
  importError.value = ''
  try {
    const text = await readFileAsText(file)
    applyImportText(text)
  } catch (e) {
    importError.value = t('tools.flowchartEditor.errImport')
    toast.error(t('toolsCommon.loadFailed'))
  }
}

/* ---------- 导出 PNG：SVG 序列化 → canvas 2x → PNG ---------- */
async function exportPng() {
  if (exportingPng.value) return
  exportingPng.value = true
  // 导出前清理选中态与编辑态
  selectedNodeId.value = null
  selectedEdgeId.value = null
  editing.value = null
  link.value = null
  await nextTick()
  try {
    const svg = svgRef.value
    if (!svg) throw new Error('svg missing')
    const clone = svg.cloneNode(true)
    clone.querySelectorAll('[data-noexport]').forEach((el) => el.remove())
    clone.setAttribute('width', String(CANVAS_W))
    clone.setAttribute('height', String(CANVAS_H))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const xml = new XMLSerializer().serializeToString(clone)
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg load failed'))
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
    })
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W * 2
    canvas.height = CANVAS_H * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    downloadCanvasAsPng(canvas, 'flowchart.png')
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  } finally {
    exportingPng.value = false
  }
}

/* ---------- Delete 键删除选中 ---------- */
function onKeydown(e) {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  if (editing.value) return
  const tag = e.target && e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (selectedEdgeId.value != null || selectedNodeId.value != null) {
    e.preventDefault()
    deleteSelected()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <ToolPage tool-id="flowchartEditor">
    <!-- 节点面板 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <span class="section-title">{{ t('tools.flowchartEditor.paletteTitle') }}</span>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          v-for="pt in PALETTE"
          :key="pt"
          type="button"
          class="palette-item"
          :aria-label="t(`tools.flowchartEditor.${NODE_STYLE[pt].key}`)"
          @pointerdown="onPalettePointerDown($event, pt)"
          @pointermove="onPalettePointerMove"
          @pointerup="onPalettePointerUp"
          @pointercancel="onPalettePointerUp"
        >
          <svg width="56" height="32" viewBox="0 0 56 32" aria-hidden="true">
            <template v-if="pt === 'start'">
              <rect x="6" y="6" width="44" height="20" rx="10" fill="#dcfce7" stroke="#16a34a" stroke-width="1.6" />
            </template>
            <template v-else-if="pt === 'end'">
              <rect x="6" y="6" width="44" height="20" rx="10" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" />
            </template>
            <template v-else-if="pt === 'process'">
              <rect x="6" y="5" width="44" height="22" rx="4" fill="#dbeafe" stroke="#2563eb" stroke-width="1.6" />
            </template>
            <template v-else-if="pt === 'decision'">
              <polygon points="28,3 53,16 28,29 3,16" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.6" />
            </template>
            <template v-else>
              <rect x="5" y="5" width="46" height="22" rx="3" fill="#ede9fe" stroke="#7c3aed" stroke-width="1.6" />
              <rect x="9" y="9" width="38" height="14" rx="2" fill="none" stroke="#7c3aed" stroke-width="1.2" />
            </template>
          </svg>
          <span class="text-xs font-medium text-slate-600">{{ t(`tools.flowchartEditor.${NODE_STYLE[pt].key}`) }}</span>
        </button>
      </div>
    </section>

    <!-- 画布 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="chip mr-auto">{{ t('tools.flowchartEditor.nodesStat') }}: {{ nodes.length }} · {{ t('tools.flowchartEditor.edgesStat') }}: {{ edges.length }}</span>
        <button type="button" class="btn-ghost" :disabled="!history.length" @click="undo">{{ t('tools.flowchartEditor.undo') }}</button>
        <button
          type="button"
          class="btn-danger"
          :disabled="selectedNodeId == null && selectedEdgeId == null"
          @click="deleteSelected"
        >
          {{ deleteButtonLabel }}
        </button>
        <button type="button" class="btn-ghost" :disabled="!nodes.length" @click="clearCanvas">{{ t('tools.flowchartEditor.clearCanvas') }}</button>
        <button type="button" class="btn-ghost" @click="exportJson">{{ t('tools.flowchartEditor.exportJson') }}</button>
        <button
          type="button"
          class="btn-ghost"
          :class="{ 'text-blue-600 border-blue-300': showImport }"
          @click="showImport = !showImport"
        >
          {{ t('tools.flowchartEditor.importJson') }}
        </button>
        <button type="button" class="btn-primary" :disabled="exportingPng" @click="exportPng">
          {{ t('tools.flowchartEditor.exportPng') }}
        </button>
      </div>

      <!-- 导入面板 -->
      <div v-if="showImport" class="rounded-xl border border-slate-200 bg-white/70 p-3 mb-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="label-base mb-0">{{ t('tools.flowchartEditor.importTitle') }}</span>
          <span class="text-xs text-slate-400">{{ t('tools.flowchartEditor.importHint') }}</span>
        </div>
        <FileDropZone accept=".json,application/json" :multiple="false" :maxSizeMB="2" @files="onImportFile" />
        <p v-if="importError" class="mt-2 text-sm text-red-600">{{ importError }}</p>
      </div>

      <div class="flow-canvas relative w-full rounded-xl border border-slate-200 overflow-hidden bg-white">
        <svg
          ref="svgRef"
          :viewBox="'0 0 ' + CANVAS_W + ' ' + CANVAS_H"
          xmlns="http://www.w3.org/2000/svg"
          class="fc-svg block w-full h-auto select-none"
          style="touch-action: none"
        >
          <defs>
            <pattern id="fc-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 L 0 40" fill="none" stroke="#e2e8f0" stroke-width="1" />
            </pattern>
            <marker id="fc-arrow" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L9,4 L0,8 Z" fill="#64748b" />
            </marker>
            <marker id="fc-arrow-active" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L9,4 L0,8 Z" fill="#2563eb" />
            </marker>
          </defs>

          <!-- 背景与网格 -->
          <rect x="0" y="0" :width="CANVAS_W" :height="CANVAS_H" fill="#ffffff" @pointerdown="onCanvasPointerDown" />
          <rect x="0" y="0" :width="CANVAS_W" :height="CANVAS_H" fill="url(#fc-grid)" pointer-events="none" />

          <!-- 空态提示 -->
          <text v-if="!nodes.length" data-noexport x="600" y="400" text-anchor="middle" font-size="20" fill="#94a3b8" pointer-events="none">
              {{ t('tools.flowchartEditor.emptyHint') }}
            </text>

          <!-- 连线（先画，节点覆盖端点） -->
          <g v-for="edge in edges" :key="'e' + edge.id">
            <path
              :d="edgeD(edge)"
              fill="none"
              stroke="transparent"
              stroke-width="14"
              style="cursor: pointer"
              @pointerdown.stop="selectEdge(edge.id)"
            />
            <path
              :d="edgeD(edge)"
              fill="none"
              :stroke="selectedEdgeId === edge.id ? '#2563eb' : '#64748b'"
              :stroke-width="selectedEdgeId === edge.id ? 2.6 : 1.8"
              :marker-end="selectedEdgeId === edge.id ? 'url(#fc-arrow-active)' : 'url(#fc-arrow)'"
              style="pointer-events: none"
            />
          </g>

          <!-- 连线拖拽中的临时虚线 -->
          <line
            v-if="link"
            data-noexport
            :x1="link.from.x"
            :y1="link.from.y"
            :x2="link.cur.x"
            :y2="link.cur.y"
            stroke="#2563eb"
            stroke-width="2"
            stroke-dasharray="6 4"
          />

          <!-- 节点 -->
          <g
            v-for="node in nodes"
            :key="'n' + node.id"
            style="cursor: move"
            @pointerdown="onNodePointerDown($event, node)"
            @pointermove="onNodePointerMove"
            @pointerup="onNodePointerUp"
            @pointercancel="onNodePointerUp"
            @dblclick.prevent="startEdit(node)"
          >
            <template v-if="node.type === 'decision'">
              <polygon :points="diamondPoints(node)" :fill="styleOf(node).fill" :stroke="selectedNodeId === node.id ? '#2563eb' : styleOf(node).stroke" :stroke-width="selectedNodeId === node.id ? 3 : 1.6" />
            </template>
            <template v-else-if="node.type === 'subprocess'">
              <rect :x="node.x - styleOf(node).w / 2" :y="node.y - styleOf(node).h / 2" :width="styleOf(node).w" :height="styleOf(node).h" :rx="styleOf(node).rx" :fill="styleOf(node).fill" :stroke="selectedNodeId === node.id ? '#2563eb' : styleOf(node).stroke" :stroke-width="selectedNodeId === node.id ? 3 : 1.6" />
              <rect :x="node.x - styleOf(node).w / 2 + 5" :y="node.y - styleOf(node).h / 2 + 5" :width="styleOf(node).w - 10" :height="styleOf(node).h - 10" :rx="styleOf(node).rx" fill="none" :stroke="selectedNodeId === node.id ? '#2563eb' : styleOf(node).stroke" stroke-width="1.2" pointer-events="none" />
            </template>
            <template v-else>
              <rect :x="node.x - styleOf(node).w / 2" :y="node.y - styleOf(node).h / 2" :width="styleOf(node).w" :height="styleOf(node).h" :rx="styleOf(node).rx" :fill="styleOf(node).fill" :stroke="selectedNodeId === node.id ? '#2563eb' : styleOf(node).stroke" :stroke-width="selectedNodeId === node.id ? 3 : 1.6" />
            </template>

            <text
              :x="node.x"
              :y="node.y"
              text-anchor="middle"
              dominant-baseline="central"
              font-size="14"
              font-family="system-ui, 'Segoe UI', sans-serif"
              :fill="styleOf(node).text"
              style="pointer-events: none; user-select: none"
            >
              {{ node.text }}
            </text>

            <!-- 四边连接点手柄（不参与 PNG 导出） -->
            <circle
              v-for="side in SIDES"
              :key="side"
              :cx="portPos(node, side).x"
              :cy="portPos(node, side).y"
              r="4.5"
              fill="#ffffff"
              stroke="#3b82f6"
              stroke-width="1.5"
              class="fc-port"
              data-noexport
              style="cursor: crosshair"
              @pointerdown.stop.prevent="onPortPointerDown($event, node, side)"
              @pointermove="onPortPointerMove"
              @pointerup="onPortPointerUp"
              @pointercancel="onPortPointerUp"
            />
          </g>
        </svg>

        <!-- 双击编辑文字：行内输入框覆盖在节点上 -->
        <input
          v-if="editing && editNode"
          ref="editInputRef"
          v-model="editing.text"
          class="fc-edit-input"
          :style="editStyle(editNode)"
          maxlength="60"
          @keydown.enter.prevent="confirmEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="confirmEdit"
          @pointerdown.stop
        />
      </div>
    </section>

    <!-- 操作说明 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-600">
        <li v-for="tip in TIPS" :key="tip" class="flex items-start gap-2">
          <span class="text-blue-500 mt-0.5">•</span>
          <span>{{ t(`tools.flowchartEditor.${tip}`) }}</span>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

<style scoped>
.palette-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.7);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: all 0.15s;
}

.palette-item:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.06);
}

.palette-item:active {
  cursor: grabbing;
  transform: scale(0.97);
}

.fc-port {
  transition: r 0.1s;
}

.fc-port:hover {
  r: 6;
}

.fc-edit-input {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 2px 6px;
  font-size: 13px;
  border-radius: 8px;
  border: 1.5px solid #3b82f6;
  outline: none;
  background: #ffffff;
  color: #1e293b;
  text-align: center;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
  z-index: 10;
}
</style>
