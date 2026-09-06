<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadDataUrl, readFileAsArrayBuffer } from '@/utils/download'
import { formatBytes } from '@/utils/format'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const { t } = useI18n()
const toast = useToast()

const BASE = 'tools.pdfToImage'

/* ---------------- 状态 ---------------- */
const file = ref(null) // { name, size }
const fileObj = ref(null) // 原始 File，重新读取用
const numPages = ref(0)
// 渲染倍率，持久化
const scale = useStorage('tool-pdf-to-image-scale', 1.5)
const scaleOptions = [
  { value: 1, label: 'scale1x' },
  { value: 1.5, label: 'scale15x' },
  { value: 2, label: 'scale2x' },
]

const pages = ref([]) // [{ n, url, w, h }]
const busy = ref(false) // 逐页渲染中
const merging = ref(false) // 拼接长图中
const progress = ref(null) // { current, total }
const errorMsg = ref('')
const confirmLong = ref(false)
const longImage = ref(null) // { url, size, w, h }

const busyAny = computed(() => busy.value || merging.value)

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/* ---------------- 渲染 ---------------- */
async function loadPdf() {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const data = await readFileAsArrayBuffer(fileObj.value)
  return pdfjsLib.getDocument({ data }).promise
}

async function renderAll() {
  if (!fileObj.value || busy.value) return
  busy.value = true
  errorMsg.value = ''
  pages.value = []
  longImage.value = null
  confirmLong.value = false
  await nextTick()
  let pdf = null
  try {
    pdf = await loadPdf()
    numPages.value = pdf.numPages
    progress.value = { current: 0, total: pdf.numPages }
    const list = []
    for (let i = 1; i <= pdf.numPages; i++) {
      progress.value = { current: i, total: pdf.numPages }
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: Number(scale.value) || 1 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const ctx = canvas.getContext('2d')
      // 白底，避免透明 PNG 在深色背景下观感异常
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      list.push({
        n: i,
        url: canvas.toDataURL('image/png'),
        w: canvas.width,
        h: canvas.height,
      })
      page.cleanup()
      // 让出主线程，防止长时间阻塞 UI
      await yieldToUi()
    }
    pages.value = list
    toast.success(t('toolsCommon.done'))
  } catch {
    errorMsg.value = t(`${BASE}.loadFailed`)
    toast.error(t(`${BASE}.loadFailed`))
  } finally {
    try {
      if (pdf) await pdf.destroy()
    } catch {
      // 销毁失败可忽略
    }
    busy.value = false
    progress.value = null
  }
}

async function onFile(f) {
  if (!f) return
  fileObj.value = f
  file.value = { name: f.name || 'document.pdf', size: f.size }
  numPages.value = 0
  await renderAll()
}

watch(scale, () => {
  if (fileObj.value && !busy.value) renderAll()
})

/* ---------------- 单页下载 ---------------- */
function downloadPage(page) {
  if (!page) return
  downloadDataUrl(page.url, `page-${String(page.n).padStart(3, '0')}.png`)
}

/* ---------------- 拼接长图 ---------------- */
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function requestLongImage() {
  if (!pages.value.length) {
    toast.info(t(`${BASE}.needFile`))
    return
  }
  // 页数较多时需要用户二次确认，避免浏览器卡死
  if (pages.value.length > 30) {
    confirmLong.value = true
    return
  }
  generateLongImage()
}

function cancelLongImage() {
  confirmLong.value = false
}

async function generateLongImage() {
  confirmLong.value = false
  if (merging.value || !pages.value.length) return
  merging.value = true
  errorMsg.value = ''
  await nextTick()
  try {
    const imgs = []
    for (const p of pages.value) {
      imgs.push(await loadImageEl(p.url))
      await yieldToUi()
    }
    const width = Math.max(...imgs.map((img) => img.naturalWidth))
    const totalH = imgs.reduce((sum, img) => sum + img.naturalHeight, 0)
    // 浏览器 canvas 高度上限约 32767px
    if (totalH > 32700) {
      errorMsg.value = t(`${BASE}.canvasTooTall`)
      toast.error(t(`${BASE}.canvasTooTall`))
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = totalH
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, totalH)
    let y = 0
    for (const img of imgs) {
      ctx.drawImage(img, 0, y)
      y += img.naturalHeight
    }
    const url = canvas.toDataURL('image/png')
    const base64 = url.slice(url.indexOf(',') + 1)
    const size = Math.floor((base64.length * 3) / 4)
    longImage.value = { url, size, w: width, h: totalH }
    toast.success(t(`${BASE}.longImageDone`))
  } catch {
    errorMsg.value = t(`${BASE}.renderFailed`)
    toast.error(t(`${BASE}.renderFailed`))
  } finally {
    merging.value = false
  }
}

function downloadLongImage() {
  if (!longImage.value) return
  downloadDataUrl(longImage.value.url, 'long-image.png')
}
</script>

