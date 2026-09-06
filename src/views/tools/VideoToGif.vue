<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadBlob } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

const FPS_OPTIONS = [5, 10, 15]
const WIDTH_OPTIONS = [240, 320, 480]
const MAX_CLIP_SECONDS = 30
const DEFAULT_CLIP_SECONDS = 10
const SEEK_TIMEOUT_MS = 2000

/** 持久化配置：帧率与输出宽度 */
const config = useStorage('tool-video-to-gif-config', { fps: 10, width: 320 })

const file = ref(null) // { name, size, type }
const previewSrc = ref('')
const previewEl = ref(null)
const meta = ref(null) // { width, height, duration }
const loading = ref(false)
const processing = ref(false)
const errorMsg = ref('')
const startSec = ref(0)
const endSec = ref(0)
const frameCur = ref(0)
const frameTotal = ref(0)
const result = ref(null) // { blob, url, size }

let sourceUrl = ''
let extractVideo = null
let disposed = false

const durationOk = computed(
  () => !!meta.value && Number.isFinite(meta.value.duration) && meta.value.duration > 0
)
const durationLabel = computed(() =>
  durationOk.value ? meta.value.duration.toFixed(1) + ' ' + t('toolsCommon.seconds') : '-'
)
const clipLength = computed(() => {
  const s = Number(startSec.value) || 0
  const e = Number(endSec.value) || 0
  return Math.max(0, e - s)
})
const clipLengthLabel = computed(
  () => clipLength.value.toFixed(1) + ' ' + t('toolsCommon.seconds')
)
const estimatedFrames = computed(() => {
  const fps = Number(config.value.fps)
  if (!Number.isFinite(fps) || fps <= 0) return 0
  return Math.max(1, Math.round(Math.min(MAX_CLIP_SECONDS, clipLength.value) * fps))
})
const progressPercent = computed(() =>
  frameTotal.value > 0 ? Math.round((frameCur.value / frameTotal.value) * 100) : 0
)
const resultSizeLabel = computed(() => (result.value ? formatBytes(result.value.size) : ''))

onMounted(() => {
  if (!FPS_OPTIONS.includes(Number(config.value.fps))) config.value.fps = 10
  if (!WIDTH_OPTIONS.includes(Number(config.value.width))) config.value.width = 320
})

function releaseResult() {
  if (result.value && result.value.url) {
    try {
      URL.revokeObjectURL(result.value.url)
    } catch {
      // ignore
    }
  }
  result.value = null
}

function releaseSource() {
  if (sourceUrl) {
    try {
      URL.revokeObjectURL(sourceUrl)
    } catch {
      // ignore
    }
    sourceUrl = ''
  }
  if (extractVideo) {
    try {
      extractVideo.pause()
      extractVideo.removeAttribute('src')
      extractVideo.load()
    } catch {
      // ignore
    }
    extractVideo = null
  }
}

/** 等待视频元数据加载 */
function waitMetadata(v) {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 1 && v.videoWidth > 0) {
      resolve()
      return
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('video metadata failed'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('video metadata timeout'))
    }, 15000)
    function cleanup() {
      clearTimeout(timer)
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('error', onError)
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('error', onError)
  })
}

/**
 * 把视频 seek 到指定时刻（Promise 化 seeked 事件）
 * 单次 seek 超过 2 秒视为超时并报错
 */
function seekTo(v, time) {
  if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - time) < 0.001) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let done = false
    const onSeeked = () => finish(true)
    const onError = () => finish(false, new Error('seek failed'))
    const timer = setTimeout(() => {
      // 位置已到位只是事件未触发时视为成功，否则按超时报错
      if (!v.seeking && Math.abs(v.currentTime - time) < 0.05) {
        finish(true)
      } else {
        finish(false, new Error('seek timeout'))
      }
    }, SEEK_TIMEOUT_MS)
    function finish(ok, err) {
      if (done) return
      done = true
      clearTimeout(timer)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('error', onError)
      if (ok) resolve()
      else reject(err)
    }
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('error', onError)
    try {
      v.currentTime = time
    } catch (e) {
      finish(false, e)
    }
  })
}

