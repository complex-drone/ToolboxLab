<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { readFileAsText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * 代码行数统计
 * - 状态机逐字符扫描：正确跳过字符串字面量，支持 // 、注释块、# 与 HTML 注释
 * - 多行块注释中间的行计入注释行；行内既有代码又有注释时优先计为代码行
 * - 粘贴模式可选语言规则（默认 auto 按行首注释符检测并持久化）
 * - 上传多文件按扩展名分组汇总
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-code-line-counter-config', {
  language: 'auto',
})

const mode = ref('paste')
const pasteCode = ref('')

/* ---------------- 注释规则 ---------------- */

const RULE_SETS = {
  cstyle: { line: ['//'], block: [['/*', '*/']] },
  hash: { line: ['#'], block: [] },
  html: { line: [], block: [['<!--', '-->']] },
  cssBlock: { line: [], block: [['/*', '*/']] },
  sql: { line: ['--'], block: [['/*', '*/']] },
  none: { line: [], block: [] },
}

const LANG_OPTIONS = [
  { id: 'auto', labelKey: 'tools.codeLineCounter.langAuto' },
  { id: 'javascript', labelKey: 'tools.codeLineCounter.langJavaScript' },
  { id: 'python', labelKey: 'tools.codeLineCounter.langPython' },
  { id: 'shell', labelKey: 'tools.codeLineCounter.langShell' },
  { id: 'yaml', labelKey: 'tools.codeLineCounter.langYaml' },
  { id: 'html', labelKey: 'tools.codeLineCounter.langHtml' },
  { id: 'css', labelKey: 'tools.codeLineCounter.langCss' },
  { id: 'json', labelKey: 'tools.codeLineCounter.langJson' },
  { id: 'java', labelKey: 'tools.codeLineCounter.langJava' },
]

function rulesForLang(id) {
  switch (id) {
    case 'javascript':
    case 'java':
      return RULE_SETS.cstyle
    case 'python':
    case 'shell':
    case 'yaml':
      return RULE_SETS.hash
    case 'html':
      return RULE_SETS.html
    case 'css':
      return RULE_SETS.cssBlock
    case 'sql':
      return RULE_SETS.sql
    case 'json':
      return RULE_SETS.none
    default:
      return null // auto
  }
}

/** 扩展名 → 语言规则 id（未命中时按内容自动检测） */
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'javascript', tsx: 'javascript', vue: 'javascript', scss: 'javascript', less: 'javascript',
  java: 'java', go: 'java', c: 'java', h: 'java', cpp: 'java', hpp: 'java', cc: 'java',
  cs: 'java', rs: 'java', php: 'java', kt: 'java', swift: 'java', scala: 'java',
  py: 'python', rb: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', dockerfile: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml', env: 'yaml',
  html: 'html', htm: 'html', xml: 'html', svg: 'html',
  css: 'css',
  sql: 'sql',
  json: 'json',
}

