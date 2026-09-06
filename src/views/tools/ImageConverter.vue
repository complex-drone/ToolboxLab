<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl, downloadBlob } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/** 超过 4000 万像素的图片直接拒绝，防止 canvas 卡死页面 */
const MAX_PIXELS = 40000000

const MIME_MAP = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}
const EXT_MAP = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' }

/** 持久化配置：目标格式 + 质量 */
const config = useStorage('tool-image-converter-config', { format: 'jpeg', quality: 80 })

const source = ref(null) // { name, size, type, dataUrl, width, height }
const result = ref(null) // { blob, url, size, type, width, height, ext }
const processing = ref(false)
const errorMsg = ref('')
const avifSupported = ref(false)
const avifChecked = ref(false)

/** 非响应式的原图 Image 元素，供 drawImage 使用 */
let srcImg = null

const formatOptions = computed(() => [
  { key: 'jpeg', label: 'JPEG', disabled: false },
  { key: 'png', label: 'PNG', disabled: false },
  { key: 'webp', label: 'WebP', disabled: false },
  { key: 'avif', label: 'AVIF', disabled: !avifSupported.value },
])

const qualityEnabled = computed(() => config.value.format !== 'png')

const quality = computed({
  get() {
    const n = Math.round(Number(config.value.quality))
    return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 80
  },
  set(v) {
    const n = Math.round(Number(v))
    config.value.quality = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 80
  },
})

const originalSizeLabel = computed(() =>
  source.value ? formatBytes(source.value.size) : ''
)
const resultSizeLabel = computed(() =>
  result.value ? formatBytes(result.value.size) : ''
)

/** 体积变化百分比：正值表示比原图小 */
const savedPercent = computed(() => {
  if (!source.value || !result.value || !source.value.size) return null
  return (1 - result.value.size / source.value.size) * 100
})

const ratioText = computed(() => {
  if (savedPercent.value === null) return ''
  if (Math.abs(savedPercent.value) < 0.05) return '±0%'
  const sign = savedPercent.value > 0 ? '-' : '+'
  return sign + Math.abs(savedPercent.value).toFixed(1) + '%'
})

const ratioCaption = computed(() => {
  if (savedPercent.value === null) return ''
  if (Math.abs(savedPercent.value) < 0.05) {
    return t('tools.imageConverter.sameSize')
  }
  const p = Math.abs(savedPercent.value).toFixed(1) + '%'
  const label =
    savedPercent.value > 0
      ? t('tools.imageConverter.smaller')
      : t('tools.imageConverter.larger')
  return label + ' ' + p
})

/** 通过 canvas.toBlob 回调结果 type 探测浏览器是否支持 AVIF 导出 */
async function detectAvifSupport() {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.fillRect(0, 0, 2, 2)
    const blob = await new Promise((resolve) => {
      try {
        canvas.toBlob(resolve, 'image/avif', 0.5)
      } catch {
        resolve(null)
      }
    })
    avifSupported.value = !!(blob && blob.type === 'image/avif')
  } catch {
    avifSupported.value = false
  }
  avifChecked.value = true
  // 持久化的格式若不被支持则回退
  if (config.value.format === 'avif' && !avifSupported.value) {
    config.value.format = 'jpeg'
  }
}

onMounted(() => {
  // 校验持久化的格式，非法值回退为 JPEG
  if (!Object.prototype.hasOwnProperty.call(MIME_MAP, config.value.format)) {
    config.value.format = 'jpeg'
  }
  detectAvifSupport()
})

function selectFormat(key) {
  const opt = formatOptions.value.find((o) => o.key === key)
  if (!opt || opt.disabled) return
  config.value.format = key
}

function formatButtonClass(active) {
  return active
    ? 'px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white shadow-sm transition select-none'
    : 'px-3.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 bg-white/70 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition select-none disabled:opacity-40 disabled:cursor-not-allowed'
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function canvasToBlob(canvas, mime, qualityValue) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        mime,
        qualityValue
      )
    } catch (e) {
      reject(e)
    }
  })
}

function releaseResult() {
  if (result.value && result.value.url) {
    try {
      URL.revokeObjectURL(result.value.url)
    } catch {
      // ignore
    }
  }
}

async function onFile(file) {
  if (!file) return
  errorMsg.value = ''
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const img = await loadImage(dataUrl)
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
      errorMsg.value = t('tools.imageConverter.tooLargePixels')
      toast.error(errorMsg.value)
      return
    }
    releaseResult()
    result.value = null
    srcImg = img
    source.value = {
      name: file.name || 'image',
      size: file.size,
      type: file.type || 'image',
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
    toast.success(t('toolsCommon.loaded'))
  } catch {
    errorMsg.value = t('toolsCommon.loadFailed')
    toast.error(errorMsg.value)
  }
}

