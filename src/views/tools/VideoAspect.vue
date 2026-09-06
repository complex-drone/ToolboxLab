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

/** 目标比例与输出高度预设 */
const ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] }
const HEIGHTS = [480, 720, 1080]
const CAPTURE_FPS = 30

/** 持久化配置：比例 / 适配方式 / 填充色 / 输出高度 */
const config = useStorage('tool-video-aspect-config', {
  aspect: '16:9',
  fit: 'cover',
  fill: '#000000',
  height: 720,
})

const file = ref(null) // { name, size, type }
const videoEl = ref(null)
const meta = ref(null) // { width, height, duration }
const loading = ref(false)
const processing = ref(false)
const progress = ref(0) // 0 - 1
const errorMsg = ref('')
const result = ref(null) // { blob, url, size }

let sourceUrl = ''
let chunks = []
let recorder = null
let rafId = 0
let endedHandler = null
let disposed = false

/** 按优先级探测可用的 WebM 录制 mime，全部不支持时返回空串 */
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {
      // ignore
    }
  }
  return ''
}

const mimeSupported = computed(() => pickMime() !== '')
const captureSupported = computed(
  () =>
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
)
const supported = computed(() => mimeSupported.value && captureSupported.value)

/** 按比例与高度预设计算输出尺寸（宽度偶数对齐） */
const outputSize = computed(() => {
  const [rw, rh] = ASPECTS[config.value.aspect] || ASPECTS['16:9']
  const h = HEIGHTS.includes(Number(config.value.height)) ? Number(config.value.height) : 720
  let w = Math.round((h * rw) / rh)
  if (w % 2 !== 0) w -= 1
  return { width: w, height: h }
})

const durationOk = computed(
  () => !!meta.value && Number.isFinite(meta.value.duration) && meta.value.duration > 0
)
const durationLabel = computed(() =>
  durationOk.value ? meta.value.duration.toFixed(1) + ' ' + t('toolsCommon.seconds') : '-'
)
const progressPercent = computed(() => Math.round(progress.value * 100))
const resultSizeLabel = computed(() => (result.value ? formatBytes(result.value.size) : ''))

onMounted(() => {
  if (!ASPECTS[config.value.aspect]) config.value.aspect = '16:9'
  if (!['cover', 'contain'].includes(config.value.fit)) config.value.fit = 'cover'
  if (!HEIGHTS.includes(Number(config.value.height))) config.value.height = 720
  if (typeof config.value.fill !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(config.value.fill)) {
    config.value.fill = '#000000'
  }
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

/** 等待一次 seek 完成（部分浏览器 currentTime 不变化时不触发 seeked） */
function waitSeeked(v, timeout = 5000) {
  if (!v.seeking && v.readyState >= 2 && v.currentTime === 0) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let done = false
    const onSeeked = () => finish(true)
    const onError = () => finish(false, new Error('seek failed'))
    const timer = setTimeout(() => finish(false, new Error('seek timeout')), timeout)
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
  })
}

/** 部分 WebM 的 duration 会是 Infinity，通过跳到末尾来求解真实时长 */
function resolveDuration(v) {
  return new Promise((resolve) => {
    if (Number.isFinite(v.duration) && v.duration > 0) {
      resolve(v.duration)
      return
    }
    const onDurationChange = () => {
      v.removeEventListener('durationchange', onDurationChange)
      if (Number.isFinite(v.duration) && v.duration > 0) {
        resolve(v.duration)
      } else {
        resolve(NaN)
      }
    }
    v.addEventListener('durationchange', onDurationChange)
    try {
      v.currentTime = 1e7
    } catch {
      v.removeEventListener('durationchange', onDurationChange)
      resolve(NaN)
    }
  })
}