function detectRules(code) {
  const text = String(code || '')
  if (text.includes('<!--')) return RULE_SETS.html
  const hashHits = (text.match(/^[ \t]*#/gm) || []).length
  const slashHits = (text.match(/^[ \t]*\/\//gm) || []).length
  if (hashHits > 0 && hashHits >= slashHits) return RULE_SETS.hash
  return RULE_SETS.cstyle
}

function resolveRules(code, langId, ext) {
  if (langId === 'auto' || !langId) {
    const byExt = ext ? EXT_LANG[ext] : null
    if (byExt) {
      const rules = rulesForLang(byExt)
      if (rules) return rules
    }
    return detectRules(code)
  }
  return rulesForLang(langId) || RULE_SETS.cstyle
}

/* ---------------- 状态机逐行统计 ---------------- */

function analyzeLines(code, rules) {
  const result = { total: 0, blank: 0, comment: 0, code: 0 }
  const normalized = String(code || '').replace(/\r\n?/g, '\n')
  // 空输入直接全 0
  if (!normalized) return result
  const lines = normalized.split('\n')
  // 结尾换行不额外计一行
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  let inBlock = false
  let blockEnd = ''
  for (const raw of lines) {
    result.total += 1
    if (!raw.trim()) {
      result.blank += 1
      continue
    }
    let hasCode = false
    let hasComment = false
    let i = 0
    const n = raw.length
    if (inBlock) hasComment = true
    while (i < n) {
      if (inBlock) {
        const endIdx = raw.indexOf(blockEnd, i)
        if (endIdx === -1) {
          i = n
          break
        }
        i = endIdx + blockEnd.length
        inBlock = false
        continue
      }
      const ch = raw[i]
      // 字符串字面量整体跳过，避免字符串内的注释符被误判
      if (ch === '"' || ch === "'" || ch === '`') {
        i += 1
        while (i < n) {
          if (raw[i] === '\\') {
            i += 2
            continue
          }
          if (raw[i] === ch) {
            i += 1
            break
          }
          i += 1
        }
        hasCode = true
        continue
      }
      let matched = false
      for (const [open, close] of rules.block) {
        if (raw.startsWith(open, i)) {
          hasComment = true
          inBlock = true
          blockEnd = close
          i += open.length
          matched = true
          break
        }
      }
      if (matched) continue
      for (const mark of rules.line) {
        if (raw.startsWith(mark, i)) {
          hasComment = true
          i = n
          matched = true
          break
        }
      }
      if (matched) continue
      if (!/\s/.test(ch)) hasCode = true
      i += 1
    }
    // 既有代码又有注释的行优先计为代码行
    if (hasCode) result.code += 1
    else if (hasComment) result.comment += 1
  }
  return result
}

/* ---------------- 粘贴模式 ---------------- */

const isAuto = computed(() => !config.value.language || config.value.language === 'auto')

const pasteStats = computed(() => {
  return analyzeLines(pasteCode.value, resolveRules(pasteCode.value, config.value.language, ''))
})

/* ---------------- 上传模式 ---------------- */

const uploadedFiles = ref([]) // { name, ext, content, stats }
const filesLoading = ref(false)

function getExt(name) {
  const idx = name.lastIndexOf('.')
  if (idx === -1 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

async function onFilesReceived(files) {
  const list = Array.isArray(files) ? files : [files]
  filesLoading.value = true
  const results = []
  let failed = false
  for (const file of list) {
    try {
      const content = await readFileAsText(file)
      results.push({
        name: file.name,
        ext: getExt(file.name),
        content,
        stats: analyzeLines(content, resolveRules(content, 'auto', getExt(file.name))),
      })
    } catch {
      failed = true
    }
  }
  uploadedFiles.value = results
  filesLoading.value = false
  if (failed) {
    toast.error(t('tools.codeLineCounter.readFailed'))
  }
}

function clearFiles() {
  uploadedFiles.value = []
}

const uploadTotals = computed(() => {
  const sum = { total: 0, blank: 0, comment: 0, code: 0 }
  for (const f of uploadedFiles.value) {
    sum.total += f.stats.total
    sum.blank += f.stats.blank
    sum.comment += f.stats.comment
    sum.code += f.stats.code
  }
  return sum
})

const uploadGroups = computed(() => {
  const map = new Map()
  for (const f of uploadedFiles.value) {
    const key = f.ext || '__none__'
    if (!map.has(key)) {
      map.set(key, { ext: key, files: 0, total: 0, code: 0 })
    }
    const g = map.get(key)
    g.files += 1
    g.total += f.stats.total
    g.code += f.stats.code
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
})

/* ---------------- 展示辅助 ---------------- */

function fmt(n) {
  return Number(n || 0).toLocaleString()
}

function ratio(stats) {
  if (!stats.total) return 0
  return Math.round((stats.comment / stats.total) * 100)
}

const activeStats = computed(() => (mode.value === 'upload' ? uploadTotals.value : pasteStats.value))
</script>

<template>
  <ToolPage tool-id="codeLineCounter">
    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap gap-2 mb-4" role="tablist" :aria-label="t('tools.codeLineCounter.title')">
        <button
          type="button"
          role="tab"
          class="px-4 py-1.5 rounded-full text-sm font-medium transition select-none"
          :class="mode === 'paste' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white/70 text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'"
          :aria-selected="mode === 'paste'"
          @click="mode = 'paste'"
        >
          {{ t('tools.codeLineCounter.tabPaste') }}
        </button>
        <button
          type="button"
          role="tab"
          class="px-4 py-1.5 rounded-full text-sm font-medium transition select-none"
          :class="mode === 'upload' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white/70 text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'"
          :aria-selected="mode === 'upload'"
          @click="mode = 'upload'"
        >
          {{ t('tools.codeLineCounter.tabUpload') }}
        </button>
      </div>

      <!-- 粘贴模式 -->
      <div v-if="mode === 'paste'">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
          <label class="label-base flex-1 min-w-[8rem] mb-0" for="clc-editor">
            {{ t('tools.codeLineCounter.editorLabel') }}
          </label>
          <div class="flex items-center gap-2">
            <label class="text-xs text-slate-500" for="clc-language">
              {{ t('tools.codeLineCounter.languageLabel') }}
            </label>
            <select
              id="clc-language"
              v-model="config.language"
              class="input-base !w-auto py-1 text-xs"
              :aria-label="t('tools.codeLineCounter.languageLabel')"
            >
              <option v-for="opt in LANG_OPTIONS" :key="opt.id" :value="opt.id">
                {{ t(opt.labelKey) }}
              </option>
            </select>
          </div>
        </div>
        <textarea
          id="clc-editor"
          v-model="pasteCode"
          class="input-base w-full font-mono text-xs sm:text-sm h-64 resize-y"
          :placeholder="t('tools.codeLineCounter.editorPlaceholder')"
          spellcheck="false"
        ></textarea>
      </div>

      <!-- 上传模式 -->
      <div v-else>
        <FileDropZone
          multiple
          :max-size-mb="5"
          accept=".js,.mjs,.cjs,.jsx,.ts,.tsx,.vue,.py,.rb,.sh,.bash,.zsh,.fish,.ps1,.yml,.yaml,.toml,.ini,.conf,.html,.htm,.xml,.svg,.css,.scss,.less,.json,.sql,.java,.go,.c,.h,.cpp,.hpp,.cc,.cs,.rs,.php,.kt,.swift,.scala,.md,.txt"
          :hint="t('tools.codeLineCounter.uploadHint')"
          @files="onFilesReceived"
        />
        <p v-if="filesLoading" class="text-sm text-slate-500 mt-2">{{ t('toolsCommon.processing') }}</p>

        <div v-if="uploadedFiles.length > 0" class="mt-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="section-title flex-1 mb-0">
              {{ t('tools.codeLineCounter.filesTitle') }}（{{ uploadedFiles.length }}）
            </span>
            <button type="button" class="btn-danger" @click="clearFiles">
              {{ t('tools.codeLineCounter.clearFiles') }}
            </button>
          </div>
          <ul class="flex flex-wrap gap-1.5">
            <li v-for="f in uploadedFiles" :key="f.name" class="chip font-mono">
              {{ f.name }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 统计结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span class="section-title flex-1 mb-0">{{ t('toolsCommon.result') }}</span>
        <span v-if="activeStats.total > 0" class="chip">
          {{ t('tools.codeLineCounter.commentRatio') }} {{ ratio(activeStats) }}%
        </span>
        <span v-if="mode === 'paste' && isAuto && pasteCode.trim()" class="text-xs text-slate-400">
          {{ t('tools.codeLineCounter.autoDetectedRule') }}
        </span>
      </div>

      <!-- 四项统计 -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl bg-blue-50/80 border border-blue-100 px-4 py-3">
          <p class="text-xs text-blue-500 mb-1">{{ t('tools.codeLineCounter.statTotal') }}</p>
          <p class="text-2xl font-bold text-blue-600 font-mono">{{ fmt(activeStats.total) }}</p>
        </div>
        <div class="rounded-xl bg-slate-100/80 border border-slate-200 px-4 py-3">
          <p class="text-xs text-slate-500 mb-1">{{ t('tools.codeLineCounter.statBlank') }}</p>
          <p class="text-2xl font-bold text-slate-600 font-mono">{{ fmt(activeStats.blank) }}</p>
        </div>
        <div class="rounded-xl bg-amber-50/80 border border-amber-100 px-4 py-3">
          <p class="text-xs text-amber-500 mb-1">{{ t('tools.codeLineCounter.statComment') }}</p>
          <p class="text-2xl font-bold text-amber-600 font-mono">{{ fmt(activeStats.comment) }}</p>
        </div>
        <div class="rounded-xl bg-emerald-50/80 border border-emerald-100 px-4 py-3">
          <p class="text-xs text-emerald-500 mb-1">{{ t('tools.codeLineCounter.statCode') }}</p>
          <p class="text-2xl font-bold text-emerald-600 font-mono">{{ fmt(activeStats.code) }}</p>
        </div>
      </div>

      <!-- 上传模式：按扩展名分组表格 -->
      <div v-if="mode === 'upload'" class="mt-5">
        <p v-if="uploadedFiles.length === 0" class="text-sm text-slate-400 text-center py-2">
          {{ t('tools.codeLineCounter.noFiles') }}
        </p>
        <div v-else class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-slate-100/80 text-slate-500 text-xs">
                <th class="text-left font-medium px-3 py-2">{{ t('tools.codeLineCounter.tableExt') }}</th>
                <th class="text-right font-medium px-3 py-2">{{ t('tools.codeLineCounter.tableFiles') }}</th>
                <th class="text-right font-medium px-3 py-2">{{ t('tools.codeLineCounter.tableTotal') }}</th>
                <th class="text-right font-medium px-3 py-2">{{ t('tools.codeLineCounter.tableCode') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in uploadGroups"
                :key="g.ext"
                class="border-t border-slate-100 text-slate-600"
              >
                <td class="px-3 py-2 font-mono text-blue-600">
                  {{ g.ext === '__none__' ? t('tools.codeLineCounter.otherExt') : `.${g.ext}` }}
                </td>
                <td class="px-3 py-2 text-right font-mono">{{ fmt(g.files) }}</td>
                <td class="px-3 py-2 text-right font-mono">{{ fmt(g.total) }}</td>
                <td class="px-3 py-2 text-right font-mono">{{ fmt(g.code) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
