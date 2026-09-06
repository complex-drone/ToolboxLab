<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 摩斯密码：
 * - 双向实时转换（防抖 200ms）：文本→摩斯 / 摩斯→文本
 * - 码表（A-Z、0-9、常用标点）放组件常量，点用「.」划用「-」，
 *   字母间空格、单词间「 / 」，反向解析兼容「|」作单词分隔
 * - 播放：Web Audio（AudioContext + OscillatorNode，600Hz），
 *   在 AudioContext 时间轴上整体 schedule（非逐个 setTimeout），
 *   点 100ms / 划 300ms，符号间 100ms、字母间 200ms、单词间 500ms，可调速度倍率
 * - 停止：cancelScheduledValues + close，卸载时清理
 */
const { t } = useI18n()
const toast = useToast()

/** 持久化：方向与播放速度倍率 */
const config = useStorage('tool-morse-code-config', {
  direction: 'encode',
  speed: 1,
})

/** 字符 → 摩斯码表 */
const MORSE_TABLE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
}
const REVERSE_TABLE = Object.fromEntries(
  Object.entries(MORSE_TABLE).map(([char, code]) => [code, char])
)
/** 未知摩斯序列在解码结果中的占位符 */
const UNKNOWN_MARK = '#'

// 播放参数（毫秒），速度倍率在此基础上缩放
const TONE_HZ = 600
const DOT_MS = 100
const DASH_MS = 300
const GAP_SYMBOL_MS = 100
const GAP_LETTER_MS = 200
const GAP_WORD_MS = 500

// ---------- 状态 ----------
const direction = ref(config.value.direction === 'decode' ? 'decode' : 'encode')
const speed = ref([0.5, 1, 2].includes(config.value.speed) ? config.value.speed : 1)
const sourceText = ref(direction.value === 'encode' ? 'Hello ToolboxLab' : '.... . .-.. .-.. --- / - --- --- .-.. -... --- -..- .-.. .- -...')
const outputText = ref('')
const warnMessage = ref('')
const warnChars = ref([])
const isPlaying = ref(false)

const wordSeparator = ' / '

/** 文本 → 摩斯 */
function encodeMorse(text) {
  const unsupported = new Set()
  const words = text.trim().split(/\s+/).filter(Boolean)
  const encodedWords = words.map(word => {
    const codes = []
    for (const ch of word) {
      const code = MORSE_TABLE[ch.toUpperCase()]
      if (code) {
        codes.push(code)
      } else {
        unsupported.add(ch)
      }
    }
    return codes.join(' ')
  }).filter(Boolean)
  return { result: encodedWords.join(wordSeparator), unsupported: [...unsupported] }
}

/** 摩斯 → 文本（兼容「|」作单词分隔符） */
function decodeMorse(text) {
  let unknownCount = 0
  const words = text.trim().split(/[/|]+/).filter(w => w.trim())
  const decodedWords = words.map(word =>
    word
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(token => {
        const char = REVERSE_TABLE[token]
        if (char) return char
        unknownCount += 1
        return UNKNOWN_MARK
      })
      .join('')
  )
  return { result: decodedWords.join(' '), unknownCount }
}

function runConvert() {
  const raw = sourceText.value
  try {
    if (!raw.trim()) {
      outputText.value = ''
      warnMessage.value = ''
      warnChars.value = []
      return
    }
    if (direction.value === 'encode') {
      const { result, unsupported } = encodeMorse(raw)
      outputText.value = result
      warnChars.value = unsupported
      warnMessage.value = unsupported.length ? t('tools.morseCode.unsupportedChars') : ''
    } else {
      const { result, unknownCount } = decodeMorse(raw)
      outputText.value = result
      warnChars.value = []
      warnMessage.value = unknownCount > 0 ? t('tools.morseCode.unknownSequences', { n: unknownCount }) : ''
    }
  } catch {
    outputText.value = ''
    warnMessage.value = t('toolsCommon.error')
    warnChars.value = []
  }
}
const debouncedConvert = useDebounceFn(runConvert, 200)

