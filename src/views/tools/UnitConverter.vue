<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 单位换算：
 * - 7 个类别（长度/重量/温度/存储/速度/面积/体积），单位倍率表放组件常量
 * - 实时双向换算：两侧输入框任意一侧输入即换算另一侧
 * - 精度下拉（2/4/6 位小数），输出去掉尾零
 * - 存储类别支持二进制（1024）/ 十进制（1000）切换
 * - 温度用特殊函数（经过摄氏度中转）换算
 */
const { t } = useI18n()

/** 持久化：类别 / 精度 / 存储进制 / 每个类别记住的单位组合 */
const config = useStorage('tool-unit-converter-config', {
  category: 'length',
  precision: 6,
  storageSystem: 'decimal',
  unitPrefs: {},
})

/** 类别定义：单位 key 列表 + 默认 [源, 目标]（存储类别特殊处理） */
const CATEGORIES = [
  { key: 'length', defaults: ['meter', 'foot'] },
  { key: 'weight', defaults: ['kilogram', 'pound'] },
  { key: 'temperature', defaults: ['celsius', 'fahrenheit'] },
  { key: 'storage', defaults: ['mb', 'gb'] },
  { key: 'speed', defaults: ['kilometerPerHour', 'milePerHour'] },
  { key: 'area', defaults: ['squareMeter', 'squareFoot'] },
  { key: 'volume', defaults: ['liter', 'gallonUs'] },
]

/** 各类别单位相对基准的倍率（长度基准米、重量基准千克、速度基准米/秒、面积基准平方米、体积基准升） */
const UNIT_FACTORS = {
  length: {
    millimeter: 0.001,
    centimeter: 0.01,
    meter: 1,
    kilometer: 1000,
    inch: 0.0254,
    foot: 0.3048,
    yard: 0.9144,
    mile: 1609.344,
    nauticalMile: 1852,
  },
  weight: {
    milligram: 0.000001,
    gram: 0.001,
    kilogram: 1,
    tonne: 1000,
    ounce: 0.028349523125,
    pound: 0.45359237,
    jin: 0.5,
  },
  temperature: {},
  speed: {
    meterPerSecond: 1,
    kilometerPerHour: 1 / 3.6,
    footPerSecond: 0.3048,
    milePerHour: 0.44704,
    knot: 1852 / 3600,
    mach: 340.29,
  },
  area: {
    squareMillimeter: 0.000001,
    squareCentimeter: 0.0001,
    squareMeter: 1,
    hectare: 10000,
    squareKilometer: 1000000,
    squareInch: 0.00064516,
    squareFoot: 0.09290304,
    squareYard: 0.83612736,
    acre: 4046.8564224,
    squareMile: 2589988.110336,
    mu: 2000 / 3,
  },
  volume: {
    milliliter: 0.001,
    liter: 1,
    cubicCentimeter: 0.001,
    cubicMeter: 1000,
    cubicInch: 0.016387064,
    cubicFoot: 28.316846592,
    teaspoon: 0.00492892159375,
    tablespoon: 0.01478676478125,
    fluidOunce: 0.0295735295625,
    cup: 0.2365882365,
    pint: 0.473176473,
    quart: 0.946352946,
    gallonUs: 3.785411784,
    gallonUk: 4.54609,
  },
}

/** 存储单位：二进制（1024 进制）与十进制（1000 进制）两套，基准字节 */
const STORAGE_SYSTEMS = {
  binary: {
    units: { byte: 1, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 },
    defaults: ['mib', 'gib'],
  },
  decimal: {
    units: { byte: 1, kb: 1000, mb: 1000000, gb: 1000000000, tb: 1000000000000 },
    defaults: ['mb', 'gb'],
  },
}

