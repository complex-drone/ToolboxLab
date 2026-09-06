<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadBlob } from '@/utils/download'
import { formatBytes } from '@/utils/format'

/**
 * 音频格式转换：浏览器 AudioContext 解码音频后，
 * 用 OfflineAudioContext 完成混音（单声道）与重采样，
 * 再由自实现的 WAV 编码器（44 字节 RIFF 头 + 16 位 PCM 交错数据）导出
 */

const MAX_SIZE_MB = 50
const RATE_OPTIONS = [8000, 16000, 22050, 44100]

const { t } = useI18n()
const toast = useToast()

/** 输出选项持久化 */
const config = useStorage('tool-audio-converter-config', {
  format: 'wav',
  mono: false,
  rate: 'keep',
})
const format = ref(config.value.format === 'raw' ? 'raw' : 'wav')
const mono = ref(Boolean(config.value.mono))
const rate = ref(RATE_OPTIONS.includes(config.value.rate) ? config.value.rate : 'keep')

watch(format, value => {
  config.value.format = value
})
watch(mono, value => {
  config.value.mono = value
})
watch(rate, value => {
  config.value.rate = value
})

const fileMeta = ref(null)
/** 解码后的 AudioBuffer */
const audioBuffer = ref(null)
const decoding = ref(false)
const decodeError = ref('')
const converting = ref(false)
const convertError = ref('')
/** 转换输出：{ blob, url, size, filename } */
const output = ref(null)

let decodeToken = 0
let convertToken = 0
let activeContext = null

/** 将字符串按单字节 ASCII 写入 DataView（用于 RIFF 区块名） */
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/**
 * WAV 编码器（纯函数）：44 字节 RIFF 头 + 16 位 PCM 交错数据
 * @param {Float32Array[]} channels - 每声道的采样数据（取值 -1 到 1）
 * @param {number} sampleRate - 采样率（Hz）
 * @returns {ArrayBuffer}
 */
function encodeWav(channels, sampleRate) {
  const numChannels = channels.length
  const numFrames = channels[0].length
  const blockAlign = numChannels * 2
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF 区块头
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  // fmt 子区块（16 字节，PCM 格式）
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  // data 子区块
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // 16 位 PCM 交错写入（帧 = 同一时刻各声道采样依次排列）
  let offset = 44
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][frame]
      if (sample < -1) sample = -1
      else if (sample > 1) sample = 1
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return buffer
}

/** 释放上一次转换产物的对象 URL */
function resetOutput() {
  if (output.value && output.value.url) {
    URL.revokeObjectURL(output.value.url)
  }
  output.value = null
}

/** 上传并解码音频文件 */
async function handleFile(file) {
  if (!file) return
  const token = ++decodeToken
  // 新文件使进行中的转换失效
  convertToken++
  resetOutput()
  decodeError.value = ''
  convertError.value = ''
  audioBuffer.value = null
  fileMeta.value = { name: file.name, size: file.size }
  decoding.value = true

  let context = null
  try {
    const arrayBuffer = await file.arrayBuffer()
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) throw new Error('AudioContext unsupported')
    context = new AudioCtx()
    activeContext = context
    const buffer = await context.decodeAudioData(arrayBuffer)
    if (token !== decodeToken) return
    audioBuffer.value = buffer
  } catch {
    if (token !== decodeToken) return
    audioBuffer.value = null
    fileMeta.value = null
    decodeError.value = t('tools.audioConverter.errDecode')
    toast.error(t('tools.audioConverter.errDecode'))
  } finally {
    if (token === decodeToken) decoding.value = false
    if (context) {
      if (activeContext === context) activeContext = null
      try {
        await context.close()
      } catch {
        // 关闭失败可忽略
      }
    }
  }
}

