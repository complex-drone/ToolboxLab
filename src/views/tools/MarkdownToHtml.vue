<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { escapeHtml } from '@/utils/html'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * Markdown 转 HTML（增强版）
 * - marked + highlight.js(core) + DOMPurify 懒加载渲染（与 MarkdownPreview 同范式）
 * - 侧重导出：独立 HTML 文档（内嵌基础样式 + hljs 深色代码样式）、复制源码、复制纯文本
 * - 预览区简化，无滚动同步
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-markdown-to-html-config', {
  gfm: true,
})

const DEFAULT_DOC = [
  '# ToolboxLab',
  '',
  'Edit **Markdown** on the left, preview HTML on the right. 在左侧编辑，右侧实时预览。',
  '',
  '## GFM Features',
  '',
  '| Syntax | Description |',
  '| --- | --- |',
  '| **Bold** | two asterisks |',
  '| ~~Strikethrough~~ | double tilde |',
  '',
  '- [x] Done item',
  '- [ ] Todo item',
  '',
  '```js',
  'const hello = (name) => `Hello, ${name}`',
  'console.log(hello("World"))',
  '```',
  '',
  '> Everything renders locally in your browser.',
].join('\n')

/* ---------- 导出用样式常量 ---------- */

const BASE_CSS = [
  'body { margin: 0; padding: 32px 16px; background: #f1f5f9; color: #334155;',
  "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',",
  "    Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; line-height: 1.7; }",
  '.markdown-body { max-width: 820px; margin: 0 auto; background: #ffffff; padding: 40px 48px;',
  '  border-radius: 12px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); font-size: 15px; word-break: break-word; }',
  '.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { color: #1e293b; line-height: 1.35; margin: 1em 0 0.4em; }',
  '.markdown-body h1 { font-size: 1.7em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }',
  '.markdown-body h2 { font-size: 1.35em; border-bottom: 1px solid #eef2f7; padding-bottom: 0.25em; }',
  '.markdown-body h3 { font-size: 1.15em; }',
  '.markdown-body p { margin: 0.6em 0; }',
  '.markdown-body a { color: #2563eb; text-decoration: underline; }',
  '.markdown-body ul, .markdown-body ol { margin: 0.6em 0; padding-left: 1.5em; }',
  '.markdown-body blockquote { margin: 0.7em 0; padding: 0.5em 1em; border-left: 4px solid #93c5fd;',
  '  border-radius: 0 8px 8px 0; background: rgba(59, 130, 246, 0.06); color: #64748b; }',
  '.markdown-body table { border-collapse: collapse; margin: 0.8em 0; width: 100%; font-size: 14px; }',
  '.markdown-body th, .markdown-body td { border: 1px solid #e2e8f0; padding: 6px 12px; text-align: left; }',
  '.markdown-body th { background: #f1f5f9; color: #1e293b; font-weight: 600; }',
  '.markdown-body :not(pre) > code { background: rgba(148, 163, 184, 0.16); color: #dc2626;',
  "  padding: 0.15em 0.4em; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }",
  '.markdown-body img { max-width: 100%; border-radius: 8px; }',
  '.markdown-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.2em 0; }',
].join('\n')

const HLJS_DARK_CSS = [
  '.markdown-body pre { background: #0d1117; border-radius: 10px; padding: 14px 16px; margin: 0.8em 0; overflow-x: auto; }',
  '.markdown-body pre code { display: block; background: transparent; color: #e6edf3; padding: 0;',
  "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.6; }",
  '.hljs-keyword, .hljs-selector-tag, .hljs-doctag { color: #ff7b72; }',
  '.hljs-string, .hljs-regexp, .hljs-addition { color: #a5d6ff; }',
  '.hljs-number, .hljs-literal, .hljs-link { color: #79c0ff; }',
  '.hljs-comment, .hljs-quote, .hljs-meta { color: #8b949e; font-style: italic; }',
  '.hljs-title, .hljs-section, .hljs-name { color: #d2a8ff; }',
  '.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable { color: #79c0ff; }',
  '.hljs-built_in, .hljs-type, .hljs-symbol, .hljs-bullet { color: #ffa657; }',
  '.hljs-emphasis { font-style: italic; }',
  '.hljs-strong { font-weight: 700; }',
  '.hljs-deletion { color: #ffa198; }',
].join('\n')

const EXPORT_FILENAME = 'markdown-export.html'

/* ---------- 状态 ---------- */

const editorText = ref(DEFAULT_DOC)
const html = ref('')
const plainText = ref('')
const renderError = ref('')

const charCount = computed(() => editorText.value.length)
const lineCount = computed(() => (editorText.value ? editorText.value.split('\n').length : 0))
const wordCount = computed(() => {
  const trimmed = editorText.value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
})

/* ---------- marked + highlight.js 懒加载 ---------- */

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
    const sink = document.createElement('div')
    sink.innerHTML = html.value
    plainText.value = sink.textContent || ''
  } catch (e) {
    renderError.value = e && e.message ? e.message : t('tools.markdownToHtml.renderError')
  }
}

const renderDebounced = useDebounceFn(render, 300)

watch([editorText, () => config.value.gfm], () => renderDebounced())

onMounted(() => {
  render()
})

/* ---------- 导出与复制 ---------- */

function buildStandaloneDoc(bodyHtml) {
  const title = t('tools.markdownToHtml.exportTitle')
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    '<style>',
    BASE_CSS,
    HLJS_DARK_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<article class="markdown-body">',
    bodyHtml,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function exportHtmlFile() {
  try {
    if (!html.value) return
    downloadText(buildStandaloneDoc(html.value), EXPORT_FILENAME, 'text/html;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function loadSample() {
  editorText.value = DEFAULT_DOC
}

function clearEditor() {
  editorText.value = ''
}
</script>

<template>
  <ToolPage tool-id="markdownToHtml">
    <!-- 工具栏与选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.gfm" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.markdownToHtml.gfm') }}
        </label>
        <span class="flex-1"></span>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger" @click="clearEditor">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <button type="button" class="btn-primary" :disabled="!html" @click="exportHtmlFile">
          {{ t('tools.markdownToHtml.exportHtml') }}
        </button>
        <CopyButton
          :text="html"
          :label="t('tools.markdownToHtml.copyHtml')"
          :disabled="!html"
        />
        <CopyButton
          :text="plainText"
          :label="t('tools.markdownToHtml.copyText')"
          :disabled="!plainText"
        />
      </div>
    </section>

    <!-- 编辑 + 预览 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.markdownToHtml.editor') }}</span>
            <span class="text-xs text-slate-400 whitespace-nowrap">
              {{ charCount }} {{ t('toolsCommon.chars') }} · {{ lineCount }} {{ t('toolsCommon.lines') }} ·
              {{ wordCount }} {{ t('toolsCommon.words') }}
            </span>
          </div>
          <textarea
            v-model="editorText"
            class="input-base w-full font-mono h-[420px] lg:h-[560px] resize-none overflow-y-auto"
            :placeholder="t('tools.markdownToHtml.editorPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>

        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('toolsCommon.preview') }}</span>
          </div>
          <p v-if="renderError" class="text-red-600 text-sm mb-2">{{ renderError }}</p>
          <div
            v-else
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
/* v-html 注入的节点不带 scoped 属性，通过父级 .md-preview + :deep() 命中 */
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
