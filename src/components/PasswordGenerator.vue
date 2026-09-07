<script setup>
import { ref, computed, onMounted } from 'vue'
import { useStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { generatePassword as _generatePassword, calculateEntropy, getStrengthLevel } from '@/utils/password'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()

/* ==================== 常量定义 ==================== */

const BASE_CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}<>?,.;:~',
}

const AMBIGUOUS_CHARS = {
  uppercase: ['O'],
  lowercase: ['o', 'l'],
  numbers: ['0', '1'],
}

const SYMBOL_PRESETS = {
  html: ['<', '>', '{', '}'],
  url: ['/', '?', '&', '=']
}

const LENGTH_PRESETS = [12, 16, 24, 32, 64]
const MAX_ENTROPY = 128

/* ==================== 统一状态管理（useStorage） ==================== */

const settings = useStorage('password_generator_settings', {
  length: 16,
  options: {
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  },
  excludedSymbols: [],
  excludeAmbiguous: false,
}, localStorage, { deep: true })

/* ==================== 响应式状态（UI 专用） ==================== */

const showPassword = ref(true)
const isGenerating = ref(false)
const showSymbolFilter = ref(false)
const copiedIndex = ref(-1)
const password = ref('')  // 当前密码

const hasCrypto = typeof window !== 'undefined' && !!window.crypto?.getRandomValues
const { show: showToast } = useToast()

/* ==================== 计算属性 ==================== */

const length = computed({
  get: () => settings.value.length,
  set: (val) => { settings.value.length = val }
})

const options = computed({
  get: () => settings.value.options,
  set: (val) => { settings.value.options = val }
})

const excludedSymbols = computed({
  get: () => settings.value.excludedSymbols || [],
  set: (val) => { settings.value.excludedSymbols = val }
})

const excludeAmbiguous = computed({
  get: () => settings.value.excludeAmbiguous || false,
  set: (val) => { settings.value.excludeAmbiguous = val }
})

const selectedKeys = computed(() =>
  Object.keys(options.value).filter(key => options.value[key])
)

const hasCharset = computed(() => {
  if (selectedKeys.value.length === 0) return false
  if (options.value.symbols && excludedSymbols.value.length === BASE_CHAR_SETS.symbols.length) {
    if (selectedKeys.value.length === 1 && selectedKeys.value[0] === 'symbols') return false
  }
  return true
})

const poolSize = computed(() => {
  let total = 0
  for (const key of selectedKeys.value) {
    let chars = BASE_CHAR_SETS[key]
    if (excludeAmbiguous.value && AMBIGUOUS_CHARS[key]) {
      chars = chars.split('').filter(c => !AMBIGUOUS_CHARS[key].includes(c)).join('')
    }
    if (key === 'symbols') {
      chars = chars.split('').filter(c => !excludedSymbols.value.includes(c)).join('')
    }
    total += chars.length
  }
  return total
})

const entropyBits = computed(() =>
  hasCharset.value ? calculateEntropy(length.value, poolSize.value) : 0
)

const strength = computed(() => {
  if (!hasCharset.value) {
    return { percent: 0, label: t('password.strength.invalid'), color: '#94a3b8' }
  }
  const percent = Math.min(100, Math.round((entropyBits.value / MAX_ENTROPY) * 100))
  const result = getStrengthLevel(percent)
  let labelKey = 'strong'
  if (percent < 40) labelKey = 'weak'
  else if (percent < 70) labelKey = 'medium'
  return {
    percent,
    label: t(`password.strength.${labelKey}`),
    color: result.color,
  }
})

const sliderFill = computed(() => ((length.value - 4) / (64 - 4)) * 100)

const allSymbols = computed(() => BASE_CHAR_SETS.symbols.split(''))

const currentExcludedSymbols = computed(() =>
  excludedSymbols.value.filter(sym => allSymbols.value.includes(sym))
)

/* ==================== 核心函数 ==================== */

