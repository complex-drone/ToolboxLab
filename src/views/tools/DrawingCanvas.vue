<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { downloadCanvasAsPng } from '@/utils/download'

/**
 * 绘图画布：原生 Canvas，固定逻辑尺寸 1200x800，CSS 自适应缩放
 * - 工具：画笔 / 橡皮擦（白线覆盖）/ 矩形 / 圆形 / 直线 / 文字（字号随线宽）
 * - pointer 事件 + setPointerCapture，坐标按显示尺寸换算到逻辑尺寸
 * - 撤销/重做：dataURL 快照栈（上限 30 步），离屏 canvas 保存已提交画面供形状预览
 * - 清空采用二次点击确认（不弹原生对话框），清空后仍可撤销
 * - 工具 / 颜色 / 粗细持久化
 */
const { t } = useI18n()
const toast = useToast()

const CANVAS_W = 1200
const CANVAS_H = 800
const BG_COLOR = '#ffffff'
const ERASER_COLOR = '#ffffff'
const MAX_HISTORY = 30

const TOOLS = [
  { key: 'pen' },
  { key: 'eraser' },
  { key: 'rect' },
  { key: 'circle' },
  { key: 'line' },
  { key: 'text' },
]

const config = useStorage('tool-drawing-canvas-config', {
  tool: 'pen',
  color: '#2563eb',
  strokeWidth: 4,
})

const canvasRef = ref(null)
const textValue = ref('')
const clearArmed = ref(false)

let ctx = null
let offscreen = null
let offCtx = null
const history = ref([])
const redoStack = ref([])
let drawing = false
let startPoint = null
let lastPoint = null
let clearTimer = null

const canvasCursor = computed(() => {
  if (config.value.tool === 'text') return 'text'
  if (config.value.tool === 'eraser') return 'cell'
  return 'crosshair'
})

const canUndo = computed(() => history.value.length > 1)
const canRedo = computed(() => redoStack.value.length > 0)

/* ---------- 快照管理 ---------- */
function takeSnapshot() {
  try {
    return canvasRef.value.toDataURL('image/png')
  } catch (e) {
    return null
  }
}

function syncOffscreen() {
  if (!offCtx || !canvasRef.value) return
  offCtx.drawImage(canvasRef.value, 0, 0, CANVAS_W, CANVAS_H)
}

function pushSnapshot() {
  const snap = takeSnapshot()
  if (!snap) return
  history.value.push(snap)
  if (history.value.length > MAX_HISTORY) history.value.shift()
  redoStack.value = []
  syncOffscreen()
}

function restoreFrom(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H)
      syncOffscreen()
      resolve()
    }
    img.onerror = () => resolve()
    img.src = dataUrl
  })
}

async function undo() {
  if (history.value.length <= 1) return
  const current = history.value.pop()
  redoStack.value.push(current)
  const target = history.value[history.value.length - 1]
  if (target) await restoreFrom(target)
}

async function redo() {
  if (!redoStack.value.length) return
  const snap = redoStack.value.pop()
  history.value.push(snap)
  await restoreFrom(snap)
}

/* ---------- 画布初始化 ---------- */
function paintBackground() {
  if (!ctx) return
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = canvas.getContext('2d')
  if (!ctx) {
    toast.error(t('toolsCommon.error'))
    return
  }
  offscreen = document.createElement('canvas')
  offscreen.width = CANVAS_W
  offscreen.height = CANVAS_H
  offCtx = offscreen.getContext('2d')
  paintBackground()
  syncOffscreen()
  const snap = takeSnapshot()
  if (snap) history.value.push(snap)
})

onBeforeUnmount(() => {
  if (clearTimer) clearTimeout(clearTimer)
  ctx = null
  offCtx = null
  offscreen = null
  history.value = []
  redoStack.value = []
})

/* ---------- 坐标换算 ---------- */
function getPos(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const scaleX = CANVAS_W / (rect.width || CANVAS_W)
  const scaleY = CANVAS_H / (rect.height || CANVAS_H)
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  }
}

/* ---------- 绘制 ---------- */
function strokeStyleFor(tool) {
  ctx.strokeStyle = tool === 'eraser' ? ERASER_COLOR : config.value.color
  ctx.lineWidth = config.value.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
}

function drawShapePreview(from, to) {
  ctx.drawImage(offscreen, 0, 0, CANVAS_W, CANVAS_H)
  strokeStyleFor(config.value.tool)
  ctx.beginPath()
  const tool = config.value.tool
  if (tool === 'rect') {
    ctx.strokeRect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  } else if (tool === 'circle') {
    const cx = (from.x + to.x) / 2
    const cy = (from.y + to.y) / 2
    ctx.ellipse(cx, cy, Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2, 0, 0, Math.PI * 2)
  } else if (tool === 'line') {
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
  }
  ctx.stroke()
}

function placeText(pos) {
  const content = textValue.value.trim()
  if (!content) {
    toast.info(t('tools.drawingCanvas.textRequired'))
    return
  }
  const fontSize = Math.max(12, Math.round(config.value.strokeWidth * 5))
  ctx.fillStyle = config.value.color
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText(content, pos.x, pos.y)
  pushSnapshot()
}