async function onFile(f) {
  if (!f || processing.value) return
  errorMsg.value = ''
  releaseResult()
  meta.value = null
  loading.value = true
  releaseSource()
  try {
    sourceUrl = URL.createObjectURL(f)
    file.value = { name: f.name || 'video', size: f.size, type: f.type || 'video' }
    await nextTick()
    const v = videoEl.value
    if (!v) throw new Error('video element missing')
    v.muted = true
    v.playsInline = true
    v.pause()
    v.src = sourceUrl
    await waitMetadata(v)
    const duration = await resolveDuration(v)
    if (Number.isFinite(duration) && duration > 0) {
      try {
        v.currentTime = 0
      } catch {
        // ignore
      }
    }
    if (!v.videoWidth || !v.videoHeight) throw new Error('no video track')
    meta.value = { width: v.videoWidth, height: v.videoHeight, duration }
    if (!durationOk.value) {
      errorMsg.value = t('tools.videoAspect.unknownDuration')
    }
    toast.success(t('toolsCommon.loaded'))
  } catch {
    releaseSource()
    file.value = null
    meta.value = null
    errorMsg.value = t('tools.videoAspect.metadataFailed')
    toast.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

/** 按当前适配方式把视频帧绘制到目标画布 */
function drawFrame(ctx, v, tw, th) {
  if (config.value.fit === 'contain') {
    ctx.fillStyle = config.value.fill || '#000000'
    ctx.fillRect(0, 0, tw, th)
  }
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh) return
  const scale =
    config.value.fit === 'cover' ? Math.max(tw / vw, th / vh) : Math.min(tw / vw, th / vh)
  const dw = vw * scale
  const dh = vh * scale
  ctx.drawImage(v, (tw - dw) / 2, (th - dh) / 2, dw, dh)
}

async function process() {
  if (!file.value || !meta.value || processing.value || !supported.value || !durationOk.value) return
  const v = videoEl.value
  if (!v) return
  processing.value = true
  errorMsg.value = ''
  progress.value = 0
  chunks = []
  let stream = null
  try {
    const { width, height } = outputSize.value
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')

    stream = canvas.captureStream(CAPTURE_FPS)
    const mime = pickMime()
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5000000 } : undefined)
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('recorder error'))
    })

    // 回到起点，先画一帧保证流里有画面
    v.pause()
    v.muted = true
    v.playbackRate = 1
    v.currentTime = 0
    await waitSeeked(v)
    drawFrame(ctx, v, width, height)

    recorder.start(200)
    await v.play()

    const loop = () => {
      if (disposed || !processing.value) return
      if (durationOk.value) {
        progress.value = Math.min(0.999, v.currentTime / meta.value.duration)
      }
      drawFrame(ctx, v, width, height)
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    // 视频播放结束时结束录制
    await new Promise((resolve) => {
      endedHandler = resolve
      v.addEventListener('ended', resolve, { once: true })
    })
    cancelAnimationFrame(rafId)
    drawFrame(ctx, v, width, height)
    await new Promise((r) => setTimeout(r, 150))
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped

    const type = (recorder && recorder.mimeType) || mime || 'video/webm'
    const blob = new Blob(chunks, { type })
    if (!blob.size) throw new Error('empty output')
    releaseResult()
    result.value = { blob, url: URL.createObjectURL(blob), size: blob.size }
    progress.value = 1
    toast.success(t('toolsCommon.done'))
  } catch (e) {
    if (!disposed) {
      errorMsg.value = t('toolsCommon.error')
      toast.error(errorMsg.value)
    }
  } finally {
    processing.value = false
    if (endedHandler) {
      v.removeEventListener('ended', endedHandler)
      endedHandler = null
    }
    cancelAnimationFrame(rafId)
    if (stream) {
      try {
        stream.getTracks().forEach((tr) => tr.stop())
      } catch {
        // ignore
      }
    }
    try {
      v.pause()
    } catch {
      // ignore
    }
    recorder = null
  }
}

function downloadResult() {
  if (!result.value || !file.value) return
  try {
    const base = file.value.name.replace(/\.[^.]+$/, '') || 'video'
    const { width, height } = outputSize.value
    downloadBlob(result.value.blob, base + '-' + width + 'x' + height + '.webm')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  disposed = true
  processing.value = false
  cancelAnimationFrame(rafId)
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop()
    } catch {
      // ignore
    }
  }
  recorder = null
  releaseSource()
  releaseResult()
})
</script>