function generatePassword() {
  if (!hasCharset.value || isGenerating.value) return

  isGenerating.value = true

  // 获取有效字符池（用于滚动动画）
  let chars = []
  for (const key of selectedKeys.value) {
    let set = BASE_CHAR_SETS[key].split('')
    if (excludeAmbiguous.value && AMBIGUOUS_CHARS[key]) {
      set = set.filter(c => !AMBIGUOUS_CHARS[key].includes(c))
    }
    if (key === 'symbols') {
      set = set.filter(c => !excludedSymbols.value.includes(c))
    }
    chars = chars.concat(set)
  }

  if (chars.length === 0) {
    isGenerating.value = false
    return
  }

  const targetPassword = _generatePassword(
    length.value,
    options.value,
    excludedSymbols.value,
    excludeAmbiguous.value
  )

  let progress = 0
  const duration = 500
  const startTime = performance.now()
  const currentChars = Array(length.value).fill('')

  const animate = (time) => {
    const elapsed = time - startTime
    progress = Math.min(1, elapsed / duration)
    const displayLength = Math.floor(progress * length.value)

    for (let i = 0; i < length.value; i++) {
      if (i < displayLength) {
        currentChars[i] = chars[Math.floor(Math.random() * chars.length)]
      } else {
        currentChars[i] = ''
      }
    }

    password.value = currentChars.join('')

    if (progress < 1) {
      requestAnimationFrame(animate)
    } else {
      password.value = targetPassword
      showToast(t('password.toast.generated'), 'success')
      isGenerating.value = false
    }
  }

  requestAnimationFrame(animate)
}

async function copyPassword() {
  if (!password.value) return

  let success = false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(password.value)
      success = true
    } catch { /* fallback */ }
  }
  if (!success) {
    const textarea = document.createElement('textarea')
    textarea.value = password.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      success = document.execCommand('copy')
    } catch { /* ignore */ }
    document.body.removeChild(textarea)
  }

  if (success) {
    copiedIndex.value = 0
    showToast(t('password.toast.copied'), 'success')
    setTimeout(() => { copiedIndex.value = -1 }, 2000)
  }
}

function toggleExcludeSymbol(symbol) {
  const list = excludedSymbols.value
  const idx = list.indexOf(symbol)
  if (idx > -1) {
    list.splice(idx, 1)
  } else {
    list.push(symbol)
  }
  generatePassword()
}

function isPresetExcluded(presetName) {
  const symbols = SYMBOL_PRESETS[presetName]
  return symbols.every(s => excludedSymbols.value.includes(s))
}

function toggleSymbolPreset(presetName) {
  const symbols = SYMBOL_PRESETS[presetName]
  const allExcluded = isPresetExcluded(presetName)

  if (allExcluded) {
    excludedSymbols.value = excludedSymbols.value.filter(s => !symbols.includes(s))
  } else {
    symbols.forEach(s => {
      if (!excludedSymbols.value.includes(s)) {
        excludedSymbols.value.push(s)
      }
    })
  }
  generatePassword()
}

/* ==================== 生命周期 ==================== */

onMounted(() => {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      showPassword.value = false
    }
  })
  generatePassword()
})
</script>

