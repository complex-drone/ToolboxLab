<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t } = useI18n()

/** type 与 emoji 映射（按 Conventional Commits 常用顺序） */
const TYPES = [
  { value: 'feat', icon: '✨', descKey: 'typeFeat' },
  { value: 'fix', icon: '🐛', descKey: 'typeFix' },
  { value: 'docs', icon: '📝', descKey: 'typeDocs' },
  { value: 'style', icon: '💄', descKey: 'typeStyle' },
  { value: 'refactor', icon: '♻️', descKey: 'typeRefactor' },
  { value: 'perf', icon: '⚡', descKey: 'typePerf' },
  { value: 'test', icon: '✅', descKey: 'typeTest' },
  { value: 'build', icon: '👷', descKey: 'typeBuild' },
  { value: 'ci', icon: '🔧', descKey: 'typeCi' },
  { value: 'chore', icon: '🔖', descKey: 'typeChore' },
  { value: 'revert', icon: '⏪', descKey: 'typeRevert' },
]

const MAX_SUBJECT_LEN = 50
const BREAKING_TOKEN = 'BREAKING CHANGE: '
const CLOSES_TOKEN = 'Closes '

/** type/scope/描述等持久化 */
const config = useStorage('tool-commit-generator-config', {
  type: 'feat',
  scope: '',
  subject: '',
  body: '',
  breaking: false,
  breakingDesc: '',
  issues: '',
})

/** 安全读取：存储值损坏时回退，不让页面崩溃 */
function str(value) {
  return typeof value === 'string' ? value : ''
}
const currentType = computed(() => {
  const found = TYPES.find(tp => tp.value === config.value.type)
  return found || TYPES[0]
})
const scope = computed(() => str(config.value.scope))
const subject = computed(() => str(config.value.subject))
const body = computed(() => str(config.value.body))
const breakingDesc = computed(() => str(config.value.breakingDesc))
const issues = computed(() => str(config.value.issues))
const breaking = computed(() => config.value.breaking === true)

const typeOptions = computed(() =>
  TYPES.map(tp => ({
    value: tp.value,
    label: `${tp.icon} ${tp.value} · ${t(`tools.commitGenerator.${tp.descKey}`)}`,
  }))
)

const currentTypeDesc = computed(() =>
  t(`tools.commitGenerator.${currentType.value.descKey}`)
)

/** 描述超长黄色警告 */
const subjectTooLong = computed(() => subject.value.length > MAX_SUBJECT_LEN)