/** 单位符号（放常量，不进语言包） */
const UNIT_SYMBOLS = {
  length: {
    millimeter: 'mm', centimeter: 'cm', meter: 'm', kilometer: 'km',
    inch: 'in', foot: 'ft', yard: 'yd', mile: 'mi', nauticalMile: 'nmi',
  },
  weight: {
    milligram: 'mg', gram: 'g', kilogram: 'kg', tonne: 't',
    ounce: 'oz', pound: 'lb', jin: '斤',
  },
  temperature: { celsius: '°C', fahrenheit: '°F', kelvin: 'K' },
  storage: {
    byte: 'B', kib: 'KiB', mib: 'MiB', gib: 'GiB', tib: 'TiB',
    kb: 'kB', mb: 'MB', gb: 'GB', tb: 'TB',
  },
  speed: {
    meterPerSecond: 'm/s', kilometerPerHour: 'km/h', footPerSecond: 'ft/s',
    milePerHour: 'mph', knot: 'kn', mach: 'Ma',
  },
  area: {
    squareMillimeter: 'mm²', squareCentimeter: 'cm²', squareMeter: 'm²',
    hectare: 'ha', squareKilometer: 'km²', squareInch: 'in²', squareFoot: 'ft²',
    squareYard: 'yd²', acre: 'ac', squareMile: 'mi²', mu: '亩',
  },
  volume: {
    milliliter: 'mL', liter: 'L', cubicCentimeter: 'cm³', cubicMeter: 'm³',
    cubicInch: 'in³', cubicFoot: 'ft³', teaspoon: 'tsp', tablespoon: 'tbsp',
    fluidOunce: 'fl oz', cup: 'cup', pint: 'pt', quart: 'qt',
    gallonUs: 'gal', gallonUk: 'gal(UK)',
  },
}

const PRECISION_OPTIONS = [2, 4, 6]

function isValidCategory(key) {
  return CATEGORIES.some(c => c.key === key)
}

function defaultUnits(categoryKey) {
  const cat = CATEGORIES.find(c => c.key === categoryKey) || CATEGORIES[0]
  if (categoryKey === 'storage') {
    return [...STORAGE_SYSTEMS[storageSystem.value].defaults]
  }
  return [...cat.defaults]
}

function unitsOf(categoryKey) {
  if (categoryKey === 'storage') {
    return Object.keys(STORAGE_SYSTEMS[storageSystem.value].units)
  }
  return Object.keys(UNIT_FACTORS[categoryKey] || {})
}

function factorOf(categoryKey, unitKey) {
  if (categoryKey === 'storage') {
    return STORAGE_SYSTEMS[storageSystem.value].units[unitKey]
  }
  return UNIT_FACTORS[categoryKey][unitKey]
}

// ---------- 状态 ----------
const category = ref(isValidCategory(config.value.category) ? config.value.category : 'length')
const storageSystem = ref(
  config.value.storageSystem === 'binary' ? 'binary' : 'decimal'
)
const precision = ref(
  PRECISION_OPTIONS.includes(config.value.precision) ? config.value.precision : 6
)

/** 每个类别记住的 [源单位, 目标单位]，加载时校验合法性 */
const unitPrefs = ref({})
{
  const saved = config.value.unitPrefs
  const prefs = {}
  for (const cat of CATEGORIES) {
    const entry = saved && saved[cat.key]
    const valid = unitsOf(cat.key)
    if (
      entry && Array.isArray(entry) && entry.length === 2 &&
      valid.includes(entry[0]) && valid.includes(entry[1])
    ) {
      prefs[cat.key] = [entry[0], entry[1]]
    } else {
      prefs[cat.key] = defaultUnits(cat.key)
    }
  }
  unitPrefs.value = prefs
}

const fromUnit = computed({
  get: () => unitPrefs.value[category.value]?.[0] || defaultUnits(category.value)[0],
  set: value => {
    const pair = unitPrefs.value[category.value] || defaultUnits(category.value)
    unitPrefs.value = { ...unitPrefs.value, [category.value]: [value, pair[1]] }
  },
})
const toUnit = computed({
  get: () => unitPrefs.value[category.value]?.[1] || defaultUnits(category.value)[1],
  set: value => {
    const pair = unitPrefs.value[category.value] || defaultUnits(category.value)
    unitPrefs.value = { ...unitPrefs.value, [category.value]: [pair[0], value] }
  },
})

const sourceText = ref('1')
const targetText = ref('')
const inputError = ref('')
/** 当前由哪一侧驱动换算（双向） */
const activeField = ref('source')

const unitOptions = computed(() => unitsOf(category.value))
const isStorage = computed(() => category.value === 'storage')
const isTemperature = computed(() => category.value === 'temperature')

