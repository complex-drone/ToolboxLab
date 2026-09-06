<script setup>
import { ref, computed, watch } from 'vue'
import { clampNumber } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/** 当前颜色（RGB 通道，0-255 整数），持久化保存 */
const config = useStorage('tool-color-converter-config', {
  r: 59,
  g: 130,
  b: 246,
})

/* ================= 纯函数：各格式双向换算 ================= */


function clampChannel(value) {
  return Math.round(clampNumber(value, 0, 255, 0))
}

/** 解析 3 位或 6 位 HEX（可含 # 前缀），非法返回 null */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  let s = hex.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  const two = v => clampChannel(v).toString(16).padStart(2, '0')
  return `#${two(r)}${two(g)}${two(b)}`.toUpperCase()
}

function rgbToHsl(r, g, b) {
  const rn = clampChannel(r) / 255
  const gn = clampChannel(g) / 255
  const bn = clampChannel(b) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) {
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
    } else if (max === gn) {
      h = (bn - rn) / d + 2
    } else {
      h = (rn - gn) / d + 4
    }
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb(h, s, l) {
  const hn = clampNumber(h, 0, 360, 0) / 360
  const sn = clampNumber(s, 0, 100, 0) / 100
  const ln = clampNumber(l, 0, 100, 0) / 100
  if (sn === 0) {
    const v = Math.round(ln * 255)
    return { r: v, g: v, b: v }
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const hue2rgb = v => {
    let x = v
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  }
}

function rgbToCmyk(r, g, b) {
  const rn = clampChannel(r) / 255
  const gn = clampChannel(g) / 255
  const bn = clampChannel(b) / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}

function cmykToRgb(c, m, y, k) {
  const cn = clampNumber(c, 0, 100, 0) / 100
  const mn = clampNumber(m, 0, 100, 0) / 100
  const yn = clampNumber(y, 0, 100, 0) / 100
  const kn = clampNumber(k, 0, 100, 0) / 100
  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
  }
}

/* ================= WCAG 相对亮度与对比度 ================= */

