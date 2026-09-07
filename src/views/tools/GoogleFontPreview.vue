<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { clampInt, clampNumber } from '@/utils/number'

const { t } = useI18n()
const toast = useToast()

/* ================= 常量 ================= */

/** 单个字体加载超时时间 */
const LOAD_TIMEOUT_MS = 5000
/** 最近使用记录上限 */
const MAX_RECENT = 8

/** 内置常见 Google Fonts 家族静态清单（不依赖 metadata 接口） */
const FONT_FAMILIES = [
  // 英文无衬线
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Raleway',
  'Work Sans',
  'Rubik',
  'Karla',
  'Fira Sans',
  'Source Sans 3',
  'PT Sans',
  'Noto Sans',
  'Mulish',
  'Manrope',
  'DM Sans',
  'Outfit',
  'Urbanist',
  'Barlow',
  'Figtree',
  'Sora',
  'Space Grotesk',
  'Epilogue',
  'Plus Jakarta Sans',
  'Cabin',
  'Heebo',
  'Assistant',
  'Jost',
  'Nunito Sans',
  'IBM Plex Sans',
  'Libre Franklin',
  'Public Sans',
  'Red Hat Display',
  // 英文衬线
  'Merriweather',
  'Playfair Display',
  'Lora',
  'PT Serif',
  'Libre Baskerville',
  'Cormorant Garamond',
  'EB Garamond',
  'Bitter',
  'Crimson Text',
  'Zilla Slab',
  'Arvo',
  // 等宽
  'Roboto Mono',
  'JetBrains Mono',
  'Source Code Pro',
  'IBM Plex Mono',
  'Fira Code',
  'Space Mono',
  // 展示与手写
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Josefin Sans',
  'Quicksand',
  'Comfortaa',
  'Pacifico',
  'Dancing Script',
  'Lobster',
  // 中文
  'Noto Sans SC',
  'Noto Serif SC',
  'Noto Sans TC',
  'ZCOOL XiaoWei',
  'ZCOOL QingKe HuangYou',
  'Ma Shan Zheng',
  'Zhi Mang Xing',
  'Long Cang',
  'Liu Jian Mao Cao',
]

const DEFAULT_CONFIG = {
  text: 'The quick brown fox jumps over the lazy dog.',
  family: 'Inter',
  fontSize: 32,
  fontWeight: 400,
  italic: false,
  lineHeight: 1.5,
  uppercase: false,
  bgColor: '#ffffff',
  textColor: '#1f2937',
}

/* ================= 状态（持久化） ================= */

const config = useStorage('tool-google-font-preview-config', { ...DEFAULT_CONFIG })
const recentFamilies = useStorage('tool-google-font-preview-recent', [])

const search = ref('')
/** family -> 'loading' | 'ready' | 'failed' */
const familyStatus = ref({})

/* ================= 持久化配置防御性修正 ================= */

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function sanitizeConfig() {
  config.value.fontSize = clampInt(config.value.fontSize, 12, 72, DEFAULT_CONFIG.fontSize)
  config.value.fontWeight = clampInt(config.value.fontWeight, 100, 900, DEFAULT_CONFIG.fontWeight)
  config.value.lineHeight = clampNumber(config.value.lineHeight, 1, 2.5, DEFAULT_CONFIG.lineHeight)
  if (!isHexColor(config.value.bgColor)) config.value.bgColor = DEFAULT_CONFIG.bgColor
  if (!isHexColor(config.value.textColor)) config.value.textColor = DEFAULT_CONFIG.textColor
  if (typeof config.value.text !== 'string') config.value.text = DEFAULT_CONFIG.text
  if (!FONT_FAMILIES.includes(config.value.family)) config.value.family = DEFAULT_CONFIG.family
  if (!Array.isArray(recentFamilies.value)) recentFamilies.value = []
  recentFamilies.value = recentFamilies.value
    .filter(f => FONT_FAMILIES.includes(f))
    .slice(0, MAX_RECENT)
}
sanitizeConfig()