async function convert() {
  if (!source.value || processing.value) return
  let format = config.value.format
  if (!MIME_MAP[format]) format = 'jpeg'
  processing.value = true
  errorMsg.value = ''
  try {
    await nextTick()
    // 让 UI 先渲染出 processing 状态再执行重活
    await new Promise((resolve) => setTimeout(resolve, 50))
    const canvas = document.createElement('canvas')
    canvas.width = source.value.width
    canvas.height = source.value.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    // JPEG 不支持透明，先铺白底避免透明区域变黑
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(srcImg, 0, 0)
    const qualityValue = qualityEnabled.value ? quality.value / 100 : undefined
    const blob = await canvasToBlob(canvas, MIME_MAP[format], qualityValue)
    releaseResult()
    result.value = {
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      type: blob.type || MIME_MAP[format],
      width: canvas.width,
      height: canvas.height,
      ext: EXT_MAP[format],
    }
    toast.success(t('toolsCommon.done'))
  } catch {
    errorMsg.value = t('toolsCommon.error')
    toast.error(errorMsg.value)
  } finally {
    processing.value = false
  }
}

function downloadResult() {
  if (!result.value || !source.value) return
  try {
    const base = source.value.name.replace(/\.[^.]+$/, '') || 'image'
    downloadBlob(result.value.blob, base + '-converted.' + result.value.ext)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  releaseResult()
  srcImg = null
})
</script>

<template>
  <ToolPage tool-id="imageConverter">
    <!-- 上传与原图信息 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.imageConverter.uploadTitle') }}</h2>
      <FileDropZone
        accept="image/*"
        :multiple="false"
        :maxSizeMB="20"
        @files="onFile"
      />
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>

      <div v-if="source" class="mt-4 flex flex-col sm:flex-row gap-4 items-start">
        <img
          :src="source.dataUrl"
          :alt="source.name"
          class="w-full sm:w-48 max-h-56 object-contain rounded-xl border border-slate-200 bg-white"
        />
        <dl class="flex-1 min-w-0 w-full grid gap-1.5 text-sm content-start">
          <div class="flex gap-2 min-w-0">
            <dt class="text-slate-400 shrink-0">{{ t('tools.imageConverter.fileName') }}:</dt>
            <dd class="text-slate-700 break-all">{{ source.name }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-slate-400 shrink-0">{{ t('tools.imageConverter.fileSize') }}:</dt>
            <dd class="text-slate-700">{{ originalSizeLabel }}（{{ source.size }} {{ t('toolsCommon.bytes') }}）</dd>
          </div>
          <div class="flex gap-2 min-w-0">
            <dt class="text-slate-400 shrink-0">{{ t('tools.imageConverter.fileType') }}:</dt>
            <dd class="text-slate-700 break-all">{{ source.type }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-slate-400 shrink-0">{{ t('tools.imageConverter.dimensions') }}:</dt>
            <dd class="text-slate-700">{{ source.width }} × {{ source.height }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- 转换设置 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.imageConverter.settingsTitle') }}</h2>

      <span class="label-base">{{ t('tools.imageConverter.targetFormat') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="opt in formatOptions"
          :key="opt.key"
          type="button"
          :disabled="opt.disabled"
          :aria-pressed="config.format === opt.key"
          :class="formatButtonClass(config.format === opt.key)"
          @click="selectFormat(opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>
      <p v-if="avifChecked && !avifSupported" class="text-xs text-slate-400 mt-2">
        {{ t('tools.imageConverter.avifUnsupported') }}
      </p>

      <div class="mt-5">
        <div class="flex items-center justify-between gap-2">
          <span class="label-base mb-0">{{ t('tools.imageConverter.quality') }}</span>
          <span class="chip">{{ quality }}%</span>
        </div>
        <input
          v-model.number="quality"
          type="range"
          min="1"
          max="100"
          step="1"
          :disabled="!qualityEnabled"
          class="w-full mt-2 accent-blue-600"
          :aria-label="t('tools.imageConverter.quality')"
        />
        <p class="text-xs text-slate-400 mt-1">{{ t('tools.imageConverter.qualityHint') }}</p>
      </div>
    </div>

    <!-- 转换与结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-primary"
          :disabled="!source || processing"
          @click="convert"
        >
          {{ processing ? t('toolsCommon.processing') : t('tools.imageConverter.convertNow') }}
        </button>
        <button
          v-if="result && !processing"
          type="button"
          class="btn-ghost"
          @click="downloadResult"
        >
          {{ t('toolsCommon.download') }}
        </button>
      </div>

      <div v-if="result" class="mt-5">
        <h2 class="section-title">{{ t('tools.imageConverter.resultTitle') }}</h2>
        <img
          :src="result.url"
          :alt="t('tools.imageConverter.resultTitle')"
          class="max-w-full max-h-[420px] object-contain rounded-xl border border-slate-200 bg-white"
        />
        <div class="mt-4 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
            <p class="text-xs text-slate-400">{{ t('tools.imageConverter.originalSize') }}</p>
            <p class="text-sm font-semibold text-slate-700 mt-0.5">{{ originalSizeLabel }}</p>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
            <p class="text-xs text-slate-400">{{ t('tools.imageConverter.newSize') }}</p>
            <p class="text-sm font-semibold text-slate-700 mt-0.5">{{ resultSizeLabel }}</p>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
            <p class="text-xs text-slate-400">{{ t('tools.imageConverter.ratioLabel') }}</p>
            <p
              class="text-sm font-semibold mt-0.5"
              :class="savedPercent !== null && savedPercent >= 0 ? 'text-green-600' : 'text-orange-600'"
            >
              {{ ratioText }}
            </p>
          </div>
        </div>
        <p v-if="ratioCaption" class="text-xs text-slate-400 text-center mt-2">{{ ratioCaption }}</p>
      </div>
    </div>
  </ToolPage>
</template>