watch([sourceText, direction], () => {
  debouncedConvert()
})

function setDirection(value) {
  if (direction.value === value) return
  stopPlayback()
  direction.value = value
  // 切换方向时把原输出作为新输入，方便来回验证
  if (outputText.value.trim()) {
    sourceText.value = outputText.value
  }
  runConvert()
}

function clearSource() {
  stopPlayback()
  sourceText.value = ''
  runConvert()
}

// ---------- 音频播放 ----------
let audioCtx = null
let oscNode = null
let gainNode = null

/** 在 AudioContext 时间轴上生成 { start, duration }（秒）播放计划 */
function buildSchedule(morse, rate) {
  const events = []
  const dot = DOT_MS / 1000 / rate
  const dash = DASH_MS / 1000 / rate
  const gapSymbol = GAP_SYMBOL_MS / 1000 / rate
  const gapLetter = GAP_LETTER_MS / 1000 / rate
  const gapWord = GAP_WORD_MS / 1000 / rate
  let time = 0
  const words = morse.split(wordSeparator)
  words.forEach((word, wi) => {
    const letters = word.trim().split(/\s+/).filter(Boolean)
    letters.forEach((letter, li) => {
      for (const sym of letter) {
        if (sym !== '.' && sym !== '-') continue
        const duration = sym === '-' ? dash : dot
        events.push({ start: time, duration })
        time += duration + gapSymbol
      }
      if (li < letters.length - 1) {
        time += gapLetter - gapSymbol
      }
    })
    if (wi < words.length - 1) {
      time += gapWord - gapSymbol
    }
  })
  return { events, total: time }
}

function closeAudio() {
  try {
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close()
    }
  } catch {
    // 忽略关闭异常
  }
  audioCtx = null
  oscNode = null
  gainNode = null
}

function stopPlayback() {
  const wasPlaying = isPlaying.value
  isPlaying.value = false
  try {
    if (gainNode && audioCtx) {
      const now = audioCtx.currentTime
      gainNode.gain.cancelScheduledValues(now)
      gainNode.gain.setValueAtTime(0, now)
    }
    if (oscNode) {
      oscNode.onended = null
      try {
        oscNode.stop()
      } catch {
        // 尚未 start 过的节点 stop 会抛错，忽略
      }
    }
  } catch {
    // 忽略停止异常
  }
  if (wasPlaying) closeAudio()
}

async function play() {
  if (isPlaying.value) return
  const morse = outputText.value.trim()
  if (!morse) return
  if (direction.value !== 'encode') return
  stopPlayback()
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) throw new Error('AudioContext unavailable')
    audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    const rate = speed.value || 1
    const { events, total } = buildSchedule(morse, rate)
    if (!events.length) throw new Error('nothing to play')

    oscNode = audioCtx.createOscillator()
    gainNode = audioCtx.createGain()
    oscNode.type = 'sine'
    oscNode.frequency.value = TONE_HZ
    gainNode.gain.value = 0
    oscNode.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    const startAt = audioCtx.currentTime + 0.1
    const ramp = 0.004
    for (const ev of events) {
      const from = startAt + ev.start
      const to = from + ev.duration
      gainNode.gain.setValueAtTime(0.0001, from)
      gainNode.gain.exponentialRampToValueAtTime(0.35, from + ramp)
      gainNode.gain.setValueAtTime(0.35, Math.max(from + ramp, to - ramp))
      gainNode.gain.exponentialRampToValueAtTime(0.0001, to)
    }

    oscNode.onended = () => {
      isPlaying.value = false
      closeAudio()
    }
    oscNode.start(startAt)
    oscNode.stop(startAt + total + 0.05)
    isPlaying.value = true
  } catch {
    stopPlayback()
    closeAudio()
    toast.error(t('tools.morseCode.audioError'))
  }
}