async function onFile(f) {
  if (!f || processing.value) return
  errorMsg.value = ''
  releaseResult()
  meta.value = null
  frameCur.value = 0
  frameTotal.value = 0
  loading.value = true
  releaseSource()
  try {
    sourceUrl = URL.createObjectURL(f)
    file.value = { name: f.name || 'video', size: f.size, type: f.type || 'video' }

    // 离屏 video 元素：仅用于逐帧 seek，不影响预览播放
    extractVideo = document.createElement('video')
    extractVideo.muted = true
    extractVideo.playsInline = true
    extractVideo.preload = 'auto'
    extractVideo.src = sourceUrl
    await waitMetadata(extractVideo)
    if (!extractVideo.videoWidth || !extractVideo.videoHeight) {
      throw new Error('no video track')
    }
    const duration = Number.isFinite(extractVideo.duration) ? extractVideo.duration : NaN
    meta.value = {
      width: extractVideo.videoWidth,
      height: extractVideo.videoHeight,
      duration,
    }
    if (!durationOk.value) throw new Error('unknown duration')

    // 预览视频与默认时间段
    previewSrc.value = sourceUrl
    startSec.value = 0
    endSec.value = Math.min(DEFAULT_CLIP_SECONDS, meta.value.duration)
    await nextTick()
    toast.success(t('toolsCommon.loaded'))
  } catch {
    previewSrc.value = ''
    releaseSource()
    file.value = null
    meta.value = null
    errorMsg.value = t('tools.videoToGif.metadataFailed')
    toast.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

/** 校验时间段：0 <= start < end <= duration 且片段 <= 30 秒 */
function validateRange() {
  const s = Number(startSec.value)
  const e = Number(endSec.value)
  return (
    Number.isFinite(s) &&
    Number.isFinite(e) &&
    s >= 0 &&
    e > s &&
    e <= meta.value.duration + 0.001 &&
    e - s <= MAX_CLIP_SECONDS + 0.001
  )
}

async function generate() {
  if (!file.value || !meta.value || processing.value) return
  if (!validateRange()) {
    errorMsg.value = t('tools.videoToGif.rangeError')
    toast.error(errorMsg.value)
    return
  }
  errorMsg.value = ''
  processing.value = true
  releaseResult()
  frameCur.value = 0
  const start = Number(startSec.value)
  const end = Number(endSec.value)
  const fps = Number(config.value.fps)
  const total = Math.max(1, Math.ceil((end - start) * fps))
  frameTotal.value = total
  let canvas = null
  try {
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
    if (disposed) return

    const vw = meta.value.width
    const vh = meta.value.height
    const tw = Number(config.value.width)
    const th = Math.max(1, Math.round((tw * vh) / vw))
    canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, tw, th)

    extractVideo.pause()
    const gif = GIFEncoder()
    for (let i = 0; i < total; i++) {
      if (disposed) return
      const time = Math.min(start + i / fps, Math.max(start, end - 0.001))
      await seekTo(extractVideo, time)
      if (disposed) return
      ctx.drawImage(extractVideo, 0, 0, tw, th)
      const { data } = ctx.getImageData(0, 0, tw, th)
      const palette = quantize(data, 256)
      const index = applyPalette(data, palette)
      gif.writeFrame(index, tw, th, { palette, delay: Math.round(1000 / fps) })
      frameCur.value = i + 1
      // 让出主线程，避免长时间阻塞 UI
      await new Promise((r) => setTimeout(r, 0))
    }
    if (disposed) return
    gif.finish()
    const blob = new Blob([gif.bytes()], { type: 'image/gif' })
    if (!blob.size) throw new Error('empty gif output')
    releaseResult()
    result.value = { blob, url: URL.createObjectURL(blob), size: blob.size, width: tw, height: th }
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    if (!disposed) {
      const isSeekTimeout = e && /seek timeout/i.test(String(e && e.message))
      errorMsg.value = isSeekTimeout
        ? t('tools.videoToGif.seekTimeout')
        : t('toolsCommon.error')
      toast.error(errorMsg.value)
    }
  } finally {
    processing.value = false
  }
}

function downloadResult() {
  if (!result.value || !file.value) return
  try {
    const base = file.value.name.replace(/\.[^.]+$/, '') || 'video'
    downloadBlob(result.value.blob, base + '.gif')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  disposed = true
  processing.value = false
  releaseSource()
  releaseResult()
})
</script>

<template>
  <ToolPage tool-id="videoToGif">
    <!-- 上传与预览 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.videoToGif.uploadTitle') }}</h2>
      <FileDropZone
        accept="video/*"
        :multiple="false"
        :maxSizeMB="100"
        @files="onFile"
      />
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>

      <div v-if="file" class="mt-4">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="chip">{{ file.name }}</span>
          <span class="chip">{{ formatBytes(file.size) }}</span>
        </div>
        <video
          v-show="previewSrc"
          ref="previewEl"
          :src="previewSrc"
          class="w-full max-h-[380px] rounded-xl border border-slate-200 bg-black"
          controls
          muted
          playsinline
          preload="auto"
        ></video>
        <dl class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoToGif.dimensions') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">
              {{ meta ? meta.width + ' × ' + meta.height : '…' }}
            </dd>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoToGif.duration') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">{{ durationLabel }}</dd>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoToGif.framesCount') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">{{ estimatedFrames }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- 截取时间段 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.videoToGif.rangeTitle') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="label-base" for="vtg-start">{{ t('tools.videoToGif.startTime') }}</label>
          <input
            id="vtg-start"
            v-model.number="startSec"
            type="number"
            class="input-base"
            min="0"
            step="0.1"
            :max="meta ? meta.duration : 0"
            :disabled="processing || !meta"
          />
        </div>
        <div>
          <label class="label-base" for="vtg-end">{{ t('tools.videoToGif.endTime') }}</label>
          <input
            id="vtg-end"
            v-model.number="endSec"
            type="number"
            class="input-base"
            min="0"
            step="0.1"
            :max="meta ? meta.duration : 0"
            :disabled="processing || !meta"
          />
        </div>
        <div>
          <span class="label-base">{{ t('tools.videoToGif.clipLength') }}</span>
          <p class="input-base !bg-white/60 flex items-center">{{ clipLengthLabel }}</p>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-2">{{ t('tools.videoToGif.rangeHint') }}</p>
    </div>

    <!-- GIF 参数 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.videoToGif.paramTitle') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="label-base" for="vtg-fps">{{ t('tools.videoToGif.fps') }}</label>
          <select
            id="vtg-fps"
            v-model.number="config.fps"
            class="input-base"
            :disabled="processing"
          >
            <option v-for="fps in FPS_OPTIONS" :key="fps" :value="fps">{{ fps }}</option>
          </select>
        </div>
        <div>
          <label class="label-base" for="vtg-width">{{ t('tools.videoToGif.width') }}</label>
          <select
            id="vtg-width"
            v-model.number="config.width"
            class="input-base"
            :disabled="processing"
          >
            <option v-for="w in WIDTH_OPTIONS" :key="w" :value="w">{{ w }} px</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 生成与结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-primary"
          :disabled="!file || !meta || processing || !durationOk"
          @click="generate"
        >
          {{ processing ? t('toolsCommon.processing') : t('tools.videoToGif.generate') }}
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

      <div v-if="processing" class="mt-4">
        <div class="flex items-center justify-between text-xs text-slate-500 mb-1.5">
          <span>{{ t('tools.videoToGif.progressLabel') }}</span>
          <span class="font-semibold text-blue-600">{{ frameCur }} / {{ frameTotal }}</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            class="h-full rounded-full bg-blue-600 transition-all duration-200"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
      </div>

      <div v-if="result" class="mt-5">
        <h2 class="section-title">{{ t('tools.videoToGif.resultTitle') }}</h2>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="chip">GIF</span>
          <span class="chip">{{ resultSizeLabel }}</span>
          <span class="chip">
            {{ result.width }} × {{ result.height }}
          </span>
        </div>
        <img
          :src="result.url"
          :alt="t('tools.videoToGif.resultTitle')"
          class="max-w-full rounded-xl border border-slate-200 bg-white"
        />
      </div>
    </div>
  </ToolPage>
</template>