<template>
  <section class="tool-card" aria-label="密码生成器">
    <!-- 标题 -->
    <header class="tool-header">
      <div class="tool-title">
        <span class="tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
        </span>
        <h1>{{ t('password.title') }}</h1>
      </div>
      <p class="tool-desc">{{ t('password.description') }}</p>
    </header>

    <!-- 密码展示 -->
    <div class="password-row">
      <input
        ref="passwordInput"
        class="password-display"
        :type="showPassword ? 'text' : 'password'"
        :value="password"
        readonly
        spellcheck="false"
        :placeholder="t('password.placeholder')"
      />
      <div class="password-actions">
        <button
          class="toggle-visibility"
          :class="{ active: showPassword }"
          type="button"
          @click="showPassword = !showPassword"
          :title="t('password.toggleVisibility')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          class="copy-btn"
          :class="{ copied: copiedIndex === 0 }"
          type="button"
          :disabled="!password || isGenerating"
          @click="copyPassword()"
        >
          <svg v-if="copiedIndex !== 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 强度指示 -->
    <div class="strength-block">
      <div class="strength-meta">
        <span class="strength-title">{{ t('password.strength.label') }}</span>
        <span class="strength-label" :style="{ color: strength.color }">{{ strength.label }}</span>
      </div>
      <div class="strength-track" role="progressbar" :aria-valuenow="strength.percent">
        <div class="strength-bar" :style="{ width: strength.percent + '%', backgroundColor: strength.color }"></div>
      </div>
      <p class="strength-hint">
        {{ t('password.strength.hint', { length, types: selectedKeys.length, entropy: Math.round(entropyBits) }) }}
      </p>
    </div>

    <div class="divider"></div>

    <!-- 长度控制 -->
    <div class="control-block">
      <div class="control-head">
        <label class="control-name" for="length-slider">{{ t('password.length.label') }}</label>
        <span class="length-badge">{{ length }}</span>
      </div>
      <input id="length-slider" class="length-slider" type="range" min="4" max="64" step="1" v-model.number="length" :style="{ '--fill': sliderFill + '%' }" />
      <div class="range-marks"><span>4</span><span>64</span></div>
      <div class="length-presets">
        <button v-for="preset in LENGTH_PRESETS" :key="preset" class="preset-button" :class="{ active: length === preset }" @click="length = preset">{{ preset }}</button>
      </div>
    </div>

    <!-- 字符选项 -->
    <div class="control-block">
      <div class="control-head">
        <span class="control-name">{{ t('password.charset.label') }}</span>
        <span class="option-summary">{{ t('password.selected') }} {{ selectedKeys.length }} / 4</span>
      </div>
      <div class="char-options">
        <label class="char-option" :class="{ active: options.uppercase }">
          <input type="checkbox" v-model="options.uppercase" />
          <span class="checkbox-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12" /></svg></span>
          <span class="option-text"><span class="option-name">{{ t('password.charset.uppercase') }}</span><span class="option-sample">{{ t('password.charset.sample.uppercase') }}</span></span>
        </label>
        <label class="char-option" :class="{ active: options.lowercase }">
          <input type="checkbox" v-model="options.lowercase" />
          <span class="checkbox-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12" /></svg></span>
          <span class="option-text"><span class="option-name">{{ t('password.charset.lowercase') }}</span><span class="option-sample">{{ t('password.charset.sample.lowercase') }}</span></span>
        </label>
        <label class="char-option" :class="{ active: options.numbers }">
          <input type="checkbox" v-model="options.numbers" />
          <span class="checkbox-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12" /></svg></span>
          <span class="option-text"><span class="option-name">{{ t('password.charset.numbers') }}</span><span class="option-sample">{{ t('password.charset.sample.numbers') }}</span></span>
        </label>
        <label class="char-option" :class="{ active: options.symbols }">
          <input type="checkbox" v-model="options.symbols" />
          <span class="checkbox-box" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12" /></svg></span>
          <span class="option-text">
      <span class="option-name">{{ t('password.charset.symbols') }}</span>
      <span class="option-sample">!@#$%</span>  <!-- 硬编码，不翻译 -->
    </span>
        </label>
      </div>

      <!-- 排除易混淆字符 -->
      <div class="exclude-ambiguous">
        <input id="exclude-ambiguous-toggle" v-model="excludeAmbiguous" type="checkbox" class="toggle-input" />
        <label for="exclude-ambiguous-toggle" class="toggle-label">{{ t('password.excludeAmbiguous.label') }}</label>
        <p class="hint">{{ t('password.excludeAmbiguous.hint') }}</p>
      </div>

      <!-- 符号排除 -->
      <div v-if="options.symbols" class="symbol-filter-wrap">
        <button class="filter-toggle" type="button" @click="showSymbolFilter = !showSymbolFilter">
          <span class="filter-toggle-text">
            <span>🔧 {{ t('password.excludeSymbols.label') }}</span>
            <span class="filter-stats">{{ t('password.excludeSymbols.stats', { excluded: currentExcludedSymbols.length, total: allSymbols.length }) }}</span>
          </span>
          <span class="filter-arrow" :class="{ open: showSymbolFilter }">▾</span>
        </button>
        <div v-show="showSymbolFilter" class="symbol-grid">
          <button v-for="sym in allSymbols" :key="sym" class="symbol-tag" :class="{ excluded: excludedSymbols.includes(sym) }" type="button" @click="toggleExcludeSymbol(sym)">
            <span class="symbol-char">{{ sym }}</span>
            <span class="symbol-status">{{ excludedSymbols.includes(sym) ? '✕' : '✓' }}</span>
          </button>
          <div class="filter-actions">
            <button class="filter-action-btn" type="button" @click="toggleSymbolPreset('html')">
              {{ isPresetExcluded('html') ? t('password.actions.cancelExcludeHtml') : t('password.actions.excludeHtml') }}
            </button>
            <button class="filter-action-btn" type="button" @click="toggleSymbolPreset('url')">
              {{ isPresetExcluded('url') ? t('password.actions.cancelExcludeUrl') : t('password.actions.excludeUrl') }}
            </button>
            <button class="filter-action-btn" type="button" @click="excludedSymbols = []" :disabled="excludedSymbols.length === 0">
              {{ t('password.actions.reset') }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="!hasCharset" class="warning-hint">
        <span v-if="options.symbols && currentExcludedSymbols.length === allSymbols.length">{{ t('password.warning.allSymbolsExcluded') }}</span>
        <span v-else>{{ t('password.warning.noCharset') }}</span>
      </p>
    </div>

    <!-- 生成按钮 -->
    <button class="generate-btn" type="button" :disabled="!hasCharset || isGenerating" @click="generatePassword">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
      {{ isGenerating ? t('password.generate.loading') : t('password.generate.label') }}
    </button>

    <!-- 随机源说明 -->
    <p class="local-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
      {{ t('password.randomSource.label') }}: {{ hasCrypto ? t('password.randomSource.crypto') : t('password.randomSource.fallback') }} · {{ t('password.randomSource.note') }}
    </p>
  </section>
</template>

<style scoped>
/* ---------- 工具卡片 ---------- */
.tool-card {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(96, 125, 169, 0.18);
  padding: 28px;
  animation: fade-up 0.45s ease both;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 工具标题 ---------- */
.tool-header {
  margin-bottom: 22px;
}

.tool-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3);
  flex-shrink: 0;
}

