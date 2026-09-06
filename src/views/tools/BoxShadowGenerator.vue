<script setup>
import { computed, onMounted } from 'vue'
import { clampNumber } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function defaultLayer() {
  return { x: 0, y: 8, blur: 16, spread: 0, color: '#1e293b', opacity: 0.25, inset: false }
}

/** 阴影层配置持久化（多层叠加） */
const config = useStorage('tool-box-shadow-generator-config', {
  layers: [defaultLayer()],
})


/** 挂载时修复历史脏数据，保证至少一层且各字段合法 */
onMounted(() => {
  try {
    if (!Array.isArray(config.value.layers)) config.value.layers = []
    config.value.layers = config.value.layers
      .filter(l => l && typeof l === 'object')
      .map(l => ({
        x: clampNumber(l.x, -50, 50, 0),
        y: clampNumber(l.y, -50, 50, 8),
        blur: clampNumber(l.blur, 0, 100, 16),
        spread: clampNumber(l.spread, -50, 50, 0),
        color: typeof l.color === 'string' && HEX_RE.test(l.color) ? l.color : '#1e293b',
        opacity: clampNumber(l.opacity, 0, 1, 0.25),
        inset: Boolean(l.inset),
      }))
    if (config.value.layers.length < 1) {
      config.value.layers = [defaultLayer()]
    }
  } catch {
    config.value.layers = [defaultLayer()]
  }
})

/** 单层阴影转 CSS 片段（rgba 颜色 + 可选 inset） */
function layerToCss(layer) {
  const hex = typeof layer.color === 'string' && HEX_RE.test(layer.color) ? layer.color : '#000000'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const opacity = clampNumber(layer.opacity, 0, 1, 0.25)
  const alpha = String(Math.round(opacity * 100) / 100)
  const parts = []
  if (layer.inset) parts.push('inset')
  parts.push(
    `${Math.round(clampNumber(layer.x, -50, 50, 0))}px`,
    `${Math.round(clampNumber(layer.y, -50, 50, 0))}px`,
    `${Math.round(clampNumber(layer.blur, 0, 100, 0))}px`,
    `${Math.round(clampNumber(layer.spread, -50, 50, 0))}px`,
    `rgba(${r}, ${g}, ${b}, ${alpha})`
  )
  return parts.join(' ')
}

const shadowValue = computed(() => config.value.layers.map(layerToCss).join(', '))
const cssCode = computed(() => `box-shadow: ${shadowValue.value};`)

function addLayer() {
  if (config.value.layers.length >= 8) {
    toast.info(t('tools.boxShadowGenerator.layerLimit'))
    return
  }
  config.value.layers.push({ x: 0, y: 12, blur: 24, spread: 0, color: '#3b82f6', opacity: 0.3, inset: false })
}

function removeLayer(index) {
  if (config.value.layers.length <= 1) return
  config.value.layers.splice(index, 1)
}

function resetAll() {
  config.value.layers = [defaultLayer()]
  toast.info(t('toolsCommon.done'))
}
</script>

