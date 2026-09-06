<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadCanvasAsPng, downloadText } from '@/utils/download'

/**
 * 条形码生成器：基于 JsBarcode（懒加载）
 * 支持 CODE128 / EAN-13 / EAN-8 / UPC / CODE39 / ITF-14，
 * 数字类格式自动补全校验位并校验，支持 PNG / SVG 下载，格式与外观选项本地持久化
 */

const STORAGE_KEY = 'tool-barcode-generator-config'

/** 格式定义：dataLen 为校验位前的数据位数，totalLen 为含校验位总位数 */
const FORMATS = [
  { value: 'CODE128', example: 'ToolboxLab-2026' },
  { value: 'EAN13', dataLen: 12, totalLen: 13, example: '590123412345' },
  { value: 'EAN8', dataLen: 7, totalLen: 8, example: '9638507' },
  { value: 'UPC', dataLen: 11, totalLen: 12, example: '03600029145' },
  { value: 'CODE39', example: 'TOOLBOX 2026' },
  { value: 'ITF14', dataLen: 13, totalLen: 14, example: '1234567890123' },
]

const CHECK_FORMAT_KEYS = {
  EAN13: { length: 'errEan13Length', check: 'errEan13Check' },
  EAN8: { length: 'errEan8Length', check: 'errEan8Check' },
  UPC: { length: 'errUpcLength', check: 'errUpcCheck' },
  ITF14: { length: 'errItf14Length', check: 'errItf14Check' },
}

const DEFAULTS = {
  format: 'CODE128',
  text: 'ToolboxLab-2026',
  width: 2,
  height: 80,
  lineColor: '#111827',
  displayValue: true,
  fontSize: 20,
  margin: 10,
}

const { t } = useI18n()
const toast = useToast()

const saved = useStorage(STORAGE_KEY, { ...DEFAULTS })

