<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * .env 可视化管理器
 * - 粘贴 .env 解析为可编辑表格：跳过注释、剥离 export 前缀、剥离成对引号、容忍等号两侧空格
 * - 键命名行内校验（红标不阻塞编辑）；与 .env.example 模板比对缺失 / 多余变量
 * - 导出规范 .env 与 .env.example（排序 / 占位符开关），复制 + 下载
 * - 隐私：文本与表格值仅存于内存，绝不写 localStorage；仅选项持久化
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 常量 ---------------- */

const KEY_RE = /^[A-Z][A-Z0-9_]*$/

let uidSeed = 0
function nextId() {
  uidSeed += 1
  return 'e' + Date.now().toString(36) + '-' + uidSeed.toString(36)
}

/* ---------------- 状态（隐私：内容全部不持久化） ---------------- */

const envText = ref('')
const exampleText = ref('')
const rows = ref([])
const commentCount = ref(0)
const parseMessage = ref('')

/** 仅选项持久化 */
const options = useStorage(
  'tool-env-manager-options',
  {
    sortByLetter: true,
    placeholderMode: 'empty',
    placeholderText: 'your_value_here',
  },
  undefined,
  { mergeDefaults: true },
)

/* ---------------- 解析 ---------------- */

/**
 * 解析 .env 文本：
 * - 跳过空行与 # 注释行（计数）
 * - 剥离 export 前缀；按第一个等号切分；容忍两侧空格
 * - 成对单引号 / 双引号包裹的值去引号
 * - 重复键后者覆盖前者并计数；无法识别的行跳过并计数
 */
function parseEnvText(text) {
  const result = { rows: [], comments: 0, badLines: 0, duplicates: 0 }
  const map = new Map()
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('#')) {
      result.comments += 1
      continue
    }
    let body = line
    if (/^export\s+/.test(body)) body = body.replace(/^export\s+/, '')
    const eq = body.indexOf('=')
    if (eq <= 0) {
      result.badLines += 1
      continue
    }
    const key = body.slice(0, eq).trim()
    if (!key) {
      result.badLines += 1
      continue
    }
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    if (map.has(key)) {
      result.duplicates += 1
      map.get(key).value = value
    } else {
      const row = { id: nextId(), key, value }
      map.set(key, row)
      result.rows.push(row)
    }
  }
  return result
}

