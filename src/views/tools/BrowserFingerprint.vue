<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 浏览器指纹检测：逐项收集 UA、屏幕、Canvas、WebGL、音频、字体等指纹信号，
 * 全部完成后用 Web Crypto SHA-256 生成总指纹哈希并给出隐私风险评估。
 * 隐私考虑：结果不持久化、不上传；所有哈希均通过 crypto.subtle 完成
 */

const CANVAS_WIDTH = 240
const CANVAS_HEIGHT = 72
const HASH_PREFIX_LENGTH = 16
const AUDIO_RENDER_TIMEOUT_MS = 4000
const AUDIO_SAMPLE_START = 4500
const AUDIO_SAMPLE_END = 5000
const FONT_TEST_STRING = 'mmmmmmmmmmlli WwMm 0O1'
const FONT_PROBE_LIST = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  'Consolas',
  'Segoe UI',
  'Calibri',
  'Cambria',
  'Lucida Console',
  'Monaco',
  'Palatino Linotype',
  'Microsoft YaHei',
  'SimSun',
  'KaiTi',
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
]

const { t } = useI18n()
const toast = useToast()

/** Web Crypto 可用性：不可用时整页显示不支持横幅 */
const cryptoAvailable =
  typeof crypto !== 'undefined' &&
  !!crypto.subtle &&
  typeof crypto.subtle.digest === 'function' &&
  typeof TextEncoder !== 'undefined'

const running = ref(false)
const totalHash = ref('')
const hashFailed = ref(false)

function buildItems() {
  return ITEM_DEFS.map(def => ({
    key: def.key,
    status: 'pending',
    value: '',
    display: '',
  }))
}

const finished = computed(() => !running.value && items.value.some(item => item.status !== 'pending'))
const doneCount = computed(() => items.value.filter(item => item.status === 'done').length)

/** 隐私风险评估：按可收集项数量分级 */
const risk = computed(() => {
  const count = doneCount.value
  if (count >= 8) {
    return { key: 'high', cls: 'bg-red-50 border-red-200 text-red-700', dot: '🟥' }
  }
  if (count >= 5) {
    return { key: 'medium', cls: 'bg-orange-50 border-orange-200 text-orange-700', dot: '🟧' }
  }
  return { key: 'low', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: '🟩' }
})

const startBtnLabel = computed(() => (finished.value ? t('tools.browserFingerprint.recheckBtn') : t('tools.browserFingerprint.startBtn')))

/* ---------- SHA-256（Web Crypto） ---------- */

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms)
    }),
  ])
}

/* ---------- 各指纹项采集函数：返回 { value, display } 或 null（不支持） ---------- */

function collectUserAgent() {
  const ua = navigator.userAgent || ''
  return ua ? { value: ua } : null
}

function collectLanguages() {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length
    ? [...navigator.languages]
    : navigator.language
      ? [navigator.language]
      : []
  return langs.length ? { value: langs.join(', ') } : null
}

function collectPlatform() {
  const platform = navigator.platform || ''
  return platform ? { value: platform } : null
}

function collectScreen() {
  const s = window.screen
  if (!s || !s.width) return null
  const parts = [
    t('tools.browserFingerprint.screenPart') + ' ' + s.width + 'x' + s.height,
    t('tools.browserFingerprint.availPart') + ' ' + s.availWidth + 'x' + s.availHeight,
    t('tools.browserFingerprint.windowPart') + ' ' + window.innerWidth + 'x' + window.innerHeight,
    t('tools.browserFingerprint.dprPart') + ' ' + String(window.devicePixelRatio || 1),
    t('tools.browserFingerprint.colorDepthPart') + ' ' + String(s.colorDepth),
  ]
  return { value: parts.join(' · ') }
}

function collectTimezone() {
  let timeZone = ''
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    timeZone = ''
  }
  const offsetMinutes = -new Date().getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  if (!timeZone && !Number.isFinite(offsetMinutes)) return null
  return { value: (timeZone || t('toolsCommon.none')) + ' · UTC' + sign + hh + ':' + mm }
}

function collectCpuCores() {
  const cores = navigator.hardwareConcurrency
  return Number.isFinite(cores) && cores > 0 ? { value: String(cores) } : null
}

function collectDeviceMemory() {
  const memory = navigator.deviceMemory
  return Number.isFinite(memory) && memory > 0 ? { value: memory + ' GB' } : null
}

function collectTouch() {
  const points = Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0
  const hasTouch = points > 0 || 'ontouchstart' in window
  if (!hasTouch) return { value: 'no-touch', display: t('toolsCommon.no') }
  return { value: 'touch:' + points, display: t('toolsCommon.yes') + ' (' + points + ')' }
}

