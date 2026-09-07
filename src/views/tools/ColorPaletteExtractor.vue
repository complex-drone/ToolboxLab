<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl } from '@/utils/download'
import { formatBytes } from '@/utils/format'
import { copyText } from '@/utils/clipboard'

const { t } = useI18n()
const toast = useToast()

/* ================= 常量 ================= */

/** 采样离屏画布最长边 */
const MAX_SAMPLE_EDGE = 200
/** 主色数量可选项 */
const COLOR_COUNT_OPTIONS = [5, 8, 10]
/** 中位切分的目标箱数（数量选项 5 用 8 箱，8/10 用 16 箱） */
const MAX_BOX_TARGET = 16

/* ================= 状态 ================= */

/** 主色数量选项持久化 */
const config = useStorage('tool-color-palette-config', { colorCount: 8 })

const file = ref(null) // { name, size, type }
const previewDataUrl = ref('')
const dims = ref(null) // { width, height }
const sampledCount = ref(0)
const palette = ref([]) // [{ hex, r, g, b, count, percent }]
const extractError = ref('')
const extracting = ref(false)

let objectUrl = ''
let currentImage = null

if (!COLOR_COUNT_OPTIONS.includes(config.value.colorCount)) {
  config.value.colorCount = 8
}

/* ================= 颜色纯函数 ================= */

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function rgbToHex(r, g, b) {
  const two = v => clampChannel(v).toString(16).padStart(2, '0')
  return `#${two(r)}${two(g)}${two(b)}`.toUpperCase()
}

function rgbToHsl(r, g, b) {
  const rn = clampChannel(r) / 255
  const gn = clampChannel(g) / 255
  const bn = clampChannel(b) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) {
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
    } else if (max === gn) {
      h = (bn - rn) / d + 2
    } else {
      h = (rn - gn) / d + 4
    }
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360
  const sn = Math.min(100, Math.max(0, s)) / 100
  const ln = Math.min(100, Math.max(0, l)) / 100
  if (sn === 0) {
    const v = Math.round(ln * 255)
    return { r: v, g: v, b: v }
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const hue2rgb = v => {
    let x = v
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  }
}

/* ================= MMCQ（中位切分）颜色量化 ================= */

/**
 * 构建一个颜色箱：一次遍历统计像素数、通道和、平方和与各通道方差
 */
function makeBox(pixels) {
  const n = pixels.length
  let sr = 0
  let sg = 0
  let sb = 0
  let ssr = 0
  let ssg = 0
  let ssb = 0
  for (let i = 0; i < n; i++) {
    const r = pixels[i][0]
    const g = pixels[i][1]
    const b = pixels[i][2]
    sr += r
    sg += g
    sb += b
    ssr += r * r
    ssg += g * g
    ssb += b * b
  }
  const mean = n > 0 ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : [0, 0, 0]
  const variance = n > 0
    ? [ssr / n - (sr / n) ** 2, ssg / n - (sg / n) ** 2, ssb / n - (sb / n) ** 2]
    : [0, 0, 0]
  return { pixels, n, mean, variance }
}

/**
 * 中位切分：反复挑选「通道方差之和最大」的箱，
 * 沿方差最大的通道按中位数切成两箱，直到达到目标箱数或无法再切
 */
function splitBoxes(pixels, targetBoxes) {
  if (!pixels || pixels.length === 0) return []
  const boxes = [makeBox(pixels)]
  while (boxes.length < targetBoxes) {
    let bestIdx = -1
    let bestScore = 0
    let bestChannel = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.n < 2) continue
      const score = box.variance[0] + box.variance[1] + box.variance[2]
      if (score <= 0) continue
      let channel = 0
      if (box.variance[1] > box.variance[channel]) channel = 1
      if (box.variance[2] > box.variance[channel]) channel = 2
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
        bestChannel = channel
      }
    }
    if (bestIdx === -1) break
    const box = boxes.splice(bestIdx, 1)[0]
    const ch = bestChannel
    const sorted = [...box.pixels].sort((a, b) => a[ch] - b[ch])
    const mid = sorted.length >> 1
    boxes.push(makeBox(sorted.slice(0, mid)), makeBox(sorted.slice(mid)))
  }
  return boxes
}

/**
 * 提取主色：量化后每箱取均值色，按箱内像素数降序取前 colorCount 个
 */