<template>
  <ToolPage tool-id="boxShadowGenerator">
    <!-- 多层阴影配置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">
          {{ t('tools.boxShadowGenerator.layers') }}
          <span class="ml-1 text-xs font-normal text-slate-400">{{ config.layers.length }}</span>
        </h2>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-ghost" @click="resetAll">{{ t('toolsCommon.reset') }}</button>
          <button type="button" class="btn-primary" @click="addLayer">{{ t('tools.boxShadowGenerator.addLayer') }}</button>
        </div>
      </div>

      <div class="space-y-4">
        <div
          v-for="(layer, i) in config.layers"
          :key="`layer-${i}`"
          class="rounded-xl border border-slate-100 bg-white/70 p-3"
        >
          <!-- 层头部：名称 + inset 开关 + 删除 -->
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-semibold text-slate-700">
              {{ t('tools.boxShadowGenerator.layerName', { n: i + 1 }) }}
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn-ghost font-mono"
                :class="layer.inset ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
                :aria-pressed="layer.inset ? 'true' : 'false'"
                @click="layer.inset = !layer.inset"
              >
                {{ t('tools.boxShadowGenerator.inset') }}
              </button>
              <button
                type="button"
                class="btn-danger"
                :disabled="config.layers.length <= 1"
                :aria-label="t('tools.boxShadowGenerator.removeLayer')"
                @click="removeLayer(i)"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- 四个偏移/模糊/扩散滑块 -->
          <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <label class="label-base mb-1" :for="`bs-x-${i}`">
                {{ t('tools.boxShadowGenerator.offsetX') }}: {{ Math.round(layer.x) }}px
              </label>
              <input
                :id="`bs-x-${i}`"
                v-model.number="layer.x"
                type="range"
                min="-50"
                max="50"
                class="w-full accent-blue-600"
                :aria-label="t('tools.boxShadowGenerator.offsetX')"
              />
            </div>
            <div>
              <label class="label-base mb-1" :for="`bs-y-${i}`">
                {{ t('tools.boxShadowGenerator.offsetY') }}: {{ Math.round(layer.y) }}px
              </label>
              <input
                :id="`bs-y-${i}`"
                v-model.number="layer.y"
                type="range"
                min="-50"
                max="50"
                class="w-full accent-blue-600"
                :aria-label="t('tools.boxShadowGenerator.offsetY')"
              />
            </div>
            <div>
              <label class="label-base mb-1" :for="`bs-blur-${i}`">
                {{ t('tools.boxShadowGenerator.blur') }}: {{ Math.round(layer.blur) }}px
              </label>
              <input
                :id="`bs-blur-${i}`"
                v-model.number="layer.blur"
                type="range"
                min="0"
                max="100"
                class="w-full accent-blue-600"
                :aria-label="t('tools.boxShadowGenerator.blur')"
              />
            </div>
            <div>
              <label class="label-base mb-1" :for="`bs-spread-${i}`">
                {{ t('tools.boxShadowGenerator.spread') }}: {{ Math.round(layer.spread) }}px
              </label>
              <input
                :id="`bs-spread-${i}`"
                v-model.number="layer.spread"
                type="range"
                min="-50"
                max="50"
                class="w-full accent-blue-600"
                :aria-label="t('tools.boxShadowGenerator.spread')"
              />
            </div>
          </div>

          <!-- 颜色与透明度 -->
          <div class="mt-3 flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <input
                v-model="layer.color"
                type="color"
                class="h-10 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                :aria-label="t('tools.boxShadowGenerator.color')"
              />
              <span class="font-mono text-xs text-slate-500">{{ layer.color }}</span>
            </div>
            <div class="flex min-w-40 flex-1 items-center gap-3">
              <label class="shrink-0 text-sm text-slate-500" :for="`bs-opacity-${i}`">
                {{ t('tools.boxShadowGenerator.opacity') }}
              </label>
              <input
                :id="`bs-opacity-${i}`"
                v-model.number="layer.opacity"
                type="range"
                min="0"
                max="1"
                step="0.05"
                class="min-w-0 flex-1 accent-blue-600"
                :aria-label="t('tools.boxShadowGenerator.opacity')"
              />
              <span class="w-10 shrink-0 text-right font-mono text-sm text-slate-600">
                {{ Math.round(clampNumber(layer.opacity, 0, 1, 0.25) * 100) / 100 }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 预览与代码 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.preview') }}</h2>
      <div class="checker-bg flex min-h-48 items-center justify-center rounded-xl border border-slate-200 p-8 sm:min-h-64">
        <div
          class="h-28 w-28 rounded-xl bg-white sm:h-32 sm:w-32"
          :style="{ boxShadow: shadowValue }"
        ></div>
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.boxShadowGenerator.cssCode') }}</h2>
        <CopyButton :text="cssCode" :label="t('toolsCommon.copy')" />
      </div>
      <pre class="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700"><code>{{ cssCode }}</code></pre>
    </section>
  </ToolPage>
</template>

<style scoped>
/* 浅灰格子纹理背景，便于观察阴影效果 */
.checker-bg {
  background-color: #f8fafc;
  background-image:
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
    linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
}
</style>
