<script setup>
import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useElementSize, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl, downloadBlob } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

const MAX_PIXELS = 40000000
const MAX_OUTPUT = 10000
/** 裁剪框最小显示边长（px），换算为原始像素下限 */
const MIN_DISPLAY = 24

const RATIO_KEYS = ['free', '1:1', '16:9', '9:16']
const RATIO_VALUES = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 }
const RATIO_LABEL_KEYS = {
  free: 'tools.imageCropper.ratioFree',
  '1:1': 'tools.imageCropper.ratio11',
  '16:9': 'tools.imageCropper.ratio169',
  '9:16': 'tools.imageCropper.ratio916',
}

/** 持久化配置：比例模式 + 输出宽高比锁定开关 */
const config = useStorage('tool-image-cropper-config', { ratio: 'free', lockSize: false })

const source = ref(null) // { name, size, type, dataUrl, width, height }
const previewBox = ref(null) // 紧贴 img 的包裹层，用于测量显示尺寸
const previewImg = ref(null) // 预览 img 元素，供 9 参 drawImage 使用
const cropBoxRef = ref(null)
const handleRef = ref(null)

const { width: displayW } = useElementSize(previewBox)

/** 裁剪区域，始终以原始图片像素存储 */
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })
const outputW = ref(0)
const outputH = ref(0)
const sizeEdited = ref(false) // 用户手动改过输出尺寸后不再自动跟随裁剪框

const result = ref(null)
const processing = ref(false)
const errorMsg = ref('')

const scale = computed(() => {
  if (!source.value || !displayW.value) return 0
  return displayW.value / source.value.width
})

const currentRatio = computed(() => {
  const key = RATIO_KEYS.includes(config.value.ratio) ? config.value.ratio : 'free'
  return key === 'free' ? 0 : RATIO_VALUES[key]
})

const cropStyle = computed(() => {
  const s = scale.value
  return {
    left: crop.x * s + 'px',
    top: crop.y * s + 'px',
    width: crop.w * s + 'px',
    height: crop.h * s + 'px',
  }
})

const cropSizeText = computed(() =>
  Math.round(crop.w) + ' × ' + Math.round(crop.h)
)

const resultSizeLabel = computed(() =>
  result.value ? formatBytes(result.value.size) : ''
)

const presets = computed(() => [
  { key: 'avatar', label: t('tools.imageCropper.presetAvatar'), w: 200, h: 200, ratio: '1:1' },
  { key: 'wide', label: t('tools.imageCropper.presetWide'), w: 1280, h: 720, ratio: '16:9' },
  { key: 'tall', label: t('tools.imageCropper.presetTall'), w: 720, h: 1280, ratio: '9:16' },
])

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function optionClass(active) {
  return active
    ? 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white shadow-sm transition select-none'
    : 'px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 bg-white/70 border border-slate-200 hover:border-blue-300 hover:text-blue-600 transition select-none'
}

function minCropSize() {
  if (!source.value || !scale.value) return 1
  return Math.max(
    1,
    Math.min(
      source.value.width,
      source.value.height,
      Math.round(MIN_DISPLAY / scale.value)
    )
  )
}

/* ---------------- 裁剪框指针交互 ---------------- */
let drag = null

function onBoxPointerDown(e) {
  if (!source.value || drag) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  startDrag('move', e, cropBoxRef.value)
}

function onHandlePointerDown(e) {
  if (!source.value || drag) return
  e.preventDefault()
  e.stopPropagation()
  startDrag('resize', e, handleRef.value)
}

