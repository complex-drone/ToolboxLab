<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { downloadText, downloadCanvasAsPng } from '@/utils/download'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

const SIZE_MIN = 200
const SIZE_MAX = 600
const SIZE_FALLBACK = 320
const ECC_LEVELS = ['L', 'M', 'Q', 'H']
const ECC_LABELS = { L: 'levelL', M: 'levelM', Q: 'levelQ', H: 'levelH' }

/** 二维码设置全部持久化（正文文本不持久化） */
const config = useStorage('tool-qr-code-generator-config', {
  size: SIZE_FALLBACK,
  fg: '#000000',
  bg: '#ffffff',
  ecc: 'M',
})

const text = ref('')
const canvasRef = ref(null)
const rendered = ref(false)
const renderError = ref('')

/** 懒加载并缓存 qrcode 模块 */
let qrModule = null
async function loadQr() {
  if (!qrModule) {
    const mod = await import('qrcode')
    qrModule = mod.default && typeof mod.default.toCanvas === 'function' ? mod.default : mod
  }
  return qrModule
}

function clampSize(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return SIZE_FALLBACK
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)))
}

function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

const hasText = computed(() => text.value.trim().length > 0)

const renderOptions = () => ({
  width: clampSize(config.value.size),
  errorCorrectionLevel: ECC_LEVELS.includes(config.value.ecc) ? config.value.ecc : 'M',
  color: {
    dark: safeColor(config.value.fg, '#000000'),
    light: safeColor(config.value.bg, '#ffffff'),
  },
})

/** 渲染二维码到 canvas（空内容显示空状态） */
async function doRender() {
  const value = text.value
  if (!value.trim()) {
    rendered.value = false
    renderError.value = ''
    return
  }
  try {
    const QRCode = await loadQr()
    if (!canvasRef.value || text.value !== value) return
    await QRCode.toCanvas(canvasRef.value, value, renderOptions())
    rendered.value = true
    renderError.value = ''
  } catch {
    rendered.value = false
    renderError.value = t('tools.qrCodeGenerator.renderFailed')
    toast.error(renderError.value)
  }
}

const debouncedRender = useDebounceFn(doRender, 300)

function downloadPng() {
  try {
    if (!rendered.value || !canvasRef.value) return
    downloadCanvasAsPng(canvasRef.value, 'qrcode.png')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

async function downloadSvg() {
  try {
    if (!hasText.value) return
    const QRCode = await loadQr()
    const svg = await QRCode.toString(text.value, {
      type: 'svg',
      ...renderOptions(),
    })
    downloadText(svg, 'qrcode.svg', 'image/svg+xml;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

watch(
  () => [text.value, config.value.size, config.value.fg, config.value.bg, config.value.ecc],
  () => debouncedRender()
)

onMounted(() => {
  config.value.size = clampSize(config.value.size)
  if (!ECC_LEVELS.includes(config.value.ecc)) config.value.ecc = 'M'
  config.value.fg = safeColor(config.value.fg, '#000000')
  config.value.bg = safeColor(config.value.bg, '#ffffff')
  debouncedRender()
})

onBeforeUnmount(() => {
  debouncedRender.cancel()
})
</script>

<template>
  <ToolPage tool-id="qrCodeGenerator">
    <!-- 内容与设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>

      <label class="label-base" for="qr-text">{{ t('tools.qrCodeGenerator.content') }}</label>
      <textarea
        id="qr-text"
        v-model="text"
        rows="4"
        class="input-base w-full font-mono"
        :placeholder="t('tools.qrCodeGenerator.contentPlaceholder')"
        :aria-label="t('tools.qrCodeGenerator.content')"
      ></textarea>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <!-- 尺寸滑块 -->
        <div>
          <label class="label-base" for="qr-size">
            {{ t('tools.qrCodeGenerator.size') }}: {{ clampSize(config.size) }} px
          </label>
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0">
              <input
                id="qr-size"
                v-model.number="config.size"
                type="number"
                :min="SIZE_MIN"
                :max="SIZE_MAX"
                class="input-base text-center font-mono"
                :aria-label="t('tools.qrCodeGenerator.size')"
              />
            </div>
            <input
              v-model.number="config.size"
              type="range"
              :min="SIZE_MIN"
              :max="SIZE_MAX"
              :step="10"
              class="min-w-0 flex-1 accent-blue-600"
              :aria-label="t('tools.qrCodeGenerator.size')"
            />
          </div>
        </div>

        <!-- 纠错等级 -->
        <div>
          <label class="label-base" for="qr-ecc">{{ t('tools.qrCodeGenerator.ecc') }}</label>
          <select
            id="qr-ecc"
            v-model="config.ecc"
            class="input-base"
            :aria-label="t('tools.qrCodeGenerator.ecc')"
          >
            <option v-for="lv in ECC_LEVELS" :key="lv" :value="lv">
              {{ t(`tools.qrCodeGenerator.${ECC_LABELS[lv]}`) }}
            </option>
          </select>
        </div>
      </div>

      <!-- 颜色 -->
      <div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <div class="flex items-center gap-2">
          <label class="label-base mb-0" for="qr-fg">{{ t('tools.qrCodeGenerator.fgColor') }}</label>
          <input
            id="qr-fg"
            v-model="config.fg"
            type="color"
            class="h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
            :aria-label="t('tools.qrCodeGenerator.fgColor')"
          />
          <span class="font-mono text-xs text-slate-400">{{ config.fg }}</span>
        </div>
        <div class="flex items-center gap-2">
          <label class="label-base mb-0" for="qr-bg">{{ t('tools.qrCodeGenerator.bgColor') }}</label>
          <input
            id="qr-bg"
            v-model="config.bg"
            type="color"
            class="h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
            :aria-label="t('tools.qrCodeGenerator.bgColor')"
          />
          <span class="font-mono text-xs text-slate-400">{{ config.bg }}</span>
        </div>
      </div>
    </section>

    <!-- 预览与下载 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('toolsCommon.preview') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="!rendered"
            @click="downloadPng"
          >
            {{ t('tools.qrCodeGenerator.downloadPng') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="!hasText"
            @click="downloadSvg"
          >
            {{ t('tools.qrCodeGenerator.downloadSvg') }}
          </button>
        </div>
      </div>

      <div class="flex justify-center">
        <div class="max-w-full overflow-x-auto rounded-xl border border-slate-100 bg-white p-3">
          <canvas ref="canvasRef" v-show="hasText" class="block"></canvas>
          <div
            v-if="!hasText"
            class="flex h-[200px] w-[200px] items-center justify-center px-4 text-center text-sm text-slate-400"
          >
            {{ t('tools.qrCodeGenerator.emptyHint') }}
          </div>
        </div>
      </div>

      <p v-if="renderError" class="mt-3 text-center text-sm text-red-600">{{ renderError }}</p>
    </section>
  </ToolPage>
</template>