/** 解析 issue 列表：支持逗号/分号/空白分隔，自动补 # */
const issueIds = computed(() => {
  const raw = issues.value
  if (!raw.trim()) return []
  return raw
    .split(/[,，;；\s]+/)
    .map(s => s.trim().replace(/^#+/, ''))
    .filter(Boolean)
})

/** 实时生成 Conventional Commits 格式文本 */
const commitMessage = computed(() => {
  const lines = []
  const scopePart = scope.value.trim() ? `(${scope.value.trim()})` : ''
  const bang = breaking.value ? '!' : ''
  const firstLine = `${currentType.value.value}${scopePart}${bang}: ${subject.value.trim()}`
  lines.push(firstLine)

  const trimmedBody = body.value.trim()
  const footerLines = []
  if (breaking.value) {
    const desc = breakingDesc.value.trim()
    footerLines.push(BREAKING_TOKEN + (desc || '-'))
  }
  if (issueIds.value.length) {
    footerLines.push(CLOSES_TOKEN + issueIds.value.map(id => `#${id}`).join(', '))
  }

  if (trimmedBody) {
    lines.push('', trimmedBody)
  }
  if (footerLines.length) {
    lines.push('', footerLines.join('\n'))
  }
  return lines.join('\n')
})

const canCopy = computed(() => subject.value.trim().length > 0)

const SPEC_ITEMS = ['specType', 'specScope', 'specSubject', 'specBreaking', 'specBody', 'specFooter']
</script>

<template>
  <ToolPage tool-id="commitGenerator">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="label-base" for="cg-type">{{ t('tools.commitGenerator.typeLabel') }}</label>
          <select
            id="cg-type"
            v-model="config.type"
            class="input-base"
            :aria-label="t('tools.commitGenerator.typeLabel')"
          >
            <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <div class="mt-2">
            <span class="chip">
              <span class="mr-1" aria-hidden="true">{{ currentType.icon }}</span>
              <span class="font-mono font-semibold mr-1">{{ currentType.value }}</span>
              <span>{{ currentTypeDesc }}</span>
            </span>
          </div>
        </div>
        <div>
          <label class="label-base" for="cg-scope">{{ t('tools.commitGenerator.scopeLabel') }}</label>
          <input
            id="cg-scope"
            v-model="config.scope"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.commitGenerator.scopePlaceholder')"
            :aria-label="t('tools.commitGenerator.scopeLabel')"
          />
        </div>
      </div>

      <div class="mt-4">
        <label class="label-base" for="cg-subject">{{ t('tools.commitGenerator.subjectLabel') }}</label>
        <input
          id="cg-subject"
          v-model="config.subject"
          type="text"
          class="input-base"
          :class="subjectTooLong ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-100' : ''"
          :placeholder="t('tools.commitGenerator.subjectPlaceholder')"
          :aria-invalid="subjectTooLong ? 'true' : 'false'"
          :aria-label="t('tools.commitGenerator.subjectLabel')"
        />
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <p v-if="!subject.trim()" class="text-xs text-slate-400">
            {{ t('tools.commitGenerator.subjectRequired') }}
          </p>
          <p v-else-if="subjectTooLong" class="text-xs text-amber-600" role="alert">
            {{ t('tools.commitGenerator.subjectTooLong', { n: MAX_SUBJECT_LEN }) }}
          </p>
          <span v-else class="text-xs text-emerald-600">{{ t('tools.commitGenerator.subjectOk') }}</span>
          <span
            class="shrink-0 text-xs font-mono"
            :class="subjectTooLong ? 'text-amber-600' : 'text-slate-400'"
          >
            {{ subject.length }}/{{ MAX_SUBJECT_LEN }}
          </span>
        </div>
      </div>

      <div class="mt-4">
        <label class="label-base" for="cg-body">{{ t('tools.commitGenerator.bodyLabel') }}</label>
        <textarea
          id="cg-body"
          v-model="config.body"
          rows="3"
          class="input-base w-full"
          :placeholder="t('tools.commitGenerator.bodyPlaceholder')"
          :aria-label="t('tools.commitGenerator.bodyLabel')"
        ></textarea>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <label class="chip cursor-pointer select-none" :class="{ 'opacity-70': !breaking }">
          <input
            v-model="config.breaking"
            type="checkbox"
            class="mr-1.5 accent-blue-600"
            :aria-label="t('tools.commitGenerator.breakingLabel')"
          />
          {{ t('tools.commitGenerator.breakingLabel') }}
        </label>
        <label class="flex-1 min-w-[200px]">
          <input
            v-model="config.issues"
            type="text"
            class="input-base"
            :placeholder="t('tools.commitGenerator.issuesPlaceholder')"
            :aria-label="t('tools.commitGenerator.issuesLabel')"
          />
        </label>
      </div>

      <div v-if="breaking" class="mt-3">
        <label class="label-base" for="cg-breaking-desc">{{ t('tools.commitGenerator.breakingDescLabel') }}</label>
        <textarea
          id="cg-breaking-desc"
          v-model="config.breakingDesc"
          rows="2"
          class="input-base w-full"
          :placeholder="t('tools.commitGenerator.breakingDescPlaceholder')"
          :aria-label="t('tools.commitGenerator.breakingDescLabel')"
        ></textarea>
      </div>
    </section>

    <!-- 预览区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.commitGenerator.previewTitle') }}</h2>
        <CopyButton :text="commitMessage" :label="t('toolsCommon.copy')" :disabled="!canCopy" />
      </div>
      <pre v-if="canCopy" class="cg-preview font-mono text-sm text-slate-800">{{ commitMessage }}</pre>
      <p v-else class="text-sm text-slate-400">{{ t('tools.commitGenerator.emptyPreviewHint') }}</p>

      <div v-if="breaking" class="mt-3 flex flex-wrap gap-2">
        <span class="chip border-amber-200 bg-amber-50 text-amber-700">
          {{ t('tools.commitGenerator.breakingBadge') }}
        </span>
        <span v-if="issueIds.length" class="chip">
          {{ t('tools.commitGenerator.issuesBadge', { n: issueIds.length }) }}
        </span>
      </div>
    </section>

    <!-- 规范速查 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.commitGenerator.specTitle') }}</h2>
      <div class="rounded-xl border border-slate-200 bg-white/70 p-3 mb-3">
        <code class="font-mono text-xs sm:text-sm text-slate-700 break-all">
          {{ t('tools.commitGenerator.specFormat') }}
        </code>
      </div>
      <ul class="space-y-1.5">
        <li
          v-for="item in SPEC_ITEMS"
          :key="item"
          class="text-sm text-slate-600 leading-relaxed flex gap-2"
        >
          <span class="text-blue-500 shrink-0" aria-hidden="true">·</span>
          <span>{{ t(`tools.commitGenerator.${item}`) }}</span>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

<style scoped>
.cg-preview {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  padding: 0.85rem 1rem;
}
</style>
