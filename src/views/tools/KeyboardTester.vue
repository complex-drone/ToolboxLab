<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 键盘布局测试器：window 级 keydown/keyup 监听，按下高亮键帽、抬起恢复，
 * 展示 key / code / keyCode 与组合键、最近 10 次历史；
 * 键帽文字可按 QWERTY / Dvorak 映射常量切换，布局选择持久化
 * 注意：不做 preventDefault，浏览器组合键（如 Ctrl 加 W）会被浏览器拦截属正常
 */

const { t } = useI18n()

const supported = typeof window !== 'undefined' && typeof KeyboardEvent !== 'undefined'

/* ---------- 键位定义 ---------- */

function k(code, label, u = 1) {
  return { code, label, u }
}

const MAIN_ROWS = [
  [
    k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'), k('Digit4', '4'),
    k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'), k('Digit8', '8'), k('Digit9', '9'),
    k('Digit0', '0'), k('Minus', '-'), k('Equal', '='), k('Backspace', '⌫', 2),
  ],
  [
    k('Tab', 'Tab', 1.5), k('KeyQ', 'q'), k('KeyW', 'w'), k('KeyE', 'e'), k('KeyR', 'r'),
    k('KeyT', 't'), k('KeyY', 'y'), k('KeyU', 'u'), k('KeyI', 'i'), k('KeyO', 'o'), k('KeyP', 'p'),
    k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5),
  ],
  [
    k('CapsLock', 'Caps', 1.75), k('KeyA', 'a'), k('KeyS', 's'), k('KeyD', 'd'), k('KeyF', 'f'),
    k('KeyG', 'g'), k('KeyH', 'h'), k('KeyJ', 'j'), k('KeyK', 'k'), k('KeyL', 'l'),
    k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.25),
  ],
  [
    k('ShiftLeft', 'Shift', 2.25), k('KeyZ', 'z'), k('KeyX', 'x'), k('KeyC', 'c'), k('KeyV', 'v'),
    k('KeyB', 'b'), k('KeyN', 'n'), k('KeyM', 'm'), k('Comma', ','), k('Period', '.'), k('Slash', '/'),
    k('ShiftRight', 'Shift', 2.5),
  ],
  [
    k('ControlLeft', 'Ctrl', 1.25), k('MetaLeft', 'Meta', 1.25), k('AltLeft', 'Alt', 1.25),
    k('Space', 'Space', 6.25), k('AltRight', 'Alt', 1.25), k('MetaRight', 'Meta', 1.25),
    k('ContextMenu', 'Menu', 1.25), k('ControlRight', 'Ctrl', 1.25),
  ],
]

/** 数字小键盘（显式网格定位，加号与回车跨两行，0 跨两列） */
const NUMPAD_KEYS = [
  { code: 'NumLock', label: 'Num', col: 1, row: 1 },
  { code: 'NumpadDivide', label: '÷', col: 2, row: 1 },
  { code: 'NumpadMultiply', label: '×', col: 3, row: 1 },
  { code: 'NumpadSubtract', label: '−', col: 4, row: 1 },
  { code: 'Numpad7', label: '7', col: 1, row: 2 },
  { code: 'Numpad8', label: '8', col: 2, row: 2 },
  { code: 'Numpad9', label: '9', col: 3, row: 2 },
  { code: 'NumpadAdd', label: '+', col: 4, row: 2, rowSpan: 2 },
  { code: 'Numpad4', label: '4', col: 1, row: 3 },
  { code: 'Numpad5', label: '5', col: 2, row: 3 },
  { code: 'Numpad6', label: '6', col: 3, row: 3 },
  { code: 'Numpad1', label: '1', col: 1, row: 4 },
  { code: 'Numpad2', label: '2', col: 2, row: 4 },
  { code: 'Numpad3', label: '3', col: 3, row: 4 },
  { code: 'NumpadEnter', label: '⏎', col: 4, row: 4, rowSpan: 2 },
  { code: 'Numpad0', label: '0', col: 1, row: 5, colSpan: 2 },
  { code: 'NumpadDecimal', label: '.', col: 3, row: 5 },
]

/** Dvorak 映射常量：物理键码 -> 键帽字符（数字行与部分符号键不变，无需映射） */
const DVORAK_MAP = {
  Minus: '[',
  Equal: ']',
  KeyQ: "'", KeyW: ',', KeyE: '.', KeyR: 'p', KeyT: 'y', KeyY: 'f',
  KeyU: 'g', KeyI: 'c', KeyO: 'r', KeyP: 'l',
  BracketLeft: '/', BracketRight: '=', Backslash: '\\',
  KeyA: 'a', KeyS: 'o', KeyD: 'e', KeyF: 'u', KeyG: 'i', KeyH: 'd',
  KeyJ: 'h', KeyK: 't', KeyL: 'n', Semicolon: 's', Quote: '-',
  KeyZ: ';', KeyX: 'q', KeyC: 'j', KeyV: 'k', KeyB: 'x', KeyN: 'b',
  KeyM: 'm', Comma: 'w', Period: 'v', Slash: 'z',
}