const format = ref(FORMATS.some(f => f.value === saved.value.format) ? saved.value.format : DEFAULTS.format)
const text = ref(typeof saved.value.text === 'string' ? saved.value.text : DEFAULTS.text)
const width = ref(Number(saved.value.width) || DEFAULTS.width)
const height = ref(clamp(Number(saved.value.height) || DEFAULTS.height, 30, 150))
const lineColor = ref(/^#[0-9a-fA-F]{6}$/.test(String(saved.value.lineColor)) ? saved.value.lineColor : DEFAULTS.lineColor)
const displayValue = ref(typeof saved.value.displayValue === 'boolean' ? saved.value.displayValue : DEFAULTS.displayValue)
const fontSize = ref(clamp(Number(saved.value.fontSize) || DEFAULTS.fontSize, 8, 32))
const margin = ref(clamp(Number(saved.value.margin) || DEFAULTS.margin, 0, 40))

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

watch([format, text, width, height, lineColor, displayValue, fontSize, margin], () => {
  saved.value = {
    format: format.value,
    text: text.value,
    width: width.value,
    height: height.value,
    lineColor: lineColor.value,
    displayValue: displayValue.value,
    fontSize: fontSize.value,
    margin: margin.value,
  }
})

const currentSpec = computed(() => FORMATS.find(f => f.value === format.value) || FORMATS[0])

/** 标准 EAN / UPC / ITF 模 10 校验位：自右起交替乘 3 和 1 */
function computeCheckDigit(data) {
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const digit = Number(data[data.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return String((10 - (sum % 10)) % 10)
}

/**
 * 校验输入，返回 { ok, value, error, auto }
 * error 为 { key, params }，auto 为自动补上的校验位（或 null）
 */
function validate(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, value: '', error: { key: 'tools.barcodeGenerator.errEmpty' }, auto: null }

  const spec = currentSpec.value
  if (spec.dataLen) {
    const keys = CHECK_FORMAT_KEYS[spec.value]
    if (!/^\d+$/.test(value)) return { ok: false, value: '', error: { key: 'tools.barcodeGenerator.errDigitsOnly' }, auto: null }
    if (value.length === spec.totalLen) {
      const expected = computeCheckDigit(value.slice(0, -1))
      if (value.slice(-1) === expected) return { ok: true, value, error: null, auto: null }
      return {
        ok: false,
        value: '',
        error: { key: `tools.barcodeGenerator.${keys.check}`, params: { got: value.slice(-1), check: expected } },
        auto: null,
      }
    }
    if (value.length === spec.dataLen) {
      const check = computeCheckDigit(value)
      return { ok: true, value: value + check, error: null, auto: check }
    }
    return { ok: false, value: '', error: { key: `tools.barcodeGenerator.${keys.length}` }, auto: null }
  }

  if (spec.value === 'CODE39') {
    if (/^[0-9A-Z\-. $/+%]+$/.test(value)) return { ok: true, value, error: null, auto: null }
    return { ok: false, value: '', error: { key: 'tools.barcodeGenerator.errCode39' }, auto: null }
  }

  // CODE128：支持常见半角 ASCII 可打印字符
  if (/^[\x20-\x7E]+$/.test(value)) return { ok: true, value, error: null, auto: null }
  return { ok: false, value: '', error: { key: 'tools.barcodeGenerator.errCode128' }, auto: null }
}

const canvasRef = ref(null)
const errorMsg = ref('')
const autoCheck = ref('')
const validValue = ref('')
const canDownload = computed(() => validValue.value !== '')

let jsbarcodeLib = null
let renderToken = 0

function barcodeOptions() {
  return {
    format: format.value,
    width: width.value,
    height: height.value,
    lineColor: lineColor.value,
    displayValue: displayValue.value,
    fontSize: fontSize.value,
    margin: margin.value,
    background: '#ffffff',
  }
}

async function render() {
  const token = ++renderToken
  const canvas = canvasRef.value
  if (!canvas) return

  const result = validate(text.value)
  errorMsg.value = result.error ? t(result.error.key, result.error.params || {}) : ''
  autoCheck.value = result.auto ? t('tools.barcodeGenerator.autoCheck', { check: result.auto }) : ''

  if (!result.ok) {
    validValue.value = ''
    return
  }

  try {
    if (!jsbarcodeLib) {
      const mod = await import('jsbarcode')
      jsbarcodeLib = mod.default
    }
    if (token !== renderToken) return
    jsbarcodeLib(canvas, result.value, barcodeOptions())
    validValue.value = result.value
  } catch {
    if (token !== renderToken) return
    validValue.value = ''
    errorMsg.value = t('toolsCommon.error')
  }
}

watch([text, format, width, height, lineColor, displayValue, fontSize, margin], render)
onMounted(render)

function fillExample() {
  text.value = currentSpec.value.example
}

function downloadPng() {
  if (!canDownload.value || !canvasRef.value) return
  try {
    downloadCanvasAsPng(canvasRef.value, `barcode-${format.value}.png`)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function downloadSvg() {
  if (!canDownload.value) return
  try {
    if (!jsbarcodeLib) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    jsbarcodeLib(svg, validValue.value, barcodeOptions())
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML
    downloadText(source, `barcode-${format.value}.svg`, 'image/svg+xml;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="barcodeGenerator">
    <!-- 输入与格式 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="label-base" for="barcode-text">{{ t('tools.barcodeGenerator.textLabel') }}</label>
          <div class="flex gap-2">
            <input
              id="barcode-text"
              v-model="text"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.barcodeGenerator.textPlaceholder')"
              autocomplete="off"
            />
            <button type="button" class="btn-ghost shrink-0" :title="t('tools.barcodeGenerator.exampleBtn')" @click="fillExample">
              {{ t('tools.barcodeGenerator.exampleBtn') }}
            </button>
          </div>
          <p v-if="errorMsg" class="mt-1.5 text-xs text-red-600">{{ errorMsg }}</p>
          <p v-else-if="autoCheck" class="mt-1.5 text-xs text-emerald-600">{{ autoCheck }}</p>
        </div>
        <div>
          <label class="label-base" for="barcode-format">{{ t('tools.barcodeGenerator.formatLabel') }}</label>
          <select id="barcode-format" v-model="format" class="input-base">
            <option v-for="f in FORMATS" :key="f.value" :value="f.value">{{ f.value }}</option>
          </select>
          <p class="mt-1.5 text-xs text-slate-400">{{ t(`tools.barcodeGenerator.formatHints.${format}`) }}</p>
        </div>
      </div>
    </section>

    <!-- 外观选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.options') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <label class="label-base" for="barcode-width">
            {{ t('tools.barcodeGenerator.width') }}
            <span class="font-mono text-slate-400">{{ width }} px</span>
          </label>
          <input id="barcode-width" v-model.number="width" type="range" min="1" max="4" step="1" class="w-full accent-blue-600" />
        </div>
        <div>
          <label class="label-base" for="barcode-height">
            {{ t('tools.barcodeGenerator.height') }}
            <span class="font-mono text-slate-400">{{ height }} px</span>
          </label>
          <input id="barcode-height" v-model.number="height" type="range" min="30" max="150" step="5" class="w-full accent-blue-600" />
        </div>
        <div>
          <label class="label-base" for="barcode-color">{{ t('tools.barcodeGenerator.lineColor') }}</label>
          <input id="barcode-color" v-model="lineColor" type="color" class="input-base !p-1 h-10 w-20 cursor-pointer" />
        </div>
        <div>
          <label class="label-base" for="barcode-margin">
            {{ t('tools.barcodeGenerator.margin') }}
            <span class="font-mono text-slate-400">{{ margin }} px</span>
          </label>
          <input id="barcode-margin" v-model.number="margin" type="range" min="0" max="40" step="2" class="w-full accent-blue-600" />
        </div>
        <div class="flex items-center gap-4 flex-wrap">
          <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input v-model="displayValue" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.barcodeGenerator.displayValue') }}
          </label>
        </div>
        <div v-if="displayValue">
          <label class="label-base" for="barcode-fontsize">
            {{ t('tools.barcodeGenerator.fontSize') }}
            <span class="font-mono text-slate-400">{{ fontSize }} px</span>
          </label>
          <input id="barcode-fontsize" v-model.number="fontSize" type="range" min="8" max="32" step="1" class="w-full accent-blue-600" />
        </div>
      </div>
    </section>

    <!-- 预览与下载 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.preview') }}</h2>
      <div class="rounded-xl border border-slate-100 bg-white p-4 overflow-x-auto flex justify-center min-h-[120px] items-center">
        <canvas v-show="!errorMsg" ref="canvasRef" class="max-w-full"></canvas>
        <p v-if="errorMsg" class="text-sm text-slate-400 text-center py-6">{{ t('tools.barcodeGenerator.previewUnavailable') }}</p>
      </div>
      <div class="mt-4 flex items-center gap-2 flex-wrap">
        <button type="button" class="btn-primary" :disabled="!canDownload" @click="downloadPng">
          {{ t('tools.barcodeGenerator.downloadPng') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="!canDownload" @click="downloadSvg">
          {{ t('tools.barcodeGenerator.downloadSvg') }}
        </button>
        <CopyButton :text="validValue" :label="t('toolsCommon.copy')" :disabled="!canDownload" />
      </div>
    </section>
  </ToolPage>
</template>
