<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * Dockerfile 最佳实践分析器
 * - 自实现解析器：处理续行符、忽略注释，按逻辑行解析指令
 * - 规则：多阶段构建 / root 用户 / apt-get 合并 / .dockerignore 建议 /
 *   latest 标签 / COPY 全量拷贝、ADD 远程地址、缺 EXPOSE、依赖缓存排序
 * - 每条结果含级别 + 行号 + 建议；顶部评分与进度条；可展开优化示例
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 常量 ---------------- */

const KNOWN_DIRECTIVES = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
  'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
])

const MANIFEST_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'pyproject.toml', 'poetry.lock',
  'go.mod', 'go.sum', 'pom.xml', 'build.gradle', 'Cargo.toml', 'Gemfile', 'composer.json',
])

const EXAMPLE_DOCKERFILE = [
  'FROM node',
  'WORKDIR /app',
  'RUN apt-get update',
  'COPY . .',
  'RUN apt-get install -y curl',
  'ADD https://example.com/package.tar.gz /app',
  'EXPOSE 3000',
  'CMD ["node", "server.js"]',
  '',
].join('\n')

const OPTIMIZED_DOCKERFILE = [
  '# syntax=docker/dockerfile:1',
  'FROM node:20-alpine AS deps',
  'WORKDIR /app',
  'COPY package.json package-lock.json ./',
  'RUN npm ci',
  '',
  'FROM node:20-alpine AS builder',
  'WORKDIR /app',
  'COPY --from=deps /app/node_modules ./node_modules',
  'COPY package.json package-lock.json ./',
  'COPY src ./src',
  'COPY public ./public',
  'RUN npm run build',
  '',
  'FROM node:20-alpine AS runner',
  'WORKDIR /app',
  'ENV NODE_ENV=production',
  'RUN addgroup -S app && adduser -S app -G app',
  'COPY --from=deps /app/node_modules ./node_modules',
  'COPY --from=deps /app/package.json ./package.json',
  'COPY --from=builder /app/dist ./dist',
  'USER app',
  'EXPOSE 3000',
  'CMD ["node", "dist/server.js"]',
  '',
].join('\n')

/* ---------------- 输入（持久化可选，这里持久化） ---------------- */

const config = useStorage('tool-dockerfile-analyzer', {
  source: '',
})

const showExample = ref(false)

/* ---------------- 解析器 ---------------- */

/** 按逻辑行解析：合并续行符，跳过注释与空行 */
function logicalLines(text) {
  const rawLines = String(text).split(/\r?\n/)
  const out = []
  let buf = null
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\t/g, '    ').trim()
    if (!buf) {
      if (line === '' || line.startsWith('#')) continue
      buf = { start: i + 1, text: line }
    } else {
      if (line === '' || line.startsWith('#')) continue
      buf.text += ' ' + line
    }
    if (/\\\s*$/.test(buf.text)) {
      buf.text = buf.text.replace(/\\\s*$/, ' ')
    } else {
      out.push(buf)
      buf = null
    }
  }
  if (buf) out.push(buf)
  return out
    .map((l) => {
      const m = /^(\S+)\s*(.*)$/.exec(l.text) || []
      return { start: l.start, directive: String(m[1] || '').toUpperCase(), args: String(m[2] || '').trim() }
    })
    .filter((l) => KNOWN_DIRECTIVES.has(l.directive))
}

function tokensOf(args) {
  return String(args || '').split(/\s+/).filter(Boolean)
}

