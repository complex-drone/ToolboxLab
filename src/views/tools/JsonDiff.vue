<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * JSON 差异对比（自实现结构化 diff，无第三方依赖）
 * - 左右两份 JSON 防抖 500ms 解析，失败分别行内报错
 * - 递归对比：对象按键、数组按索引（长度差异体现为增删条目）
 * - 差异条目 = 类型徽章 + 扁平路径 + 旧值 → 新值（长值截断 80 字符，类型变化附加类型标注）
 * - 过滤（全部/新增/删除/修改/类型变化）+ 路径关键词搜索 + 差异报告复制
 */
const { t } = useI18n()

const SAMPLE_LEFT = [
  '{',
  '  "name": "toolbox",',
  '  "version": "1.2.0",',
  '  "stable": true,',
  '  "rating": 4.5,',
  '  "tags": ["utils", "web"],',
  '  "author": { "name": "Alice", "email": "alice@example.com" },',
  '  "deprecated": false',
  '}',
].join('\n')

const SAMPLE_RIGHT = [
  '{',
  '  "name": "toolbox",',
  '  "version": "2.0.0",',
  '  "rating": "4.5",',
  '  "tags": ["utils", "web", "tools"],',
  '  "author": { "name": "Alice", "homepage": "https://example.com" },',
  '  "license": "MIT"',
  '}',
].join('\n')

const TYPE_BADGE_CLS = {
  added: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  removed: 'bg-red-50 text-red-600 border-red-100',
  changed: 'bg-amber-50 text-amber-600 border-amber-100',
  typeChanged: 'bg-purple-50 text-purple-600 border-purple-100',
}

const FILTERS = [
  { key: 'all' },
  { key: 'added' },
  { key: 'removed' },
  { key: 'changed' },
  { key: 'typeChanged' },
]

/* ---------- 输入持久化 ---------- */

const input = useStorage('tool-json-diff-input', { left: '', right: '' })

const leftError = ref('')
const rightError = ref('')
const leftState = ref({ ok: false, value: undefined })
const rightState = ref({ ok: false, value: undefined })
const diffs = ref([])
const filterType = ref('all')
const searchQuery = ref('')

/* ---------- 解析 ---------- */

function tryParse(text) {
  if (!text.trim()) return { ok: false, value: undefined, error: '' }
  try {
    return { ok: true, value: JSON.parse(text), error: '' }
  } catch (e) {
    const detail = e && e.message ? ' (' + e.message + ')' : ''
    return { ok: false, value: undefined, error: t('tools.jsonDiff.parseError') + detail }
  }
}

function parseBoth() {
  const l = tryParse(input.value.left)
  const r = tryParse(input.value.right)
  leftError.value = l.error
  rightError.value = r.error
  leftState.value = { ok: l.ok, value: l.value }
  rightState.value = { ok: r.ok, value: r.value }
  diffs.value = l.ok && r.ok ? computeDiff(l.value, r.value) : []
}

const parseDebounced = useDebounceFn(parseBoth, 500)

watch(
  () => [input.value.left, input.value.right],
  () => parseDebounced()
)

onMounted(() => {
  parseBoth()
})

/* ---------- 结构化 diff ---------- */

function jsonType(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** 合法 JS 标识符用点号，否则用中括号加引号 */
function joinKey(base, key) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return base + '.' + key
  const escaped = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return base + "['" + escaped + "']"
}

function computeDiff(oldRoot, newRoot) {
  const out = []
  walk(oldRoot, newRoot, '$', out)
  return out
}