/* ================= 字体动态加载（去重注入 link） ================= */

const injectedLinks = new Set()
const loadPromises = new Map()
const activeTimers = new Set()

function clearTimer(timer) {
  clearTimeout(timer)
  activeTimers.delete(timer)
}

/** 给 Promise 加超时，超时后 reject；真实任务在后台结束后不再改变结果 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer)
      reject(new Error('timeout'))
    }, ms)
    activeTimers.add(timer)
    promise.then(
      value => {
        clearTimer(timer)
        resolve(value)
      },
      error => {
        clearTimer(timer)
        reject(error)
      }
    )
  })
}

function cssUrl(family, withWeights) {
  const name = family.replace(/ /g, '+')
  return withWeights
    ? `https://fonts.googleapis.com/css2?family=${name}:wght@100..900&display=swap`
    : `https://fonts.googleapis.com/css2?family=${name}&display=swap`
}

function injectStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => {
      link.remove()
      injectedLinks.delete(link)
      reject(new Error('stylesheet failed'))
    }
    document.head.appendChild(link)
    injectedLinks.add(link)
  })
}

async function requestFont(family) {
  // 优先请求可变字重区间；非可变字体（如 Ma Shan Zheng）会返回 400，退回默认字重
  try {
    await injectStylesheet(cssUrl(family, true))
  } catch {
    await injectStylesheet(cssUrl(family, false))
  }
  try {
    // 以当前示例文本触发对应字符集子集下载
    await document.fonts.load(`16px "${family}"`, config.value.text || 'Aa')
  } catch {
    // 字体接口异常时以样式表加载成功为准
  }
}

function loadFontFamily(family) {
  const status = familyStatus.value[family]
  if (status === 'ready' || status === 'loading') {
    return loadPromises.get(family) || Promise.resolve(true)
  }
  familyStatus.value = { ...familyStatus.value, [family]: 'loading' }
  const promise = withTimeout(requestFont(family), LOAD_TIMEOUT_MS)
    .then(() => {
      familyStatus.value = { ...familyStatus.value, [family]: 'ready' }
      return true
    })
    .catch(() => {
      familyStatus.value = { ...familyStatus.value, [family]: 'failed' }
      return false
    })
  loadPromises.set(family, promise)
  return promise
}

function statusOf(family) {
  return familyStatus.value[family] || 'idle'
}

/* ================= 选择与最近使用 ================= */

function pushRecent(family) {
  const list = recentFamilies.value.filter(f => f !== family)
  list.unshift(family)
  recentFamilies.value = list.slice(0, MAX_RECENT)
}

async function selectFamily(family) {
  config.value.family = family
  pushRecent(family)
  const ok = await loadFontFamily(family)
  if (!ok) {
    toast.error(t('tools.googleFontPreview.loadFailedHint'))
  }
}

function clearRecent() {
  recentFamilies.value = []
}

function resetAll() {
  config.value = { ...DEFAULT_CONFIG }
  selectFamily(DEFAULT_CONFIG.family)
}

/* ================= 列表过滤 ================= */

const filteredFamilies = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return FONT_FAMILIES
  return FONT_FAMILIES.filter(f => f.toLowerCase().includes(q))
})

const currentStatus = computed(() => statusOf(config.value.family))

/* ================= 预览样式与 CSS 输出 ================= */

const previewStyle = computed(() => ({
  fontFamily: `'${config.value.family}', sans-serif`,
  fontSize: `${config.value.fontSize}px`,
  fontWeight: String(config.value.fontWeight),
  fontStyle: config.value.italic ? 'italic' : 'normal',
  lineHeight: String(config.value.lineHeight),
  textTransform: config.value.uppercase ? 'uppercase' : 'none',
  backgroundColor: config.value.bgColor,
  color: config.value.textColor,
}))