/** 执行转换：按需重采样 / 混音，再编码为 WAV 或裸 PCM */
async function runConvert() {
  const source = audioBuffer.value
  if (!source || converting.value) return
  const token = ++convertToken
  converting.value = true
  convertError.value = ''
  try {
    const targetRate = rate.value === 'keep' ? source.sampleRate : Number(rate.value)
    const targetChannels = mono.value ? 1 : source.numberOfChannels

    let rendered = source
    if (targetRate !== source.sampleRate || targetChannels !== source.numberOfChannels) {
      // 目标长度 = 时长 × 新采样率；声道变化由 OfflineAudioContext 自动上/下混
      const length = Math.max(1, Math.ceil(source.duration * targetRate))
      const offline = new OfflineAudioContext(targetChannels, length, targetRate)
      const node = offline.createBufferSource()
      node.buffer = source
      node.connect(offline.destination)
      node.start()
      rendered = await offline.startRendering()
    }
    if (token !== convertToken) return

    const channels = []
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      channels.push(rendered.getChannelData(ch))
    }
    const wavBuffer = encodeWav(channels, rendered.sampleRate)
    const isRaw = format.value === 'raw'
    const blob = new Blob([isRaw ? wavBuffer.slice(44) : wavBuffer], {
      type: isRaw ? 'application/octet-stream' : 'audio/wav',
    })
    if (token !== convertToken) return

    resetOutput()
    const baseName = (fileMeta.value && fileMeta.value.name ? fileMeta.value.name : 'audio')
      .replace(/\.[^.]+$/, '')
    const filename = baseName + '-16bit-' + rendered.sampleRate + 'Hz.' + (isRaw ? 'raw' : 'wav')
    output.value = {
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      filename,
    }
    toast.success(t('tools.audioConverter.convertDone'))
  } catch {
    if (token !== convertToken) return
    convertError.value = t('tools.audioConverter.errConvert')
    toast.error(t('toolsCommon.error'))
  } finally {
    if (token === convertToken) converting.value = false
  }
}

function downloadOutput() {
  if (!output.value) return
  downloadBlob(output.value.blob, output.value.filename)
}

/** 解码信息：时长 / 声道 / 采样率 / 解码后大小（Float32 PCM） */
const decodedInfo = computed(() => {
  const buffer = audioBuffer.value
  if (!buffer) return null
  return {
    duration: buffer.duration,
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    decodedBytes: buffer.length * buffer.numberOfChannels * 4,
  }
})

const canConvert = computed(() => Boolean(audioBuffer.value) && !decoding.value && !converting.value)

onBeforeUnmount(() => {
  decodeToken++
  convertToken++
  resetOutput()
  if (activeContext) {
    try {
      activeContext.close()
    } catch {
      // 关闭失败可忽略
    }
    activeContext = null
  }
})
</script>

