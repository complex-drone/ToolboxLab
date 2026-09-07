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
/** 最多同时对比的字体数 */
const MAX_FONTS = 4
/** 最少保留的字体数（逐个取消时） */
const MIN_FONTS = 2

const DEFAULT_TEXT = 'The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了懒惰的狗。'

const DEFAULT_CONFIG = {
  text: DEFAULT_TEXT,
  families: ['Inter', 'Noto Sans SC'],
  fontSize: 24,
  fontWeight: 400,
  lineHeight: 1.6,
  align: 'left',
}

const ALIGN_OPTIONS = ['left', 'center', 'right']

/** 内置常见 Google Fonts 家族静态清单（与本站其他工具不共享文件，独立维护） */
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

/* ================= 状态（持久化：所选字体与字号等） ================= */

const config = useStorage('tool-font-comparer-config', { ...DEFAULT_CONFIG })

const search = ref('')
/** family -> 'loading' | 'ready' | 'failed' */
const familyStatus = ref({})

/* ================= 持久化配置防御性修正 ================= */

function sanitizeConfig() {
  if (typeof config.value.text !== 'string') config.value.text = DEFAULT_CONFIG.text
  config.value.fontSize = clampInt(config.value.fontSize, 12, 72, DEFAULT_CONFIG.fontSize)
  config.value.fontWeight = clampInt(config.value.fontWeight, 100, 900, DEFAULT_CONFIG.fontWeight)
  config.value.lineHeight = clampNumber(config.value.lineHeight, 1, 2.5, DEFAULT_CONFIG.lineHeight)
  if (!ALIGN_OPTIONS.includes(config.value.align)) config.value.align = DEFAULT_CONFIG.align
  if (!Array.isArray(config.value.families)) config.value.families = [...DEFAULT_CONFIG.families]
  const unique = []
  for (const f of config.value.families) {
    if (FONT_FAMILIES.includes(f) && !unique.includes(f)) unique.push(f)
  }
  config.value.families = unique.slice(0, MAX_FONTS)
}

/* ================= 字体动态加载（去重注入 link，本组件内独立实现） ================= */

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
  // 优先请求可变字重区间；非可变字体（如 Bebas Neue）会返回 400，退回默认字重
  try {
    await injectStylesheet(cssUrl(family, true))
  } catch {
    await injectStylesheet(cssUrl(family, false))
  }
  try {
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

/* ================= 字体多选 ================= */

sanitizeConfig()

function isSelected(family) {
  return config.value.families.includes(family)
}

function toggleFamily(family) {
  if (isSelected(family)) {
    if (config.value.families.length <= MIN_FONTS) {
      toast.info(t('tools.fontComparer.minFontsHint'))
      return
    }
    config.value.families = config.value.families.filter(f => f !== family)
    return
  }
  if (config.value.families.length >= MAX_FONTS) {
    toast.info(t('tools.fontComparer.maxFontsHint'))
    return
  }
  config.value.families = [...config.value.families, family]
  loadFontFamily(family).catch(() => {})
}

function clearSelection() {
  config.value.families = []
}

function resetDefaults() {
  config.value = { ...DEFAULT_CONFIG, families: [...DEFAULT_CONFIG.families] }
  for (const family of config.value.families) {
    loadFontFamily(family).catch(() => {})
  }
}

/* ================= 列表过滤 ================= */

const filteredFamilies = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return FONT_FAMILIES
  return FONT_FAMILIES.filter(f => f.toLowerCase().includes(q))
})

const hasText = computed(() => String(config.value.text || '').trim().length > 0)

/* ================= 预览样式与 CSS 输出 ================= */

function cardStyle(family) {
  return {
    fontFamily: `'${family}', sans-serif`,
    fontSize: `${config.value.fontSize}px`,
    fontWeight: String(config.value.fontWeight),
    lineHeight: String(config.value.lineHeight),
    textAlign: config.value.align,
  }
}

function cssSnippet(family) {
  return `@import url('${cssUrl(family, true)}');\nfont-family: '${family}', sans-serif;`
}

/* ================= 生命周期与清理 ================= */