function extractPalette(pixels, colorCount) {
  const targetBoxes = colorCount <= 5 ? 8 : MAX_BOX_TARGET
  const boxes = splitBoxes(pixels, targetBoxes)
  return boxes
    .map(box => ({
      hex: rgbToHex(box.mean[0], box.mean[1], box.mean[2]),
      r: box.mean[0],
      g: box.mean[1],
      b: box.mean[2],
      count: box.n,
      percent: Math.round((box.n / pixels.length) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, colorCount)
}

/* ================= 图片加载与采样 ================= */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

/** 绘制到最长边不超过 200px 的离屏画布并收集 RGB 像素（跳过完全透明像素） */
function samplePixels(img) {
  const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas context unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const pixels = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  return pixels
}

function resetResult() {
  palette.value = []
  extractError.value = ''
  sampledCount.value = 0
}

function releaseImage() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  currentImage = null
  file.value = null
  dims.value = null
  previewDataUrl.value = ''
  resetResult()
}

async function runExtraction() {
  const pixels = currentPixelsCache
  resetResult()
  if (!pixels || pixels.length === 0) {
    if (file.value) {
      extractError.value = t('tools.colorPaletteExtractor.emptyImage')
    }
    return
  }
  extracting.value = true
  try {
    palette.value = extractPalette(pixels, config.value.colorCount)
  } catch {
    extractError.value = t('tools.colorPaletteExtractor.extractFailed')
    toast.error(t('tools.colorPaletteExtractor.extractFailed'))
  } finally {
    extracting.value = false
  }
}

let currentPixelsCache = null

async function onFileSelected(f) {
  if (!f) return
  try {
    releaseImage()
    objectUrl = URL.createObjectURL(f)
    const img = await loadImage(objectUrl)
    const pixels = samplePixels(img)
    currentImage = img
    currentPixelsCache = pixels
    file.value = { name: f.name, size: f.size, type: f.type }
    dims.value = { width: img.naturalWidth, height: img.naturalHeight }
    previewDataUrl.value = objectUrl
    sampledCount.value = pixels.length
    await runExtraction()
  } catch {
    releaseImage()
    currentPixelsCache = null
    toast.error(t('tools.colorPaletteExtractor.extractFailed'))
  }
}

function onUploadError() {
  toast.error(t('toolsCommon.unsupportedFile'))
}

function reupload() {
  releaseImage()
  currentPixelsCache = null
}

watch(
  () => config.value.colorCount,
  () => {
    if (currentPixelsCache) runExtraction()
  }
)

/* ================= 主色展示 ================= */

const dominant = computed(() => palette.value[0] || null)

async function copyHex(hex) {
  try {
    const ok = await copyText(hex)
    if (ok) {
      toast.success(t('toolsCommon.copied'))
    } else {
      toast.error(t('toolsCommon.copyFailed'))
    }
  } catch {
    toast.error(t('toolsCommon.copyFailed'))
  }
}

/* ================= 配色方案生成 ================= */

const schemes = computed(() => {
  const d = dominant.value
  if (!d) return []
  const base = rgbToHsl(d.r, d.g, d.b)
  const shift = delta => {
    const rgb = hslToRgb(base.h + delta, base.s, base.l)
    return rgbToHex(rgb.r, rgb.g, rgb.b)
  }
  return [
    { key: 'complementary', labelKey: 'schemeComplementary', colors: [shift(0), shift(180)] },
    { key: 'triadic', labelKey: 'schemeTriadic', colors: [shift(0), shift(120), shift(240)] },
    { key: 'analogous', labelKey: 'schemeAnalogous', colors: [shift(-30), shift(-15), shift(0), shift(15), shift(30)] },
  ]
})

function schemeLabel(scheme) {
  return t(`tools.colorPaletteExtractor.${scheme.labelKey}`)
}

function schemeCssVars(scheme) {
  const lines = scheme.colors.map((hex, i) => `  --${scheme.key}-${i + 1}: ${hex};`)
  return `:root {\n${lines.join('\n')}\n}`
}

const allHexText = computed(() => palette.value.map(c => c.hex).join('\n'))

const allCssVars = computed(() => {
  const lines = []
  palette.value.forEach((c, i) => {
    lines.push(`  --palette-${i + 1}: ${c.hex};`)
  })
  schemes.value.forEach(scheme => {
    scheme.colors.forEach((hex, i) => {
      lines.push(`  --${scheme.key}-${i + 1}: ${hex};`)
    })
  })
  return `:root {\n${lines.join('\n')}\n}`
})

/* ================= 清理 ================= */

onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  currentImage = null
  currentPixelsCache = null
})
</script>

