<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clampNumber } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * 手持弹幕：多行文字逐行无限循环滚动
 * 预览小窗常显；全屏优先使用 requestFullscreen，失败时降级为页面内大窗（fixed 覆盖层）；
 * 横屏下文字自动放大并提示旋转手机；设置本地持久化
 */

const STORAGE_KEY = 'tool-danmaku-config'

const SPEED_MIN = 1
const SPEED_MAX = 10
const FONT_MIN = 24
const FONT_MAX = 120

const { t } = useI18n()
const toast = useToast()

const DEFAULT_TEXT = '前排出售瓜子饮料\n本条弹幕由 ToolboxLab 生成\n横屏观看效果更佳'

const saved = useStorage(STORAGE_KEY, {
  text: DEFAULT_TEXT,
  speed: 4,
  direction: 'left',
  fontSize: 48,
  textColor: '#ffffff',
  bgColor: '#dc2626',
  loop: true,
})


function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : fallback
}

/** 运行时配置：从持久化数据初始化并做合法性校正，变化后写回 */
const cfg = ref({
  text: typeof saved.value.text === 'string' ? saved.value.text : DEFAULT_TEXT,
  speed: clampNumber(saved.value.speed, SPEED_MIN, SPEED_MAX, 4),
  direction: saved.value.direction === 'right' ? 'right' : 'left',
  fontSize: clampNumber(saved.value.fontSize, FONT_MIN, FONT_MAX, 48),
  textColor: safeColor(saved.value.textColor, '#ffffff'),
  bgColor: safeColor(saved.value.bgColor, '#dc2626'),
  loop: saved.value.loop !== false,
})

watch(
  cfg,
  value => {
    saved.value = { ...value }
  },
  { deep: true }
)

const playing = ref(true)
const stageRef = ref(null)
const isNativeFs = ref(false)
const overlayMode = ref(false)
const isLandscape = ref(true)

const fullscreenActive = computed(() => isNativeFs.value || overlayMode.value)

/** 每行一条弹幕（忽略空行） */
const lines = computed(() =>
  String(cfg.value.text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
)

/** 速度滑块 1-10，映射为单条滚过一屏的秒数（速度越高越快） */
const durationSec = computed(() => 32 - cfg.value.speed * 3)

/** 横屏全屏时文字自动放大 */
const fontPx = computed(() => {
  if (fullscreenActive.value && isLandscape.value) return Math.round(cfg.value.fontSize * 1.6)
  return cfg.value.fontSize
})

const rowHeight = computed(() => Math.round(fontPx.value * 1.4))
const rowGap = computed(() => Math.round(fontPx.value * 0.35))

const rowsStyle = computed(() => ({ gap: rowGap.value + 'px' }))

const textStyle = computed(() => ({
  fontSize: fontPx.value + 'px',
  lineHeight: rowHeight.value + 'px',
  color: cfg.value.textColor,
  animationDuration: durationSec.value + 's',
  animationIterationCount: cfg.value.loop ? 'infinite' : '1',
}))

function togglePlay() {
  playing.value = !playing.value
}

async function enterFullscreen() {
  const el = stageRef.value
  try {
    if (!el || typeof el.requestFullscreen !== 'function') {
      throw new Error('requestFullscreen unsupported')
    }
    await el.requestFullscreen()
  } catch {
    // Safari 等环境不支持或被拒绝时，降级为页面内大窗模式
    overlayMode.value = true
    toast.info(t('tools.danmaku.overlayFallback'))
  }
}

function exitFullscreen() {
  if (isNativeFs.value && typeof document.exitFullscreen === 'function') {
    document.exitFullscreen().catch(() => {
      isNativeFs.value = false
    })
  }
  overlayMode.value = false
}

function handleFsChange() {
  isNativeFs.value = document.fullscreenElement === stageRef.value
}

function handleKeydown(event) {
  if (event.key === 'Escape' && overlayMode.value) {
    overlayMode.value = false
  }
}

function handleOrientationChange(event) {
  isLandscape.value = event.matches
}

/** 覆盖层模式锁定页面滚动 */
watch(overlayMode, locked => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = locked ? 'hidden' : ''
})