function onPointerDown(e) {
  if (!ctx) return
  e.preventDefault()
  const pos = getPos(e)
  if (config.value.tool === 'text') {
    placeText(pos)
    return
  }
  try {
    canvasRef.value.setPointerCapture(e.pointerId)
  } catch (err) {
    /* 某些环境不支持 pointer capture，忽略 */
  }
  drawing = true
  startPoint = pos
  lastPoint = pos
  if (config.value.tool === 'pen' || config.value.tool === 'eraser') {
    strokeStyleFor(config.value.tool)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    // 单击也留下一个圆点
    ctx.lineTo(pos.x + 0.01, pos.y + 0.01)
    ctx.stroke()
  }
}

function onPointerMove(e) {
  if (!drawing || !ctx) return
  e.preventDefault()
  const pos = getPos(e)
  const tool = config.value.tool
  if (tool === 'pen' || tool === 'eraser') {
    strokeStyleFor(tool)
    ctx.beginPath()
    ctx.moveTo(lastPoint.x, lastPoint.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPoint = pos
  } else if (startPoint) {
    drawShapePreview(startPoint, pos)
  }
}

function onPointerUp(e) {
  if (!drawing || !ctx) return
  try {
    if (canvasRef.value.hasPointerCapture && canvasRef.value.hasPointerCapture(e.pointerId)) {
      canvasRef.value.releasePointerCapture(e.pointerId)
    }
  } catch (err) {
    /* 忽略 */
  }
  drawing = false
  startPoint = null
  lastPoint = null
  pushSnapshot()
}

function onPointerCancel(e) {
  if (!drawing || !ctx) return
  drawing = false
  startPoint = null
  lastPoint = null
  // 恢复到最近一次已提交画面，避免残留未完成的预览
  if (history.value.length) restoreFrom(history.value[history.value.length - 1])
}

/* ---------- 清空（二次点击确认） / 导出 ---------- */
function handleClear() {
  if (!ctx) return
  if (!clearArmed.value) {
    clearArmed.value = true
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      clearArmed.value = false
    }, 3000)
    return
  }
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  clearArmed.value = false
  paintBackground()
  pushSnapshot()
  toast.info(t('tools.drawingCanvas.clearedDone'))
}

function exportPng() {
  if (!canvasRef.value) return
  try {
    downloadCanvasAsPng(canvasRef.value, 'drawing-canvas.png')
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="drawingCanvas">
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 工具栏 -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="tool in TOOLS"
          :key="tool.key"
          type="button"
          class="btn-ghost"
          :class="config.tool === tool.key ? 'text-blue-600 border-blue-400 bg-blue-50' : ''"
          @click="config.tool = tool.key"
        >
          {{ t(`tools.drawingCanvas.tool${tool.key.charAt(0).toUpperCase() + tool.key.slice(1)}`) }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 mt-3">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600">
          <span>{{ t('tools.drawingCanvas.colorLabel') }}</span>
          <input v-model="config.color" type="color" class="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5" />
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 min-w-[180px] flex-1 max-w-xs">
          <span class="whitespace-nowrap">{{ t('tools.drawingCanvas.strokeLabel') }}</span>
          <input
            v-model.number="config.strokeWidth"
            type="range"
            min="1"
            max="30"
            class="flex-1 accent-blue-600"
          />
          <span class="font-mono text-xs text-slate-500 w-12 text-right">{{ config.strokeWidth }} px</span>
        </label>
        <div class="flex flex-wrap items-center gap-2 ml-auto">
          <button type="button" class="btn-ghost" :disabled="!canUndo" @click="undo">
            {{ t('tools.drawingCanvas.undo') }}
          </button>
          <button type="button" class="btn-ghost" :disabled="!canRedo" @click="redo">
            {{ t('tools.drawingCanvas.redo') }}
          </button>
          <button type="button" class="btn-danger" @click="handleClear">
            {{ clearArmed ? t('tools.drawingCanvas.confirmClear') : t('tools.drawingCanvas.clearCanvas') }}
          </button>
          <button type="button" class="btn-primary" @click="exportPng">
            {{ t('tools.drawingCanvas.exportPng') }}
          </button>
        </div>
      </div>

      <!-- 文字工具输入 -->
      <div v-if="config.tool === 'text'" class="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <label class="label-base mb-0 sm:w-24">{{ t('tools.drawingCanvas.textInputLabel') }}</label>
        <input
          v-model="textValue"
          type="text"
          class="input-base flex-1"
          :placeholder="t('tools.drawingCanvas.textPlaceholder')"
        />
      </div>

      <!-- 画布 -->
      <div class="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <canvas
          ref="canvasRef"
          :width="CANVAS_W"
          :height="CANVAS_H"
          class="block w-full max-w-full h-auto touch-none select-none"
          :style="{ cursor: canvasCursor }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
        ></canvas>
      </div>
      <p class="mt-2 text-xs text-slate-400">
        {{ t('tools.drawingCanvas.canvasSize') }} · {{ history.length }} {{ t('tools.drawingCanvas.steps') }}
      </p>
    </section>
  </ToolPage>
</template>