const MODIFIER_NAMES = {
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  ShiftLeft: 'Shift', ShiftRight: 'Shift',
  AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Meta', MetaRight: 'Meta',
}

const CODE_NAMES = {
  Backquote: '`', Minus: '-', Equal: '=', Backspace: '⌫',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Enter: 'Enter',
  Comma: ',', Period: '.', Slash: '/',
  CapsLock: 'Caps', Tab: 'Tab', ContextMenu: 'Menu',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  NumLock: 'Num', NumpadDivide: 'Num÷', NumpadMultiply: 'Num×', NumpadSubtract: 'Num−',
  NumpadAdd: 'Num+', NumpadEnter: 'Num⏎', NumpadDecimal: 'Num.',
  Insert: 'Insert', Delete: 'Del', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', Escape: 'Esc',
}

/* ---------- 状态 ---------- */

/** 布局持久化：QWERTY / Dvorak */
const layout = useStorage('tool-keyboard-tester-layout', 'qwerty')

/** 当前按下的物理键码（保持按下顺序） */
const pressedCodes = ref([])
const lastKey = ref(null)
const history = ref([])
let historyId = 0

/* ---------- 键帽文字 ---------- */

function isMapped(def) {
  return layout.value === 'dvorak' && Object.prototype.hasOwnProperty.call(DVORAK_MAP, def.code)
}

function keyLabel(def) {
  if (def.code === 'Space') return t('tools.keyboardTester.spaceKey')
  if (isMapped(def)) {
    const mapped = DVORAK_MAP[def.code]
    return mapped.length === 1 ? mapped.toUpperCase() : mapped
  }
  return def.label.length === 1 ? def.label.toUpperCase() : def.label
}

function numpadStyle(def) {
  return {
    gridColumn: def.col + ' / span ' + (def.colSpan || 1),
    gridRow: def.row + ' / span ' + (def.rowSpan || 1),
  }
}

/* ---------- 按键描述 ---------- */

function describeCode(code) {
  if (!code) return ''
  if (code.indexOf('Key') === 0) return code.slice(3)
  if (code.indexOf('Digit') === 0) return code.slice(5)
  if (code === 'Space') return t('tools.keyboardTester.spaceKey')
  if (code.indexOf('Numpad') === 0 && /^\d$/.test(code.slice(6))) return code.slice(6)
  return CODE_NAMES[code] || code
}

/* ---------- 事件处理（不 preventDefault） ---------- */

function readKeyCode(e) {
  if (typeof e.keyCode === 'number' && e.keyCode !== 0) return e.keyCode
  return e.which || 0
}

function onKeyDown(e) {
  lastKey.value = { key: e.key || '', code: e.code || '', keyCode: readKeyCode(e) }
  if (pressedCodes.value.indexOf(e.code) === -1) {
    pressedCodes.value.push(e.code)
  }
  if (!e.repeat) addHistory(e)
}

function onKeyUp(e) {
  pressedCodes.value = pressedCodes.value.filter(c => c !== e.code)
}

/** 窗口失焦时清空按下态，避免按键卡在高亮 */
function onWindowBlur() {
  pressedCodes.value = []
}

function addHistory(e) {
  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Meta')
  const main = describeCode(e.code)
  if (!MODIFIER_NAMES[e.code] && main) parts.push(main)
  historyId += 1
  history.value = [
    { id: historyId, display: parts.join(' + ') || main || e.key, key: e.key || '', code: e.code || '', keyCode: readKeyCode(e) },
  ].concat(history.value).slice(0, 10)
}

function clearHistory() {
  history.value = []
}

/** 顶部组合键展示：Ctrl + Shift + A 形式 */
const comboDisplay = computed(() => {
  const order = { Ctrl: 0, Shift: 1, Alt: 2, Meta: 3 }
  const names = []
  pressedCodes.value.forEach(code => {
    const m = MODIFIER_NAMES[code]
    if (m && names.indexOf(m) === -1) names.push(m)
  })
  names.sort((a, b) => order[a] - order[b])
  const main = pressedCodes.value.slice().reverse().find(c => !MODIFIER_NAMES[c])
  if (main) names.push(describeCode(main))
  return names.join(' + ')
})

/* ---------- 生命周期 ---------- */

onMounted(() => {
  if (!supported) return
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  pressedCodes.value = []
})
</script>

