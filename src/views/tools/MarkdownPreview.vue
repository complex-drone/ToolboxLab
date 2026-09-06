<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * Markdown 实时预览
 * - marked@12 渲染（可开关 GFM），highlight.js/lib/core 按需注册常用语言做代码高亮
 * - 渲染结果经 DOMPurify 消毒后 v-html
 * - 编辑区 / 预览区双向滚动同步（标志位防止循环触发）
 * - 输入防抖 300ms
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-markdown-preview-config', {
  gfm: true,
  syncScroll: true,
})

const DEFAULT_DOC = [
  '# ToolboxLab',
  '',
  '在这里输入 **Markdown**，右侧会实时显示预览效果。',
  '',
  '## 常用语法',
  '',
  '- GFM 表格与任务列表',
  '- 代码块语法高亮',
  '',
  '| 语法 | 说明 |',
  '| --- | --- |',
  '| **加粗** | 两个星号 |',
  '| *斜体* | 一个星号 |',
  '',
  '- [x] 已完成的事项',
  '- [ ] 待办事项',
  '',
  '```js',
  'const hello = (name) => `Hello, ${name}!`',
  'console.log(hello("World"))',
  '```',
  '',
  '> 提示：所有渲染都在浏览器本地完成。',
].join('\n')

const editorText = ref(DEFAULT_DOC)
const html = ref('')
const renderError = ref('')
const editorRef = ref(null)
const previewRef = ref(null)

const charCount = computed(() => editorText.value.length)
const wordCount = computed(() => {
  const trimmed = editorText.value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
})

/* ---------- marked + highlight.js 初始化 ---------- */

let markedRef = null
let hljsRef = null
let readyPromise = null

const LANG_LOADERS = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  json: () => import('highlight.js/lib/languages/json'),
  bash: () => import('highlight.js/lib/languages/bash'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  sql: () => import('highlight.js/lib/languages/sql'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
}


async function ensureEngines() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const [markedMod, hljsCoreMod] = await Promise.all([
        import('marked'),
        import('highlight.js/lib/core'),
      ])
      markedRef = markedMod.marked
      hljsRef = hljsCoreMod.default
      for (const [name, loader] of Object.entries(LANG_LOADERS)) {
        const mod = await loader()
        hljsRef.registerLanguage(name, mod.default)
      }
      markedRef.use({
        renderer: {
          code(code, infostring) {
            const lang = (infostring || '').trim().split(/\s+/)[0].toLowerCase()
            let cls = 'hljs'
            let highlighted = ''
            if (lang && hljsRef.getLanguage(lang)) {
              cls += ' language-' + lang
              try {
                highlighted = hljsRef.highlight(code, { language: lang, ignoreIllegals: true }).value
              } catch {
                highlighted = escapeHtml(code)
              }
            } else {
              try {
                highlighted = hljsRef.highlightAuto(code).value
              } catch {
                highlighted = escapeHtml(code)
              }
            }
            return '<pre><code class="' + cls + '">' + highlighted + '</code></pre>'
          },
        },
      })
    })()
  }
  return readyPromise
}

async function render() {
  try {
    renderError.value = ''
    await ensureEngines()
    const raw = markedRef.parse(editorText.value, { gfm: config.value.gfm, breaks: false })
    const DOMPurify = (await import('dompurify')).default
    html.value = DOMPurify.sanitize(raw)
  } catch (e) {
    renderError.value = e && e.message ? e.message : t('tools.markdownPreview.renderError')
  }
}

const renderDebounced = useDebounceFn(render, 300)

watch([editorText, () => config.value.gfm], () => renderDebounced())

onMounted(() => {
  render()
})

/* ---------- 工具栏插入 ---------- */

function insertSnippet(before, after, placeholder) {
  const el = editorRef.value
  const text = editorText.value
  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : text.length
  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : start
  const selected = text.slice(start, end) || placeholder
  editorText.value = text.slice(0, start) + before + selected + after + text.slice(end)
  nextTick(() => {
    if (!el) return
    el.focus()
    const caret = start + before.length + selected.length
    el.setSelectionRange(caret, caret)
  })
  renderDebounced()
}