function parseEnv() {
  parseMessage.value = ''
  const text = envText.value
  if (!text.trim()) {
    parseMessage.value = t('tools.envManager.parseEmpty')
    toast.info(t('tools.envManager.parseEmpty'))
    return
  }
  try {
    const r = parseEnvText(text)
    if (r.rows.length === 0) {
      parseMessage.value = t('tools.envManager.parseError')
      toast.error(t('tools.envManager.parseError'))
      return
    }
    rows.value = r.rows
    commentCount.value = r.comments
    toast.success(t('tools.envManager.parseDone'))
    if (r.duplicates > 0) toast.info(t('tools.envManager.duplicateWarn'))
    if (r.badLines > 0) toast.info(t('tools.envManager.badLinesWarn', { n: r.badLines }))
  } catch {
    parseMessage.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------------- 表格编辑 ---------------- */

function addRow() {
  rows.value = [...rows.value, { id: nextId(), key: '', value: '' }]
}

function removeRow(id) {
  rows.value = rows.value.filter((r) => r.id !== id)
}

function clearTable() {
  rows.value = []
  parseMessage.value = ''
}

function clearText() {
  envText.value = ''
  parseMessage.value = ''
}

function isKeyInvalid(row) {
  const k = String(row.key || '').trim()
  return k !== '' && !KEY_RE.test(k)
}

/* ---------------- 模板比对 ---------------- */

const templateKeys = computed(() => {
  try {
    return parseEnvText(exampleText.value).rows.map((r) => r.key)
  } catch {
    return []
  }
})

const rowKeys = computed(() => rows.value.map((r) => String(r.key || '').trim()).filter(Boolean))

const missingKeys = computed(() => templateKeys.value.filter((k) => !rowKeys.value.includes(k)))

const extraKeys = computed(() => rowKeys.value.filter((k) => !templateKeys.value.includes(k)))

/* ---------------- 统计 ---------------- */

const stats = computed(() => ({
  vars: rows.value.length,
  comments: commentCount.value,
  invalid: rows.value.filter(isKeyInvalid).length,
  missing: missingKeys.value.length,
}))

/* ---------------- 导出 ---------------- */

function sortedRows() {
  const valid = rows.value.filter((r) => String(r.key || '').trim() !== '')
  if (!options.value.sortByLetter) return valid
  return [...valid].sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

function formatValue(v) {
  const s = String(v == null ? '' : v)
  if (s === '') return ''
  if (/[\s"'#]/.test(s)) return '"' + s.replace(/"/g, '\\"') + '"'
  return s
}

const envExportText = computed(() => {
  const list = sortedRows()
  if (list.length === 0) return ''
  return list.map((r) => r.key + '=' + formatValue(r.value)).join('\n') + '\n'
})

const exampleExportText = computed(() => {
  const list = sortedRows()
  if (list.length === 0) return ''
  const ph = String(options.value.placeholderText || '').trim() || 'your_value_here'
  return list
    .map((r) => {
      const value = options.value.placeholderMode === 'placeholder' ? ph : ''
      return r.key + '=' + value
    })
    .join('\n') + '\n'
})

function downloadEnv() {
  try {
    if (!envExportText.value) return
    downloadText(envExportText.value, '.env', 'text/plain;charset=utf-8')
    toast.success(t('tools.envManager.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function downloadExample() {
  try {
    if (!exampleExportText.value) return
    downloadText(exampleExportText.value, '.env.example', 'text/plain;charset=utf-8')
    toast.success(t('tools.envManager.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="envManager">
    <!-- 输入 + 解析 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.envManager.inputTitle') }}</h2>
        <button type="button" class="btn-ghost" :disabled="!envText.trim()" @click="clearText">
          {{ t('tools.envManager.clearText') }}
        </button>
        <button type="button" class="btn-primary" :disabled="!envText.trim()" @click="parseEnv">
          {{ t('tools.envManager.parseBtn') }}
        </button>
      </div>
      <textarea
        v-model="envText"
        rows="7"
        class="input-base font-mono text-xs sm:text-sm"
        :placeholder="t('tools.envManager.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-amber-600 flex items-center gap-1">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {{ t('tools.envManager.privacyNote') }}
        </p>
        <p class="text-xs text-slate-400">{{ t('tools.envManager.reParseHint') }}</p>
      </div>
      <p v-if="parseMessage" class="mt-2 text-sm text-rose-500" role="alert">{{ parseMessage }}</p>
    </section>

    <!-- 统计 chips -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap gap-2">
        <span class="chip">{{ t('tools.envManager.statsVars') }}：{{ stats.vars }}</span>
        <span class="chip">{{ t('tools.envManager.statsComments') }}：{{ stats.comments }}</span>
        <span class="chip" :class="stats.invalid > 0 ? 'text-rose-600' : ''">
          {{ t('tools.envManager.statsInvalid') }}：{{ stats.invalid }}
        </span>
        <span class="chip" :class="stats.missing > 0 ? 'text-amber-600' : ''">
          {{ t('tools.envManager.statsMissing') }}：{{ stats.missing }}
        </span>
      </div>
    </section>

    <!-- 变量表格 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.envManager.tableTitle') }}</h2>
        <button type="button" class="btn-ghost" :disabled="rows.length === 0" @click="clearTable">
          {{ t('tools.envManager.clearTable') }}
        </button>
        <button type="button" class="btn-primary" @click="addRow">
          + {{ t('tools.envManager.addRow') }}
        </button>
      </div>

      <div v-if="rows.length === 0" class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
        {{ t('toolsCommon.none') }}
      </div>
      <div v-else class="space-y-2">
        <div class="hidden sm:flex items-center gap-2 px-1 text-xs text-slate-400">
          <span class="w-40 shrink-0">{{ t('tools.envManager.keyHeader') }}</span>
          <span class="flex-1">{{ t('tools.envManager.valueHeader') }}</span>
          <span class="w-10 shrink-0 text-center">{{ t('tools.envManager.actionsHeader') }}</span>
        </div>
        <div v-for="row in rows" :key="row.id">
          <div class="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input
              v-model="row.key"
              type="text"
              class="input-base font-mono w-full sm:w-40 shrink-0"
              :class="isKeyInvalid(row) ? 'border-rose-400 bg-rose-50/60 focus:border-rose-400' : ''"
              :placeholder="t('tools.envManager.keyHeader')"
              autocomplete="off"
              spellcheck="false"
            />
            <input
              v-model="row.value"
              type="text"
              class="input-base font-mono w-full sm:flex-1"
              :placeholder="t('tools.envManager.valueHeader')"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="btn-ghost shrink-0"
              :aria-label="t('tools.envManager.deleteRow')"
              @click="removeRow(row.id)"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p v-if="isKeyInvalid(row)" class="mt-1 text-xs text-rose-500">
            {{ t('tools.envManager.keyInvalid') }}
          </p>
        </div>
      </div>
    </section>

    <!-- 模板对照 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.envManager.templateTitle') }}</h2>
      <textarea
        v-model="exampleText"
        rows="5"
        class="input-base font-mono text-xs sm:text-sm"
        :placeholder="t('tools.envManager.templatePlaceholder')"
        spellcheck="false"
      ></textarea>

      <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 class="text-sm font-semibold text-slate-600 mb-2">{{ t('tools.envManager.missingTitle') }}</h3>
          <p v-if="!exampleText.trim()" class="text-xs text-slate-400">
            {{ t('tools.envManager.compareHint') }}
          </p>
          <p v-else-if="missingKeys.length === 0" class="text-sm text-emerald-600">
            {{ t('tools.envManager.missingNone') }}
          </p>
          <div v-else class="flex flex-wrap gap-1.5">
            <span v-for="k in missingKeys" :key="k" class="chip font-mono text-amber-600 border border-amber-200 bg-amber-50">
              {{ k }}
            </span>
          </div>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-slate-600 mb-2">{{ t('tools.envManager.extraTitle') }}</h3>
          <p v-if="!exampleText.trim()" class="text-xs text-slate-400">
            {{ t('tools.envManager.compareHint') }}
          </p>
          <p v-else-if="extraKeys.length === 0" class="text-sm text-emerald-600">
            {{ t('tools.envManager.extraNone') }}
          </p>
          <div v-else class="flex flex-wrap gap-1.5">
            <span v-for="k in extraKeys" :key="k" class="chip font-mono text-rose-600 border border-rose-200 bg-rose-50">
              {{ k }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- 导出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.envManager.exportTitle') }}</h2>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
        <label class="inline-flex items-center gap-2 cursor-pointer select-none">
          <input v-model="options.sortByLetter" type="checkbox" class="h-4 w-4 accent-blue-600" />
          <span class="text-sm text-slate-600">{{ t('tools.envManager.sortLabel') }}</span>
        </label>
        <div class="inline-flex items-center gap-2">
          <span class="text-sm text-slate-600">{{ t('tools.envManager.exampleModeLabel') }}</span>
          <label class="inline-flex items-center gap-1 cursor-pointer select-none">
            <input v-model="options.placeholderMode" type="radio" value="empty" class="h-4 w-4 accent-blue-600" />
            <span class="text-sm text-slate-500">{{ t('tools.envManager.modeEmpty') }}</span>
          </label>
          <label class="inline-flex items-center gap-1 cursor-pointer select-none">
            <input v-model="options.placeholderMode" type="radio" value="placeholder" class="h-4 w-4 accent-blue-600" />
            <span class="text-sm text-slate-500">{{ t('tools.envManager.modePlaceholder') }}</span>
          </label>
        </div>
        <div v-if="options.placeholderMode === 'placeholder'" class="w-full sm:w-56">
          <label class="label-base" for="env-placeholder">{{ t('tools.envManager.placeholderTextLabel') }}</label>
          <input
            id="env-placeholder"
            v-model="options.placeholderText"
            type="text"
            class="input-base font-mono"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="space-y-4">
        <div>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="text-sm font-semibold text-slate-600 flex-1 mb-0">{{ t('tools.envManager.envExportLabel') }}</h3>
            <CopyButton :text="envExportText" :label="t('toolsCommon.copy')" :disabled="!envExportText" />
            <button type="button" class="btn-primary" :disabled="!envExportText" @click="downloadEnv">
              {{ t('tools.envManager.downloadEnv') }}
            </button>
          </div>
          <pre
            v-if="envExportText"
            class="font-mono text-xs leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-56"
            tabindex="0"
          >{{ envExportText }}</pre>
          <p v-else class="text-xs text-slate-400">{{ t('tools.envManager.emptyExport') }}</p>
        </div>

        <div>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="text-sm font-semibold text-slate-600 flex-1 mb-0">{{ t('tools.envManager.exampleExportLabel') }}</h3>
            <CopyButton :text="exampleExportText" :label="t('toolsCommon.copy')" :disabled="!exampleExportText" />
            <button type="button" class="btn-primary" :disabled="!exampleExportText" @click="downloadExample">
              {{ t('tools.envManager.downloadExample') }}
            </button>
          </div>
          <pre
            v-if="exampleExportText"
            class="font-mono text-xs leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-56"
            tabindex="0"
          >{{ exampleExportText }}</pre>
          <p v-else class="text-xs text-slate-400">{{ t('tools.envManager.emptyExport') }}</p>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