function walk(oldV, newV, path, out) {
  const to = jsonType(oldV)
  const tn = jsonType(newV)

  if (to !== tn) {
    out.push({ type: 'typeChanged', path, oldValue: oldV, newValue: newV, oldType: to, newType: tn })
    return
  }

  if (to === 'object') {
    const oldKeys = Object.keys(oldV)
    const newKeys = Object.keys(newV)
    const keys = [...oldKeys, ...newKeys.filter(k => !Object.prototype.hasOwnProperty.call(oldV, k))]
    for (const key of keys) {
      const p = joinKey(path, key)
      const inOld = Object.prototype.hasOwnProperty.call(oldV, key)
      const inNew = Object.prototype.hasOwnProperty.call(newV, key)
      if (inOld && !inNew) out.push({ type: 'removed', path: p, oldValue: oldV[key] })
      else if (!inOld && inNew) out.push({ type: 'added', path: p, newValue: newV[key] })
      else walk(oldV[key], newV[key], p, out)
    }
    return
  }

  if (to === 'array') {
    const len = Math.max(oldV.length, newV.length)
    for (let i = 0; i < len; i++) {
      const p = path + '[' + i + ']'
      if (i >= newV.length) out.push({ type: 'removed', path: p, oldValue: oldV[i] })
      else if (i >= oldV.length) out.push({ type: 'added', path: p, newValue: newV[i] })
      else walk(oldV[i], newV[i], p, out)
    }
    return
  }

  if (oldV !== newV) {
    out.push({ type: 'changed', path, oldValue: oldV, newValue: newV })
  }
}

/** 原始值直显，对象与数组 JSON 序列化后截断 80 字符 */
function formatVal(v) {
  if (v === undefined) return ''
  let s
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) s = String(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

/* ---------- 统计 / 过滤 / 报告 ---------- */

const stats = computed(() => ({
  added: diffs.value.filter(d => d.type === 'added').length,
  removed: diffs.value.filter(d => d.type === 'removed').length,
  changed: diffs.value.filter(d => d.type === 'changed').length,
  typeChanged: diffs.value.filter(d => d.type === 'typeChanged').length,
}))

const bothReady = computed(() => leftState.value.ok && rightState.value.ok)
const eitherEmpty = computed(() => !input.value.left.trim() || !input.value.right.trim())

const filteredDiffs = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  return diffs.value.filter(d => {
    if (filterType.value !== 'all' && d.type !== filterType.value) return false
    if (kw && !d.path.toLowerCase().includes(kw)) return false
    return true
  })
})

const reportText = computed(() => {
  return filteredDiffs.value
    .map(d => {
      const label = t(i18nKey('type_', d.type))
      if (d.type === 'added') return '[' + label + '] ' + d.path + ' : ' + formatVal(d.newValue)
      if (d.type === 'removed') return '[' + label + '] ' + d.path + ' : ' + formatVal(d.oldValue)
      if (d.type === 'typeChanged') {
        return (
          '[' + label + '] ' + d.path + ' : ' + formatVal(d.oldValue) + ' → ' + formatVal(d.newValue) +
          ' (' + d.oldType + ' → ' + d.newType + ')'
        )
      }
      return '[' + label + '] ' + d.path + ' : ' + formatVal(d.oldValue) + ' → ' + formatVal(d.newValue)
    })
    .join('\n')
})

/* ---------- 操作 ---------- */

function swapSides() {
  const l = input.value.left
  input.value.left = input.value.right
  input.value.right = l
}

function loadSample() {
  input.value.left = SAMPLE_LEFT
  input.value.right = SAMPLE_RIGHT
}

function clearAll() {
  input.value.left = ''
  input.value.right = ''
  searchQuery.value = ''
}

// 差异类型为驼峰命名（typeChanged），语言包键为下划线命名（type_type_changed）
function i18nKey(prefix, type) {
  return 'tools.jsonDiff.' + prefix + type.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
}

function typeLabel(type) {
  return t(i18nKey('type_', type))
}
</script>