/** Canvas 指纹：多层文本 + 图形 + 渐变后取 DataURL 的 SHA-256 前 16 位 */
async function collectCanvas() {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    gradient.addColorStop(0, '#ff6b6b')
    gradient.addColorStop(0.5, '#feca57')
    gradient.addColorStop(1, '#48dbfb')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)'
    ctx.beginPath()
    ctx.arc(24, 20, 12, 0, Math.PI * 2, true)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(4, 60)
    ctx.bezierCurveTo(70, 40, 150, 80, CANVAS_WIDTH - 8, 48)
    ctx.stroke()
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#1e293b'
    ctx.font = '17px Arial'
    ctx.fillText('ToolboxLab \u{1F510} <canvas>', 40, 32)
    ctx.fillStyle = '#ffffff'
    ctx.font = '13px "Times New Roman"'
    ctx.fillText('Browser Fingerprint 浏览器指纹', 40, 54)
    const dataUrl = canvas.toDataURL()
    if (!dataUrl || dataUrl === 'data:,') return null
    const hex = await sha256Hex(dataUrl)
    return { value: hex.slice(0, HASH_PREFIX_LENGTH) }
  } catch {
    return null
  }
}

/** WebGL 渲染器 / 厂商：优先读取未掩码信息 */
function collectWebgl() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    let vendor = ''
    let renderer = ''
    if (ext) {
      vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '')
      renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
    }
    if (!vendor) vendor = String(gl.getParameter(gl.VENDOR) || '')
    if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) || '')
    if (!vendor && !renderer) return null
    return { value: (vendor || '?') + ' / ' + (renderer || '?') }
  } catch {
    return null
  }
}

/** 音频指纹：OfflineAudioContext 渲染振荡器 + 压缩器，对采样求和取哈希 */
async function collectAudio() {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctx) return null
  try {
    const ctx = new Ctx(1, 44100, 44100)
    const oscillator = ctx.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = 10000
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -50
    compressor.knee.value = 40
    compressor.ratio.value = 12
    compressor.attack.value = 0
    compressor.release.value = 0.25
    oscillator.connect(compressor)
    compressor.connect(ctx.destination)
    oscillator.start(0)
    const rendered = ctx.startRendering()
    const buffer =
      rendered && typeof rendered.then === 'function'
        ? await withTimeout(rendered, AUDIO_RENDER_TIMEOUT_MS)
        : await withTimeout(
            new Promise(resolve => {
              ctx.oncomplete = event => resolve(event.renderedBuffer)
            }),
            AUDIO_RENDER_TIMEOUT_MS,
          )
    if (!buffer) return null
    const samples = buffer.getChannelData(0)
    let sum = 0
    for (let i = AUDIO_SAMPLE_START; i < AUDIO_SAMPLE_END; i++) {
      sum += Math.abs(samples[i] || 0)
    }
    if (!Number.isFinite(sum) || sum === 0) return null
    const hex = await sha256Hex(String(sum))
    return { value: hex.slice(0, HASH_PREFIX_LENGTH) }
  } catch {
    return null
  }
}

/** 字体探测：Canvas measureText 宽度对比法 */
function collectFonts() {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const fallbacks = ['monospace', 'serif']
    const measure = fontSpec => {
      ctx.font = fontSpec
      return ctx.measureText(FONT_TEST_STRING).width
    }
    const baselines = fallbacks.map(fallback => measure('72px ' + fallback))
    const hits = FONT_PROBE_LIST.filter(font =>
      fallbacks.some(
        (fallback, index) => measure('72px "' + font + '", ' + fallback) !== baselines[index],
      ),
    )
    if (!hits.length) return { value: 'no-extra-fonts', display: t('tools.browserFingerprint.noFontHit') }
    return { value: hits.join(', ') }
  } catch {
    return null
  }
}

const ITEM_DEFS = [
  { key: 'userAgent', collect: collectUserAgent },
  { key: 'languages', collect: collectLanguages },
  { key: 'platform', collect: collectPlatform },
  { key: 'screen', collect: collectScreen },
  { key: 'timezone', collect: collectTimezone },
  { key: 'cpu', collect: collectCpuCores },
  { key: 'memory', collect: collectDeviceMemory },
  { key: 'touch', collect: collectTouch },
  { key: 'canvas', collect: collectCanvas },
  { key: 'webgl', collect: collectWebgl },
  { key: 'audio', collect: collectAudio },
  { key: 'fonts', collect: collectFonts },
]

const items = ref(buildItems())

/* ---------- 状态展示 ---------- */

function statusMeta(item) {
  switch (item.status) {
    case 'collecting':
      return { labelKey: 'statusCollecting', cls: 'bg-amber-50 text-amber-700 border-amber-200', dotCls: 'bg-amber-500' }
    case 'done':
      return { labelKey: 'statusDone', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotCls: 'bg-emerald-500' }
    case 'unsupported':
      return { labelKey: 'statusUnsupported', cls: 'bg-slate-100 text-slate-500 border-slate-200', dotCls: 'bg-slate-400' }
    default:
      return { labelKey: 'statusPending', cls: 'bg-slate-50 text-slate-400 border-slate-200', dotCls: 'bg-slate-300' }
  }
}

