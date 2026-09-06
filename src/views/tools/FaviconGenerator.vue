<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl, downloadBlob, downloadDataUrl } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/** 需要生成的尺寸与对应文件名 */
const SIZES = [
  { size: 16, name: 'favicon-16.png' },
  { size: 32, name: 'favicon-32.png' },
  { size: 48, name: 'favicon-48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'android-chrome-192.png' },
  { size: 512, name: 'android-chrome-512.png' },
]
/** ICO 容器打包的尺寸 */
const ICO_SIZES = [16, 32, 48]

/** 持久化配置：预览圆角开关 */
const config = useStorage('tool-favicon-config', { rounded: true })

const source = ref(null) // { name, size, width, height, dataUrl }
const generating = ref(false)
const errorMsg = ref('')
const results = ref([]) // [{ size, name, dataUrl }]
const icoBlob = ref(null)
const icoSizeLabel = ref('')

let srcImg = null

/** HTML 引用代码（固定文件名，放在站点根目录） */
const htmlCode = computed(
  () =>
    [
      '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
      '<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192.png" />',
      '<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512.png" />',
    ].join('\n')
)

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** 居中正方形裁剪后缩放到目标尺寸，导出 PNG dataURL */
function drawSquarePng(img, size) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

/** dataURL 转 Uint8Array（用于手工构建 ICO） */
function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * 手工构建 ICO 容器：
 * ICONDIR(6 字节) + 每图 ICONDIRENTRY(16 字节) + PNG 数据
 * 宽高字节用 0 表示 256
 */
function buildIco(entries) {
  const count = entries.length
  const headerSize = 6 + 16 * count
  const total = headerSize + entries.reduce((sum, e) => sum + e.bytes.length, 0)
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // type: icon
  view.setUint16(4, count, true) // image count
  let offset = headerSize
  entries.forEach((entry, i) => {
    const pos = 6 + i * 16
    const dim = entry.size >= 256 ? 0 : entry.size
    view.setUint8(pos, dim) // width
    view.setUint8(pos + 1, dim) // height
    view.setUint8(pos + 2, 0) // color count
    view.setUint8(pos + 3, 0) // reserved
    view.setUint16(pos + 4, 1, true) // color planes
    view.setUint16(pos + 6, 32, true) // bits per pixel
    view.setUint32(pos + 8, entry.bytes.length, true) // data size
    view.setUint32(pos + 12, offset, true) // data offset
    new Uint8Array(buffer, offset, entry.bytes.length).set(entry.bytes)
    offset += entry.bytes.length
  })
  return new Blob([buffer], { type: 'image/x-icon' })
}

async function generate() {
  if (!srcImg || generating.value) return
  generating.value = true
  errorMsg.value = ''
  try {
    const list = SIZES.map((item) => ({
      size: item.size,
      name: item.name,
      dataUrl: drawSquarePng(srcImg, item.size),
    }))
    const icoEntries = list
      .filter((item) => ICO_SIZES.includes(item.size))
      .map((item) => ({ size: item.size, bytes: dataUrlToBytes(item.dataUrl) }))
    icoBlob.value = buildIco(icoEntries)
    icoSizeLabel.value = formatBytes(icoBlob.value.size)
    results.value = list
    toast.success(t('toolsCommon.done'))
  } catch {
    results.value = []
    icoBlob.value = null
    errorMsg.value = t('tools.faviconGenerator.invalidImage')
    toast.error(errorMsg.value)
  } finally {
    generating.value = false
  }
}

async function onFile(f) {
  if (!f || generating.value) return
  errorMsg.value = ''
  try {
    const dataUrl = await readFileAsDataUrl(f)
    const img = await loadImage(dataUrl)
    srcImg = img
    source.value = {
      name: f.name || 'image',
      size: f.size,
      width: img.naturalWidth,
      height: img.naturalHeight,
      dataUrl,
    }
    await generate()
  } catch {
    srcImg = null
    source.value = null
    results.value = []
    icoBlob.value = null
    errorMsg.value = t('tools.faviconGenerator.invalidImage')
    toast.error(errorMsg.value)
  }
}

function downloadOne(item) {
  try {
    downloadDataUrl(item.dataUrl, item.name)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function downloadIco() {
  if (!icoBlob.value) return
  try {
    downloadBlob(icoBlob.value, 'favicon.ico')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  srcImg = null
})
</script>

<template>
  <ToolPage tool-id="faviconGenerator">
    <!-- 上传 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.faviconGenerator.uploadTitle') }}</h2>
      <FileDropZone
        accept="image/*"
        :multiple="false"
        :maxSizeMB="10"
        @files="onFile"
      />
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>

      <div v-if="source" class="mt-4 flex flex-col sm:flex-row gap-4 items-start">
        <img
          :src="source.dataUrl"
          :alt="source.name"
          class="w-full sm:w-40 max-h-56 object-contain rounded-xl border border-slate-200 bg-white"
        />
        <div class="flex-1 min-w-0 w-full">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="chip">{{ source.name }}</span>
            <span class="chip">{{ formatBytes(source.size) }}</span>
            <span class="chip">{{ source.width }} × {{ source.height }}</span>
          </div>
          <button type="button" class="btn-ghost" :disabled="generating" @click="generate">
            {{ results.length ? t('tools.faviconGenerator.regenerate') : t('tools.faviconGenerator.generate') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 生成设置 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.faviconGenerator.settingsTitle') }}</h2>
      <label class="flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
        <input v-model="config.rounded" type="checkbox" class="w-4 h-4 accent-blue-600" />
        {{ t('tools.faviconGenerator.roundedPreview') }}
      </label>
    </div>

    <!-- 各尺寸预览 -->
    <div v-if="results.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.faviconGenerator.sizesTitle') }}</h2>
        <span class="chip">{{ t('tools.faviconGenerator.readyHint') }}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div
          v-for="item in results"
          :key="item.size"
          class="rounded-xl border border-slate-200 bg-white/70 p-3 flex flex-col items-center gap-2 min-w-0"
        >
          <p class="text-xs text-slate-400 break-all text-center">{{ item.name }}</p>
          <div class="flex items-center overflow-auto max-w-full py-2">
            <img
              :src="item.dataUrl"
              :alt="item.name"
              class="block"
              :class="config.rounded ? 'rounded-[20%]' : ''"
              :style="{ width: item.size + 'px', height: item.size + 'px' }"
            />
          </div>
          <span class="chip">{{ t('tools.faviconGenerator.actualSize') }} {{ item.size }}px</span>
          <button type="button" class="btn-ghost" @click="downloadOne(item)">
            {{ t('toolsCommon.download') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ICO 打包 -->
    <div v-if="icoBlob" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.faviconGenerator.icoTitle') }}</h2>
      <p class="text-sm text-slate-500 leading-relaxed mb-3">
        {{ t('tools.faviconGenerator.icoDesc') }}
      </p>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span v-for="s in ICO_SIZES" :key="s" class="chip">{{ s }}px</span>
        <span class="chip">favicon.ico · {{ icoSizeLabel }}</span>
      </div>
      <button type="button" class="btn-primary" @click="downloadIco">
        {{ t('tools.faviconGenerator.icoDownload') }}
      </button>
    </div>

    <!-- HTML 引用代码 -->
    <div v-if="results.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 class="section-title mb-0">{{ t('tools.faviconGenerator.htmlTitle') }}</h2>
        <CopyButton :text="htmlCode" />
      </div>
      <p class="text-sm text-slate-500 leading-relaxed mb-3">
        {{ t('tools.faviconGenerator.htmlDesc') }}
      </p>
      <pre
        class="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-xs leading-relaxed text-slate-700 overflow-auto max-h-80 whitespace-pre-wrap break-all"
      ><code>{{ htmlCode }}</code></pre>
    </div>
  </ToolPage>
</template>