function startDrag(mode, e, captureEl) {
  drag = {
    mode,
    startX: e.clientX,
    startY: e.clientY,
    orig: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
  }
  try {
    if (captureEl && e.pointerId !== undefined) {
      captureEl.setPointerCapture(e.pointerId)
    }
  } catch {
    // 个别浏览器不支持时退化为 window 监听
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e) {
  if (!drag || !source.value) return
  const s = scale.value || 1
  const dx = (e.clientX - drag.startX) / s
  const dy = (e.clientY - drag.startY) / s
  const o = drag.orig
  const minS = minCropSize()

  if (drag.mode === 'move') {
    crop.x = clamp(o.x + dx, 0, source.value.width - o.w)
    crop.y = clamp(o.y + dy, 0, source.value.height - o.h)
    return
  }

  const maxW = source.value.width - o.x
  const maxH = source.value.height - o.y
  const r = currentRatio.value
  if (r > 0) {
    let w = clamp(o.w + dx, minS, maxW)
    let h = w / r
    if (h > maxH) {
      h = maxH
      w = h * r
    }
    if (w < minS) {
      w = minS
      h = w / r
    }
    h = clamp(h, Math.min(minS, maxH), maxH)
    crop.w = clamp(w, minS, maxW)
    crop.h = h
  } else {
    crop.w = clamp(o.w + dx, minS, maxW)
    crop.h = clamp(o.h + dy, minS, maxH)
  }
}

function onPointerUp() {
  stopDrag()
}

function stopDrag() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

/* ---------------- 比例与预设 ---------------- */
function fitCropToRatio(r) {
  let w = source.value.width
  let h = w / r
  if (h > source.value.height) {
    h = source.value.height
    w = h * r
  }
  crop.w = w
  crop.h = h
  crop.x = (source.value.width - w) / 2
  crop.y = (source.value.height - h) / 2
}

function setRatio(key) {
  if (!RATIO_KEYS.includes(key)) return
  config.value.ratio = key
  if (!source.value) return
  const r = RATIO_VALUES[key]
  if (!r) return
  // 保持中心点不变，按新比例取最大适配框
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  let w = source.value.width
  let h = w / r
  if (h > source.value.height) {
    h = source.value.height
    w = h * r
  }
  crop.w = w
  crop.h = h
  crop.x = clamp(cx - w / 2, 0, source.value.width - w)
  crop.y = clamp(cy - h / 2, 0, source.value.height - h)
}

function applyPreset(p) {
  config.value.ratio = p.ratio
  outputW.value = p.w
  outputH.value = p.h
  sizeEdited.value = true
  if (source.value) fitCropToRatio(RATIO_VALUES[p.ratio])
}

/* ---------------- 输出尺寸 ---------------- */
function syncOutputFromCrop() {
  outputW.value = Math.round(crop.w)
  outputH.value = Math.round(crop.h)
}

watch(
  () => [crop.x, crop.y, crop.w, crop.h],
  () => {
    if (!sizeEdited.value) syncOutputFromCrop()
  }
)

const debouncedClampInputs = useDebounceFn(() => {
  // 输入过程中不做强制纠正，停止输入 800ms 后轻柔归位
  outputW.value = clamp(Math.round(Number(outputW.value)) || 1, 1, MAX_OUTPUT)
  outputH.value = clamp(Math.round(Number(outputH.value)) || 1, 1, MAX_OUTPUT)
}, 800)

function onOutputWChange() {
  const v = Math.round(Number(outputW.value))
  if (!Number.isFinite(v) || v < 1 || v > MAX_OUTPUT) {
    debouncedClampInputs()
    return
  }
  outputW.value = v
  sizeEdited.value = true
  if (config.value.lockSize && crop.w > 0) {
    outputH.value = clamp(Math.round(v * (crop.h / crop.w)), 1, MAX_OUTPUT)
  }
}

function onOutputHChange() {
  const v = Math.round(Number(outputH.value))
  if (!Number.isFinite(v) || v < 1 || v > MAX_OUTPUT) {
    debouncedClampInputs()
    return
  }
  outputH.value = v
  sizeEdited.value = true
  if (config.value.lockSize && crop.h > 0) {
    outputW.value = clamp(Math.round(v * (crop.w / crop.h)), 1, MAX_OUTPUT)
  }
}

/* ---------------- 加载与裁剪 ---------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function canvasToBlob(canvas, mime) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        mime
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

function initCrop() {
  sizeEdited.value = false
  const r = currentRatio.value
  if (r > 0) {
    fitCropToRatio(r)
  } else {
    crop.w = source.value.width * 0.8
    crop.h = source.value.height * 0.8
    crop.x = source.value.width * 0.1
    crop.y = source.value.height * 0.1
  }
  syncOutputFromCrop()
}

async function onFile(file) {
  if (!file) return
  errorMsg.value = ''
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const img = await loadImage(dataUrl)
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
      errorMsg.value = t('tools.imageCropper.tooLargePixels')
      toast.error(errorMsg.value)
      return
    }
    releaseResult()
    result.value = null
    source.value = {
      name: file.name || 'image',
      size: file.size,
      type: file.type || 'image',
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
    await nextTick()
    initCrop()
    toast.success(t('toolsCommon.loaded'))
  } catch {
    errorMsg.value = t('toolsCommon.loadFailed')
    toast.error(errorMsg.value)
  }
}

function resetCrop() {
  if (!source.value) return
  releaseResult()
  result.value = null
  errorMsg.value = ''
  initCrop()
}

function clearImage() {
  releaseResult()
  result.value = null
  source.value = null
  errorMsg.value = ''
}

async function applyCrop() {
  if (!source.value || processing.value || !previewImg.value) return
  const wRaw = Math.round(Number(outputW.value))
  const hRaw = Math.round(Number(outputH.value))
  if (
    !Number.isFinite(wRaw) ||
    !Number.isFinite(hRaw) ||
    wRaw < 1 ||
    hRaw < 1 ||
    wRaw > MAX_OUTPUT ||
    hRaw > MAX_OUTPUT
  ) {
    errorMsg.value = t('tools.imageCropper.invalidOutput')
    toast.error(errorMsg.value)
    return
  }
  processing.value = true
  errorMsg.value = ''
  try {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const canvas = document.createElement('canvas')
    canvas.width = wRaw
    canvas.height = hRaw
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // 9 参 drawImage：从原图裁剪区域绘制到输出画布
    ctx.drawImage(
      previewImg.value,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      wRaw,
      hRaw
    )
    const blob = await canvasToBlob(canvas, 'image/png')
    releaseResult()
    result.value = {
      blob,
      url: URL.createObjectURL(blob),
      width: wRaw,
      height: hRaw,
      size: blob.size,
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
    downloadBlob(result.value.blob, base + '-cropped.png')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  stopDrag()
  releaseResult()
})
</script>

<template>
  <ToolPage tool-id="imageCropper">
    <!-- 上传与裁剪预览 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <FileDropZone
        v-if="!source"
        accept="image/*"
        :multiple="false"
        :maxSizeMB="20"
        @files="onFile"
      />
      <template v-else>
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 class="section-title mb-0">{{ t('toolsCommon.preview') }}</h2>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-ghost" @click="resetCrop">
              {{ t('toolsCommon.reset') }}
            </button>
            <button type="button" class="btn-danger" @click="clearImage">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>

        <div class="flex justify-center">
          <div
            ref="previewBox"
            class="relative inline-block max-w-full overflow-hidden leading-none select-none rounded-lg"
          >
            <img
              ref="previewImg"
              :src="source.dataUrl"
              :alt="source.name"
              draggable="false"
              class="block max-w-full max-h-[60vh] w-auto h-auto"
            />
            <div
              ref="cropBoxRef"
              class="crop-box"
              :style="cropStyle"
              @pointerdown="onBoxPointerDown"
            >
              <div
                ref="handleRef"
                class="crop-handle"
                @pointerdown="onHandlePointerDown"
              ></div>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-3">
          <p class="text-xs text-slate-400 flex-1 min-w-0">
            {{ t('tools.imageCropper.cropHint') }}
          </p>
          <span class="chip">
            {{ t('tools.imageCropper.cropArea') }} {{ cropSizeText }}
          </span>
        </div>
      </template>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>
    </div>

    <!-- 裁剪设置 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>

      <span class="label-base">{{ t('tools.imageCropper.ratioMode') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="key in RATIO_KEYS"
          :key="key"
          type="button"
          :aria-pressed="config.ratio === key"
          :class="optionClass(config.ratio === key)"
          @click="setRatio(key)"
        >
          {{ t(RATIO_LABEL_KEYS[key]) }}
        </button>
      </div>

      <span class="label-base mt-5">{{ t('tools.imageCropper.presetTitle') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="p in presets"
          :key="p.key"
          type="button"
          class="btn-ghost"
          :disabled="!source"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </button>
      </div>

      <span class="label-base mt-5">{{ t('tools.imageCropper.outputTitle') }}</span>
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-28">
          <label class="label-base" for="crop-output-w">
            {{ t('tools.imageCropper.outputWidth') }}
          </label>
          <input
            id="crop-output-w"
            v-model.number="outputW"
            type="number"
            min="1"
            :max="MAX_OUTPUT"
            class="input-base"
            :disabled="!source"
            :aria-label="t('tools.imageCropper.outputWidth')"
            @change="onOutputWChange"
          />
        </div>
        <span class="pb-2.5 text-slate-400">×</span>
        <div class="w-28">
          <label class="label-base" for="crop-output-h">
            {{ t('tools.imageCropper.outputHeight') }}
          </label>
          <input
            id="crop-output-h"
            v-model.number="outputH"
            type="number"
            min="1"
            :max="MAX_OUTPUT"
            class="input-base"
            :disabled="!source"
            :aria-label="t('tools.imageCropper.outputHeight')"
            @change="onOutputHChange"
          />
        </div>
        <label class="flex items-center gap-2 pb-2.5 text-sm text-slate-600 cursor-pointer select-none">
          <input
            v-model="config.lockSize"
            type="checkbox"
            class="w-4 h-4 accent-blue-600"
          />
          {{ t('tools.imageCropper.lockAspect') }}
        </label>
      </div>
    </div>

    <!-- 裁剪结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-primary"
          :disabled="!source || processing"
          @click="applyCrop"
        >
          {{ processing ? t('toolsCommon.processing') : t('tools.imageCropper.applyCrop') }}
        </button>
      </div>

      <div v-if="result" class="mt-5">
        <h2 class="section-title">{{ t('tools.imageCropper.resultTitle') }}</h2>
        <div class="flex justify-center">
          <img
            :src="result.url"
            :alt="t('tools.imageCropper.resultTitle')"
            class="max-w-full max-h-[420px] object-contain rounded-xl border border-slate-200 bg-white"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <span class="chip">{{ result.width }} × {{ result.height }}</span>
          <span class="chip">{{ resultSizeLabel }}</span>
          <button type="button" class="btn-ghost" @click="downloadResult">
            {{ t('toolsCommon.download') }} PNG
          </button>
        </div>
      </div>
    </div>
  </ToolPage>
</template>

<style scoped>
.crop-box {
  position: absolute;
  border: 2px solid #3b82f6;
  /* 裁剪框外区域压暗 */
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.4);
  cursor: move;
  touch-action: none;
}

.crop-handle {
  position: absolute;
  right: -9px;
  bottom: -9px;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  background: #ffffff;
  border: 2px solid #3b82f6;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
  cursor: nwse-resize;
  touch-action: none;
}
</style>