/** 点击「开始检测」后逐项收集，再汇总生成总指纹 */
async function startDetection() {
  if (running.value || !cryptoAvailable) return
  running.value = true
  hashFailed.value = false
  totalHash.value = ''
  items.value = buildItems()
  for (let i = 0; i < ITEM_DEFS.length; i++) {
    const item = items.value[i]
    item.status = 'collecting'
    await sleep(120)
    try {
      const result = await ITEM_DEFS[i].collect()
      if (result && result.value) {
        item.value = result.value
        item.display = result.display || result.value
        item.status = 'done'
      } else {
        item.status = 'unsupported'
      }
    } catch {
      item.status = 'unsupported'
    }
  }
  try {
    const source = items.value
      .filter(item => item.status === 'done')
      .map(item => item.key + '=' + item.value)
      .join('\n')
    totalHash.value = await sha256Hex(source)
  } catch {
    hashFailed.value = true
    toast.error(t('tools.browserFingerprint.errHashFailed'))
  }
  running.value = false
}
</script>

<template>
  <ToolPage tool-id="browserFingerprint">
    <!-- Web Crypto 不可用横幅 -->
    <div
      v-if="!cryptoAvailable"
      class="glass-card p-4 sm:p-6 mb-4 !bg-red-50/80 !border-red-200 flex items-start gap-2.5"
      role="alert"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-red-500"
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
      <p class="text-sm text-red-600 leading-relaxed">{{ t('tools.browserFingerprint.cryptoUnsupported') }}</p>
    </div>

    <!-- 操作区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        <p class="text-sm text-slate-500 leading-relaxed flex-1">{{ t('tools.browserFingerprint.intro') }}</p>
        <button type="button" class="btn-primary shrink-0" :disabled="running || !cryptoAvailable" @click="startDetection">
          {{ startBtnLabel }}
        </button>
      </div>
      <p v-if="running" class="mt-2.5 text-sm text-slate-400">{{ t('tools.browserFingerprint.collecting') }}</p>
    </section>

    <!-- 逐项结果 -->
    <section v-if="items.some(item => item.status !== 'pending')" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.browserFingerprint.itemsTitle') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div
          v-for="item in items"
          :key="item.key"
          class="rounded-xl border border-slate-200 bg-white/70 p-3 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-700">
              {{ t('tools.browserFingerprint.items.' + item.key) }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] shrink-0"
              :class="statusMeta(item).cls"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta(item).dotCls" aria-hidden="true"></span>
              {{ t('tools.browserFingerprint.' + statusMeta(item).labelKey) }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-2">
            <span v-if="item.status === 'done'" class="text-xs font-mono text-slate-600 break-all leading-relaxed">
              {{ item.display }}
            </span>
            <span v-else-if="item.status === 'unsupported'" class="text-xs text-slate-400 leading-relaxed">
              {{ t('tools.browserFingerprint.unsupportedNote') }}
            </span>
            <span v-else-if="item.status === 'collecting'" class="flex items-center gap-2 text-xs text-slate-400">
              <span
                class="inline-block w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"
                aria-hidden="true"
              ></span>
              {{ t('tools.browserFingerprint.statusCollecting') }}
            </span>
            <span v-else class="text-xs text-slate-300">—</span>
            <CopyButton v-if="item.status === 'done'" compact :text="item.value" />
          </div>
        </div>
      </div>
    </section>

    <!-- 总指纹 -->
    <section v-if="finished && !hashFailed && totalHash" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.browserFingerprint.fingerprintTitle') }}</h2>
      <div class="flex items-start justify-between gap-3">
        <p class="flex-1 text-sm font-mono text-slate-700 break-all leading-relaxed bg-slate-50 rounded-xl border border-slate-200 p-3">
          {{ totalHash }}
        </p>
        <CopyButton :text="totalHash" :label="t('toolsCommon.copy')" />
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.browserFingerprint.fingerprintNote') }}</p>
    </section>

    <!-- 隐私风险评估 -->
    <section v-if="finished" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.browserFingerprint.riskTitle') }}</h2>
      <div class="flex flex-wrap items-center gap-3">
        <span class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold" :class="risk.cls">
          <span aria-hidden="true">{{ risk.dot }}</span>
          {{ t('tools.browserFingerprint.risk.' + risk.key) }}
        </span>
        <span class="text-sm text-slate-500">
          {{ t('tools.browserFingerprint.riskCount') }} {{ doneCount }} / {{ items.length }}
        </span>
      </div>
      <p class="mt-2.5 text-sm text-slate-500 leading-relaxed">{{ t('tools.browserFingerprint.riskDesc') }}</p>
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
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.browserFingerprint.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>
