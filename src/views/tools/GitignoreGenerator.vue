<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * .gitignore 生成器
 * - 12 个内置模板为组件常量，分组注释保留英文惯例原文
 * - 合并时跨模板去重：相同规则只保留一次，各模板保留分组注释标题，空行分隔
 * - 选择持久化；未选任何模板时预览区显示提示
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-gitignore-generator-config', {
  selected: [],
})

/* ---------------- 内置模板（header 与 lines 为 .gitignore 惯例英文原文） ---------------- */

const TEMPLATES = [
  {
    id: 'node',
    nameKey: 'tools.gitignoreGenerator.tplNode.name',
    descKey: 'tools.gitignoreGenerator.tplNode.desc',
    header: '# Node',
    lines: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '*.log',
      'npm-debug.log*',
      'yarn-debug.log*',
      'yarn-error.log*',
      'pnpm-debug.log*',
      '.pnpm-store/',
      '.npm',
      '*.tsbuildinfo',
    ],
  },
  {
    id: 'vue',
    nameKey: 'tools.gitignoreGenerator.tplVue.name',
    descKey: 'tools.gitignoreGenerator.tplVue.desc',
    header: '# Vue',
    lines: [
      '# Vue build output',
      'dist/',
      '.nuxt/',
      '.output/',
      '.vite/',
      '.vuepress/dist/',
      '*.local',
    ],
  },
  {
    id: 'python',
    nameKey: 'tools.gitignoreGenerator.tplPython.name',
    descKey: 'tools.gitignoreGenerator.tplPython.desc',
    header: '# Python',
    lines: [
      '__pycache__/',
      '*.py[cod]',
      '*.egg-info/',
      '.eggs/',
      'build/',
      'dist/',
      '.venv/',
      'venv/',
      'env/',
      '.pytest_cache/',
      '.mypy_cache/',
      '.ruff_cache/',
      '.coverage',
      'htmlcov/',
      '.ipynb_checkpoints',
    ],
  },
  {
    id: 'java',
    nameKey: 'tools.gitignoreGenerator.tplJava.name',
    descKey: 'tools.gitignoreGenerator.tplJava.desc',
    header: '# Java',
    lines: [
      '*.class',
      '*.jar',
      '*.war',
      '*.ear',
      'target/',
      'build/',
      'out/',
      '.gradle/',
      'hs_err_pid*',
    ],
  },
  {
    id: 'go',
    nameKey: 'tools.gitignoreGenerator.tplGo.name',
    descKey: 'tools.gitignoreGenerator.tplGo.desc',
    header: '# Go',
    lines: [
      '*.exe',
      '*.exe~',
      '*.dll',
      '*.so',
      '*.dylib',
      '*.test',
      '*.out',
      'vendor/',
      'bin/',
    ],
  },
  {
    id: 'rust',
    nameKey: 'tools.gitignoreGenerator.tplRust.name',
    descKey: 'tools.gitignoreGenerator.tplRust.desc',
    header: '# Rust',
    lines: [
      '/target',
      '**/*.rs.bk',
    ],
  },
  {
    id: 'cpp',
    nameKey: 'tools.gitignoreGenerator.tplCpp.name',
    descKey: 'tools.gitignoreGenerator.tplCpp.desc',
    header: '# C / C++',
    lines: [
      '*.o',
      '*.obj',
      '*.a',
      '*.lib',
      '*.so',
      '*.dylib',
      '*.dll',
      '*.exe',
      '*.out',
      '*.d',
      'build/',
      'bin/',
      'debug/',
      'release/',
      'cmake-build-*/',
    ],
  },
  {
    id: 'macos',
    nameKey: 'tools.gitignoreGenerator.tplMacos.name',
    descKey: 'tools.gitignoreGenerator.tplMacos.desc',
    header: '# macOS',
    lines: [
      '.DS_Store',
      '.AppleDouble',
      '.LSOverride',
      '._*',
      '.Spotlight-V100',
      '.Trashes',
      '.fseventsd',
    ],
  },
  {
    id: 'windows',
    nameKey: 'tools.gitignoreGenerator.tplWindows.name',
    descKey: 'tools.gitignoreGenerator.tplWindows.desc',
    header: '# Windows',
    lines: [
      'Thumbs.db',
      'ehthumbs.db',
      'Desktop.ini',
      '$RECYCLE.BIN/',
      '*.lnk',
    ],
  },
  {
    id: 'linux',
    nameKey: 'tools.gitignoreGenerator.tplLinux.name',
    descKey: 'tools.gitignoreGenerator.tplLinux.desc',
    header: '# Linux',
    lines: [
      '*~',
      '.fuse_hidden*',
      '.directory',
      '.Trash-*',
      '.nfs*',
    ],
  },
  {
    id: 'vscode',
    nameKey: 'tools.gitignoreGenerator.tplVscode.name',
    descKey: 'tools.gitignoreGenerator.tplVscode.desc',
    header: '# VS Code',
    lines: [
      '.vscode/*',
      '!.vscode/settings.json',
      '!.vscode/tasks.json',
      '!.vscode/launch.json',
      '!.vscode/extensions.json',
      '*.code-workspace',
      '.history/',
    ],
  },
  {
    id: 'jetbrains',
    nameKey: 'tools.gitignoreGenerator.tplJetbrains.name',
    descKey: 'tools.gitignoreGenerator.tplJetbrains.desc',
    header: '# JetBrains',
    lines: [
      '.idea/',
      '*.iml',
      '*.iws',
      '*.ipr',
      'out/',
      'cmake-build-*/',
    ],
  },
]