<template>
  <ToolPage tool-id="audioConverter">
    <!-- 上传区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <FileDropZone
        accept="audio/*"
        :maxSizeMB="MAX_SIZE_MB"
        :hint="t('tools.audioConverter.uploadHint')"
        @files="handleFile"
      />
      <p v-if="decoding" class="mt-3 flex items-center gap-2 text-sm text-slate-400">
        <span
          class="inline-block w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        {{ t('toolsCommon.processing') }}
      </p>
      <p v-if="decodeError" class="mt-2 text-sm text-red-600">{{ decodeError }}</p>
    </section>

    <!-- 解码信息 -->
    <section v-if="decodedInfo && fileMeta" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.audioConverter.infoTitle') }}</h2>
      <dl class="divide-y divide-slate-100">
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ t('tools.audioConverter.fileLabel') }}</dt>
          <dd class="min-w-0 text-right">
            <p class="text-sm text-slate-700 break-all">{{ fileMeta.name }}</p>
            <p class="text-xs text-slate-400 mt-0.5">{{ formatBytes(fileMeta.size) }}</p>
          </dd>
        </div>
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ t('tools.audioConverter.fieldDuration') }}</dt>
          <dd class="text-sm text-slate-700 font-mono">
            {{ decodedInfo.duration.toFixed(2) }} {{ t('toolsCommon.seconds') }}
          </dd>
        </div>
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ t('tools.audioConverter.fieldChannels') }}</dt>
          <dd class="text-sm text-slate-700 font-mono">{{ decodedInfo.channels }}</dd>
        </div>
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ t('tools.audioConverter.fieldSampleRate') }}</dt>
          <dd class="text-sm text-slate-700 font-mono">
            {{ t('tools.audioConverter.hzValue', { n: decodedInfo.sampleRate }) }}
          </dd>
        </div>
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ t('tools.audioConverter.fieldDecodedSize') }}</dt>
          <dd class="text-sm text-slate-700 font-mono">{{ formatBytes(decodedInfo.decodedBytes) }}</dd>
        </div>
      </dl>
    </section>

    <!-- 输出设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.audioConverter.outputTitle') }}</h2>

      <p class="label-base">{{ t('tools.audioConverter.formatLabel') }}</p>
      <div class="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition select-none"
          :class="
            format === 'wav'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-pressed="format === 'wav'"
          @click="format = 'wav'"
        >
          {{ t('tools.audioConverter.formatWav') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition select-none"
          :class="
            format === 'raw'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-pressed="format === 'raw'"
          @click="format = 'raw'"
        >
          {{ t('tools.audioConverter.formatRaw') }}
        </button>
      </div>
      <p class="mt-1.5 text-xs text-slate-400">
        {{ format === 'wav' ? t('tools.audioConverter.formatWavDesc') : t('tools.audioConverter.formatRawDesc') }}
      </p>

      <!-- 声道开关：保持原声道 / 混合为单声道 -->
      <div class="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="label-base mb-0">{{ t('tools.audioConverter.channelLabel') }}</p>
          <p class="mt-0.5 text-xs text-slate-400">
            {{ mono ? t('tools.audioConverter.channelMonoDesc') : t('tools.audioConverter.channelKeepDesc') }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="mono"
          class="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors"
          :class="mono ? 'bg-blue-600' : 'bg-slate-300'"
          @click="mono = !mono"
        >
          <span
            class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
            :class="mono ? 'translate-x-5' : 'translate-x-0'"
            aria-hidden="true"
          ></span>
        </button>
      </div>

      <div class="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-end gap-3">
        <div class="w-full sm:w-52">
          <label class="label-base" for="audio-rate-select">{{ t('tools.audioConverter.rateLabel') }}</label>
          <select id="audio-rate-select" v-model="rate" class="input-base">
            <option value="keep">{{ t('tools.audioConverter.rateKeep') }}</option>
            <option v-for="r in RATE_OPTIONS" :key="r" :value="r">
              {{ t('tools.audioConverter.rateOption', { n: r }) }}
            </option>
          </select>
        </div>
        <button
          type="button"
          class="btn-primary shrink-0 flex items-center gap-2"
          :disabled="!canConvert"
          @click="runConvert"
        >
          <svg
            v-if="converting"
            class="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-9-9" />
            <polyline points="21 3 21 12 12 12" />
          </svg>
          {{ converting ? t('tools.audioConverter.converting') : t('tools.audioConverter.convertBtn') }}
        </button>
      </div>
      <p v-if="convertError" class="mt-2 text-sm text-red-600">{{ convertError }}</p>
    </section>

    <!-- 转换结果：下载 + 试听 -->
    <section v-if="output" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.audioConverter.resultTitle') }}</h2>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm text-slate-700 font-mono break-all">{{ output.filename }}</p>
          <p class="mt-0.5 text-xs text-slate-400">
            {{ t('tools.audioConverter.outputSize') }}: {{ formatBytes(output.size) }}
          </p>
        </div>
        <button type="button" class="btn-primary shrink-0" @click="downloadOutput">
          {{ t('toolsCommon.download') }}
        </button>
      </div>
      <div class="mt-4">
        <p class="label-base">{{ t('tools.audioConverter.previewLabel') }}</p>
        <audio :src="output.url" controls class="w-full mt-1.5"></audio>
      </div>
    </section>

    <!-- 说明 -->
    <div
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5"
      role="note"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.audioConverter.decodeNote') }}</p>
    </div>
  </ToolPage>
</template>
