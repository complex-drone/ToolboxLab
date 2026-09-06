<script setup>
import { ref, computed, watch } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/** 修饰符偏好持久化（只存选项，不存大段文本） */
const config = useStorage('tool-regex-tester-config', {
  flags: ['g'],
})

const FLAGS = [
  { value: 'g', labelKey: 'flagG' },
  { value: 'i', labelKey: 'flagI' },
  { value: 'm', labelKey: 'flagM' },
  { value: 's', labelKey: 'flagS' },
  { value: 'u', labelKey: 'flagU' },
  { value: 'y', labelKey: 'flagY' },
]

/** v-model 安全层：存储值若被破坏（非数组）也不会让页面崩溃 */
const flagModel = computed({
  get: () => (Array.isArray(config.value.flags) ? config.value.flags : []),
  set: value => {
    config.value.flags = Array.isArray(value) ? value : []
  },
})

/**
 * 常用示例：正则含竖线、@、花括号等特殊字符，
 * 必须放在 JS 常量中，禁止写进语言包
 */
const PATTERN_PLACEHOLDER = '例如：\\w+ 或 \\d{3}-\\d{8}'

const PRESETS = [
  {
    key: 'Email',
    pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
    sample: '请联系 alice@example.com 或 bob.test@mail.co.uk；无效输入：foo@bar',
  },
  {
    key: 'Phone',
    pattern: '1[3-9]\\d{9}',
    sample: '座机：021-88886666；手机号：13812345678、19987654321。',
  },
  {
    key: 'Url',
    pattern: 'https?://[^\\s/]+(?:/[^\\s]*)?',
    sample: '访问 https://example.com/docs?page=1 或 http://test.org 获取更多帮助。',
  },
]

/** 性能保护：最多收集 1000 条匹配 */
const MAX_MATCHES = 1000

const pattern = ref('')
const text = ref('')
const debouncedPattern = ref('')
const debouncedText = ref('')

const syncDebounced = useDebounceFn(() => {
  debouncedPattern.value = pattern.value
  debouncedText.value = text.value
}, 300)

watch([pattern, text], () => syncDebounced())

/** HTML 转义，防止 v-html 渲染用户文本时产生 XSS */

/** 解析正则并收集匹配：任何非法输入都在这里被捕获，绝不抛到页面 */
const matchState = computed(() => {
  const source = debouncedPattern.value
  const input = debouncedText.value
  if (!source) {
    return { error: '', empty: true, matches: [] }
  }
  const flagStr = flagModel.value.join('')
  let re
  try {
    re = new RegExp(source, flagStr)
  } catch (err) {
    return { error: err && err.message ? err.message : 'Invalid RegExp', empty: false, matches: [] }
  }
  const matches = []
  try {
    if (re.global || re.sticky) {
      let m
      while ((m = re.exec(input)) !== null) {
        matches.push(m)
        // 空匹配时手动前进，避免死循环
        if (m[0].length === 0) re.lastIndex += 1
        if (matches.length >= MAX_MATCHES) break
      }
    } else {
      const m = re.exec(input)
      if (m) matches.push(m)
    }
  } catch (err) {
    return { error: err && err.message ? err.message : 'Match failed', empty: false, matches: [] }
  } finally {
    re.lastIndex = 0
  }
  return { error: '', empty: false, matches }
})

const regexError = computed(() => matchState.value.error)

// 正则从合法变为非法时给出一次 Toast 提示（行内提示常驻）
watch(regexError, (val, old) => {
  if (val && !old) {
    toast.error(t('toolsCommon.invalidInput'))
  }
})

/** 高亮 HTML：先整体分段转义，再为匹配片段包上 mark 标签 */
const highlightedHtml = computed(() => {
  const input = debouncedText.value
  if (!input) return ''
  const state = matchState.value
  if (state.error || state.empty || state.matches.length === 0) {
    return escapeHtml(input)
  }
  let html = ''
  let last = 0
  for (const m of state.matches) {
    const start = m.index
    const end = start + m[0].length
    if (start < last) continue
    html += escapeHtml(input.slice(last, start))
    if (m[0].length === 0) {
      html += '<mark class="rx-hl rx-hl-empty"></mark>'
    } else {
      html += `<mark class="rx-hl">${escapeHtml(input.slice(start, end))}</mark>`
    }
    last = Math.max(last, end)
  }
  html += escapeHtml(input.slice(last))
  return html
})

const noMatchesHint = computed(() => {
  if (matchState.value.empty) return t('tools.regexTester.emptyPatternHint')
  return t('tools.regexTester.noMatches')
})

function applyPreset(preset) {
  pattern.value = preset.pattern
  text.value = preset.sample
  // 立即同步，免去 300ms 防抖等待
  debouncedPattern.value = preset.pattern
  debouncedText.value = preset.sample
}
</script>