function unitName(unitKey) {
  return t(`tools.unitConverter.units.${category.value}.${unitKey}`)
}
function unitSymbol(unitKey) {
  return UNIT_SYMBOLS[category.value]?.[unitKey] || unitKey
}

// ---------- 转换核心 ----------
function toCelsius(value, unitKey) {
  if (unitKey === 'fahrenheit') return ((value - 32) * 5) / 9
  if (unitKey === 'kelvin') return value - 273.15
  return value
}
function fromCelsius(celsius, unitKey) {
  if (unitKey === 'fahrenheit') return (celsius * 9) / 5 + 32
  if (unitKey === 'kelvin') return celsius + 273.15
  return celsius
}

function convertValue(value, from, to) {
  if (isTemperature.value) {
    return fromCelsius(toCelsius(value, from), to)
  }
  const fromFactor = factorOf(category.value, from)
  const toFactor = factorOf(category.value, to)
  if (!fromFactor || !toFactor) return NaN
  return (value * fromFactor) / toFactor
}

/** toFixed 后去掉多余的尾零与小数点 */
function formatNumber(value) {
  if (!Number.isFinite(value)) return ''
  let text = value.toFixed(precision.value)
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '')
  }
  if (text === '-0') text = '0'
  return text
}

/** 由一侧输入换算另一侧；空输入清空对侧，非法输入给行内错误 */
function syncConversion(field) {
  activeField.value = field
  const raw = (field === 'source' ? sourceText : targetText).value.trim()
  const other = field === 'source' ? targetText : sourceText
  if (raw === '') {
    inputError.value = ''
    other.value = ''
    return
  }
  const num = Number(raw)
  if (raw.length > 100 || !Number.isFinite(num)) {
    inputError.value = t('tools.unitConverter.invalidNumber')
    return
  }
  inputError.value = ''
  try {
    const result =
      field === 'source'
        ? convertValue(num, fromUnit.value, toUnit.value)
        : convertValue(num, toUnit.value, fromUnit.value)
    other.value = formatNumber(result)
  } catch {
    inputError.value = t('toolsCommon.error')
  }
}

const onSourceInput = () => syncConversion('source')
const onTargetInput = () => syncConversion('target')

// ---------- 交互 ----------
function selectCategory(key) {
  if (category.value === key) return
  category.value = key
  inputError.value = ''
  // 切换类别后按当前驱动侧重新换算
  syncConversion(activeField.value)
}

function toggleStorageSystem() {
  const next = storageSystem.value === 'binary' ? 'decimal' : 'binary'
  storageSystem.value = next
  const valid = unitsOf('storage')
  const pair = unitPrefs.value.storage
  if (!valid.includes(pair[0]) || !valid.includes(pair[1])) {
    unitPrefs.value = {
      ...unitPrefs.value,
      storage: [...STORAGE_SYSTEMS[next].defaults],
    }
  }
  syncConversion(activeField.value)
}

/** 交换源/目标单位（连同两侧数值一起互换，保持数量关系不变） */
function swapUnits() {
  const pair = unitPrefs.value[category.value]
  unitPrefs.value = { ...unitPrefs.value, [category.value]: [pair[1], pair[0]] }
  const s = sourceText.value
  sourceText.value = targetText.value
  targetText.value = s
  activeField.value = activeField.value === 'source' ? 'target' : 'source'
  syncConversion(activeField.value)
}

const resultText = computed(() => {
  const num = Number(targetText.value)
  return targetText.value !== '' && Number.isFinite(num) ? targetText.value : ''
})

// ---------- 持久化 ----------
watch([category, storageSystem, precision, unitPrefs], () => {
  config.value = {
    category: category.value,
    precision: precision.value,
    storageSystem: storageSystem.value,
    unitPrefs: { ...unitPrefs.value },
  }
})

// 精度变化后按当前驱动侧重算（重新格式化）
watch(precision, () => {
  syncConversion(activeField.value)
})

// 初始化一次换算
syncConversion('source')
</script>