function normPath(tok) {
  return String(tok || '').replace(/^\.\//, '')
}

/* ---------------- 规则检测 ---------------- */

function analyze(text) {
  const instrs = logicalLines(text)
  const results = []
  let uid = 0
  const push = (level, ruleId, line, titleKey, suggestionKey) => {
    results.push({ id: 'r' + ++uid, level, ruleId, line, titleKey, suggestionKey: suggestionKey || '' })
  }

  if (instrs.length === 0) return results

  /* R1 多阶段构建 */
  const fromIdxs = instrs.map((x, i) => (x.directive === 'FROM' ? i : -1)).filter((i) => i >= 0)
  if (fromIdxs.length === 0) {
    push('error', 'r1', instrs[0].start, 'errNoFromTitle', 'errNoFromSuggestion')
  } else {
    const lastIdx = fromIdxs[fromIdxs.length - 1]
    const finalInstrs = instrs.slice(lastIdx + 1)
    const finalCopyFrom = finalInstrs.some((x) => x.directive === 'COPY' && /--from=/i.test(x.args))
    if (fromIdxs.length === 1) {
      push('warn', 'r1', instrs[lastIdx].start, 'singleStageTitle', 'singleStageSuggestion')
    } else if (!finalCopyFrom) {
      push('warn', 'r1', instrs[lastIdx].start, 'noCopyFromTitle', 'noCopyFromSuggestion')
    } else {
      push('pass', 'r1', instrs[lastIdx].start, 'multiStagePassTitle', '')
    }
  }

  /* R2 root 用户 */
  const users = instrs.filter((x) => x.directive === 'USER')
  if (users.length === 0) {
    push('warn', 'r2', 1, 'rootNoUserTitle', 'rootSuggestion')
  } else {
    const last = users[users.length - 1]
    const firstArg = tokensOf(last.args)[0] || ''
    if (firstArg.toLowerCase() === 'root') {
      push('warn', 'r2', last.start, 'rootUserTitle', 'rootSuggestion')
    } else {
      push('pass', 'r2', last.start, 'nonRootPassTitle', '')
    }
  }

  /* R3 apt-get 合并 */
  const runInfos = instrs
    .filter((x) => x.directive === 'RUN')
    .map((r) => ({
      r,
      hasUpdate: /apt-get\s+update/.test(r.args),
      hasInstall: /apt-get\s+install/.test(r.args),
      hasAnd: /&&/.test(r.args),
    }))
  const anyUpdate = runInfos.some((x) => x.hasUpdate)
  const aptWarns = []
  let aptCombinedLine = 0
  for (const x of runInfos) {
    if (x.hasUpdate && x.hasInstall) {
      if (x.hasAnd) {
        if (!aptCombinedLine) aptCombinedLine = x.r.start
      } else {
        aptWarns.push({ line: x.r.start, key: 'aptMergeTitle' })
      }
    } else if (x.hasUpdate && !x.hasInstall) {
      aptWarns.push({ line: x.r.start, key: 'aptUpdateOnlyTitle' })
    } else if (x.hasInstall && !x.hasUpdate && anyUpdate) {
      aptWarns.push({ line: x.r.start, key: 'aptSplitTitle' })
    }
  }
  for (const w of aptWarns) push('warn', 'r3', w.line, w.key, 'aptSuggestion')
  if (aptWarns.length === 0 && aptCombinedLine) {
    push('pass', 'r3', aptCombinedLine, 'aptPassTitle', '')
  }

  /* R4 .dockerignore 静态建议（始终提示，不扣分） */
  push('info', 'r4', 1, 'dockerignoreTitle', 'dockerignoreSuggestion')

  /* R5 latest 标签 */
  const froms = instrs.filter((x) => x.directive === 'FROM')
  let tagWarn = false
  for (const f of froms) {
    const image = tokensOf(f.args)[0] || ''
    if (image.includes('@')) continue
    const colonIdx = image.lastIndexOf(':')
    const tag = colonIdx >= 0 ? image.slice(colonIdx + 1) : ''
    if (!tag) {
      push('warn', 'r5', f.start, 'noTagTitle', 'tagSuggestion')
      tagWarn = true
    } else if (tag.toLowerCase() === 'latest') {
      push('warn', 'r5', f.start, 'latestTagTitle', 'tagSuggestion')
      tagWarn = true
    }
  }
  if (froms.length > 0 && !tagWarn) {
    push('pass', 'r5', froms[0].start, 'tagPassTitle', '')
  }

  /* R6 附加规则 */
  for (const x of instrs.filter((x) => x.directive === 'COPY')) {
    const tk = tokensOf(x.args)
    if (normPath(tk[0]) === '.' && normPath(tk[1]) === '.') {
      push('warn', 'r6', x.start, 'copyAllTitle', 'copyAllSuggestion')
    }
  }
  for (const x of instrs.filter((x) => x.directive === 'ADD')) {
    const first = tokensOf(x.args)[0] || ''
    if (/^https?:\/\//i.test(first)) {
      push('warn', 'r6', x.start, 'addUrlTitle', 'addUrlSuggestion')
    }
  }
  const exposes = instrs.filter((x) => x.directive === 'EXPOSE')
  if (exposes.length === 0) {
    push('info', 'r6', 1, 'noExposeTitle', 'noExposeSuggestion')
  }
  const copies = instrs.filter((x) => x.directive === 'COPY' || x.directive === 'ADD')
  const manifestIdx = copies.findIndex((x) => tokensOf(x.args).some((tok) => MANIFEST_FILES.has(normPath(tok))))
  const broadIdx = copies.findIndex((x) => {
    const tk = tokensOf(x.args)
    return normPath(tk[0]) === '.' && normPath(tk[1]) === '.'
  })
  if (manifestIdx >= 0 && broadIdx >= 0 && broadIdx < manifestIdx) {
    push('warn', 'r6', copies[manifestIdx].start, 'orderTitle', 'orderSuggestion')
  } else if (manifestIdx >= 0) {
    push('pass', 'r6', copies[manifestIdx].start, 'orderPassTitle', '')
  }

  return results
}

/* ---------------- 结果与评分 ---------------- */

const hasInput = computed(() => String(config.value.source || '').trim() !== '')

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, pass: 3 }

