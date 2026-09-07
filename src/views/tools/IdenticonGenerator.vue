<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import { downloadDataUrl, downloadText } from '@/utils/download'

/**
 * 头像生成器（Identicon）
 * - SHA-256 哈希字节流驱动 5x5 左右对称像素图案（左 3 列取哈希位，偶数位填色，镜像到右侧）
 * - 前景色由哈希 3 字节合成 HSL 色相（饱和度 / 亮度固定在可读区间）
 * - Canvas 按 64/128/256/512px 绘制并支持 PNG 导出；SVG 由 rect 拼接生成
 * - 批量模式：多行文本逐行生成 64px 头像，支持单个下载
 */
const { t } = useI18n()
const toast = useToast()

const GRID = 5
const SIZES = [64, 128, 256, 512]
const PAD_RATIO = 0.08
const BATCH_LIMIT = 60
const DEFAULT_BG = '#e2e8f0'

const config = useStorage('tool-identicon-config', {
  bgColor: DEFAULT_BG,
  size: 128,
  input: 'toolboxlab',
})

const pattern = ref(null) // { cells: boolean[25], fg }
const batchInput = ref('')
const batchItems = ref([]) // [{ text, cells, fg }]
const busy = ref(false)
const errorMsg = ref('')

const mainCanvas = ref(null)
const batchCanvases = new Map()

const hasPattern = computed(() => !!pattern.value)

/* ---------- 哈希与图案 ---------- */

async function sha256Bytes(str) {
  const data = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(buf)
}

function buildPattern(bytes) {
  const cells = new Array(GRID * GRID).fill(false)
  let bitIndex = 0
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < GRID; row++) {
      const byte = bytes[bitIndex >> 3] || 0
      const bit = (byte >> (bitIndex & 7)) & 1
      const filled = bit % 2 === 0 // 偶数位填色
      cells[row * GRID + col] = filled
      cells[row * GRID + (GRID - 1 - col)] = filled // 左右镜像
      bitIndex++
    }
  }
  const hue = (((bytes[15] << 16) | (bytes[16] << 8) | bytes[17]) % 360 + 360) % 360
  return { cells, fg: `hsl(${hue}, 58%, 45%)` }
}

function validBg() {
  return /^#[0-9a-fA-F]{6}$/.test(config.value.bgColor) ? config.value.bgColor : DEFAULT_BG
}

/* ---------- Canvas 绘制 ---------- */

function drawOn(canvas, sizePx, pat, bg) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pad = sizePx * PAD_RATIO
  const cell = (sizePx - pad * 2) / GRID
  ctx.clearRect(0, 0, sizePx, sizePx)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, sizePx, sizePx)
  ctx.fillStyle = pat.fg
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (pat.cells[r * GRID + c]) {
        ctx.fillRect(pad + c * cell, pad + r * cell, Math.ceil(cell), Math.ceil(cell))
      }
    }
  }
}

function drawMain() {
  if (mainCanvas.value && pattern.value) {
    drawOn(mainCanvas.value, config.value.size, pattern.value, validBg())
  }
}

function setBatchCanvas(el, index) {
  if (el) batchCanvases.set(index, el)
  else batchCanvases.delete(index)
}

function drawBatch() {
  batchItems.value.forEach((item, i) => {
    const canvas = batchCanvases.get(i)
    if (canvas) drawOn(canvas, 64, item, validBg())
  })
}

/* ---------- 生成 ---------- */

async function generate() {
  if (!(window.crypto && window.crypto.subtle)) {
    errorMsg.value = t('tools.identiconGenerator.hashFailed')
    pattern.value = null
    return
  }
  const value = (config.value.input || '').trim()
  if (!value) {
    pattern.value = null
    errorMsg.value = ''
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const bytes = await sha256Bytes(value)
    pattern.value = buildPattern(bytes)
    await nextTick()
    drawMain()
  } catch {
    pattern.value = null
    errorMsg.value = t('tools.identiconGenerator.hashFailed')
  } finally {
    busy.value = false
  }
}

const generateDebounced = useDebounceFn(generate, 300)

watch(() => config.value.input, () => generateDebounced())
watch(() => config.value.size, () => nextTick(drawMain))
watch(() => config.value.bgColor, () => {
  nextTick(drawMain)
  nextTick(drawBatch)
})

/* ---------- SVG 生成与下载 ---------- */