onMounted(() => {
  for (const family of config.value.families) {
    loadFontFamily(family).catch(() => {})
  }
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
  <ToolPage tool-id="fontComparer">
    <!-- 示例文本 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.fontComparer.sampleText') }}</h2>
      <textarea
        id="fc-text"
        v-model="config.text"
        rows="3"
        class="input-base"
        :placeholder="t('tools.fontComparer.textPlaceholder')"
        :aria-label="t('tools.fontComparer.sampleText')"
      ></textarea>
    </section>

    <!-- 选择字体 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.fontComparer.selectSection') }}</h2>
        <div class="flex items-center gap-2">
          <span class="chip">{{ t('tools.fontComparer.selectedLabel') }} {{ config.families.length }} / {{ MAX_FONTS }}</span>
          <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="clearSelection">
            {{ t('tools.fontComparer.clearSelection') }}
          </button>
          <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="resetDefaults">
            {{ t('tools.fontComparer.resetDefaults') }}
          </button>
        </div>
      </div>
      <p class="mb-2 text-xs text-slate-400">{{ t('tools.fontComparer.selectHint') }}</p>

      <label class="sr-only" for="fc-search">{{ t('tools.fontComparer.searchPlaceholder') }}</label>
      <input
        id="fc-search"
        v-model="search"
        type="text"
        class="input-base mb-3"
        :placeholder="t('tools.fontComparer.searchPlaceholder')"
        spellcheck="false"
      />

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        <button
          v-for="family in filteredFamilies"
          :key="family"
          type="button"
          class="flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left transition"
          :class="
            isSelected(family)
              ? 'border-blue-300 bg-blue-50/70'
              : 'border-slate-200 bg-white/70 hover:border-blue-200 hover:bg-blue-50/40'
          "
          :aria-pressed="isSelected(family)"
          @click="toggleFamily(family)"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-slate-700">{{ family }}</span>
          <span
            v-if="statusOf(family) === 'failed'"
            class="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
          >
            {{ t('tools.fontComparer.statusFailed') }}
          </span>
          <span
            v-else-if="statusOf(family) === 'loading'"
            class="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-500"
          >
            {{ t('tools.fontComparer.statusLoading') }}
          </span>
        </button>
        <p v-if="filteredFamilies.length === 0" class="col-span-full py-6 text-center text-sm text-slate-400">
          {{ t('toolsCommon.none') }}
        </p>
      </div>
    </section>

    <!-- 统一调节 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.fontComparer.tuneSection') }}</h2>
      <div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div>
          <label class="label-base mb-1" for="fc-size">{{ t('tools.fontComparer.fontSize') }}: {{ config.fontSize }}px</label>
          <input id="fc-size" v-model.number="config.fontSize" type="range" min="12" max="72" step="1" class="w-full accent-blue-600" :aria-label="t('tools.fontComparer.fontSize')" />
        </div>
        <div>
          <label class="label-base mb-1" for="fc-weight">{{ t('tools.fontComparer.fontWeight') }}: {{ config.fontWeight }}</label>
          <input id="fc-weight" v-model.number="config.fontWeight" type="range" min="100" max="900" step="100" class="w-full accent-blue-600" :aria-label="t('tools.fontComparer.fontWeight')" />
        </div>
        <div>
          <label class="label-base mb-1" for="fc-line">{{ t('tools.fontComparer.lineHeight') }}: {{ config.lineHeight }}</label>
          <input id="fc-line" v-model.number="config.lineHeight" type="range" min="1" max="2.5" step="0.05" class="w-full accent-blue-600" :aria-label="t('tools.fontComparer.lineHeight')" />
        </div>
        <div>
          <span class="label-base mb-1 block">{{ t('tools.fontComparer.textAlign') }}</span>
          <div class="flex gap-1.5">
            <button
              v-for="option in ALIGN_OPTIONS"
              :key="option"
              type="button"
              class="btn-ghost"
              :class="{ '!border-blue-300 !bg-blue-50 !text-blue-700': config.align === option }"
              :aria-pressed="config.align === option"
              @click="config.align = option"
            >
              {{ t(`tools.fontComparer.align-${option}`) }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 对比预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.fontComparer.compareSection') }}</h2>

      <p v-if="config.families.length < MIN_FONTS" class="text-sm text-slate-400">
        {{ t('tools.fontComparer.needFontsHint') }}
      </p>

      <div v-else class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="family in config.families"
          :key="`card-${family}`"
          class="rounded-xl border border-slate-200 bg-white/70 p-3"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm font-semibold text-slate-700">{{ family }}</span>
              <span
                v-if="statusOf(family) === 'loading'"
                class="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-500"
              >
                {{ t('tools.fontComparer.statusLoading') }}
              </span>
              <span
                v-else-if="statusOf(family) === 'failed'"
                class="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
              >
                {{ t('tools.fontComparer.statusFailed') }}
              </span>
            </div>
            <CopyButton :text="cssSnippet(family)" :label="t('tools.fontComparer.copyFontCss')" />
          </div>

          <!-- 失败态 -->
          <div v-if="statusOf(family) === 'failed'" class="flex min-h-32 flex-col items-start justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4" role="alert">
            <p class="text-xs text-red-600">{{ t('tools.fontComparer.loadFailedHint') }}</p>
            <button type="button" class="btn-ghost !px-2 !py-1 text-xs" @click="loadFontFamily(family)">
              {{ t('tools.fontComparer.retry') }}
            </button>
          </div>

          <!-- 预览文本 -->
          <div v-else class="min-h-32 break-words p-2" :style="cardStyle(family)">
            <span v-if="hasText">{{ config.text }}</span>
            <span v-else class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</span>
          </div>

          <!-- 每卡 CSS -->
          <pre class="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-500"><code>@import url('{{ cssUrl(family, true) }}');</code>
<code>font-family: '{{ family }}', sans-serif;</code></pre>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