<template>
  <ToolPage tool-id="colorPaletteExtractor">
    <!-- 上传 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.colorPaletteExtractor.uploadSection') }}</h2>
      <FileDropZone
        v-if="!previewDataUrl"
        accept="image/*"
        :max-size-mb="15"
        :hint="t('tools.colorPaletteExtractor.uploadHint')"
        @files="onFileSelected"
        @error="onUploadError"
      />
      <template v-else>
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            :src="previewDataUrl"
            :alt="file && file.name ? file.name : t('toolsCommon.preview')"
            class="max-h-72 w-full rounded-xl border border-slate-200 bg-white object-contain sm:max-w-xs"
          />
          <div class="min-w-0 flex-1">
            <h3 class="mb-2 text-sm font-semibold text-slate-600">{{ t('tools.colorPaletteExtractor.imageInfo') }}</h3>
            <dl class="space-y-1.5 text-sm">
              <div class="flex gap-2">
                <dt class="shrink-0 text-slate-400">{{ t('tools.colorPaletteExtractor.fileName') }}</dt>
                <dd class="min-w-0 break-all text-slate-700">{{ file ? file.name : '-' }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="shrink-0 text-slate-400">{{ t('tools.colorPaletteExtractor.dimensions') }}</dt>
                <dd class="font-mono text-slate-700">{{ dims ? `${dims.width} × ${dims.height}` : '-' }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="shrink-0 text-slate-400">{{ t('tools.colorPaletteExtractor.fileSize') }}</dt>
                <dd class="font-mono text-slate-700">{{ file ? formatBytes(file.size) : '-' }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="shrink-0 text-slate-400">{{ t('tools.colorPaletteExtractor.sampledPixels') }}</dt>
                <dd class="font-mono text-slate-700">{{ sampledCount }}</dd>
              </div>
            </dl>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn-primary" @click="reupload">
                {{ t('toolsCommon.reupload') }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- 主色结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.colorPaletteExtractor.paletteSection') }}</h2>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-slate-500">{{ t('tools.colorPaletteExtractor.colorCount') }}</span>
          <div class="flex gap-1">
            <button
              v-for="n in COLOR_COUNT_OPTIONS"
              :key="`count-${n}`"
              type="button"
              class="chip cursor-pointer"
              :class="config.colorCount === n ? 'border-blue-300 bg-blue-50 text-blue-700' : ''"
              :aria-pressed="config.colorCount === n"
              @click="config.colorCount = n"
            >
              {{ n }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="extracting" class="text-sm text-slate-400">{{ t('toolsCommon.processing') }}</p>
      <p v-else-if="extractError" class="text-sm text-red-600" role="alert">{{ extractError }}</p>
      <p v-else-if="palette.length === 0" class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>

      <template v-else>
        <p class="mb-3 text-xs text-slate-400">{{ t('tools.colorPaletteExtractor.clickSwatchHint') }}</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          <button
            v-for="(color, i) in palette"
            :key="`color-${i}-${color.hex}`"
            type="button"
            class="group rounded-xl border border-slate-200 bg-white/70 p-2 text-left transition hover:border-blue-300 hover:shadow-sm"
            :aria-label="`${t('toolsCommon.copy')} ${color.hex}`"
            @click="copyHex(color.hex)"
          >
            <span class="block h-16 w-full rounded-lg border border-slate-200" :style="{ backgroundColor: color.hex }"></span>
            <span class="mt-2 block font-mono text-sm font-semibold text-slate-700">{{ color.hex }}</span>
            <span class="block font-mono text-xs text-slate-400">rgb({{ color.r }}, {{ color.g }}, {{ color.b }})</span>
            <span class="mt-1 flex items-center justify-between gap-1">
              <span v-if="i === 0" class="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                {{ t('tools.colorPaletteExtractor.dominantLabel') }}
              </span>
              <span class="ml-auto font-mono text-xs text-slate-400">{{ color.percent }}%</span>
            </span>
          </button>
        </div>
      </template>
    </section>

    <!-- 配色方案 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.colorPaletteExtractor.schemesSection') }}</h2>
      <p v-if="schemes.length === 0" class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>
      <div v-else class="space-y-3">
        <div
          v-for="scheme in schemes"
          :key="scheme.key"
          class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white/70 p-3"
        >
          <span class="chip shrink-0">{{ schemeLabel(scheme) }}</span>
          <div class="flex flex-1 flex-wrap gap-2">
            <button
              v-for="(hex, i) in scheme.colors"
              :key="`${scheme.key}-${i}-${hex}`"
              type="button"
              class="h-9 w-9 rounded-lg border border-slate-200 transition hover:scale-105"
              :style="{ backgroundColor: hex }"
              :aria-label="`${t('toolsCommon.copy')} ${hex}`"
              :title="hex"
              @click="copyHex(hex)"
            ></button>
          </div>
          <CopyButton :text="schemeCssVars(scheme)" :label="t('tools.colorPaletteExtractor.copySchemeVars')" />
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <CopyButton :text="allHexText" :label="t('tools.colorPaletteExtractor.copyAllHex')" />
          <CopyButton :text="allCssVars" :label="t('tools.colorPaletteExtractor.copyAllVars')" />
        </div>
      </div>
    </section>
  </ToolPage>
</template>