.tool-icon svg {
  width: 20px;
  height: 20px;
}

.tool-title h1 {
  font-size: 20px;
  color: #1e293b;
  font-weight: 700;
}

.tool-desc {
  margin-top: 8px;
  font-size: 13px;
  color: #64748b;
}

/* ---------- 密码展示 ---------- */
.password-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.password-display {
  flex: 1;
  min-width: 0;
  font-family: Consolas, 'SF Mono', Menlo, monospace;
  font-size: 16px;
  letter-spacing: 0.5px;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.8);
  color: #1e293b;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.password-display:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.25);
}

.password-actions {
  display: flex;
  gap: 8px;
}

/* ---------- 密码可见性切换按钮 ---------- */
.toggle-visibility {
  padding: 0 8px;
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  transition: all 0.2s;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-visibility:hover {
  background: rgba(59, 130, 246, 0.2);
}

.toggle-visibility.active {
  background: rgba(59, 130, 246, 0.25);
  color: #fff;
}

.toggle-visibility svg {
  width: 20px;
  height: 20px;
}

/* ---------- 复制按钮 ---------- */
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 18px;
  border-radius: 12px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.copy-btn svg {
  width: 16px;
  height: 16px;
}

.copy-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.22);
}

.copy-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.copy-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.copy-btn.copied {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.4);
  color: #059669;
}

/* ---------- 强度指示条 ---------- */
.strength-block {
  margin-top: 18px;
}

.strength-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.strength-title {
  font-size: 13px;
  color: #475569;
  font-weight: 600;
}

.strength-label {
  font-size: 14px;
  font-weight: 700;
  transition: color 0.3s;
}

.strength-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.25);
  overflow: hidden;
}

.strength-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease, background-color 0.4s ease;
}

.strength-hint {
  margin-top: 7px;
  font-size: 12px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

/* ---------- 分割线 ---------- */
.divider {
  height: 1px;
  margin: 22px 0;
  background: linear-gradient(
    to right,
    transparent,
    rgba(148, 163, 184, 0.35),
    transparent
  );
}

/* ---------- 控制区 ---------- */
.control-block {
  margin-bottom: 20px;
}

.control-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.control-name {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.option-summary {
  font-size: 12px;
  color: #94a3b8;
}

/* ---------- 长度滑块 ---------- */
.length-badge {
  min-width: 44px;
  text-align: center;
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  font-weight: 700;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.length-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    #60a5fa 0%,
    #3b82f6 var(--fill, 20%),
    rgba(148, 163, 184, 0.3) var(--fill, 20%)
  );
  outline: none;
  cursor: pointer;
  margin: 6px 0 4px;
}

.length-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 2.5px solid #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
  cursor: grab;
  transition: transform 0.15s;
}

.length-slider::-webkit-slider-thumb:hover {
  transform: scale(1.18);
}

.length-slider:active::-webkit-slider-thumb {
  cursor: grabbing;
}

.length-slider::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.3);
}

.length-slider::-moz-range-progress {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, #60a5fa, #3b82f6);
}

