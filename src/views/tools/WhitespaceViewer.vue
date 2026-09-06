<script setup>
import { ref, computed } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 行号 / 空白字符显示
 * - 左侧输入，右侧渲染带行号的可视化结果（空格 · / Tab → / 行尾 ↵）
 * - 渲染使用 v-html，所有行内容先做 HTML 转义防止 XSS
 * - 三个标记开关 + 标记字符着色 + textarea 与渲染区按比例滚动同步
 */
const { t } = useI18n()

const MAX_RENDER_LINES = 5000

const config = useStorage('tool-whitespace-viewer-config', {
  showSpaces: true,
  showTabs: true,
  showEol: true,
})

const input = ref('')
const textareaRef = ref(null)
const renderRef = ref(null)

const lines = computed(() => input.value.split('\n'))
const lineCount = computed(() => lines.value.length)
const charCount = computed(() => input.value.length)
const isTruncated = computed(() => lineCount.value > MAX_RENDER_LINES)

/** 行号列宽（按最大行号位数自适应，单位 ch） */
const lineNoWidth = computed(() => String(Math.min(lineCount.value, MAX_RENDER_LINES)).length + 2 + 'ch')

/** 标记字符的 HTML 片段（内部常量，含固定类名用于着色） */
const SPACE_MARK = '<span class="ws-mark ws-space">·</span>'
const TAB_MARK = '<span class="ws-mark ws-tab">→</span>'
const EOL_MARK = '<span class="ws-mark ws-eol">↵</span>'


/**
 * 把一行原始文本转成带标记的 HTML
 * @param {string} raw 原始行文本（已可包含任意字符）
 * @param {boolean} withEol 是否追加行尾换行标记
 */
function markLineHtml(raw, withEol) {
  let escaped = escapeHtml(raw)
  const showSpaces = config.value.showSpaces
  const showTabs = config.value.showTabs
  // 空格与 Tab 必须在同一个正则里一次性替换，避免标记 span 的标记属性被二次替换破坏
  if (showSpaces && showTabs) {
    escaped = escaped.replace(/[\t ]/g, ch => (ch === '\t' ? TAB_MARK : SPACE_MARK))
  } else if (showTabs) {
    escaped = escaped.replace(/\t/g, TAB_MARK)
  } else if (showSpaces) {
    escaped = escaped.replace(/ /g, SPACE_MARK)
  }
  return escaped + (config.value.showEol && withEol ? EOL_MARK : '')
}

/** 渲染区 HTML：行号右对齐灰色等宽 + 转义后的行内容 */
const renderedHtml = computed(() => {
  const all = lines.value
  const count = Math.min(all.length, MAX_RENDER_LINES)
  const rows = new Array(count)
  for (let i = 0; i < count; i++) {
    const withEol = i !== all.length - 1
    rows[i] =
      '<div class="ws-row"><span class="ws-no">' +
      (i + 1) +
      '</span><span class="ws-code">' +
      markLineHtml(all[i], withEol) +
      '</span></div>'
  }
  return rows.join('\n')
})

/** 复制用的带标记纯文本（· / → / ↵） */
const markedText = computed(() => {
  if (!input.value) return ''
  const all = lines.value
  const parts = new Array(all.length)
  for (let i = 0; i < all.length; i++) {
    let line = all[i]
    if (config.value.showTabs) line = line.replace(/\t/g, '→')
    if (config.value.showSpaces) line = line.replace(/ /g, '·')
    if (config.value.showEol && i !== all.length - 1) line += '↵'
    parts[i] = line
  }
  return parts.join('\n')
})

/** textarea 滚动时按比例同步渲染区滚动 */
function syncScroll() {
  const ta = textareaRef.value
  const rd = renderRef.value
  if (!ta || !rd) return
  const taMax = ta.scrollHeight - ta.clientHeight
  const rdMax = rd.scrollHeight - rd.clientHeight
  if (taMax <= 0 || rdMax <= 0) return
  rd.scrollTop = (ta.scrollTop / taMax) * rdMax
}

function clearInput() {
  input.value = ''
}
</script>

<template>
  <ToolPage tool-id="whitespaceViewer">
    <!-- 开关与统计 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.showSpaces" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.whitespaceViewer.showSpaces') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.showTabs" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.whitespaceViewer.showTabs') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.showEol" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.whitespaceViewer.showEol') }}
        </label>

        <CopyButton
          class="ml-auto"
          :text="markedText"
          :label="t('tools.whitespaceViewer.copyMarked')"
          :disabled="!input"
        />
        <button type="button" class="btn-danger" :disabled="!input" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-4">
        <span class="chip">{{ t('toolsCommon.total') }} {{ lineCount }} {{ t('toolsCommon.lines') }}</span>
        <span class="chip">{{ charCount }} {{ t('toolsCommon.chars') }}</span>
        <span class="ml-auto text-xs text-slate-400">
          <span class="ws-space-static">·</span> {{ t('tools.whitespaceViewer.legendSpace') }}
          <span class="ml-2 ws-tab-static">→</span> {{ t('tools.whitespaceViewer.legendTab') }}
          <span class="ml-2 ws-eol-static">↵</span> {{ t('tools.whitespaceViewer.legendEol') }}
        </span>
      </div>
    </section>

    <!-- 输入 / 渲染 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="ws-input" class="label-base">{{ t('tools.whitespaceViewer.inputLabel') }}</label>
          <textarea
            id="ws-input"
            ref="textareaRef"
            v-model="input"
            class="input-base w-full font-mono ws-textarea resize-y"
            :placeholder="t('tools.whitespaceViewer.inputPlaceholder')"
            spellcheck="false"
            @scroll="syncScroll"
          ></textarea>
        </div>
        <div>
          <div class="label-base flex items-center gap-2 flex-wrap">
            <span>{{ t('tools.whitespaceViewer.renderLabel') }}</span>
            <span v-if="isTruncated" class="text-xs text-amber-600">
              {{ t('tools.whitespaceViewer.truncated') }}
            </span>
          </div>
          <div
            ref="renderRef"
            class="ws-render font-mono"
            :style="{ '--ws-no-width': lineNoWidth }"
            :aria-label="t('tools.whitespaceViewer.renderLabel')"
            v-html="renderedHtml"
          ></div>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

<style scoped>
.ws-textarea {
  height: 26rem;
  line-height: 1.6;
}

.ws-render {
  height: 26rem;
  overflow: auto;
  white-space: pre;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(248, 250, 252, 0.8);
  padding: 8px 0;
  font-size: 13px;
  line-height: 1.6;
}

.ws-row {
  display: flex;
  min-height: 1.6em;
}

.ws-no {
  flex-shrink: 0;
  width: var(--ws-no-width, 4ch);
  text-align: right;
  padding-right: 1em;
  color: #94a3b8;
  user-select: none;
}

.ws-code {
  white-space: pre;
  color: #334155;
  word-break: normal;
  overflow-wrap: normal;
}

/* 标记字符着色（写在 :deep 以命中 v-html 内容） */
.ws-render :deep(.ws-mark) {
  border-radius: 2px;
  font-weight: 500;
}

.ws-render :deep(.ws-space) {
  color: #60a5fa;
}

.ws-render :deep(.ws-tab) {
  color: #a78bfa;
}

.ws-render :deep(.ws-eol) {
  color: #94a3b8;
  font-size: 11px;
}

.ws-space-static {
  color: #60a5fa;
  font-weight: 600;
}

.ws-tab-static {
  color: #a78bfa;
  font-weight: 600;
}

.ws-eol-static {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}
</style>