<template>
  <ToolPage tool-id="jsonDiff">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('toolsCommon.input') }}</span>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-ghost" @click="swapSides">
          {{ t('toolsCommon.swap') }}
        </button>
        <button type="button" class="btn-danger" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="min-w-0">
          <span class="label-base">{{ t('tools.jsonDiff.leftLabel') }}</span>
          <textarea
            v-model="input.left"
            class="input-base font-mono h-48 resize-y"
            :placeholder="t('tools.jsonDiff.leftPlaceholder')"
            spellcheck="false"
          ></textarea>
          <p v-if="leftError" class="text-red-600 text-xs mt-1.5 break-all">{{ leftError }}</p>
        </div>
        <div class="min-w-0">
          <span class="label-base">{{ t('tools.jsonDiff.rightLabel') }}</span>
          <textarea
            v-model="input.right"
            class="input-base font-mono h-48 resize-y"
            :placeholder="t('tools.jsonDiff.rightPlaceholder')"
            spellcheck="false"
          ></textarea>
          <p v-if="rightError" class="text-red-600 text-xs mt-1.5 break-all">{{ rightError }}</p>
        </div>
      </div>

      <p class="text-xs text-slate-400 mt-3">{{ t('tools.jsonDiff.strategyNote') }}</p>
    </section>

    <!-- 差异区 -->
    <section class="glass-card p-4 sm:p-6">
      <!-- 统计 chips -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="chip font-mono">{{ typeLabel('added') }} {{ stats.added }}</span>
        <span class="chip font-mono">{{ typeLabel('removed') }} {{ stats.removed }}</span>
        <span class="chip font-mono">{{ typeLabel('changed') }} {{ stats.changed }}</span>
        <span class="chip font-mono">{{ typeLabel('typeChanged') }} {{ stats.typeChanged }}</span>
        <span class="flex-1"></span>
        <CopyButton
          :text="reportText"
          :label="t('tools.jsonDiff.copyReport')"
          :disabled="filteredDiffs.length === 0"
        />
      </div>

      <p v-if="bothReady && diffs.length === 0" class="text-sm text-emerald-600 py-4 text-center">
        {{ t('tools.jsonDiff.noDiff') }}
      </p>
      <p v-else-if="eitherEmpty" class="text-sm text-slate-400 py-4 text-center">
        {{ t('tools.jsonDiff.needBoth') }}
      </p>

      <template v-else>
        <!-- 过滤器 + 搜索 -->
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center mb-3">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="f in FILTERS"
              :key="f.key"
              type="button"
              class="px-2.5 py-1 rounded-full text-xs border transition select-none"
              :class="
                filterType === f.key
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white/70 border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
              "
              @click="filterType = f.key"
            >
              {{ t(i18nKey('filter_', f.key)) }}
            </button>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="input-base sm:max-w-xs sm:ml-auto"
            :placeholder="t('tools.jsonDiff.searchPlaceholder')"
          />
        </div>

        <p v-if="filteredDiffs.length === 0" class="text-sm text-slate-400 py-4 text-center">
          {{ t('tools.jsonDiff.noMatch') }}
        </p>
        <ul v-else class="max-h-[520px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
          <li v-for="(d, i) in filteredDiffs" :key="i" class="flex items-start gap-2.5 px-3 py-2">
            <span
              class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap mt-0.5"
              :class="TYPE_BADGE_CLS[d.type]"
            >
              {{ typeLabel(d.type) }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="font-mono text-xs text-slate-700 break-all">{{ d.path }}</div>
              <div class="text-sm text-slate-600 break-all mt-0.5">
                <template v-if="d.type === 'added'">
                  <span class="text-emerald-600">{{ formatVal(d.newValue) }}</span>
                </template>
                <template v-else-if="d.type === 'removed'">
                  <span class="text-red-600 line-through">{{ formatVal(d.oldValue) }}</span>
                </template>
                <template v-else>
                  <span class="text-red-500 line-through">{{ formatVal(d.oldValue) }}</span>
                  <span class="mx-1.5 text-slate-400">→</span>
                  <span class="text-emerald-600">{{ formatVal(d.newValue) }}</span>
                </template>
                <span
                  v-if="d.type === 'typeChanged'"
                  class="ml-2 text-xs text-purple-600 font-mono whitespace-nowrap"
                >
                  {{ d.oldType }} → {{ d.newType }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </section>
  </ToolPage>
</template>