function buildSvg(pat, bg) {
  const view = 100
  const cellRatio = (view - PAD_RATIO * view * 2) / GRID
  let rects = ''
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (pat.cells[r * GRID + c]) {
        const x = (PAD_RATIO * view + c * cellRatio).toFixed(2)
        const y = (PAD_RATIO * view + r * cellRatio).toFixed(2)
        rects += `<rect x="${x}" y="${y}" width="${cellRatio.toFixed(2)}" height="${cellRatio.toFixed(2)}" fill="${pat.fg}" />`
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="512" height="512">` +
    `<rect width="${view}" height="${view}" fill="${bg}" />` +
    rects +
    '</svg>'
  )
}

function safeName(text) {
  const base = (text || '').replace(/[^\w.-]+/g, '_').slice(0, 40)
  return base || 'identicon'
}

function downloadPng() {
  if (!pattern.value) return
  drawMain()
  if (!mainCanvas.value) return
  try {
    downloadDataUrl(mainCanvas.value.toDataURL('image/png'), `identicon-${safeName(config.value.input)}.png`)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function downloadSvg() {
  if (!pattern.value) return
  try {
    const svg = buildSvg(pattern.value, validBg())
    downloadText(svg, `identicon-${safeName(config.value.input)}.svg`, 'image/svg+xml;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------- 批量模式 ---------- */

async function generateBatch() {
  const lines = batchInput.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, BATCH_LIMIT)
  if (!lines.length) {
    batchItems.value = []
    return
  }
  if (!(window.crypto && window.crypto.subtle)) {
    errorMsg.value = t('tools.identiconGenerator.hashFailed')
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const items = []
    for (const line of lines) {
      const bytes = await sha256Bytes(line)
      items.push({ text: line, ...buildPattern(bytes) })
    }
    batchItems.value = items
    await nextTick()
    drawBatch()
  } catch {
    errorMsg.value = t('tools.identiconGenerator.hashFailed')
  } finally {
    busy.value = false
  }
}

function downloadBatchItem(item) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    drawOn(canvas, 64, item, validBg())
    downloadDataUrl(canvas.toDataURL('image/png'), `identicon-${safeName(item.text)}-64.png`)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------- 示例 ---------- */

function loadSampleSingle() {
  config.value.input = t('tools.identiconGenerator.sampleSingle')
}

function loadSampleBatch() {
  batchInput.value = t('tools.identiconGenerator.sampleBatch')
  generateBatch()
}

onMounted(() => {
  generate()
})

onBeforeUnmount(() => {
  generateDebounced.cancel()
  batchCanvases.clear()
})
</script>

<template>
  <ToolPage tool-id="identiconGenerator">
    <!-- 单个生成 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="identicon-input" class="label-base">{{ t('tools.identiconGenerator.inputLabel') }}</label>
          <div class="flex gap-2">
            <input
              id="identicon-input"
              v-model="config.input"
              type="text"
              class="input-base flex-1 min-w-0"
              :placeholder="t('tools.identiconGenerator.inputPlaceholder')"
            />
            <button type="button" class="btn-primary flex-shrink-0" :disabled="busy" @click="generate">
              {{ t('tools.identiconGenerator.generate') }}
            </button>
          </div>
          <button type="button" class="btn-ghost mt-2" @click="loadSampleSingle">
            {{ t('toolsCommon.example') }}
          </button>

          <div class="mt-4">
            <label for="identicon-bg" class="label-base">{{ t('tools.identiconGenerator.bgColor') }}</label>
            <div class="flex items-center gap-2">
              <input id="identicon-bg" v-model="config.bgColor" type="color" class="w-10 h-9 rounded cursor-pointer bg-transparent" />
              <span class="text-xs text-slate-400 font-mono">{{ config.bgColor }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-400">{{ t('tools.identiconGenerator.fgColor') }}</p>
          </div>

          <div class="mt-4">
            <span class="label-base">{{ t('tools.identiconGenerator.size') }}</span>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="size in SIZES"
                :key="size"
                class="chip cursor-pointer select-none"
                :class="config.size === size ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'"
              >
                <input v-model="config.size" type="radio" name="identicon-size" :value="size" class="hidden" />
                {{ size }} px
              </label>
            </div>
          </div>
        </div>

        <div class="flex flex-col items-center">
          <span class="label-base self-start">{{ t('toolsCommon.preview') }}</span>
          <div class="mt-1 flex items-center justify-center w-full flex-1 min-h-[180px]">
            <canvas
              v-if="hasPattern"
              ref="mainCanvas"
              :width="config.size"
              :height="config.size"
              class="w-40 h-40 sm:w-44 sm:h-44 rounded-xl border border-slate-200 shadow-sm bg-white"
            ></canvas>
            <p v-else class="text-sm text-slate-400">{{ t('tools.identiconGenerator.emptyHint') }}</p>
          </div>
          <div class="flex flex-wrap justify-center gap-2 mt-3">
            <button type="button" class="btn-ghost" :disabled="!hasPattern" @click="downloadPng">
              {{ t('tools.identiconGenerator.downloadPng') }}
            </button>
            <button type="button" class="btn-ghost" :disabled="!hasPattern" @click="downloadSvg">
              {{ t('tools.identiconGenerator.downloadSvg') }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="errorMsg" class="mt-3 text-sm text-red-600">{{ errorMsg }}</p>
    </section>

    <!-- 批量模式 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.identiconGenerator.batchMode') }}</h2>
      <div class="flex items-center gap-2 mb-1.5">
        <label for="identicon-batch" class="label-base flex-1 mb-0">{{ t('tools.identiconGenerator.batchInput') }}</label>
        <button type="button" class="btn-ghost" @click="loadSampleBatch">{{ t('toolsCommon.example') }}</button>
        <button type="button" class="btn-primary" :disabled="busy" @click="generateBatch">
          {{ t('tools.identiconGenerator.batchGenerate') }}
        </button>
      </div>
      <textarea
        id="identicon-batch"
        v-model="batchInput"
        class="input-base w-full h-28 resize-y font-mono text-sm"
        :placeholder="t('tools.identiconGenerator.batchPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p class="mt-1 text-xs text-slate-400">{{ t('tools.identiconGenerator.batchLimitNote') }}</p>

      <div v-if="batchItems.length" class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3 mt-4">
        <div
          v-for="(item, i) in batchItems"
          :key="item.text + '-' + i"
          class="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-slate-200 bg-white/70"
        >
          <canvas :ref="el => setBatchCanvas(el, i)" width="64" height="64" class="w-14 h-14 rounded-md"></canvas>
          <span class="w-full text-xs text-slate-500 text-center truncate" :title="item.text">{{ item.text }}</span>
          <button type="button" class="btn-ghost text-xs px-2 py-1" @click="downloadBatchItem(item)">
            {{ t('tools.identiconGenerator.batchDownload') }}
          </button>
        </div>
      </div>
      <p v-else class="mt-3 text-sm text-slate-400">{{ t('tools.identiconGenerator.batchEmpty') }}</p>
    </section>
  </ToolPage>
</template>