// 播放中调整速度：先停止，新速度在下次播放生效
watch(speed, () => {
  if (isPlaying.value) stopPlayback()
})

const sourceLabel = computed(() =>
  direction.value === 'encode'
    ? t('tools.morseCode.textLabel')
    : t('tools.morseCode.morseLabel')
)
const sourcePlaceholder = computed(() =>
  direction.value === 'encode'
    ? t('tools.morseCode.textPlaceholder')
    : t('tools.morseCode.morsePlaceholder')
)
const sourceChars = computed(() => [...sourceText.value].length)

onBeforeUnmount(() => {
  stopPlayback()
})
</script>

<template>
  <ToolPage tool-id="morseCode">
    <!-- 方向切换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap gap-1.5" role="tablist" :aria-label="t('tools.morseCode.modeLabel')">
        <button
          type="button"
          role="tab"
          class="px-4 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            direction === 'encode'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="direction === 'encode'"
          @click="setDirection('encode')"
        >
          {{ t('tools.morseCode.modeEncode') }}
        </button>
        <button
          type="button"
          role="tab"
          class="px-4 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            direction === 'decode'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="direction === 'decode'"
          @click="setDirection('decode')"
        >
          {{ t('tools.morseCode.modeDecode') }}
        </button>
      </div>
      <p class="mt-2.5 text-xs text-slate-400">{{ t('tools.morseCode.formatHint') }}</p>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="morse-source">{{ sourceLabel }}</label>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">{{ sourceChars }} {{ t('toolsCommon.chars') }}</span>
          <button
            type="button"
            class="btn-danger"
            :disabled="!sourceText"
            :aria-label="t('toolsCommon.clear')"
            @click="clearSource"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="morse-source"
        v-model="sourceText"
        rows="5"
        class="input-base font-mono resize-y leading-relaxed"
        :placeholder="sourcePlaceholder"
        :aria-label="sourceLabel"
        spellcheck="false"
      ></textarea>

      <p v-if="warnMessage" class="mt-2 text-amber-600 text-sm">
        {{ warnMessage }}
        <template v-if="warnChars.length">
          <span class="font-mono">{{ warnChars.join(' ') }}</span>
        </template>
      </p>
    </section>

    <!-- 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <h2 class="section-title mb-0">{{ t('toolsCommon.output') }}</h2>
        <CopyButton
          :text="outputText"
          :label="t('toolsCommon.copy')"
          :disabled="!outputText"
        />
      </div>
      <div
        class="min-h-[6rem] rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5 overflow-x-auto"
        aria-live="polite"
      >
        <pre
          v-if="outputText"
          class="font-mono text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
        >{{ outputText }}</pre>
        <p v-else class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>
      </div>

      <!-- 播放控制（仅文本转摩斯方向） -->
      <div v-if="direction === 'encode'" class="mt-4 pt-4 border-t border-slate-100">
        <div class="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            class="btn-primary"
            :disabled="!outputText || isPlaying"
            :aria-label="t('tools.morseCode.play')"
            @click="play"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            {{ t('tools.morseCode.play') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!isPlaying"
            :aria-label="t('tools.morseCode.stop')"
            @click="stopPlayback"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            {{ t('tools.morseCode.stop') }}
          </button>
          <span
            v-if="isPlaying"
            class="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium"
          >
            <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true"></span>
            {{ t('tools.morseCode.playing') }}
          </span>
        </div>

        <div class="mt-3 flex items-center gap-3 max-w-xs">
          <label class="text-xs font-medium text-slate-500 shrink-0" for="morse-speed">
            {{ t('tools.morseCode.speedLabel') }}
          </label>
          <input
            id="morse-speed"
            v-model.number="speed"
            type="range"
            min="0.5"
            max="2"
            step="0.5"
            class="flex-1 accent-blue-600"
            :aria-label="t('tools.morseCode.speedLabel')"
          />
          <span class="chip shrink-0 justify-center min-w-[3rem]">{{ speed }}x</span>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