<template>
  <ToolPage tool-id="videoAspect">
    <!-- 上传与预览 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.videoAspect.uploadTitle') }}</h2>
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
          v-show="!loading"
          ref="videoEl"
          class="w-full max-h-[420px] rounded-xl border border-slate-200 bg-black"
          controls
          muted
          playsinline
          preload="auto"
        ></video>
        <dl class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoAspect.dimensions') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">
              {{ meta ? meta.width + ' × ' + meta.height : '…' }}
            </dd>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoAspect.duration') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">{{ durationLabel }}</dd>
          </div>
          <div class="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
            <dt class="text-xs text-slate-400">{{ t('tools.videoAspect.outputSize') }}</dt>
            <dd class="font-semibold text-slate-700 mt-0.5">
              {{ outputSize.width }} × {{ outputSize.height }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- 转换设置 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.videoAspect.settingsTitle') }}</h2>

      <span class="label-base">{{ t('tools.videoAspect.targetAspect') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="key in Object.keys(ASPECTS)"
          :key="key"
          type="button"
          :disabled="processing"
          :aria-pressed="config.aspect === key"
          class="px-3.5 py-1.5 rounded-lg text-sm font-medium border transition select-none disabled:opacity-40 disabled:cursor-not-allowed"
          :class="
            config.aspect === key
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          @click="config.aspect = key"
        >
          {{
            key === '16:9'
              ? t('tools.videoAspect.aspect169')
              : key === '9:16'
                ? t('tools.videoAspect.aspect916')
                : t('tools.videoAspect.aspect11')
          }}
        </button>
      </div>

      <div class="mt-5">
        <span class="label-base">{{ t('tools.videoAspect.fitMode') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="processing"
            :aria-pressed="config.fit === 'cover'"
            class="px-3.5 py-1.5 rounded-lg text-sm font-medium border transition select-none disabled:opacity-40 disabled:cursor-not-allowed"
            :class="
              config.fit === 'cover'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            "
            @click="config.fit = 'cover'"
          >
            {{ t('tools.videoAspect.fitCover') }}
          </button>
          <button
            type="button"
            :disabled="processing"
            :aria-pressed="config.fit === 'contain'"
            class="px-3.5 py-1.5 rounded-lg text-sm font-medium border transition select-none disabled:opacity-40 disabled:cursor-not-allowed"
            :class="
              config.fit === 'contain'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            "
            @click="config.fit = 'contain'"
          >
            {{ t('tools.videoAspect.fitContain') }}
          </button>
        </div>
        <p class="text-xs text-slate-400 mt-2">
          {{
            config.fit === 'cover'
              ? t('tools.videoAspect.fitCoverHint')
              : t('tools.videoAspect.fitContainHint')
          }}
        </p>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span class="label-base mb-0">{{ t('tools.videoAspect.fillColor') }}</span>
        <input
          v-model="config.fill"
          type="color"
          class="h-9 w-14 rounded-lg border border-slate-200 bg-white cursor-pointer disabled:opacity-40"
          :disabled="processing || config.fit !== 'contain'"
          :aria-label="t('tools.videoAspect.fillColor')"
        />
        <span class="chip">{{ config.fill }}</span>
      </div>

      <div class="mt-5">
        <span class="label-base">{{ t('tools.videoAspect.resolution') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="h in HEIGHTS"
            :key="h"
            type="button"
            :disabled="processing"
            :aria-pressed="Number(config.height) === h"
            class="px-3.5 py-1.5 rounded-lg text-sm font-medium border transition select-none disabled:opacity-40 disabled:cursor-not-allowed"
            :class="
              Number(config.height) === h
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            "
            @click="config.height = h"
          >
            {{ h }}p
          </button>
        </div>
      </div>

      <div class="mt-5 rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2.5 text-xs text-slate-500 leading-relaxed">
        <p>{{ t('tools.videoAspect.webmNote') }}</p>
        <p class="mt-1">
          {{ t('tools.videoAspect.estimated') }}:
          <span class="font-semibold text-slate-700">{{ durationLabel }}</span>
        </p>
      </div>
    </div>

    <!-- 转换与结果 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-primary"
          :disabled="!file || !meta || processing || !supported || !durationOk || loading"
          @click="process"
        >
          {{ processing ? t('toolsCommon.processing') : t('tools.videoAspect.processNow') }}
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

      <p v-if="!supported" class="mt-3 text-sm text-red-600">
        {{ t('tools.videoAspect.unsupported') }}
      </p>

      <div v-if="processing" class="mt-4">
        <div class="flex items-center justify-between text-xs text-slate-500 mb-1.5">
          <span>{{ t('tools.videoAspect.progressLabel') }}</span>
          <span class="font-semibold text-blue-600">{{ progressPercent }}%</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            class="h-full rounded-full bg-blue-600 transition-all duration-200"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
      </div>

      <div v-if="result" class="mt-5">
        <h2 class="section-title">{{ t('tools.videoAspect.resultTitle') }}</h2>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="chip">{{ t('tools.videoAspect.formatLabel') }}: WebM</span>
          <span class="chip">{{ resultSizeLabel }}</span>
          <span class="chip">{{ outputSize.width }} × {{ outputSize.height }}</span>
        </div>
        <video
          :src="result.url"
          class="w-full max-h-[420px] rounded-xl border border-slate-200 bg-black"
          controls
          playsinline
        ></video>
      </div>
    </div>
  </ToolPage>
</template>
