<script setup>
import { ref, reactive, watch } from 'vue'
import { clampInt } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { randomIntBetween, randomPick, secureShuffle } from '@/utils/random'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/* ============ 标准 Lorem Ipsum 词汇库（约 110 个拉丁词，组件常量） ============ */
const VOCAB = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi',
  'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
  'voluptate', 'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur', 'excepteur',
  'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
  'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'etiam', 'curabitur', 'donec', 'vitae',
  'sapien', 'risus', 'quam', 'arcu', 'turpis', 'leo', 'mauris', 'nibh', 'justo', 'tellus',
  'imperdiet', 'auctor', 'bibendum', 'dictum', 'posuere', 'hendrerit', 'faucibus', 'luctus',
  'pellentesque', 'vestibulum', 'elementum', 'fringilla', 'sollicitudin', 'scelerisque',
  'praesent', 'suscipit', 'phasellus', 'vivamus', 'sagittis', 'blandit', 'dignissim',
  'porttitor', 'molestie', 'tristique', 'aliquam', 'malesuada', 'tincidunt', 'vulputate',
  'lobortis', 'ornare', 'fermentum', 'accumsan', 'egestas', 'rhoncus', 'venenatis', 'lacus',
  'tortor', 'feugiat', 'ultrices',
]

/** 经典开头（固定五词，组件常量） */
const CLASSIC_START = ['lorem', 'ipsum', 'dolor', 'sit', 'amet']

const MODES = [
  { value: 'paragraphs', labelKey: 'modeParagraphs' },
  { value: 'sentences', labelKey: 'modeSentences' },
  { value: 'words', labelKey: 'modeWords' },
]

const COUNT_MIN = 1
const COUNT_MAX = 100
const COUNT_FALLBACK = 3


/** 模式与数量设置持久化 */
const config = useStorage('tool-lorem-ipsum-config', {
  mode: 'paragraphs',
  count: COUNT_FALLBACK,
  startClassic: true,
})
if (!MODES.some(m => m.value === config.value.mode)) {
  config.value.mode = 'paragraphs'
}

const output = ref('')
const stats = reactive({ words: 0, chars: 0, paragraphs: 0 })

/**
 * 组一句：首字母大写、句号结尾
 * @param {string[]|null} startWords - 需要放在句首的固定词（经典开头）
 */
function buildSentence(startWords) {
  const words = []
  if (Array.isArray(startWords)) {
    words.push(...startWords)
  }
  const extra = randomIntBetween(5, 11)
  for (let i = 0; i < extra; i++) {
    words.push(randomPick(VOCAB))
  }
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

/** 组一段：4~7 句，可选以经典开头起始 */
function buildParagraph(useClassicStart) {
  const sentenceCount = randomIntBetween(4, 7)
  const sentences = []
  for (let i = 0; i < sentenceCount; i++) {
    sentences.push(buildSentence(i === 0 && useClassicStart ? CLASSIC_START : null))
  }
  return sentences.join(' ')
}

/** 按总词数生成：先放经典开头，再用 secureShuffle 洗牌后的词库按序取词 */
function buildWords(total, useClassicStart) {
  const words = []
  const start = useClassicStart ? CLASSIC_START : []
  for (const w of start) {
    if (words.length < total) words.push(w)
  }
  let pool = secureShuffle(VOCAB)
  let pi = 0
  while (words.length < total) {
    if (pi >= pool.length) {
      pool = secureShuffle(VOCAB)
      pi = 0
    }
    words.push(pool[pi++])
  }
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function updateStats() {
  const trimmed = output.value.trim()
  stats.words = trimmed ? trimmed.split(/\s+/).length : 0
  stats.chars = output.value.length
  stats.paragraphs = trimmed ? trimmed.split(/\n\n+/).length : 0
}

/** 生成假文（silent 为 true 时不弹提示，用于首次进入页面） */
function generate(silent = false) {
  try {
    config.value.count = clampInt(config.value.count, COUNT_MIN, COUNT_MAX, COUNT_FALLBACK)
    let text = ''
    if (config.value.mode === 'words') {
      text = buildWords(config.value.count, config.value.startClassic)
    } else if (config.value.mode === 'sentences') {
      const sentences = []
      for (let i = 0; i < config.value.count; i++) {
        sentences.push(buildSentence(i === 0 && config.value.startClassic ? CLASSIC_START : null))
      }
      text = sentences.join(' ')
    } else {
      const paras = []
      for (let i = 0; i < config.value.count; i++) {
        paras.push(buildParagraph(i === 0 && config.value.startClassic))
      }
      text = paras.join('\n\n')
    }
    output.value = text
    updateStats()
    if (!silent) {
      toast.success(t('tools.loremIpsum.toastGenerated'))
    }
  } catch {
    output.value = ''
    updateStats()
    toast.error(t('toolsCommon.error'))
  }
}

// 模式 / 数量 / 开关变化时自动重新生成
watch(
  () => [config.value.mode, config.value.count, config.value.startClassic],
  () => generate(true)
)

generate(true)
</script>

<template>
  <ToolPage tool-id="loremIpsum">
    <!-- 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>

      <span class="label-base">{{ t('tools.loremIpsum.mode') }}</span>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('tools.loremIpsum.mode')">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          class="btn-ghost"
          :class="config.mode === m.value ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
          :aria-pressed="config.mode === m.value ? 'true' : 'false'"
          @click="config.mode = m.value"
        >
          {{ t(`tools.loremIpsum.${m.labelKey}`) }}
        </button>
      </div>

      <div class="mt-4 max-w-xl">
        <label class="label-base" for="lorem-count">
          {{ t('tools.loremIpsum.count') }}: {{ config.count }}
        </label>
        <div class="flex items-center gap-3">
          <div class="w-20 shrink-0">
            <input
              id="lorem-count"
              v-model.number="config.count"
              type="number"
              :min="COUNT_MIN"
              :max="COUNT_MAX"
              class="input-base text-center font-mono"
              :aria-label="t('tools.loremIpsum.count')"
            />
          </div>
          <input
            v-model.number="config.count"
            type="range"
            :min="COUNT_MIN"
            :max="COUNT_MAX"
            class="min-w-0 flex-1 accent-blue-600"
            :aria-label="t('tools.loremIpsum.count')"
          />
        </div>
      </div>

      <label class="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input v-model="config.startClassic" type="checkbox" class="accent-blue-600" />
        {{ t('tools.loremIpsum.startClassic') }}
      </label>

      <div class="mt-4">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="generate()">
          {{ t('tools.loremIpsum.regenerate') }}
        </button>
      </div>
    </section>

    <!-- 生成结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('toolsCommon.result') }}</h2>
        <CopyButton :text="output" :disabled="!output" />
      </div>

      <textarea
        v-model="output"
        rows="14"
        readonly
        class="input-base w-full font-mono text-sm leading-relaxed"
        :aria-label="t('toolsCommon.result')"
      ></textarea>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
        <span>{{ t('toolsCommon.words') }}: <span class="font-mono">{{ stats.words }}</span></span>
        <span>{{ t('toolsCommon.chars') }}: <span class="font-mono">{{ stats.chars }}</span></span>
        <span>{{ t('tools.loremIpsum.paragraphs') }}: <span class="font-mono">{{ stats.paragraphs }}</span></span>
      </div>
    </section>
  </ToolPage>
</template>