.length-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 2.5px solid #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
  cursor: grab;
  transition: transform 0.15s;
}

.length-slider::-moz-range-thumb:hover {
  transform: scale(1.18);
}

.range-marks {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}

/* ---------- 长度快捷预设 ---------- */
.length-presets {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  justify-content: center;
}

.preset-button {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s;
}

.preset-button:hover {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.5);
}

.preset-button.active {
  color: #2563eb;
  border-color: #2563eb;
  background: rgba(59, 130, 246, 0.15);
}

/* ---------- 字符选项 ---------- */
.char-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.char-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
}

.char-option:hover {
  border-color: rgba(59, 130, 246, 0.5);
}

.char-option:focus-within {
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.3);
}

.char-option.active {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(59, 130, 246, 0.09);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
}

.char-option input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.checkbox-box {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid #94a3b8;
  background: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
  transition: all 0.2s;
}

.char-option.active .checkbox-box {
  background: #3b82f6;
  border-color: #3b82f6;
}

.checkbox-box svg {
  width: 11px;
  height: 11px;
  opacity: 0;
  transform: scale(0.4);
  transition: all 0.2s;
}

.char-option.active .checkbox-box svg {
  opacity: 1;
  transform: scale(1);
}

.option-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.option-name {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.option-sample {
  font-size: 11px;
  color: #94a3b8;
  font-family: Consolas, Menlo, monospace;
}

.warning-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #f87171;
}

/* ---------- 排除易混淆字符 ---------- */
.exclude-ambiguous {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 4px;
}

.hint {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}

/* ===== 符号筛选样式 ===== */
.symbol-filter-wrap {
  margin-top: 12px;
  border-top: 1px dashed rgba(148, 163, 184, 0.3);
  padding-top: 12px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 0;
  background: none;
  border: none;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.2s;
}

.filter-toggle:hover {
  color: #1e293b;
}

.filter-toggle-text {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-stats {
  font-size: 11px;
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.15);
  padding: 1px 10px;
  border-radius: 20px;
}

.filter-arrow {
  font-size: 12px;
  transition: transform 0.25s ease;
  color: #94a3b8;
}

.filter-arrow.open {
  transform: rotate(180deg);
}

.symbol-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0 6px 0;
  animation: fade-up 0.2s ease;
}

.symbol-tag {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px 4px 8px;
  border-radius: 8px;
  border: 1.5px solid rgba(148, 163, 184, 0.3);
  background: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-family: Consolas, Menlo, monospace;
  cursor: pointer;
  transition: all 0.2s;
  color: #1e293b;
}

.symbol-tag:hover {
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.08);
}

.symbol-tag.excluded {
  border-color: #f87171;
  background: rgba(248, 113, 113, 0.1);
  color: #dc2626;
  text-decoration: line-through;
  opacity: 0.7;
}

.symbol-tag .symbol-status {
  font-size: 10px;
  width: 14px;
  text-align: center;
}

.symbol-tag.excluded .symbol-status {
  color: #dc2626;
}

.symbol-tag:not(.excluded) .symbol-status {
  color: #22c55e;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  width: 100%;
}

.filter-action-btn {
  padding: 4px 14px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-action-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.08);
  border-color: #60a5fa;
}

.filter-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---------- 生成按钮 ---------- */
.generate-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 14px 16px;
  margin-top: 4px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #4f8ef7 0%, #2563eb 100%);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
  cursor: pointer;
  box-shadow: 0 5px 16px rgba(37, 99, 235, 0.35);
  transition: all 0.2s;
}

.generate-btn svg {
  width: 17px;
  height: 17px;
}

.generate-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.42);
}

.generate-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
}

.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* ---------- 本地处理说明 ---------- */
.local-note {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
  flex-wrap: wrap;
}

.local-note svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

/* ---------- 移动端适配 ---------- */
@media (max-width: 560px) {
  .tool-card {
    padding: 20px 16px;
    border-radius: 16px;
  }

  .password-row {
    gap: 8px;
  }

  .password-display {
    font-size: 13px;
    padding: 12px 10px;
  }

  .copy-btn {
    padding: 0 14px;
  }

  .symbol-grid {
    gap: 5px;
  }

  .symbol-tag {
    padding: 3px 8px 3px 6px;
    font-size: 13px;
  }
}

@media (min-width: 620px) {
  .char-options {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
