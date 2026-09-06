<script setup>
import { ref, computed, onMounted } from 'vue'
import { clampNumber } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

const DEFAULT_STOPS = [
  { color: '#3b82f6', position: 0 },
  { color: '#a855f7', position: 100 },
]

/** 类型 / 角度 / 色标 持久化 */
const config = useStorage('tool-gradient-generator-config', {
  type: 'linear',
  angle: 90,
  stops: DEFAULT_STOPS.map(s => ({ ...s })),
})

const TYPES = [
  { value: 'linear', labelKey: 'typeLinear', hintKey: 'linearHint' },
  { value: 'radial', labelKey: 'typeRadial', hintKey: 'radialHint' },
  { value: 'conic', labelKey: 'typeConic', hintKey: 'conicHint' },
]

const DIRECTIONS = [
  { angle: 0, arrow: '↑', labelKey: 'dirTop' },
  { angle: 45, arrow: '↗', labelKey: 'dirTopRight' },
  { angle: 90, arrow: '→', labelKey: 'dirRight' },
  { angle: 135, arrow: '↘', labelKey: 'dirBottomRight' },
  { angle: 180, arrow: '↓', labelKey: 'dirBottom' },
  { angle: 225, arrow: '↙', labelKey: 'dirBottomLeft' },
  { angle: 270, arrow: '←', labelKey: 'dirLeft' },
  { angle: 315, arrow: '↖', labelKey: 'dirTopLeft' },
]


const activeType = computed(() => TYPES.find(tp => tp.value === config.value.type) || TYPES[0])
const isLinear = computed(() => config.value.type === 'linear')

/** 挂载时修复历史脏数据（非法色标、数量不足等），保证始终 ≥2 个合法色标 */
onMounted(() => {
  try {
    if (!TYPES.some(tp => tp.value === config.value.type)) config.value.type = 'linear'
    config.value.angle = clampNumber(config.value.angle, 0, 360, 90)
    if (!Array.isArray(config.value.stops)) config.value.stops = []
    config.value.stops = config.value.stops
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#3b82f6',
        position: clampNumber(s.position, 0, 100, 0),
      }))
    if (config.value.stops.length < 2) {
      config.value.stops = DEFAULT_STOPS.map(s => ({ ...s }))
    }
  } catch {
    config.value.type = 'linear'
    config.value.angle = 90
    config.value.stops = DEFAULT_STOPS.map(s => ({ ...s }))
  }
})

/** 生成时按位置排序；列表展示保持操作顺序，避免拖动滑块时行跳动 */
const sortedStops = computed(() =>
  [...config.value.stops].sort((a, b) => clampNumber(a.position, 0, 100, 0) - clampNumber(b.position, 0, 100, 0))
)

/** 角度为 45 的倍数时输出 to top 等关键字形式 */
function angleKeyword(angle) {
  const a = ((Math.round(Number(angle) || 0) % 360) + 360) % 360
  const map = {
    0: 'to top',
    45: 'to top right',
    90: 'to right',
    135: 'to bottom right',
    180: 'to bottom',
    225: 'to bottom left',
    270: 'to left',
    315: 'to top left',
  }
  return map[a] || ''
}

const stopsText = computed(() =>
  sortedStops.value.map(s => `${s.color} ${Math.round(clampNumber(s.position, 0, 100, 0))}%`).join(', ')
)

const gradientValue = computed(() => {
  if (config.value.type === 'radial') return `radial-gradient(circle, ${stopsText.value})`
  if (config.value.type === 'conic') return `conic-gradient(${stopsText.value})`
  const keyword = angleKeyword(config.value.angle)
  const dir = keyword || `${Math.round(clampNumber(config.value.angle, 0, 360, 90))}deg`
  return `linear-gradient(${dir}, ${stopsText.value})`
})

const cssCode = computed(() => `background-image: ${gradientValue.value};`)

/* ================= 色标管理 ================= */

function addStop() {
  // 在最大间隔的中点插入新色标，位置更直观
  const positions = [0, ...sortedStops.value.map(s => clampNumber(s.position, 0, 100, 0)), 100]
  let bestPos = 50
  let maxGap = -1
  for (let i = 0; i < positions.length - 1; i++) {
    const gap = positions[i + 1] - positions[i]
    if (gap > maxGap) {
      maxGap = gap
      bestPos = Math.round((positions[i] + positions[i + 1]) / 2)
    }
  }
  config.value.stops.push({ color: '#f59e0b', position: bestPos })
}

function removeStop(index) {
  if (config.value.stops.length <= 2) return
  config.value.stops.splice(index, 1)
}