<template>
  <ToolPage tool-id="pdfToImage">
    <!-- 上传 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.uploadTitle`) }}</h2>
      <FileDropZone
        accept=".pdf"
        :multiple="false"
        :maxSizeMB="50"
        :hint="t(`${BASE}.uploadHint`)"
        @files="onFile"
      />

      <div v-if="file" class="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <div class="flex gap-2 min-w-0">
          <span class="text-slate-400 shrink-0">{{ t(`${BASE}.fileLabel`) }}:</span>
          <span class="text-slate-700 break-all">{{ file.name }}</span>
        </div>
        <div class="flex gap-2">
          <span class="text-slate-400 shrink-0">{{ t(`${BASE}.sizeLabel`) }}:</span>
          <span class="text-slate-700">{{ formatBytes(file.size) }}</span>
        </div>
        <div v-if="numPages" class="flex gap-2">
          <span class="text-slate-400 shrink-0">{{ t(`${BASE}.pagesLabel`) }}:</span>
          <span class="text-slate-700">{{ numPages }}</span>
        </div>
      </div>

      <!-- 渲染倍率 -->
      <div class="mt-4">
        <span class="label-base">{{ t(`${BASE}.renderScale`) }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="opt in scaleOptions"
            :key="opt.value"
            type="button"
            class="px-4 py-2 rounded-xl text-sm font-medium border transition select-none"
            :class="Number(scale) === opt.value
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'"
            :disabled="busyAny"
            @click="scale = opt.value"
          >
            {{ t(`${BASE}.${opt.label}`) }}
          </button>
          <button
            v-if="file && !busy"
            type="button"
            class="btn-ghost"
            :disabled="busyAny"
            @click="renderAll"
          >
            {{ t(`${BASE}.rerenderBtn`) }}
          </button>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ t(`${BASE}.scaleHint`) }}</p>
      </div>

      <!-- 进度 -->
      <div v-if="busy && progress" class="mt-4">
        <p class="text-sm text-slate-500 flex items-center gap-2">
          <svg class="animate-spin w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
          {{ t(`${BASE}.rendering`) }} · {{ t(`${BASE}.progressLabel`, { current: progress.current, total: progress.total }) }}
        </p>
        <div class="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            class="h-full rounded-full bg-blue-500 transition-all"
            :style="{ width: progress.total ? (progress.current / progress.total) * 100 + '%' : '0%' }"
          ></div>
        </div>
      </div>

      <p v-if="errorMsg" class="mt-4 text-sm text-red-600">{{ errorMsg }}</p>
    </div>

    <!-- 逐页预览 -->
    <div v-if="pages.length" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.pagesTitle`) }}</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        <div
          v-for="page in pages"
          :key="page.n"
          class="rounded-xl border border-slate-200 bg-white/80 overflow-hidden flex flex-col"
        >
          <div class="h-36 sm:h-40 overflow-hidden flex items-center justify-center bg-slate-50">
            <img :src="page.url" :alt="t(`${BASE}.pageLabel`, { n: page.n })" class="max-h-full max-w-full object-contain" loading="lazy" />
          </div>
          <div class="p-2 flex items-center justify-between gap-1.5">
            <span class="text-xs text-slate-500 whitespace-nowrap">{{ t(`${BASE}.pageLabel`, { n: page.n }) }}</span>
            <button type="button" class="btn-ghost !px-2 !py-1 text-xs shrink-0" @click="downloadPage(page)">
              {{ t(`${BASE}.downloadPage`) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 拼接长图 -->
    <div v-if="pages.length" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.longImageTitle`) }}</h2>
      <p class="text-sm text-slate-500 mb-4">{{ t(`${BASE}.longImageDesc`) }}</p>

      <template v-if="confirmLong">
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4">
          <p class="text-sm text-amber-700 leading-relaxed">{{ t(`${BASE}.longImageWarning`) }}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-danger" :disabled="busyAny" @click="generateLongImage">
              {{ t(`${BASE}.longImageConfirm`) }}
            </button>
            <button type="button" class="btn-ghost" @click="cancelLongImage">
              {{ t(`${BASE}.longImageCancel`) }}
            </button>
          </div>
        </div>
      </template>
      <button v-else type="button" class="btn-primary" :disabled="busyAny" @click="requestLongImage">
        <svg
          v-if="merging"
          class="animate-spin w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
        {{ merging ? t('toolsCommon.processing') : t(`${BASE}.longImageBtn`) }}
      </button>

      <!-- 长图结果 -->
      <div v-if="longImage" class="mt-4">
        <div class="flex flex-wrap gap-x-6 gap-y-1.5 text-sm mb-3">
          <div class="flex gap-2">
            <span class="text-slate-400 shrink-0">{{ t(`${BASE}.longImageSize`) }}:</span>
            <span class="text-slate-700">{{ formatBytes(longImage.size) }}</span>
          </div>
          <div class="flex gap-2">
            <span class="text-slate-400 shrink-0">{{ t(`${BASE}.dimensions`) }}:</span>
            <span class="text-slate-700">{{ longImage.w }} × {{ longImage.h }}</span>
          </div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 mb-3 max-h-80 overflow-auto">
          <img
            :src="longImage.url"
            :alt="t(`${BASE}.longImageTitle`)"
            class="w-full h-auto"
            loading="lazy"
          />
        </div>
        <button type="button" class="btn-primary" @click="downloadLongImage">
          {{ t(`${BASE}.downloadLongImage`) }}
        </button>
        <p class="mt-3 text-xs text-slate-400">{{ t(`${BASE}.compressHint`) }}</p>
      </div>
    </div>
  </ToolPage>
</template>