/* ---------------- 合并去重 ---------------- */

const selectedTemplates = computed(() => {
  const set = new Set(config.value.selected || [])
  return TEMPLATES.filter((tpl) => set.has(tpl.id))
})

const generatedText = computed(() => {
  const seen = new Set()
  const sections = []
  for (const tpl of selectedTemplates.value) {
    const uniqLines = []
    for (const line of tpl.lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // 注释行原样保留（分组小标题）；规则行全局去重
      if (trimmed.startsWith('#')) {
        uniqLines.push(line)
        continue
      }
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      uniqLines.push(line)
    }
    if (uniqLines.length > 0) {
      sections.push(tpl.header + '\n' + uniqLines.join('\n'))
    }
  }
  if (sections.length === 0) return ''
  return sections.join('\n\n') + '\n'
})

/* ---------------- 操作 ---------------- */

function toggle(id) {
  const list = new Set(config.value.selected || [])
  if (list.has(id)) {
    list.delete(id)
  } else {
    list.add(id)
  }
  config.value.selected = TEMPLATES.filter((tpl) => list.has(tpl.id)).map((tpl) => tpl.id)
}

function isSelected(id) {
  return (config.value.selected || []).includes(id)
}

function selectAll() {
  config.value.selected = TEMPLATES.map((tpl) => tpl.id)
}

function clearAll() {
  config.value.selected = []
}

function downloadGitignore() {
  try {
    if (!generatedText.value) return
    downloadText(generatedText.value, '.gitignore', 'text/plain;charset=utf-8')
    toast.success(t('tools.gitignoreGenerator.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="gitignoreGenerator">
    <!-- 项目类型多选 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('tools.gitignoreGenerator.templatesTitle') }}</span>
        <span class="text-xs text-slate-400">
          {{ t('tools.gitignoreGenerator.selectedCount') }} {{ selectedTemplates.length }} / {{ TEMPLATES.length }}
        </span>
        <button type="button" class="btn-ghost" @click="selectAll">
          {{ t('tools.gitignoreGenerator.selectAll') }}
        </button>
        <button type="button" class="btn-danger" @click="clearAll">
          {{ t('tools.gitignoreGenerator.clearAll') }}
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" role="group" :aria-label="t('tools.gitignoreGenerator.templatesTitle')">
        <label
          v-for="tpl in TEMPLATES"
          :key="tpl.id"
          class="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer select-none transition"
          :class="
            isSelected(tpl.id)
              ? 'border-blue-400 bg-blue-50/80 shadow-sm'
              : 'border-slate-200 bg-white/60 hover:border-blue-300'
          "
        >
          <input
            type="checkbox"
            class="w-4 h-4 mt-0.5 accent-blue-600 shrink-0"
            :checked="isSelected(tpl.id)"
            :aria-label="t(tpl.nameKey)"
            @change="toggle(tpl.id)"
          />
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-slate-700">{{ t(tpl.nameKey) }}</span>
            <span class="block text-xs text-slate-400 leading-snug">{{ t(tpl.descKey) }}</span>
          </span>
        </label>
      </div>
    </section>

    <!-- 生成结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('tools.gitignoreGenerator.previewTitle') }}</span>
        <CopyButton :text="generatedText" :label="t('toolsCommon.copy')" :disabled="!generatedText" />
        <button
          type="button"
          class="btn-primary"
          :disabled="!generatedText"
          @click="downloadGitignore"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('tools.gitignoreGenerator.downloadName') }}
        </button>
      </div>

      <pre
        v-if="generatedText"
        class="font-mono text-xs sm:text-sm leading-relaxed text-slate-700 bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[420px]"
        tabindex="0"
      >{{ generatedText }}</pre>
      <div
        v-else
        class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400"
      >
        {{ t('tools.gitignoreGenerator.emptyPreview') }}
      </div>
    </section>
  </ToolPage>
</template>
