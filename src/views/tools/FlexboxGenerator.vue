<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { clampInt } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

const ITEM_COUNT_MIN = 2
const ITEM_COUNT_MAX = 6

const DIRECTIONS = [
  { value: 'row', labelKey: 'dirRow' },
  { value: 'row-reverse', labelKey: 'dirRowReverse' },
  { value: 'column', labelKey: 'dirColumn' },
  { value: 'column-reverse', labelKey: 'dirColumnReverse' },
]
const JUSTIFY_OPTIONS = [
  { value: 'flex-start', labelKey: 'justifyStart' },
  { value: 'center', labelKey: 'justifyCenter' },
  { value: 'flex-end', labelKey: 'justifyEnd' },
  { value: 'space-between', labelKey: 'justifyBetween' },
  { value: 'space-around', labelKey: 'justifyAround' },
  { value: 'space-evenly', labelKey: 'justifyEvenly' },
]
const ALIGN_OPTIONS = [
  { value: 'stretch', labelKey: 'alignStretch' },
  { value: 'flex-start', labelKey: 'alignStart' },
  { value: 'center', labelKey: 'alignCenter' },
  { value: 'flex-end', labelKey: 'alignEnd' },
  { value: 'baseline', labelKey: 'alignBaseline' },
]
const PLACE_ITEMS_OPTIONS = [
  { value: 'stretch', labelKey: 'piStretch' },
  { value: 'start', labelKey: 'piStart' },
  { value: 'center', labelKey: 'piCenter' },
  { value: 'end', labelKey: 'piEnd' },
  { value: 'baseline', labelKey: 'piBaseline' },
]

/** 预览子项的固定配色（按序号取色） */
const ITEM_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4']

/** 布局配置持久化 */
const config = useStorage('tool-flexbox-generator-config', {
  mode: 'flex',
  direction: 'row',
  justify: 'center',
  align: 'center',
  wrap: false,
  gap: 8,
  columns: 3,
  rows: 2,
  placeItems: 'stretch',
  itemCount: 3,
  items: [
    { grow: 0, order: 0 },
    { grow: 0, order: 0 },
    { grow: 0, order: 0 },
  ],
})

const selected = ref(0)


function hasValue(list, value) {
  return list.some(o => o.value === value)
}

/** 子项数量变化时同步 items 数组长度 */
function syncItems() {
  const n = clampInt(config.value.itemCount, ITEM_COUNT_MIN, ITEM_COUNT_MAX, 3)
  config.value.itemCount = n
  if (!Array.isArray(config.value.items)) config.value.items = []
  while (config.value.items.length < n) {
    config.value.items.push({ grow: 0, order: 0 })
  }
  if (config.value.items.length > n) {
    config.value.items = config.value.items.slice(0, n)
  }
  config.value.items = config.value.items.map(it => ({
    grow: clampInt(it && it.grow, 0, 4, 0),
    order: clampInt(it && it.order, -2, 2, 0),
  }))
  if (selected.value >= n) selected.value = 0
}

watch(() => config.value.itemCount, syncItems)

/** 挂载时修复历史脏数据（非法枚举值、越界数值等） */
onMounted(() => {
  try {
    if (config.value.mode !== 'flex' && config.value.mode !== 'grid') config.value.mode = 'flex'
    if (!hasValue(DIRECTIONS, config.value.direction)) config.value.direction = 'row'
    if (!hasValue(JUSTIFY_OPTIONS, config.value.justify)) config.value.justify = 'center'
    if (!hasValue(ALIGN_OPTIONS, config.value.align)) config.value.align = 'center'
    if (!hasValue(PLACE_ITEMS_OPTIONS, config.value.placeItems)) config.value.placeItems = 'stretch'
    config.value.gap = clampInt(config.value.gap, 0, 32, 8)
    config.value.columns = clampInt(config.value.columns, 1, 6, 3)
    config.value.rows = clampInt(config.value.rows, 1, 6, 2)
    config.value.wrap = Boolean(config.value.wrap)
    syncItems()
  } catch {
    toast.error(t('toolsCommon.error'))
  }
})

const isFlex = computed(() => config.value.mode === 'flex')
const selectedItem = computed(() => config.value.items[selected.value] || null)