const results = computed(() => {
  if (!hasInput.value) return []
  try {
    return analyze(config.value.source).sort(
      (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.line - b.line,
    )
  } catch {
    return []
  }
})

const counts = computed(() => {
  const c = { pass: 0, warn: 0, error: 0, info: 0 }
  for (const r of results.value) c[r.level] += 1
  return c
})

/** 评分：100 起步，警告 -10，错误 -20，下限 0；提示与通过不扣分 */
const score = computed(() => {
  let s = 100
  for (const r of results.value) {
    if (r.level === 'warn') s -= 10
    else if (r.level === 'error') s -= 20
  }
  return Math.max(0, s)
})

const scoreColor = computed(() => {
  if (score.value >= 80) return 'bg-emerald-500'
  if (score.value >= 60) return 'bg-amber-500'
  return 'bg-rose-500'
})

const scoreTextColor = computed(() => {
  if (score.value >= 80) return 'text-emerald-600'
  if (score.value >= 60) return 'text-amber-600'
  return 'text-rose-600'
})

/* ---------------- 操作 ---------------- */

function loadExample() {
  config.value.source = EXAMPLE_DOCKERFILE
  toast.success(t('tools.dockerfileAnalyzer.exampleLoaded'))
}

function clearInput() {
  config.value.source = ''
}

function levelLabel(level) {
  const key = { pass: 'levelPass', warn: 'levelWarn', error: 'levelError', info: 'levelInfo' }[level] || 'levelInfo'
  return t('tools.dockerfileAnalyzer.' + key)
}

function levelClass(level) {
  return {
    pass: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    warn: 'bg-amber-50 text-amber-600 border-amber-200',
    error: 'bg-rose-50 text-rose-600 border-rose-200',
    info: 'bg-slate-100 text-slate-500 border-slate-200',
  }[level]
}

function levelIcon(level) {
  return { pass: '✓', warn: '⚠', error: '✗', info: 'ℹ' }[level] || 'ℹ'
}

function lineText(line) {
  return line > 0 ? t('tools.dockerfileAnalyzer.lineLabel', { line }) : t('tools.dockerfileAnalyzer.lineAll')
}

function resultTitle(r) {
  return t('tools.dockerfileAnalyzer.' + r.titleKey)
}

function resultSuggestion(r) {
  return r.suggestionKey ? t('tools.dockerfileAnalyzer.' + r.suggestionKey) : ''
}
</script>

<template>
  <ToolPage tool-id="dockerfileAnalyzer">
    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.dockerfileAnalyzer.inputTitle') }}</h2>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('tools.dockerfileAnalyzer.loadExample') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="!hasInput" @click="clearInput">
          {{ t('tools.dockerfileAnalyzer.clearInput') }}
        </button>
      </div>
      <textarea
        v-model="config.source"
        rows="10"
        class="input-base font-mono text-xs sm:text-sm"
        :placeholder="t('tools.dockerfileAnalyzer.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
    </section>

    <!-- 评分 + 结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.dockerfileAnalyzer.scoreTitle') }}</h2>
        <span class="chip">{{ counts.pass }} {{ t('tools.dockerfileAnalyzer.countsPass') }}</span>
        <span class="chip">{{ counts.warn }} {{ t('tools.dockerfileAnalyzer.countsWarn') }}</span>
        <span class="chip">{{ counts.error }} {{ t('tools.dockerfileAnalyzer.countsError') }}</span>
        <span class="chip">{{ counts.info }} {{ t('tools.dockerfileAnalyzer.countsInfo') }}</span>
      </div>

      <div v-if="hasInput">
        <div class="flex items-end gap-2 mb-2">
          <span class="text-3xl font-bold leading-none" :class="scoreTextColor">{{ score }}</span>
          <span class="text-sm text-slate-400 mb-0.5">{{ t('tools.dockerfileAnalyzer.scoreUnit') }}</span>
        </div>
        <div class="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden" role="img" :aria-label="String(score)">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="scoreColor"
            :style="{ width: score + '%' }"
          ></div>
        </div>
      </div>

      <div v-if="!hasInput" class="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
        {{ t('tools.dockerfileAnalyzer.emptyInput') }}
      </div>

      <!-- 检测详情 -->
      <div v-else class="mt-5">
        <h3 class="section-title mb-3">{{ t('tools.dockerfileAnalyzer.rulesTitle') }}</h3>
        <p v-if="results.length === 0" class="text-sm text-slate-400">
          {{ t('tools.dockerfileAnalyzer.noInstructions') }}
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="r in results"
            :key="r.id"
            class="flex flex-wrap sm:flex-nowrap items-start gap-3 rounded-xl border p-3"
            :class="{
              'border-emerald-200 bg-emerald-50/40': r.level === 'pass',
              'border-amber-200 bg-amber-50/40': r.level === 'warn',
              'border-rose-200 bg-rose-50/40': r.level === 'error',
              'border-slate-200 bg-white/60': r.level === 'info',
            }"
          >
            <span
              class="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border"
              :class="levelClass(r.level)"
            >
              <span aria-hidden="true">{{ levelIcon(r.level) }}</span>
              {{ levelLabel(r.level) }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-slate-700">{{ resultTitle(r) }}</p>
              <p v-if="resultSuggestion(r)" class="text-xs text-slate-500 leading-relaxed mt-0.5">
                {{ resultSuggestion(r) }}
              </p>
            </div>
            <span class="chip shrink-0 font-mono">{{ lineText(r.line) }}</span>
          </li>
        </ul>
        <p v-if="counts.warn === 0 && counts.error === 0" class="mt-3 text-sm text-emerald-600">
          {{ t('tools.dockerfileAnalyzer.noIssues') }}
        </p>
      </div>
    </section>

    <!-- 优化示例 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.dockerfileAnalyzer.exampleTitle') }}</h2>
        <button type="button" class="btn-ghost" @click="showExample = !showExample">
          {{ showExample ? t('tools.dockerfileAnalyzer.hideExample') : t('tools.dockerfileAnalyzer.showExample') }}
        </button>
        <CopyButton
          v-if="showExample"
          :text="OPTIMIZED_DOCKERFILE"
          :label="t('toolsCommon.copy')"
        />
      </div>
      <p class="text-xs text-slate-400 leading-relaxed">{{ t('tools.dockerfileAnalyzer.exampleHint') }}</p>
      <pre
        v-if="showExample"
        class="mt-3 font-mono text-xs sm:text-sm leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[420px]"
        tabindex="0"
      >{{ OPTIMIZED_DOCKERFILE }}</pre>
    </section>
  </ToolPage>
</template>
