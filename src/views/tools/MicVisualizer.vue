<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * 麦克风音频可视化器：
 * getUserMedia 采集 -> AudioContext + AnalyserNode（fftSize 2048）-> rAF 循环绘制
 * 波形（时域蓝线）与频谱（渐变柱状）两种模式，RMS 计算实时音量 dB
 * 状态机：idle / requesting / listening / paused；卸载时完整清理 rAF、轨道与音频上下文
 * 隐私：音频仅在本地处理，不录音不上传
 */

const { t } = useI18n()
const toast = useToast()

/** 音量条分段数 */
const SEG_COUNT = 24

/** 浏览器能力特性检测 */
const hasAudioApi =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  !!(window.AudioContext || window.webkitAudioContext)

/** 状态机：idle 空闲 / requesting 请求中 / listening 收听中 / paused 已暂停 */
const state = ref('idle')
const mode = ref('waveform')
const errorMsg = ref('')
const volumePercent = ref(0)
const volumeDb = ref(-60)

const wrapRef = ref(null)
const canvasRef = ref(null)

let stream = null
let audioCtx = null
let analyser = null
let timeData = null
let freqData = null
let rafId = 0
let cssW = 0
let cssH = 0
let dprVal = 1

/* ---------- 状态展示 ---------- */

const statusMeta = computed(() => {
  switch (state.value) {
    case 'requesting':
      return { key: 'statusRequesting', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' }
    case 'listening':
      return { key: 'statusListening', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
    case 'paused':
      return { key: 'statusPaused', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' }
    default:
      return { key: 'statusIdle', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' }
  }
})

/* ---------- 启动 / 暂停 / 停止 ---------- */

function classifyError(e) {
  const name = e && e.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return t('tools.micVisualizer.errNotAllowed')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return t('tools.micVisualizer.errNotFound')
  }
  return t('tools.micVisualizer.errOther')
}

async function start() {
  if (!hasAudioApi || state.value === 'requesting' || state.value === 'listening') return
  state.value = 'requesting'
  errorMsg.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const Ctx = window.AudioContext || window.webkitAudioContext
    audioCtx = new Ctx()
    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    timeData = new Uint8Array(analyser.fftSize)
    freqData = new Uint8Array(analyser.frequencyBinCount)
    resizeCanvas()
    state.value = 'listening'
    startLoop()
  } catch (e) {
    cleanupAudio()
    resetVolume()
    drawIdle()
    state.value = 'idle'
    const msg = classifyError(e)
    errorMsg.value = msg
    toast.error(msg)
  }
}

async function pause() {
  if (state.value !== 'listening' || !audioCtx) return
  stopLoop()
  try {
    await audioCtx.suspend()
  } catch {
    /* suspend 失败时保持收听状态继续绘制 */
    startLoop()
    return
  }
  state.value = 'paused'
}

async function resume() {
  if (state.value !== 'paused' || !audioCtx) return
  try {
    await audioCtx.resume()
  } catch {
    /* resume 失败则保持暂停 */
    return
  }
  state.value = 'listening'
  startLoop()
}

function stop() {
  stopLoop()
  cleanupAudio()
  resetVolume()
  drawIdle()
  state.value = 'idle'
}

/** 释放媒体流轨道与音频上下文 */
function cleanupAudio() {
  if (stream) {
    stream.getTracks().forEach(track => {
      try {
        track.stop()
      } catch {
        /* 轨道已停止则忽略 */
      }
    })
    stream = null
  }
  if (audioCtx) {
    try {
      if (audioCtx.state !== 'closed') audioCtx.close()
    } catch {
      /* 关闭失败则忽略 */
    }
    audioCtx = null
  }
  analyser = null
  timeData = null
  freqData = null
}

/* ---------- 绘制循环 ---------- */

function startLoop() {
  stopLoop()
  rafId = requestAnimationFrame(drawFrame)
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
}

function drawFrame() {
  rafId = requestAnimationFrame(drawFrame)
  if (!analyser || !timeData) return
  analyser.getByteTimeDomainData(timeData)
  updateVolume()
  if (mode.value === 'spectrum' && freqData) {
    analyser.getByteFrequencyData(freqData)
    drawSpectrum()
  } else {
    drawWaveform()
  }
}

/* ---------- 实时音量：RMS -> dB（下限 -60dB） ---------- */

function updateVolume() {
  let sum = 0
  for (let i = 0; i < timeData.length; i++) {
    const s = (timeData[i] - 128) / 128
    sum += s * s
  }
  const rms = Math.sqrt(sum / timeData.length)
  let db = -60
  if (rms > 0) db = 20 * Math.log10(rms)
  db = Math.max(-60, Math.min(0, db))
  volumeDb.value = db
  volumePercent.value = Math.round(((db + 60) / 60) * 100)
}

function resetVolume() {
  volumeDb.value = -60
  volumePercent.value = 0
}

/** 音量条分段颜色：左绿、中黄、右红，未点亮为灰 */
function segClass(index) {
  if (index > Math.round((volumePercent.value / 100) * SEG_COUNT)) return 'bg-slate-200'
  const ratio = index / SEG_COUNT
  if (ratio <= 0.6) return 'bg-emerald-500'
  if (ratio <= 0.85) return 'bg-amber-400'
  return 'bg-red-500'
}

/* ---------- Canvas 绘制（devicePixelRatio 高清） ---------- */

function getCtx() {
  const canvas = canvasRef.value
  if (!canvas || !cssW || !cssH) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dprVal, 0, 0, dprVal, 0, 0)
  return ctx
}

function resizeCanvas() {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  dprVal = window.devicePixelRatio || 1
  cssW = wrap.clientWidth
  cssH = wrap.clientHeight
  if (!cssW || !cssH) return
  canvas.width = Math.max(1, Math.round(cssW * dprVal))
  canvas.height = Math.max(1, Math.round(cssH * dprVal))
  redraw()
}

/** 重绘当前帧：收听中用实时数据，空闲画基线 */
function redraw() {
  if (analyser && timeData) {
    if (mode.value === 'spectrum' && freqData) {
      analyser.getByteFrequencyData(freqData)
      drawSpectrum()
    } else {
      drawWaveform()
    }
  } else {
    drawIdle()
  }
}

function drawIdle() {
  const ctx = getCtx()
  if (!ctx) return
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#cbd5e1'
  ctx.beginPath()
  ctx.moveTo(0, cssH / 2)
  ctx.lineTo(cssW, cssH / 2)
  ctx.stroke()
}

/** 时域波形：蓝色线条 */
function drawWaveform() {
  const ctx = getCtx()
  if (!ctx) return
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#3b82f6'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const n = timeData.length
  const stepX = cssW / n
  for (let i = 0; i < n; i++) {
    const x = i * stepX
    const y = (timeData[i] / 255) * cssH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/** 频谱柱状图：横向渐变色柱 */
function drawSpectrum() {
  const ctx = getCtx()
  if (!ctx) return
  ctx.clearRect(0, 0, cssW, cssH)
  const bars = 64
  const sampleStep = Math.max(1, Math.floor(freqData.length / bars))
  const barW = cssW / bars
  const grad = ctx.createLinearGradient(0, 0, cssW, 0)
  grad.addColorStop(0, '#3b82f6')
  grad.addColorStop(0.5, '#06b6d4')
  grad.addColorStop(1, '#8b5cf6')
  ctx.fillStyle = grad
  for (let b = 0; b < bars; b++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < sampleStep; j++) {
      const idx = b * sampleStep + j
      if (idx < freqData.length) {
        sum += freqData[idx]
        count++
      }
    }
    const v = count ? sum / count / 255 : 0
    const barH = Math.max(2, v * (cssH - 4))
    ctx.fillRect(b * barW, cssH - barH, Math.max(1, barW - 2), barH)
  }
}

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  redraw()
}

/* ---------- 生命周期 ---------- */

onMounted(() => {
  drawIdle()
})

onBeforeUnmount(() => {
  stopLoop()
  cleanupAudio()
})
</script>

<template>
  <ToolPage tool-id="micVisualizer">
    <!-- 环境不支持：友好空态 -->
    <div
      v-if="!hasAudioApi"
      class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/80 !border-amber-200 flex items-start gap-2.5"
      role="alert"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-amber-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p class="text-sm text-amber-700 leading-relaxed">{{ t('tools.micVisualizer.envUnsupported') }}</p>
    </div>

    <template v-else>
      <!-- 控制区 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3">
          <div class="flex flex-wrap items-center gap-2 flex-1">
            <button
              v-if="state === 'idle' || state === 'requesting'"
              type="button"
              class="btn-primary"
              :disabled="state === 'requesting'"
              @click="start"
            >
              {{ state === 'requesting' ? t('toolsCommon.processing') : t('tools.micVisualizer.startBtn') }}
            </button>
            <button v-if="state === 'listening'" type="button" class="btn-ghost" @click="pause">
              {{ t('tools.micVisualizer.pauseBtn') }}
            </button>
            <button v-if="state === 'paused'" type="button" class="btn-primary" @click="resume">
              {{ t('tools.micVisualizer.resumeBtn') }}
            </button>
            <button
              v-if="state === 'listening' || state === 'paused'"
              type="button"
              class="btn-danger"
              @click="stop"
            >
              {{ t('tools.micVisualizer.stopBtn') }}
            </button>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-sm text-slate-400">{{ t('tools.micVisualizer.statusLabel') }}</span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
              :class="statusMeta.cls"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta.dot" aria-hidden="true"></span>
              {{ t('tools.micVisualizer.' + statusMeta.key) }}
            </span>
          </div>
        </div>
        <p v-if="errorMsg" class="mt-3 text-sm text-red-600 leading-relaxed">{{ errorMsg }}</p>
      </section>

      <!-- 实时图形 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 class="section-title mb-0">{{ t('tools.micVisualizer.visualTitle') }}</h2>
          <div class="flex rounded-xl border border-slate-200 bg-white/70 p-1">
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              :class="mode === 'waveform' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="switchMode('waveform')"
            >
              {{ t('tools.micVisualizer.tabWaveform') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              :class="mode === 'spectrum' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="switchMode('spectrum')"
            >
              {{ t('tools.micVisualizer.tabSpectrum') }}
            </button>
          </div>
        </div>
        <div
          ref="wrapRef"
          class="relative w-full h-56 sm:h-64 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
        >
          <canvas ref="canvasRef" class="block w-full h-full"></canvas>
          <div
            v-if="state === 'idle' || state === 'requesting'"
            class="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <p class="text-sm text-slate-400 px-4 text-center leading-relaxed">
              {{ t('tools.micVisualizer.idleHint') }}
            </p>
          </div>
        </div>
      </section>

      <!-- 实时音量 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.micVisualizer.volumeTitle') }}</h2>
          <span class="text-sm font-mono font-semibold text-slate-700">
            {{ volumeDb.toFixed(1) }} {{ t('tools.micVisualizer.dbUnit') }}
          </span>
        </div>
        <div class="flex gap-1 h-3" role="img" :aria-label="t('tools.micVisualizer.volumeTitle')">
          <div
            v-for="i in SEG_COUNT"
            :key="i"
            class="flex-1 rounded-sm transition-colors duration-75"
            :class="segClass(i)"
          ></div>
        </div>
      </section>

      <!-- 隐私说明 -->
      <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5" role="note">
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
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.micVisualizer.privacyNote') }}</p>
      </div>
    </template>
  </ToolPage>
</template>