<template>
  <ToolPage tool-id="unitConverter">
    <!-- 类别选择 + 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div
        class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 sm:flex-wrap sm:overflow-visible"
        role="tablist"
        :aria-label="t('tools.unitConverter.categoryLabel')"
      >
        <button
          v-for="cat in CATEGORIES"
          :key="cat.key"
          type="button"
          role="tab"
          class="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            category === cat.key
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="category === cat.key"
          @click="selectCategory(cat.key)"
        >
          {{ t(`tools.unitConverter.categories.${cat.key}`) }}
        </button>
      </div>

      <div class="mt-4 flex flex-wrap items-end gap-3">
        <div class="w-36">
          <label class="label-base" for="unit-precision">{{ t('tools.unitConverter.precisionLabel') }}</label>
          <select id="unit-precision" v-model.number="precision" class="input-base">
            <option v-for="p in PRECISION_OPTIONS" :key="p" :value="p">
              {{ t('tools.unitConverter.precisionOption', { n: p }) }}
            </option>
          </select>
        </div>
        <button
          v-if="isStorage"
          type="button"
          class="btn-ghost"
          :aria-pressed="storageSystem === 'binary'"
          @click="toggleStorageSystem"
        >
          {{ t('tools.unitConverter.storageSystemLabel') }}：
          <span class="font-semibold text-blue-600">
            {{ storageSystem === 'binary' ? t('tools.unitConverter.storageBinary') : t('tools.unitConverter.storageDecimal') }}
          </span>
        </button>
        <p v-else class="text-xs text-slate-400 pb-2">{{ t(`tools.unitConverter.hints.${category}`) }}</p>
      </div>
    </section>

    <!-- 换算区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-2 items-start">
        <!-- 源 -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <label class="label-base mb-0" for="unit-source-value">{{ t('toolsCommon.input') }}</label>
            <span class="chip">{{ unitSymbol(fromUnit) }}</span>
          </div>
          <select
            v-model="fromUnit"
            class="input-base mb-2"
            :aria-label="t('tools.unitConverter.sourceUnitLabel')"
            @change="syncConversion(activeField)"
          >
            <option v-for="u in unitOptions" :key="u" :value="u">{{ unitName(u) }}</option>
          </select>
          <input
            id="unit-source-value"
            v-model="sourceText"
            type="text"
            inputmode="decimal"
            class="input-base font-mono"
            :placeholder="t('tools.unitConverter.inputPlaceholder')"
            :aria-label="t('tools.unitConverter.sourceValueLabel')"
            spellcheck="false"
            autocomplete="off"
            @input="onSourceInput"
          />
        </div>

        <!-- 交换 -->
        <div class="flex sm:flex-col items-center justify-center sm:pt-9">
          <button
            type="button"
            class="btn-ghost !rounded-full !p-2.5"
            :aria-label="t('toolsCommon.swap')"
            :title="t('toolsCommon.swap')"
            @click="swapUnits"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M7 16V4M7 4L3 8M7 4l4 4" />
              <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        <!-- 目标 -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <label class="label-base mb-0" for="unit-target-value">{{ t('toolsCommon.result') }}</label>
            <span class="flex items-center gap-1.5">
              <span class="chip">{{ unitSymbol(toUnit) }}</span>
              <CopyButton :text="resultText" compact :aria-label="t('toolsCommon.copy')" />
            </span>
          </div>
          <select
            v-model="toUnit"
            class="input-base mb-2"
            :aria-label="t('tools.unitConverter.targetUnitLabel')"
            @change="syncConversion(activeField)"
          >
            <option v-for="u in unitOptions" :key="u" :value="u">{{ unitName(u) }}</option>
          </select>
          <input
            id="unit-target-value"
            v-model="targetText"
            type="text"
            inputmode="decimal"
            class="input-base font-mono font-semibold text-blue-700"
            :placeholder="t('tools.unitConverter.inputPlaceholder')"
            :aria-label="t('tools.unitConverter.targetValueLabel')"
            spellcheck="false"
            autocomplete="off"
            @input="onTargetInput"
          />
        </div>
      </div>

      <p v-if="inputError" class="mt-3 text-red-600 text-sm">{{ inputError }}</p>
      <p v-else class="mt-3 text-xs text-slate-400">{{ t('tools.unitConverter.twoWayHint') }}</p>
    </section>
  </ToolPage>
</template>