function resetAll() {
  config.value.type = 'linear'
  config.value.angle = 90
  config.value.stops = DEFAULT_STOPS.map(s => ({ ...s }))
  toast.info(t('toolsCommon.done'))
}
</script>

<template>
  <ToolPage tool-id="gradientGenerator">
    <!-- 类型与方向 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>

      <span class="label-base">{{ t('tools.gradientGenerator.type') }}</span>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('tools.gradientGenerator.type')">
        <button
          v-for="tp in TYPES"
          :key="tp.value"
          type="button"
          class="btn-ghost"
          :class="config.type === tp.value ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
          :aria-pressed="config.type === tp.value ? 'true' : 'false'"
          @click="config.type = tp.value"
        >
          {{ t(`tools.gradientGenerator.${tp.labelKey}`) }}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">{{ t(`tools.gradientGenerator.${activeType.hintKey}`) }}</p>

      <!-- 角度与方向预设：仅线性渐变有效 -->
      <template v-if="isLinear">
        <div class="mt-4">
          <label class="label-base" for="gg-angle">
            {{ t('tools.gradientGenerator.angle') }}: {{ t('tools.gradientGenerator.angleDegree', { n: Math.round(config.angle) }) }}
          </label>
          <div class="flex items-center gap-3">
            <input
              id="gg-angle"
              v-model.number="config.angle"
              type="range"
              min="0"
              max="360"
              class="min-w-0 flex-1 accent-blue-600"
              :aria-label="t('tools.gradientGenerator.angle')"
            />
            <span class="w-14 shrink-0 text-right font-mono text-sm text-slate-600">{{ Math.round(config.angle) }}deg</span>
          </div>
        </div>

        <div class="mt-4">
          <span class="label-base">{{ t('tools.gradientGenerator.direction') }}</span>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
            <button
              v-for="d in DIRECTIONS"
              :key="d.angle"
              type="button"
              class="btn-ghost flex-col !px-1 !py-2"
              :class="Math.round(config.angle) === d.angle ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
              :aria-pressed="Math.round(config.angle) === d.angle ? 'true' : 'false'"
              :aria-label="t(`tools.gradientGenerator.${d.labelKey}`)"
              @click="config.angle = d.angle"
            >
              <span class="text-base leading-none">{{ d.arrow }}</span>
              <span class="mt-1 text-[11px] leading-none">{{ t(`tools.gradientGenerator.${d.labelKey}`) }}</span>
            </button>
          </div>
        </div>
      </template>
    </section>

    <!-- 色标管理 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">
          {{ t('tools.gradientGenerator.stops') }}
          <span class="ml-1 text-xs font-normal text-slate-400">
            {{ t('tools.gradientGenerator.stopsCount', { n: config.stops.length }) }}
          </span>
        </h2>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-ghost" @click="resetAll">{{ t('toolsCommon.reset') }}</button>
          <button type="button" class="btn-primary" @click="addStop">{{ t('tools.gradientGenerator.addStop') }}</button>
        </div>
      </div>

      <div class="space-y-3">
        <div
          v-for="(stop, i) in config.stops"
          :key="`stop-${i}`"
          class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white/70 p-3"
        >
          <input
            v-model="stop.color"
            type="color"
            class="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
            :aria-label="`${t('tools.gradientGenerator.stops')} ${i + 1}`"
          />
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <input
              v-model.number="stop.position"
              type="range"
              min="0"
              max="100"
              class="min-w-0 flex-1 accent-blue-600"
              :aria-label="`${t('tools.gradientGenerator.stopPosition')} ${i + 1}`"
            />
            <span class="w-12 shrink-0 text-right font-mono text-sm text-slate-600">{{ Math.round(stop.position) }}%</span>
          </div>
          <button
            type="button"
            class="btn-danger shrink-0"
            :disabled="config.stops.length <= 2"
            :aria-label="t('tools.gradientGenerator.removeStop')"
            :title="config.stops.length <= 2 ? t('tools.gradientGenerator.minStopsHint') : t('tools.gradientGenerator.removeStop')"
            @click="removeStop(i)"
          >
            ✕
          </button>
        </div>
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.gradientGenerator.minStopsHint') }}</p>
    </section>

    <!-- 预览与代码 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.preview') }}</h2>
      <div
        class="h-48 rounded-xl border border-slate-200 sm:h-64"
        :style="{ backgroundImage: gradientValue }"
        role="img"
        :aria-label="t('toolsCommon.preview')"
      ></div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.gradientGenerator.cssCode') }}</h2>
        <CopyButton :text="cssCode" :label="t('toolsCommon.copy')" />
      </div>
      <pre class="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700"><code>{{ cssCode }}</code></pre>
    </section>
  </ToolPage>
</template>
