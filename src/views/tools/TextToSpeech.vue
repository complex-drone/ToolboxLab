<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 文本转语音：基于 Web Speech API（speechSynthesis）
 * - 音色列表按所选语言过滤，voices 异步加载（监听 voiceschanged + 兜底重试）
 * - 语速 / 音调 / 音量滑块与语言持久化，朗读文本不持久化
 * - onboundary 事件按 charIndex 估算朗读进度，onend / onerror 复位状态
 */
const { t } = useI18n()
const toast = useToast()

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

const config = useStorage('tool-text-to-speech-config', {
  lang: 'zh-CN',
  rate: 1,
  pitch: 1,
  volume: 1,
})

const LANG_OPTIONS = [
  { value: 'zh-CN', key: 'langZh' },
  { value: 'en-US', key: 'langEn' },
  { value: 'ja-JP', key: 'langJa' },
]

const text = ref('')
const voices = ref([])
const selectedVoiceURI = ref('')
const status = ref('idle') // idle | speaking | paused
const progress = ref(0)

let retryTimer = null
let activeUtterance = null

const charCount = computed(() => text.value.length)

const filteredVoices = computed(() => {
  const lang = (config.value.lang || '').toLowerCase()
  return voices.value.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang))
})

const activeVoice = computed(() =>
  filteredVoices.value.find(v => v.voiceURI === selectedVoiceURI.value) || null
)

const statusKey = computed(() => {
  if (status.value === 'speaking') return 'statusSpeaking'
  if (status.value === 'paused') return 'statusPaused'
  return 'statusIdle'
})

const statusClass = computed(() => {
  if (status.value === 'speaking') return 'bg-emerald-100 text-emerald-700'
  if (status.value === 'paused') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-500'
})

watch(filteredVoices, list => {
  if (!list.some(v => v.voiceURI === selectedVoiceURI.value)) {
    selectedVoiceURI.value = list.length ? list[0].voiceURI : ''
  }
})

function loadVoices() {
  if (!supported) return
  try {
    voices.value = window.speechSynthesis.getVoices() || []
  } catch {
    voices.value = []
  }
}

function onVoicesChanged() {
  loadVoices()
}

function cancelSpeech() {
  if (!supported) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* 忽略 */
  }
}

function speak() {
  if (!supported) return
  const content = text.value.trim()
  if (!content) {
    toast.info(t('tools.textToSpeech.emptyText'))
    return
  }
  cancelSpeech()
  activeUtterance = null
  const utterance = new SpeechSynthesisUtterance(content)
  utterance.lang = config.value.lang
  if (activeVoice.value) utterance.voice = activeVoice.value
  utterance.rate = Number(config.value.rate) || 1
  const pitchNum = Number(config.value.pitch)
  utterance.pitch = Number.isFinite(pitchNum) ? Math.min(2, Math.max(0, pitchNum)) : 1
  const volumeNum = Number(config.value.volume)
  utterance.volume = Number.isFinite(volumeNum) ? Math.min(1, Math.max(0, volumeNum)) : 1

  utterance.onboundary = e => {
    if (activeUtterance !== utterance || status.value === 'paused') return
    const total = content.length || 1
    progress.value = Math.min(100, Math.round(((e.charIndex || 0) / total) * 100))
  }
  utterance.onend = () => {
    if (activeUtterance !== utterance) return
    activeUtterance = null
    status.value = 'idle'
    progress.value = 100
  }
  utterance.onpause = () => {
    if (activeUtterance !== utterance) return
    status.value = 'paused'
  }
  utterance.onresume = () => {
    if (activeUtterance !== utterance) return
    status.value = 'speaking'
  }
  utterance.onerror = e => {
    if (activeUtterance !== utterance) return
    activeUtterance = null
    const err = e && e.error
    if (err !== 'interrupted' && err !== 'canceled') {
      toast.error(t('tools.textToSpeech.speakFailed'))
    }
    status.value = 'idle'
    progress.value = 0
  }

  progress.value = 0
  activeUtterance = utterance
  status.value = 'speaking'
  try {
    window.speechSynthesis.speak(utterance)
  } catch {
    status.value = 'idle'
    toast.error(t('tools.textToSpeech.speakFailed'))
  }
}

function pauseSpeech() {
  if (!supported || status.value !== 'speaking') return
  try {
    window.speechSynthesis.pause()
    status.value = 'paused'
  } catch {
    /* 忽略 */
  }
}

function resumeSpeech() {
  if (!supported || status.value !== 'paused') return
  try {
    window.speechSynthesis.resume()
    status.value = 'speaking'
  } catch {
    /* 忽略 */
  }
}

function stopSpeech() {
  activeUtterance = null
  cancelSpeech()
  status.value = 'idle'
  progress.value = 0
}