const cssImport = computed(() => `@import url('${cssUrl(config.value.family, true)}');`)
const cssFamilyLine = computed(() => `font-family: '${config.value.family}', sans-serif;`)
const cssSnippet = computed(() => `${cssImport.value}\n${cssFamilyLine.value}`)

const hasText = computed(() => String(config.value.text || '').trim().length > 0)

const listStyleFor = family => (statusOf(family) === 'ready' ? { fontFamily: `'${family}', sans-serif` } : undefined)

/* ================= 生命周期与清理 ================= */

onMounted(() => {
  loadFontFamily(config.value.family).catch(() => {})
})

onBeforeUnmount(() => {
  for (const timer of activeTimers) clearTimeout(timer)
  activeTimers.clear()
  for (const link of injectedLinks) {
    link.remove()
  }
  injectedLinks.clear()
})
</script>

<template>
  <ToolPage tool-id="googleFontPreview">
    <!-- 示例文本 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.googleFontPreview.sampleText') }}</h2>
      <textarea
        id="gfp-text"
        v-model="config.text"
        rows="3"
        class="input-base"
        :placeholder="t('tools.googleFontPreview.textPlaceholder')"
        :aria-label="t('tools.googleFontPreview.sampleText')"
      ></textarea>
    </section>

    <!-- 字体家族列表 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.googleFontPreview.familySection') }}</h2>
        <span class="text-xs text-slate-400">{{ FONT_FAMILIES.length }} {{ t('toolsCommon.items') }}</span>
      </div>

      <label class="sr-only" for="gfp-search">{{ t('tools.googleFontPreview.searchPlaceholder') }}</label>
      <input
        id="gfp-search"
        v-model="search"
        type="text"
        class="input-base mb-3"
        :placeholder="t('tools.googleFontPreview.searchPlaceholder')"
        spellcheck="false"
      />

      <!-- 最近使用 -->
      <div v-if="recentFamilies.length > 0" class="mb-3">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-xs font-medium text-slate-500">{{ t('tools.googleFontPreview.recentSection') }}</span>
          <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="clearRecent">
            {{ t('tools.googleFontPreview.clearRecent') }}
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="family in recentFamilies"
            :key="`recent-${family}`"
            type="button"
            class="chip"
            :class="{ 'ring-2 ring-blue-400 bg-blue-50 text-blue-700 border-blue-200': family === config.family }"
            @click="selectFamily(family)"
          >
            {{ family }}
          </button>
        </div>
      </div>

      <!-- 家族清单 -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        <button
          v-for="family in filteredFamilies"
          :key="family"
          type="button"
          class="flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left transition"
          :class="[
            family === config.family
              ? 'border-blue-300 bg-blue-50/70'
              : 'border-slate-200 bg-white/70 hover:border-blue-200 hover:bg-blue-50/40',
            statusOf(family) === 'failed' ? 'opacity-55' : '',
          ]"
          :aria-pressed="family === config.family"
          @click="selectFamily(family)"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-slate-700" :style="listStyleFor(family)">
            {{ family }}
          </span>
          <span
            v-if="statusOf(family) === 'failed'"
            class="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
          >
            {{ t('tools.googleFontPreview.statusFailed') }}
          </span>
          <span
            v-else-if="statusOf(family) === 'loading'"
            class="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-500"
          >
            {{ t('tools.googleFontPreview.statusLoading') }}
          </span>
          <span
            v-else-if="statusOf(family) === 'ready'"
            class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"
          >
            {{ t('tools.googleFontPreview.statusReady') }}
          </span>
        </button>
        <p v-if="filteredFamilies.length === 0" class="col-span-full py-6 text-center text-sm text-slate-400">
          {{ t('toolsCommon.none') }}
        </p>
      </div>
    </section>

    <!-- 样式调节 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.googleFontPreview.styleSection') }}</h2>
      <div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div>
          <label class="label-base mb-1" for="gfp-size">{{ t('tools.googleFontPreview.fontSize') }}: {{ config.fontSize }}px</label>
          <input id="gfp-size" v-model.number="config.fontSize" type="range" min="12" max="72" step="1" class="w-full accent-blue-600" :aria-label="t('tools.googleFontPreview.fontSize')" />
        </div>
        <div>
          <label class="label-base mb-1" for="gfp-weight">{{ t('tools.googleFontPreview.fontWeight') }}: {{ config.fontWeight }}</label>
          <input id="gfp-weight" v-model.number="config.fontWeight" type="range" min="100" max="900" step="100" class="w-full accent-blue-600" :aria-label="t('tools.googleFontPreview.fontWeight')" />
        </div>
        <div>
          <label class="label-base mb-1" for="gfp-line">{{ t('tools.googleFontPreview.lineHeight') }}: {{ config.lineHeight }}</label>
          <input id="gfp-line" v-model.number="config.lineHeight" type="range" min="1" max="2.5" step="0.05" class="w-full accent-blue-600" :aria-label="t('tools.googleFontPreview.lineHeight')" />
        </div>
        <div class="flex items-end gap-2">
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!border-blue-300 !bg-blue-50 !text-blue-700': config.italic }"
            :aria-pressed="config.italic"
            @click="config.italic = !config.italic"
          >
            {{ t('tools.googleFontPreview.italic') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!border-blue-300 !bg-blue-50 !text-blue-700': config.uppercase }"
            :aria-pressed="config.uppercase"
            @click="config.uppercase = !config.uppercase"
          >
            {{ t('tools.googleFontPreview.uppercase') }}
          </button>
        </div>
        <div class="flex items-center gap-3">
          <div>
            <label class="label-base mb-1" for="gfp-bg">{{ t('tools.googleFontPreview.bgColor') }}</label>
            <input id="gfp-bg" v-model="config.bgColor" type="color" class="h-10 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" :aria-label="t('tools.googleFontPreview.bgColor')" />
          </div>
          <div>
            <label class="label-base mb-1" for="gfp-fg">{{ t('tools.googleFontPreview.textColor') }}</label>
            <input id="gfp-fg" v-model="config.textColor" type="color" class="h-10 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" :aria-label="t('tools.googleFontPreview.textColor')" />
          </div>
          <button type="button" class="btn-ghost mb-0.5" @click="resetAll">
            {{ t('toolsCommon.reset') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 预览与 CSS -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('toolsCommon.preview') }}</h2>
        <div class="flex items-center gap-2">
          <span class="chip">{{ config.family }}</span>
          <span
            v-if="currentStatus === 'loading'"
            class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-500"
          >
            {{ t('tools.googleFontPreview.statusLoading') }}
          </span>
          <span
            v-else-if="currentStatus === 'ready'"
            class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600"
          >
            {{ t('tools.googleFontPreview.statusReady') }}
          </span>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 overflow-hidden">
        <div v-if="hasText" class="min-h-40 break-words p-5 sm:p-8" :style="previewStyle">{{ config.text }}</div>
        <div v-else class="flex min-h-40 items-center justify-center text-sm text-slate-400">
          {{ t('tools.googleFontPreview.previewEmpty') }}
        </div>
      </div>

      <div v-if="currentStatus === 'failed'" class="mt-3 flex flex-wrap items-center gap-2" role="alert">
        <p class="text-xs text-red-600">{{ t('tools.googleFontPreview.loadFailedHint') }}</p>
        <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="selectFamily(config.family)">
          {{ t('tools.googleFontPreview.retry') }}
        </button>
      </div>

      <!-- CSS 输出 -->
      <div class="mt-4 rounded-xl border border-slate-100 bg-white/70 p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-slate-600">{{ t('tools.googleFontPreview.cssSection') }}</h3>
          <CopyButton :text="cssSnippet" :label="t('toolsCommon.copyAll')" />
        </div>
        <pre class="overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700"><code>{{ cssImport }}</code>
<code>{{ cssFamilyLine }}</code></pre>
      </div>
    </section>
  </ToolPage>
</template>