<template>
  <ToolPage tool-id="keyboardTester">
    <!-- 环境不支持 -->
    <div
      v-if="!supported"
      class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/80 !border-amber-200 flex items-start gap-2.5"
      role="alert"
    >
      <p class="text-sm text-amber-700 leading-relaxed">{{ t('tools.keyboardTester.unsupported') }}</p>
    </div>

    <template v-else>
      <!-- 浏览器拦截说明 -->
      <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5" role="note">
        <svg
          class="w-5 h-5 shrink-0 mt-0.5 text-blue-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.keyboardTester.browserNote') }}</p>
      </div>

      <!-- 当前组合键 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="section-title mb-0">{{ t('tools.keyboardTester.comboTitle') }}</h2>
          <span
            v-if="comboDisplay"
            class="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 font-mono"
          >
            {{ comboDisplay }}
          </span>
          <span v-else class="text-sm text-slate-400">{{ t('tools.keyboardTester.comboHint') }}</span>
        </div>
      </section>

      <!-- 键盘 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 class="section-title mb-0.5">{{ t('tools.keyboardTester.layoutLabel') }}</h2>
            <p class="text-xs text-slate-400">{{ t('tools.keyboardTester.pressHint') }}</p>
          </div>
          <div class="flex rounded-xl border border-slate-200 bg-white/70 p-1">
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              :class="layout === 'qwerty' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="layout = 'qwerty'"
            >
              {{ t('tools.keyboardTester.layoutQwerty') }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              :class="layout === 'dvorak' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="layout = 'dvorak'"
            >
              {{ t('tools.keyboardTester.layoutDvorak') }}
            </button>
          </div>
        </div>

        <div class="flex flex-col lg:flex-row gap-4">
          <!-- 主键区：小屏横向滚动 -->
          <div class="flex-1 overflow-x-auto pb-1 -mx-1 px-1">
            <div class="min-w-[540px]">
              <div v-for="(row, ri) in MAIN_ROWS" :key="ri" class="flex gap-1 mb-1">
                <div
                  v-for="def in row"
                  :key="def.code"
                  class="keycap"
                  :class="{ pressed: pressedCodes.indexOf(def.code) !== -1 }"
                  :style="{ flex: def.u + ' ' + def.u + ' 0%' }"
                >
                  <span class="keycap-main" :class="{ 'text-[10px]': def.label.length > 2 }">{{ keyLabel(def) }}</span>
                  <span v-if="isMapped(def)" class="keycap-hint">{{ def.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 数字小键盘 -->
          <div class="lg:w-48 shrink-0">
            <p class="text-xs text-slate-400 mb-1.5">{{ t('tools.keyboardTester.numpadTitle') }}</p>
            <div class="grid grid-cols-4 gap-1" style="grid-auto-rows: 38px">
              <div
                v-for="def in NUMPAD_KEYS"
                :key="def.code"
                class="keycap"
                :class="{ pressed: pressedCodes.indexOf(def.code) !== -1 }"
                :style="numpadStyle(def)"
              >
                <span class="keycap-main">{{ def.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 最新按键 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.keyboardTester.latestTitle') }}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div class="rounded-xl border border-slate-200 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.keyboardTester.keyName') }}</p>
            <p class="text-sm font-mono text-slate-700 break-all min-h-5">{{ lastKey && lastKey.key ? lastKey.key : '—' }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.keyboardTester.codeName') }}</p>
            <p class="text-sm font-mono text-slate-700 break-all min-h-5">{{ lastKey && lastKey.code ? lastKey.code : '—' }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white/70 p-3">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.keyboardTester.keyCodeName') }}</p>
            <p class="text-sm font-mono text-slate-700 break-all min-h-5">{{ lastKey ? lastKey.keyCode : '—' }}</p>
          </div>
        </div>
      </section>

      <!-- 按键历史 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.keyboardTester.historyTitle') }}</h2>
          <button type="button" class="btn-ghost" :disabled="!history.length" @click="clearHistory">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 min-h-8">
          <span v-for="h in history" :key="h.id" class="chip font-mono">{{ h.display }}</span>
          <span v-if="!history.length" class="text-sm text-slate-400">{{ t('tools.keyboardTester.historyEmpty') }}</span>
        </div>
      </section>
    </template>
  </ToolPage>
</template>

<style scoped>
.keycap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 38px;
  padding: 0 2px;
  border-radius: 7px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
  box-shadow: 0 2px 0 rgba(100, 116, 139, 0.28);
  color: #334155;
  user-select: none;
  transition: background-color 0.08s, color 0.08s, transform 0.08s, box-shadow 0.08s;
  overflow: hidden;
}

.keycap-main {
  font-size: 12px;
  line-height: 1.1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.keycap-hint {
  font-size: 9px;
  line-height: 1;
  color: #94a3b8;
  margin-top: 1px;
}

.keycap.pressed {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  border-color: #1d4ed8;
  color: #ffffff;
  transform: translateY(2px);
  box-shadow: 0 0 0 rgba(0, 0, 0, 0);
}

.keycap.pressed .keycap-hint {
  color: rgba(255, 255, 255, 0.75);
}
</style>