/** 容器内联样式：实时预览用 */
const containerStyle = computed(() => {
  if (config.value.mode === 'grid') {
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${config.value.columns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${config.value.rows}, minmax(0, 1fr))`,
      gap: `${config.value.gap}px`,
      placeItems: config.value.placeItems,
    }
  }
  const style = {
    display: 'flex',
    flexDirection: config.value.direction,
    justifyContent: config.value.justify,
    alignItems: config.value.align,
    gap: `${config.value.gap}px`,
  }
  if (config.value.wrap) style.flexWrap = 'wrap'
  return style
})

/** 子项内联样式：仅 Flex 模式应用 grow / order */
function itemStyle(i) {
  if (!isFlex.value) return {}
  const it = config.value.items[i]
  if (!it) return {}
  const style = {}
  if (it.grow !== 0) style.flexGrow = it.grow
  if (it.order !== 0) style.order = it.order
  return style
}

/**
 * 生成 CSS 代码：只输出与 CSS 默认值不同（有实际效果）的属性。
 * 子项的非默认 grow / order 以 nth-child 覆盖形式输出。
 */
const cssCode = computed(() => {
  const lines = []
  lines.push('.container {')
  if (config.value.mode === 'grid') {
    lines.push('  display: grid;')
    lines.push(`  grid-template-columns: repeat(${config.value.columns}, minmax(0, 1fr));`)
    lines.push(`  grid-template-rows: repeat(${config.value.rows}, minmax(0, 1fr));`)
    if (config.value.gap > 0) lines.push(`  gap: ${config.value.gap}px;`)
    if (config.value.placeItems !== 'stretch') lines.push(`  place-items: ${config.value.placeItems};`)
  } else {
    lines.push('  display: flex;')
    if (config.value.direction !== 'row') lines.push(`  flex-direction: ${config.value.direction};`)
    if (config.value.justify !== 'flex-start') lines.push(`  justify-content: ${config.value.justify};`)
    if (config.value.align !== 'stretch') lines.push(`  align-items: ${config.value.align};`)
    if (config.value.wrap) lines.push('  flex-wrap: wrap;')
    if (config.value.gap > 0) lines.push(`  gap: ${config.value.gap}px;`)
  }
  lines.push('}')
  lines.push('')
  lines.push('.item {')
  lines.push('  padding: 8px 20px;')
  lines.push('  border-radius: 8px;')
  lines.push('  color: #ffffff;')
  lines.push('  font-weight: 600;')
  lines.push('  text-align: center;')
  lines.push('}')
  if (isFlex.value) {
    config.value.items.forEach((it, i) => {
      if (!it) return
      const props = []
      if (it.grow !== 0) props.push(`  flex-grow: ${it.grow};`)
      if (it.order !== 0) props.push(`  order: ${it.order};`)
      if (props.length) {
        lines.push('')
        lines.push(`.item:nth-child(${i + 1}) {`)
        lines.push(...props)
        lines.push('}')
      }
    })
  }
  return lines.join('\n')
})

function resetAll() {
  config.value.mode = 'flex'
  config.value.direction = 'row'
  config.value.justify = 'center'
  config.value.align = 'center'
  config.value.wrap = false
  config.value.gap = 8
  config.value.columns = 3
  config.value.rows = 2
  config.value.placeItems = 'stretch'
  config.value.itemCount = 3
  config.value.items = [
    { grow: 0, order: 0 },
    { grow: 0, order: 0 },
    { grow: 0, order: 0 },
  ]
  selected.value = 0
  toast.info(t('toolsCommon.done'))
}
</script>

<template>
  <ToolPage tool-id="flexboxGenerator">
    <!-- 布局模式 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.flexboxGenerator.mode') }}</h2>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('tools.flexboxGenerator.mode')">
        <button
          type="button"
          class="btn-ghost"
          :class="config.mode === 'flex' ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
          :aria-pressed="config.mode === 'flex' ? 'true' : 'false'"
          @click="config.mode = 'flex'"
        >
          {{ t('tools.flexboxGenerator.modeFlex') }}
        </button>
        <button
          type="button"
          class="btn-ghost"
          :class="config.mode === 'grid' ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
          :aria-pressed="config.mode === 'grid' ? 'true' : 'false'"
          @click="config.mode = 'grid'"
        >
          {{ t('tools.flexboxGenerator.modeGrid') }}
        </button>
      </div>
    </section>

    <!-- 容器属性 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.flexboxGenerator.container') }}</h2>

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- Flexbox 专属属性 -->
        <template v-if="isFlex">
          <div>
            <label class="label-base" for="fg-direction">{{ t('tools.flexboxGenerator.direction') }}</label>
            <select id="fg-direction" v-model="config.direction" class="input-base">
              <option v-for="o in DIRECTIONS" :key="o.value" :value="o.value">
                {{ t(`tools.flexboxGenerator.${o.labelKey}`) }}
              </option>
            </select>
          </div>
          <div>
            <label class="label-base" for="fg-justify">{{ t('tools.flexboxGenerator.justify') }}</label>
            <select id="fg-justify" v-model="config.justify" class="input-base">
              <option v-for="o in JUSTIFY_OPTIONS" :key="o.value" :value="o.value">
                {{ t(`tools.flexboxGenerator.${o.labelKey}`) }}
              </option>
            </select>
          </div>
          <div>
            <label class="label-base" for="fg-align">{{ t('tools.flexboxGenerator.align') }}</label>
            <select id="fg-align" v-model="config.align" class="input-base">
              <option v-for="o in ALIGN_OPTIONS" :key="o.value" :value="o.value">
                {{ t(`tools.flexboxGenerator.${o.labelKey}`) }}
              </option>
            </select>
          </div>
          <div class="flex items-end pb-1">
            <button
              type="button"
              class="btn-ghost"
              :class="config.wrap ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
              :aria-pressed="config.wrap ? 'true' : 'false'"
              @click="config.wrap = !config.wrap"
            >
              {{ t('tools.flexboxGenerator.wrap') }}
            </button>
          </div>
        </template>

        <!-- Grid 专属属性 -->
        <template v-else>
          <div>
            <label class="label-base" for="fg-columns">
              {{ t('tools.flexboxGenerator.columns') }}: {{ config.columns }}
            </label>
            <input
              id="fg-columns"
              v-model.number="config.columns"
              type="range"
              min="1"
              max="6"
              class="w-full accent-blue-600"
              :aria-label="t('tools.flexboxGenerator.columns')"
            />
          </div>
          <div>
            <label class="label-base" for="fg-rows">
              {{ t('tools.flexboxGenerator.rows') }}: {{ config.rows }}
            </label>
            <input
              id="fg-rows"
              v-model.number="config.rows"
              type="range"
              min="1"
              max="6"
              class="w-full accent-blue-600"
              :aria-label="t('tools.flexboxGenerator.rows')"
            />
          </div>
          <div>
            <label class="label-base" for="fg-place">{{ t('tools.flexboxGenerator.placeItems') }}</label>
            <select id="fg-place" v-model="config.placeItems" class="input-base">
              <option v-for="o in PLACE_ITEMS_OPTIONS" :key="o.value" :value="o.value">
                {{ t(`tools.flexboxGenerator.${o.labelKey}`) }}
              </option>
            </select>
          </div>
        </template>

        <!-- 两种模式共用：间距 -->
        <div>
          <label class="label-base" for="fg-gap">
            {{ t('tools.flexboxGenerator.gap') }}: {{ config.gap }}px
          </label>
          <input
            id="fg-gap"
            v-model.number="config.gap"
            type="range"
            min="0"
            max="32"
            class="w-full accent-blue-600"
            :aria-label="t('tools.flexboxGenerator.gap')"
          />
        </div>

        <!-- 两种模式共用：子项数量 -->
        <div>
          <label class="label-base" for="fg-count">
            {{ t('tools.flexboxGenerator.itemsCount') }}: {{ config.itemCount }}
          </label>
          <input
            id="fg-count"
            v-model.number="config.itemCount"
            type="range"
            :min="ITEM_COUNT_MIN"
            :max="ITEM_COUNT_MAX"
            class="w-full accent-blue-600"
            :aria-label="t('tools.flexboxGenerator.itemsCount')"
          />
        </div>
      </div>
    </section>

    <!-- 实时预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.preview') }}</h2>
      <div
        class="min-h-56 overflow-auto rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/80 p-4 sm:min-h-64"
        :style="containerStyle"
      >
        <button
          v-for="i in config.itemCount"
          :key="`item-${i}`"
          type="button"
          class="shrink-0 cursor-pointer rounded-lg px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          :class="selected === i - 1 ? 'ring-4 ring-blue-300' : ''"
          :style="{ backgroundColor: ITEM_COLORS[(i - 1) % ITEM_COLORS.length], ...itemStyle(i - 1) }"
          :aria-pressed="selected === i - 1 ? 'true' : 'false'"
          :aria-label="t('tools.flexboxGenerator.editingItem', { n: i })"
          @click="selected = i - 1"
        >
          {{ i }}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.flexboxGenerator.clickItemHint') }}</p>

      <!-- 子项属性（仅 Flexbox 模式） -->
      <div v-if="isFlex && selectedItem" class="mt-4 rounded-xl border border-slate-100 bg-white/70 p-3">
        <h3 class="section-title">
          {{ t('tools.flexboxGenerator.itemEditor') }} ·
          {{ t('tools.flexboxGenerator.editingItem', { n: selected + 1 }) }}
        </h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label-base mb-1" for="fg-grow">
              {{ t('tools.flexboxGenerator.flexGrow') }}: {{ selectedItem.grow }}
            </label>
            <input
              id="fg-grow"
              v-model.number="selectedItem.grow"
              type="range"
              min="0"
              max="4"
              class="w-full accent-blue-600"
              :aria-label="t('tools.flexboxGenerator.flexGrow')"
            />
          </div>
          <div>
            <label class="label-base mb-1" for="fg-order">
              {{ t('tools.flexboxGenerator.order') }}: {{ selectedItem.order }}
            </label>
            <input
              id="fg-order"
              v-model.number="selectedItem.order"
              type="range"
              min="-2"
              max="2"
              class="w-full accent-blue-600"
              :aria-label="t('tools.flexboxGenerator.order')"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- 生成的 CSS 代码 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.flexboxGenerator.cssCode') }}</h2>
        <CopyButton :text="cssCode" :label="t('toolsCommon.copy')" />
      </div>
      <pre class="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700"><code>{{ cssCode }}</code></pre>
      <div class="mt-3">
        <button type="button" class="btn-ghost" @click="resetAll">{{ t('toolsCommon.reset') }}</button>
      </div>
    </section>
  </ToolPage>
</template>