<template>
  <ToolPage tool-id="regexTester">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="regex-pattern">{{ t('tools.regexTester.pattern') }}</label>
      <input
        id="regex-pattern"
        v-model="pattern"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="input-base font-mono"
        :class="regexError ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
        :placeholder="PATTERN_PLACEHOLDER || t('tools.regexTester.patternPlaceholder')"
        :aria-invalid="regexError ? 'true' : 'false'"
        :aria-label="t('tools.regexTester.pattern')"
      />

      <!-- 修饰符 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.regexTester.flags') }}</span>
        <label
          v-for="f in FLAGS"
          :key="f.value"
          class="chip cursor-pointer select-none"
          :class="{ 'opacity-50': !flagModel.includes(f.value) }"
        >
          <input v-model="flagModel" type="checkbox" :value="f.value" class="mr-1 accent-blue-600" />
          <span class="font-mono font-semibold">{{ f.value }}</span>
          <span class="ml-1">{{ t(`tools.regexTester.${f.labelKey}`) }}</span>
        </label>
      </div>

      <!-- 常用示例 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.regexTester.presets') }}</span>
        <button
          v-for="p in PRESETS"
          :key="p.key"
          type="button"
          class="btn-ghost"
          @click="applyPreset(p)"
        >
          {{ t(`tools.regexTester.preset${p.key}`) }}
        </button>
      </div>

      <label class="label-base mt-4" for="regex-text">{{ t('tools.regexTester.testText') }}</label>
      <textarea
        id="regex-text"
        v-model="text"
        rows="6"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.regexTester.textPlaceholder')"
        :aria-label="t('tools.regexTester.testText')"
      ></textarea>

      <!-- 行内错误提示 -->
      <p v-if="regexError" class="mt-2 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.regexTester.invalidRegex') }}: {{ regexError }}
      </p>
    </section>

    <!-- 结果区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('toolsCommon.result') }}</h2>
        <span v-if="!matchState.empty && !regexError" class="chip font-mono">
          {{ t('tools.regexTester.matchCount', { n: matchState.matches.length }) }}
        </span>
      </div>

      <div class="section-title">{{ t('tools.regexTester.highlight') }}</div>
      <!-- v-html 内容已全部经过 escapeHtml 转义 -->
      <div
        v-if="debouncedText"
        class="rx-preview rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-800"
        v-html="highlightedHtml"
      ></div>
      <p v-else class="text-sm text-slate-400">{{ t('tools.regexTester.emptyTextHint') }}</p>

      <div class="section-title mt-5">{{ t('tools.regexTester.matches') }}</div>
      <ol v-if="matchState.matches.length" class="space-y-2">
        <li
          v-for="(m, i) in matchState.matches"
          :key="i"
          class="rounded-xl border border-slate-100 bg-white/70 p-3"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="chip font-mono shrink-0">{{ i + 1 }}</span>
            <code class="flex-1 min-w-0 font-mono text-sm text-slate-800 break-all">
              {{ m[0] === '' ? t('tools.regexTester.emptyMatch') : m[0] }}
            </code>
            <span class="shrink-0 text-xs text-slate-400 font-mono">
              {{ t('tools.regexTester.indexLabel') }} {{ m.index }}
            </span>
          </div>
          <!-- 捕获分组：未参与匹配的组显示为空 -->
          <div v-if="m.length > 1" class="mt-2 grid gap-1 border-t border-slate-100 pt-2">
            <div v-for="gi in m.length - 1" :key="gi" class="flex gap-2 text-xs text-slate-500">
              <span class="shrink-0 font-medium text-slate-600">{{ t('tools.regexTester.group', { n: gi }) }}</span>
              <code class="min-w-0 font-mono break-all">{{ m[gi] === undefined ? '' : m[gi] }}</code>
            </div>
          </div>
          <!-- 命名分组 -->
          <div v-if="m.groups" class="mt-2 grid gap-1">
            <div v-for="(val, name) in m.groups" :key="name" class="flex gap-2 text-xs text-slate-500">
              <span class="shrink-0 font-medium text-slate-600">{{ name }}</span>
              <code class="min-w-0 font-mono break-all">{{ val === undefined || val === null ? '' : val }}</code>
            </div>
          </div>
        </li>
      </ol>
      <p v-else class="text-sm text-slate-400">{{ noMatchesHint }}</p>

      <p v-if="matchState.matches.length >= MAX_MATCHES" class="mt-2 text-xs text-amber-600">
        {{ t('tools.regexTester.truncated', { n: MAX_MATCHES }) }}
      </p>
    </section>
  </ToolPage>
</template>

<style scoped>
.rx-preview {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

.rx-preview :deep(mark.rx-hl) {
  background-color: #fde047;
  color: #854d0e;
  border-radius: 3px;
  padding: 0 1px;
}

/* 空匹配：显示为一个细小的黄色竖条标记 */
.rx-preview :deep(mark.rx-hl-empty) {
  display: inline-block;
  width: 3px;
  height: 1em;
  padding: 0;
  vertical-align: text-bottom;
}
</style>