function insertBold() {
  insertSnippet('**', '**', t('tools.markdownPreview.sampleBold'))
}
function insertItalic() {
  insertSnippet('*', '*', t('tools.markdownPreview.sampleItalic'))
}
function insertLink() {
  insertSnippet('[' + t('tools.markdownPreview.sampleLinkText') + '](https://', ')', 'example.com')
}
function insertCode() {
  insertSnippet('\n```js\n', '\n```\n', t('tools.markdownPreview.sampleCode'))
}
function insertTable() {
  const tpl =
    '\n| ' + t('tools.markdownPreview.tableCol1') +
    ' | ' + t('tools.markdownPreview.tableCol2') +
    ' |\n| --- | --- |\n| ' + t('tools.markdownPreview.tableCell') +
    ' | ' + t('tools.markdownPreview.tableCell') + ' |\n'
  insertSnippet(tpl, '', '')
}

const toolbarButtons = [
  { key: 'bold', run: insertBold },
  { key: 'italic', run: insertItalic },
  { key: 'link', run: insertLink },
  { key: 'code', run: insertCode },
  { key: 'table', run: insertTable },
]

function clearEditor() {
  editorText.value = ''
}

function loadSample() {
  editorText.value = DEFAULT_DOC
}

/* ---------- 滚动同步 ---------- */

let scrollLock = null
let scrollLockTimer = null

function syncScroll(from) {
  if (!config.value.syncScroll) return
  if (scrollLock && scrollLock !== from) return
  scrollLock = from
  const src = from === 'editor' ? editorRef.value : previewRef.value
  const dst = from === 'editor' ? previewRef.value : editorRef.value
  if (src && dst) {
    const srcMax = src.scrollHeight - src.clientHeight
    const dstMax = dst.scrollHeight - dst.clientHeight
    if (srcMax > 0) {
      dst.scrollTop = (src.scrollTop / srcMax) * Math.max(0, dstMax)
    }
  }
  if (scrollLockTimer) clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(() => {
    scrollLock = null
  }, 120)
}

onBeforeUnmount(() => {
  if (scrollLockTimer) clearTimeout(scrollLockTimer)
})
</script>

<template>
  <ToolPage tool-id="markdownPreview">
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 工具栏 + 选项 -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="btn in toolbarButtons"
          :key="btn.key"
          type="button"
          class="btn-ghost"
          :aria-label="t(`tools.markdownPreview.toolbar.${btn.key}`)"
          @click="btn.run"
        >
          {{ t(`tools.markdownPreview.toolbar.${btn.key}`) }}
        </button>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger" @click="clearEditor">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.gfm" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.markdownPreview.gfm') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.syncScroll" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.markdownPreview.syncScroll') }}
        </label>
      </div>

      <!-- 编辑 + 预览 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.markdownPreview.editor') }}</span>
            <span class="text-xs text-slate-400">
              {{ charCount }} {{ t('toolsCommon.chars') }} · {{ wordCount }} {{ t('toolsCommon.words') }}
            </span>
          </div>
          <textarea
            id="markdown-editor"
            ref="editorRef"
            v-model="editorText"
            class="input-base w-full font-mono h-[420px] lg:h-[560px] resize-none overflow-y-auto"
            :placeholder="t('tools.markdownPreview.editorPlaceholder')"
            spellcheck="false"
            @scroll="syncScroll('editor')"
          ></textarea>
        </div>

        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('toolsCommon.preview') }}</span>
            <CopyButton :text="html" :label="t('tools.markdownPreview.copyHtml')" :disabled="!html" />
          </div>
          <p v-if="renderError" class="text-red-600 text-sm mb-2">{{ renderError }}</p>
          <div
            v-else
            ref="previewRef"
            class="md-preview h-[420px] lg:h-[560px] overflow-y-auto rounded-xl border border-slate-200 bg-white/80 px-4 py-3"
            role="region"
            :aria-label="t('toolsCommon.preview')"
            v-html="html"
          ></div>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

<style scoped>
/* v-html 注入的节点不带 scoped 属性，因此通过父级 .md-preview + :deep() 命中 */
.md-preview {
  line-height: 1.7;
  color: #334155;
  font-size: 14px;
  word-break: break-word;
}