function channelLuminance(v) {
  const c = clampChannel(v) / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(r, g, b) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastWith(r, g, b, wr, wg, wb) {
  const l1 = relativeLuminance(r, g, b)
  const l2 = relativeLuminance(wr, wg, wb)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/* ================= 状态与双向同步 ================= */

/** 无效通道时保持原值，避免输入框清空导致跳变 */
function applyRgb(next) {
  const nr = Number(next.r)
  const ng = Number(next.g)
  const nb = Number(next.b)
  if (Number.isFinite(nr)) config.value.r = Math.min(255, Math.max(0, Math.round(nr)))
  if (Number.isFinite(ng)) config.value.g = Math.min(255, Math.max(0, Math.round(ng)))
  if (Number.isFinite(nb)) config.value.b = Math.min(255, Math.max(0, Math.round(nb)))
}

function numOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const hexValue = computed(() => rgbToHex(config.value.r, config.value.g, config.value.b))
const rgbValue = computed(() => `rgb(${config.value.r}, ${config.value.g}, ${config.value.b})`)
const hsl = computed(() => rgbToHsl(config.value.r, config.value.g, config.value.b))
const hslValue = computed(() => `hsl(${hsl.value.h}, ${hsl.value.s}%, ${hsl.value.l}%)`)
const cmyk = computed(() => rgbToCmyk(config.value.r, config.value.g, config.value.b))
const cmykValue = computed(() => `cmyk(${cmyk.value.c}%, ${cmyk.value.m}%, ${cmyk.value.y}%, ${cmyk.value.k}%)`)

/** HEX 文本框：非法输入行内报错，不覆盖正在输入的内容 */
const hexInput = ref('#3B82F6')
const hexError = ref(false)
const hexField = ref(null)

watch(
  hexValue,
  v => {
    if (document.activeElement !== hexField.value) {
      hexInput.value = v
      hexError.value = false
    }
  },
  { immediate: true }
)

function onHexInput() {
  try {
    const rgb = hexToRgb(hexInput.value)
    if (rgb) {
      hexError.value = false
      applyRgb(rgb)
    } else {
      hexError.value = hexInput.value.trim() !== ''
    }
  } catch {
    hexError.value = true
  }
}

function onHexBlur() {
  hexInput.value = hexValue.value
  hexError.value = false
}

/** RGB 三个数字输入 */
const rModel = computed({
  get: () => config.value.r,
  set: v => applyRgb({ r: v, g: config.value.g, b: config.value.b }),
})
const gModel = computed({
  get: () => config.value.g,
  set: v => applyRgb({ r: config.value.r, g: v, b: config.value.b }),
})
const bModel = computed({
  get: () => config.value.b,
  set: v => applyRgb({ r: config.value.r, g: config.value.g, b: v }),
})

/** HSL 三个数字输入 */
function applyHsl(next) {
  const h = numOr(next.h, hsl.value.h)
  const s = numOr(next.s, hsl.value.s)
  const l = numOr(next.l, hsl.value.l)
  applyRgb(hslToRgb(h, s, l))
}
const hModel = computed({
  get: () => hsl.value.h,
  set: v => applyHsl({ h: v }),
})
const sModel = computed({
  get: () => hsl.value.s,
  set: v => applyHsl({ s: v }),
})
const lModel = computed({
  get: () => hsl.value.l,
  set: v => applyHsl({ l: v }),
})

/** CMYK 四个数字输入 */
function applyCmyk(next) {
  const c = numOr(next.c, cmyk.value.c)
  const m = numOr(next.m, cmyk.value.m)
  const y = numOr(next.y, cmyk.value.y)
  const k = numOr(next.k, cmyk.value.k)
  applyRgb(cmykToRgb(c, m, y, k))
}
const cModel = computed({
  get: () => cmyk.value.c,
  set: v => applyCmyk({ c: v }),
})
const mModel = computed({
  get: () => cmyk.value.m,
  set: v => applyCmyk({ m: v }),
})
const yModel = computed({
  get: () => cmyk.value.y,
  set: v => applyCmyk({ y: v }),
})
const kModel = computed({
  get: () => cmyk.value.k,
  set: v => applyCmyk({ k: v }),
})

/** 系统取色器（input type=color）+ EyeDropper 屏幕取色（特性检测） */
const supportsEyeDropper = typeof window !== 'undefined' && typeof window.EyeDropper === 'function'

function onColorPicker(event) {
  try {
    const rgb = hexToRgb(event.target.value)
    if (rgb) applyRgb(rgb)
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

async function pickFromScreen() {
  try {
    const picker = new window.EyeDropper()
    const result = await picker.open()
    const rgb = hexToRgb(result && result.sRGBHex)
    if (rgb) {
      applyRgb(rgb)
      toast.success(t('tools.colorConverter.screenPickSuccess', { hex: rgbToHex(rgb.r, rgb.g, rgb.b) }))
    } else {
      toast.error(t('toolsCommon.invalidInput'))
    }
  } catch (err) {
    // 用户按 Esc 取消选色时静默，其余情况提示错误
    if (!(err && err.name === 'AbortError')) {
      toast.error(t('toolsCommon.error'))
    }
  }
}

/* ================= WCAG 对比度 ================= */

const contrastWhite = computed(() => contrastWith(config.value.r, config.value.g, config.value.b, 255, 255, 255))
const contrastBlack = computed(() => contrastWith(config.value.r, config.value.g, config.value.b, 0, 0, 0))
const ratioWhite = computed(() => `${contrastWhite.value.toFixed(2)} : 1`)
const ratioBlack = computed(() => `${contrastBlack.value.toFixed(2)} : 1`)
const whiteAA = computed(() => contrastWhite.value >= 4.5)
const whiteAAA = computed(() => contrastWhite.value >= 7)
const blackAA = computed(() => contrastBlack.value >= 4.5)
const blackAAA = computed(() => contrastBlack.value >= 7)
/** 当前颜色作为背景时，对比度更高的一方即为建议文字颜色 */
const suggestWhite = computed(() => contrastWhite.value >= contrastBlack.value)
</script>

<template>
  <ToolPage tool-id="colorConverter">
    <!-- 各格式输入，双向同步 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.colorConverter.formatInput') }}</h2>

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- HEX -->
        <div class="rounded-xl border border-slate-100 bg-white/60 p-3">
          <label class="label-base" for="cc-hex">{{ t('tools.colorConverter.hex') }}</label>
          <input
            id="cc-hex"
            ref="hexField"
            v-model="hexInput"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.colorConverter.hexPlaceholder')"
            :aria-label="t('tools.colorConverter.hex')"
            spellcheck="false"
            @input="onHexInput"
            @blur="onHexBlur"
          />
          <p v-if="hexError" class="mt-1.5 text-xs text-red-600" role="alert">
            {{ t('tools.colorConverter.invalidHex') }}
          </p>
          <div class="mt-3 flex items-center gap-2">
            <input
              type="color"
              :value="hexValue"
              class="h-10 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
              :aria-label="t('tools.colorConverter.pickColor')"
              :title="t('tools.colorConverter.pickColor')"
              @input="onColorPicker"
            />
            <button
              v-if="supportsEyeDropper"
              type="button"
              class="btn-ghost"
              @click="pickFromScreen"
            >
              {{ t('tools.colorConverter.screenPick') }}
            </button>
          </div>
        </div>

        <!-- RGB -->
        <div class="rounded-xl border border-slate-100 bg-white/60 p-3">
          <span class="label-base">{{ t('tools.colorConverter.rgb') }}</span>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-r">{{ t('tools.colorConverter.chR') }}</label>
              <input id="cc-r" v-model.number="rModel" type="number" min="0" max="255" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chR')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-g">{{ t('tools.colorConverter.chG') }}</label>
              <input id="cc-g" v-model.number="gModel" type="number" min="0" max="255" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chG')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-b">{{ t('tools.colorConverter.chB') }}</label>
              <input id="cc-b" v-model.number="bModel" type="number" min="0" max="255" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chB')" />
            </div>
          </div>
        </div>

        <!-- HSL -->
        <div class="rounded-xl border border-slate-100 bg-white/60 p-3">
          <span class="label-base">{{ t('tools.colorConverter.hsl') }}</span>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-h">{{ t('tools.colorConverter.chH') }}</label>
              <input id="cc-h" v-model.number="hModel" type="number" min="0" max="360" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chH')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-s">{{ t('tools.colorConverter.chS') }}</label>
              <input id="cc-s" v-model.number="sModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chS')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-l">{{ t('tools.colorConverter.chL') }}</label>
              <input id="cc-l" v-model.number="lModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chL')" />
            </div>
          </div>
        </div>

        <!-- CMYK -->
        <div class="rounded-xl border border-slate-100 bg-white/60 p-3">
          <span class="label-base">{{ t('tools.colorConverter.cmyk') }}</span>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-c">{{ t('tools.colorConverter.chC') }}</label>
              <input id="cc-c" v-model.number="cModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chC')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-m">{{ t('tools.colorConverter.chM') }}</label>
              <input id="cc-m" v-model.number="mModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chM')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-y">{{ t('tools.colorConverter.chY') }}</label>
              <input id="cc-y" v-model.number="yModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chY')" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="cc-k">{{ t('tools.colorConverter.chK') }}</label>
              <input id="cc-k" v-model.number="kModel" type="number" min="0" max="100" class="input-base text-center font-mono" :aria-label="t('tools.colorConverter.chK')" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.preview') }}</h2>
      <div class="flex flex-col gap-4 sm:flex-row">
        <div
          class="h-36 shrink-0 rounded-xl border border-slate-200 sm:h-auto sm:w-56"
          :style="{ backgroundColor: hexValue }"
          role="img"
          :aria-label="t('tools.colorConverter.previewColor')"
        ></div>
        <div class="min-w-0 flex-1 space-y-2">
          <div v-for="row in [
              { label: t('tools.colorConverter.hex'), value: hexValue },
              { label: t('tools.colorConverter.rgb'), value: rgbValue },
              { label: t('tools.colorConverter.hsl'), value: hslValue },
              { label: t('tools.colorConverter.cmyk'), value: cmykValue },
            ]"
            :key="row.label"
            class="flex items-center gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
          >
            <span class="chip shrink-0">{{ row.label }}</span>
            <code class="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">{{ row.value }}</code>
            <CopyButton :text="row.value" compact :label="t('toolsCommon.copy')" />
          </div>
        </div>
      </div>
    </section>

    <!-- WCAG 对比度 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.colorConverter.contrastTitle') }}</h2>

      <div class="grid gap-3 sm:grid-cols-2">
        <!-- 白底 -->
        <div
          class="rounded-xl border p-3"
          :class="whiteAA ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white/70'"
        >
          <p class="mb-2 text-xs font-medium text-slate-500">{{ t('tools.colorConverter.onWhite') }}</p>
          <div class="rounded-lg p-3 text-center text-xl font-bold" :style="{ backgroundColor: '#ffffff', color: hexValue }">
            {{ t('tools.colorConverter.sampleText') }}
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-slate-400">{{ t('tools.colorConverter.ratioLabel') }}</span>
            <span class="font-mono text-sm text-slate-700">{{ ratioWhite }}</span>
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
              :class="whiteAA ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-400'"
            >
              {{ t('tools.colorConverter.aaBadge') }} · {{ whiteAA ? t('tools.colorConverter.pass') : t('tools.colorConverter.fail') }}
            </span>
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
              :class="whiteAAA ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-400'"
            >
              {{ t('tools.colorConverter.aaaBadge') }} · {{ whiteAAA ? t('tools.colorConverter.pass') : t('tools.colorConverter.fail') }}
            </span>
          </div>
        </div>

        <!-- 黑底 -->
        <div
          class="rounded-xl border p-3"
          :class="blackAA ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white/70'"
        >
          <p class="mb-2 text-xs font-medium text-slate-500">{{ t('tools.colorConverter.onBlack') }}</p>
          <div class="rounded-lg p-3 text-center text-xl font-bold" :style="{ backgroundColor: '#000000', color: hexValue }">
            {{ t('tools.colorConverter.sampleText') }}
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-slate-400">{{ t('tools.colorConverter.ratioLabel') }}</span>
            <span class="font-mono text-sm text-slate-700">{{ ratioBlack }}</span>
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
              :class="blackAA ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-400'"
            >
              {{ t('tools.colorConverter.aaBadge') }} · {{ blackAA ? t('tools.colorConverter.pass') : t('tools.colorConverter.fail') }}
            </span>
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
              :class="blackAAA ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-400'"
            >
              {{ t('tools.colorConverter.aaaBadge') }} · {{ blackAAA ? t('tools.colorConverter.pass') : t('tools.colorConverter.fail') }}
            </span>
          </div>
        </div>
      </div>

      <p class="mt-2 text-xs text-slate-400">{{ t('tools.colorConverter.aaHint') }}</p>

      <!-- 建议文字颜色 -->
      <div class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white/70 p-3">
        <span class="text-sm text-slate-600">{{ t('tools.colorConverter.suggestedText') }}</span>
        <span
          class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold"
          :style="suggestWhite ? { backgroundColor: hexValue, color: '#ffffff' } : { backgroundColor: hexValue, color: '#0f172a' }"
        >
          {{ suggestWhite ? t('tools.colorConverter.whiteText') : t('tools.colorConverter.blackText') }}
        </span>
      </div>
    </section>
  </ToolPage>
</template>