let orientationMq = null

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFsChange)
  window.addEventListener('keydown', handleKeydown)
  if (typeof window.matchMedia === 'function') {
    orientationMq = window.matchMedia('(orientation: landscape)')
    isLandscape.value = orientationMq.matches
    if (typeof orientationMq.addEventListener === 'function') {
      orientationMq.addEventListener('change', handleOrientationChange)
    } else if (typeof orientationMq.addListener === 'function') {
      orientationMq.addListener(handleOrientationChange)
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFsChange)
  window.removeEventListener('keydown', handleKeydown)
  if (orientationMq) {
    if (typeof orientationMq.removeEventListener === 'function') {
      orientationMq.removeEventListener('change', handleOrientationChange)
    } else if (typeof orientationMq.removeListener === 'function') {
      orientationMq.removeListener(handleOrientationChange)
    }
  }
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <ToolPage tool-id="danmaku">
    <!-- 预览舞台：常显，亦是全屏与页面内大窗模式的容器 -->
    <section class="mb-4">
      <div
        ref="stageRef"
        class="dm-stage relative w-full overflow-hidden bg-black transition-colors"
        :class="overlayMode ? 'fixed inset-0 z-[80] rounded-none' : isNativeFs ? '' : 'rounded-2xl h-56 sm:h-72'"
        :style="{ backgroundColor: cfg.bgColor }"
      >
        <!-- 全屏/覆盖层时的顶部提示条与退出按钮 -->
        <div
          v-if="fullscreenActive"
          class="absolute top-0 inset-x-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-black/25"
        >
          <span class="text-xs text-white/85 truncate">{{ t('tools.danmaku.fullscreenHint') }}</span>
          <button
            type="button"
            class="shrink-0 rounded-lg px-3 py-1 text-xs font-semibold text-white bg-white/20 border border-white/30 hover:bg-white/30 transition"
            @click="exitFullscreen"
          >
            {{ t('tools.danmaku.exit') }}
          </button>
        </div>

        <!-- 滚动文字：每行一条、独立动画 -->
        <div class="absolute inset-0 flex flex-col justify-center" :class="playing ? 'dm-playing' : ''" :style="rowsStyle">
          <template v-if="lines.length">
            <div
              v-for="(line, index) in lines"
              :key="index"
              class="dm-row relative w-full"
              :class="playing ? '' : 'text-center px-4'"
              :style="{ height: rowHeight + 'px' }"
            >
              <span
                class="dm-text font-black"
                :class="playing ? (cfg.direction === 'left' ? 'to-left' : 'to-right') : ''"
                :style="textStyle"
              >{{ line }}</span>
            </div>
          </template>
          <p v-else class="w-full text-center text-sm text-white/60 px-6">
            {{ t('tools.danmaku.emptyHint') }}
          </p>
        </div>

        <!-- 横竖屏提示 -->
        <div v-if="fullscreenActive && !isLandscape" class="absolute bottom-3 inset-x-0 z-10 flex justify-center">
          <span class="inline-flex items-center rounded-full px-3 py-1 text-xs text-white bg-black/40 border border-white/20">
            {{ t('tools.danmaku.rotateHint') }}
          </span>
        </div>
      </div>
    </section>

    <!-- 控制与设置：全屏/大窗模式下隐藏 -->
    <section v-show="!fullscreenActive" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.danmaku.settingsTitle') }}</h2>
      <div class="flex items-center gap-2 flex-wrap mb-4">
        <button v-if="!playing" type="button" class="btn-primary" @click="togglePlay">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="6 3 20 12 6 21" />
          </svg>
          {{ t('tools.danmaku.play') }}
        </button>
        <button v-else type="button" class="btn-ghost" @click="togglePlay">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="4" width="4" height="16" rx="1" />
            <rect x="15" y="4" width="4" height="16" rx="1" />
          </svg>
          {{ t('tools.danmaku.stop') }}
        </button>
        <button type="button" class="btn-ghost" @click="enterFullscreen">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          {{ t('tools.danmaku.fullscreen') }}
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div class="sm:col-span-2">
          <label class="label-base" for="danmaku-text">{{ t('tools.danmaku.textLabel') }}</label>
          <textarea
            id="danmaku-text"
            v-model="cfg.text"
            rows="3"
            class="input-base"
            :placeholder="t('tools.danmaku.textPlaceholder')"
          ></textarea>
        </div>
        <div>
          <label class="label-base" for="danmaku-speed">
            {{ t('tools.danmaku.speedLabel') }}
            <span class="font-mono text-slate-400">{{ t('tools.danmaku.speedHint', { n: durationSec }) }}</span>
          </label>
          <input id="danmaku-speed" v-model.number="cfg.speed" type="range" :min="SPEED_MIN" :max="SPEED_MAX" step="1" class="w-full accent-blue-600" />
        </div>
        <div>
          <label class="label-base" for="danmaku-direction">{{ t('tools.danmaku.directionLabel') }}</label>
          <select id="danmaku-direction" v-model="cfg.direction" class="input-base">
            <option value="left">{{ t('tools.danmaku.directionLeft') }}</option>
            <option value="right">{{ t('tools.danmaku.directionRight') }}</option>
          </select>
        </div>
        <div>
          <label class="label-base" for="danmaku-fontsize">
            {{ t('tools.danmaku.fontSizeLabel') }}
            <span class="font-mono text-slate-400">{{ cfg.fontSize }} px</span>
          </label>
          <input id="danmaku-fontsize" v-model.number="cfg.fontSize" type="range" :min="FONT_MIN" :max="FONT_MAX" step="2" class="w-full accent-blue-600" />
        </div>
        <div class="flex items-end gap-4 flex-wrap">
          <div>
            <label class="label-base" for="danmaku-textcolor">{{ t('tools.danmaku.textColor') }}</label>
            <input id="danmaku-textcolor" v-model="cfg.textColor" type="color" class="input-base !p-1 h-10 w-20 cursor-pointer" />
          </div>
          <div>
            <label class="label-base" for="danmaku-bgcolor">{{ t('tools.danmaku.bgColor') }}</label>
            <input id="danmaku-bgcolor" v-model="cfg.bgColor" type="color" class="input-base !p-1 h-10 w-20 cursor-pointer" />
          </div>
        </div>
        <div class="flex items-center">
          <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input v-model="cfg.loop" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.danmaku.loopLabel') }}
          </label>
        </div>
      </div>
    </section>

    <div
      v-show="!fullscreenActive"
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5"
      role="note"
    >
      <svg class="w-5 h-5 shrink-0 mt-0.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.danmaku.note') }}</p>
    </div>
  </ToolPage>
</template>

<style scoped>
.dm-stage:fullscreen {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
}

.dm-text {
  display: inline-block;
  white-space: nowrap;
  will-change: transform;
}

.dm-playing .dm-text {
  position: absolute;
  left: 0;
  top: 0;
  animation-timing-function: linear;
}

.dm-playing .to-left {
  animation-name: dm-to-left;
}

.dm-playing .to-right {
  animation-name: dm-to-right;
}

@keyframes dm-to-left {
  from {
    transform: translateX(100vw);
  }
  to {
    transform: translateX(-100%);
  }
}

@keyframes dm-to-right {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100vw);
  }
}
</style>