.md-preview :deep(h1),
.md-preview :deep(h2),
.md-preview :deep(h3),
.md-preview :deep(h4) {
  font-weight: 700;
  color: #1e293b;
  margin: 1em 0 0.4em;
  line-height: 1.35;
}

.md-preview :deep(h1) {
  font-size: 1.55em;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.3em;
}

.md-preview :deep(h2) {
  font-size: 1.3em;
  border-bottom: 1px solid #eef2f7;
  padding-bottom: 0.25em;
}

.md-preview :deep(h3) {
  font-size: 1.15em;
}

.md-preview :deep(h4) {
  font-size: 1.02em;
}

.md-preview :deep(h1:first-child),
.md-preview :deep(h2:first-child),
.md-preview :deep(p:first-child) {
  margin-top: 0;
}

.md-preview :deep(p) {
  margin: 0.55em 0;
}

.md-preview :deep(a) {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.md-preview :deep(ul),
.md-preview :deep(ol) {
  margin: 0.55em 0;
  padding-left: 1.5em;
}

.md-preview :deep(ul) {
  list-style: disc;
}

.md-preview :deep(ol) {
  list-style: decimal;
}

.md-preview :deep(li) {
  margin: 0.2em 0;
}

.md-preview :deep(li > input[type='checkbox']) {
  margin-right: 0.45em;
  vertical-align: middle;
}

.md-preview :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.4em 0.9em;
  border-left: 4px solid #93c5fd;
  border-radius: 0 8px 8px 0;
  background: rgba(59, 130, 246, 0.06);
  color: #64748b;
}

.md-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.88em;
}

.md-preview :deep(:not(pre) > code) {
  background: rgba(148, 163, 184, 0.16);
  color: #dc2626;
  padding: 0.15em 0.4em;
  border-radius: 6px;
}

.md-preview :deep(pre) {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0.7em 0;
  overflow-x: auto;
  line-height: 1.55;
}

.md-preview :deep(pre code) {
  background: transparent;
  color: #334155;
  padding: 0;
  font-size: 13px;
}

.md-preview :deep(table) {
  border-collapse: collapse;
  margin: 0.7em 0;
  width: 100%;
  font-size: 13px;
}

.md-preview :deep(th),
.md-preview :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  text-align: left;
}

.md-preview :deep(th) {
  background: #f1f5f9;
  font-weight: 600;
  color: #1e293b;
}

.md-preview :deep(hr) {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1em 0;
}

.md-preview :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

/* 简易高亮配色：关键字蓝、字符串绿、数字紫、注释灰 */
.md-preview :deep(.hljs-keyword),
.md-preview :deep(.hljs-selector-tag),
.md-preview :deep(.hljs-literal),
.md-preview :deep(.hljs-doctag) {
  color: #2563eb;
}

.md-preview :deep(.hljs-string),
.md-preview :deep(.hljs-regexp),
.md-preview :deep(.hljs-addition) {
  color: #16a34a;
}

.md-preview :deep(.hljs-number),
.md-preview :deep(.hljs-symbol),
.md-preview :deep(.hljs-bullet),
.md-preview :deep(.hljs-link) {
  color: #9333ea;
}

.md-preview :deep(.hljs-comment),
.md-preview :deep(.hljs-quote) {
  color: #94a3b8;
  font-style: italic;
}

.md-preview :deep(.hljs-title),
.md-preview :deep(.hljs-section),
.md-preview :deep(.hljs-name) {
  color: #7c3aed;
}

.md-preview :deep(.hljs-attr),
.md-preview :deep(.hljs-attribute),
.md-preview :deep(.hljs-variable),
.md-preview :deep(.hljs-template-variable),
.md-preview :deep(.hljs-type) {
  color: #d97706;
}

.md-preview :deep(.hljs-built_in),
.md-preview :deep(.hljs-class .hljs-title) {
  color: #0891b2;
}

.md-preview :deep(.hljs-meta),
.md-preview :deep(.hljs-deletion) {
  color: #64748b;
}

.md-preview :deep(.hljs-emphasis) {
  font-style: italic;
}

.md-preview :deep(.hljs-strong) {
  font-weight: 700;
}
</style>