onMounted(() => {
  if (!supported) return
  loadVoices()
  window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
  // 部分浏览器 voices 异步就绪且不触发 voiceschanged，做一次兜底重试
  retryTimer = setTimeout(loadVoices, 600)
})

onBeforeUnmount(() => {
  if (!supported) return
  window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  activeUtterance = null
  cancelSpeech()
})
</script>

<template>
  <ToolPage tool-id="textToSpeech">
    <!-- 特性检测：不支持语音合成 -->
    <section v-if="!supported" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-start gap-3">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium flex-shrink-0">
          {{ t('toolsCommon.error') }}
        </span>
        <p class="text-sm text-slate-600 leading-relaxed">{{ t('tools.textToSpeech.unsupported') }}</p>
      </div>
    </section>

    <template v-else>
      <!-- 文本输入 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center gap-2 mb-1.5">
          <label for="tts-text" class="label-base flex-1 mb-0">{{ t('tools.textToSpeech.inputLabel') }}</label>
          <span class="text-xs text-slate-400">{{ charCount }} {{ t('toolsCommon.chars') }}</span>
        </div>
        <textarea
          id="tts-text"
          v-model="text"
          class="input-base w-full h-36 resize-y"
          :placeholder="t('tools.textToSpeech.inputPlaceholder')"
        ></textarea>
      </section>

      <!-- 语言 / 音色 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title mb-3">{{ t('toolsCommon.settings') }}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="tts-lang" class="label-base">{{ t('tools.textToSpeech.language') }}</label>
            <select id="tts-lang" v-model="config.lang" class="input-base w-full">
              <option v-for="opt in LANG_OPTIONS" :key="opt.value" :value="opt.value">
                {{ t(`tools.textToSpeech.${opt.key}`) }}
              </option>
            </select>
          </div>
          <div>
            <label for="tts-voice" class="label-base">{{ t('tools.textToSpeech.voice') }}</label>
            <select id="tts-voice" v-model="selectedVoiceURI" class="input-base w-full">
              <option value="">{{ t('tools.textToSpeech.voiceDefault') }}</option>
              <option v-for="voice in filteredVoices" :key="voice.voiceURI" :value="voice.voiceURI">
                {{ voice.name }}（{{ voice.lang }}）
              </option>
            </select>
          </div>
        </div>

        <p v-if="voices.length === 0" class="mt-3 text-xs text-amber-600">
          {{ t('tools.textToSpeech.voicesLoading') }}
        </p>
        <p v-else-if="filteredVoices.length === 0" class="mt-3 text-xs text-amber-600">
          {{ t('tools.textToSpeech.noVoiceHint') }}
        </p>

        <!-- 语速 / 音调 / 音量 -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="label-base mb-0">{{ t('tools.textToSpeech.rate') }}</span>
              <span class="text-xs text-slate-500 font-mono">x{{ Number(config.rate).toFixed(1) }}</span>
            </div>
            <input v-model.number="config.rate" type="range" min="0.5" max="2" step="0.1" class="w-full accent-blue-600" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="label-base mb-0">{{ t('tools.textToSpeech.pitch') }}</span>
              <span class="text-xs text-slate-500 font-mono">{{ Number(config.pitch).toFixed(1) }}</span>
            </div>
            <input v-model.number="config.pitch" type="range" min="0" max="2" step="0.1" class="w-full accent-blue-600" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="label-base mb-0">{{ t('tools.textToSpeech.volume') }}</span>
              <span class="text-xs text-slate-500 font-mono">{{ Math.round(Number(config.volume) * 100) }}%</span>
            </div>
            <input v-model.number="config.volume" type="range" min="0" max="1" step="0.05" class="w-full accent-blue-600" />
          </div>
        </div>
      </section>

      <!-- 播放控制 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="!text.trim() || status === 'speaking'"
            @click="speak"
          >
            {{ t('tools.textToSpeech.speak') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="status !== 'speaking'"
            @click="pauseSpeech"
          >
            {{ t('tools.textToSpeech.pause') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="status !== 'paused'"
            @click="resumeSpeech"
          >
            {{ t('tools.textToSpeech.resume') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="status === 'idle'"
            @click="stopSpeech"
          >
            {{ t('tools.textToSpeech.stop') }}
          </button>
          <span class="chip ml-auto" :class="statusClass">{{ t(`tools.textToSpeech.${statusKey}`) }}</span>
        </div>

        <!-- 朗读进度 -->
        <div class="mt-4">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-slate-500">{{ t('tools.textToSpeech.progress') }}</span>
            <span class="text-xs text-slate-400 font-mono">{{ progress }}%</span>
          </div>
          <div class="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              class="h-full rounded-full bg-blue-500 transition-all duration-200"
              :style="{ width: progress + '%' }"
            ></div>
          </div>
        </div>
      </section>
    </template>
  </ToolPage>
</template>
