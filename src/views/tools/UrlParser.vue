<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * URL 解析器
 * - 自动补全 https://；new URL 构造 try/catch，行内显示失败原因
 * - 组成部分表格：protocol/username/password/hostname/port/pathname/search/hash/origin/href
 *   每行可复制；port 为空且协议有默认端口时标注「默认」
 * - pathname 与 search 支持编码 / 解码两种形态切换
 * - searchParams 解码为键值对（+ 号转空格、重复参数名多行），每格可复制
 * - 输入与显示形态持久化；空 search / 空 hash 显示「无」
 */
const { t } = useI18n()

/** 常见协议默认端口 */
const DEFAULT_PORTS = {
  'http:': '80',
  'https:': '443',
  'ftp:': '21',
  'ws:': '80',
  'wss:': '443',
}

/* ---------------- 持久化输入 ---------------- */

const input = useStorage(
  'tool-url-parser-input',
  'https://example.com:8443/api/search?q=hello%20world&page=2&tag=web&tag=tool#section-1'
)
const displayForm = useStorage('tool-url-parser-form', 'encoded')

/* ---------------- 解析 ---------------- */

/** 无协议时自动补 https:// */
const normalizedInput = computed(() => {
  const raw = (input.value || '').trim()
  if (raw === '') return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw
  return 'https://' + raw
})

const parsed = computed(() => {
  const raw = (input.value || '').trim()
  if (raw === '') return { empty: true }
  try {
    return { empty: false, url: new URL(normalizedInput.value) }
  } catch (err) {
    return { empty: false, error: err && err.message ? String(err.message) : '' }
  }
})

/** 安全解码：非法 % 序列时回退原文 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const displayFormLabel = computed(() =>
  displayForm.value === 'encoded' ? t('tools.urlParser.encoded') : t('tools.urlParser.decoded')
)

/** 按 displayForm 返回 pathname / search 的展示值 */
function displayValue(value) {
  return displayForm.value === 'encoded' ? value : safeDecode(value)
}

/* ---------------- 组成部分行 ---------------- */

const partRows = computed(() => {
  if (parsed.value.empty || parsed.value.error) return []
  const u = parsed.value.url
  const defaultPort = DEFAULT_PORTS[u.protocol] || ''
  const isDefaultPort = u.port === '' && defaultPort !== ''
  const searchEncoded = u.search
  const searchDecoded = u.search === '' ? '' : safeDecode(u.search)
  return [
    { key: 'protocol', label: t('tools.urlParser.partProtocol'), value: u.protocol, mono: true },
    { key: 'username', label: t('tools.urlParser.partUsername'), value: u.username },
    { key: 'password', label: t('tools.urlParser.partPassword'), value: u.password },
    { key: 'hostname', label: t('tools.urlParser.partHostname'), value: u.hostname, mono: true },
    {
      key: 'port',
      label: t('tools.urlParser.partPort'),
      value: u.port !== '' ? u.port : defaultPort,
      mono: true,
      badge: isDefaultPort ? t('tools.urlParser.defaultPortBadge') : '',
    },
    {
      key: 'pathname',
      label: t('tools.urlParser.partPathname'),
      value: displayValue(u.pathname),
      mono: true,
      badge: '',
      sub: displayFormLabel.value,
    },
    {
      key: 'search',
      label: t('tools.urlParser.partSearch'),
      value: u.search === '' ? '' : displayForm.value === 'encoded' ? searchEncoded : searchDecoded,
      mono: true,
      badge: '',
      sub: u.search === '' ? '' : displayFormLabel.value,
    },
    { key: 'hash', label: t('tools.urlParser.partHash'), value: u.hash, mono: true },
    { key: 'origin', label: t('tools.urlParser.partOrigin'), value: u.origin, mono: true },
    { key: 'href', label: t('tools.urlParser.partHref'), value: u.href, mono: true },
  ]
})

/* ---------------- 查询参数（重复键多行，+ 号由 URLSearchParams 转为空格） ---------------- */

const searchParamRows = computed(() => {
  if (parsed.value.empty || parsed.value.error) return []
  try {
    const pairs = []
    let i = 0
    for (const pair of parsed.value.url.searchParams.entries()) {
      pairs.push({ id: i, key: pair[0], value: pair[1] })
      i++
    }
    return pairs
  } catch {
    return []
  }
})
</script>

<template>
  <ToolPage tool-id="urlParser">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="url-parser-input">{{ t('tools.urlParser.urlLabel') }}</label>
      <input
        id="url-parser-input"
        v-model="input"
        type="text"
        class="input-base font-mono"
        :class="!parsed.empty && parsed.error ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''"
        :placeholder="t('tools.urlParser.urlPlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
      <p v-if="!parsed.empty && parsed.error" class="mt-1.5 text-xs text-rose-500 break-all">
        {{ t('tools.urlParser.urlInvalid') }}: {{ parsed.error }}
      </p>
      <p v-else-if="parsed.empty" class="mt-1.5 text-xs text-slate-400">
        {{ t('tools.urlParser.urlPlaceholder') }}
      </p>
      <p v-else class="mt-1.5 text-xs text-slate-400">
        {{ t('toolsCommon.chars') }}: {{ input.length }}
      </p>
    </section>

    <template v-if="!parsed.empty && !parsed.error">
      <!-- 组成部分表格 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <h2 class="section-title flex-1 mb-0">{{ t('tools.urlParser.partsTitle') }}</h2>
          <!-- 编码 / 解码切换 -->
          <div
            class="inline-flex rounded-lg border border-slate-200 bg-white/70 p-0.5"
            role="group"
            :aria-label="t('tools.urlParser.displayMode')"
          >
            <button
              type="button"
              class="px-3 py-1 rounded-md text-xs font-medium transition select-none"
              :class="displayForm === 'encoded' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="displayForm = 'encoded'"
            >
              {{ t('tools.urlParser.encoded') }}
            </button>
            <button
              type="button"
              class="px-3 py-1 rounded-md text-xs font-medium transition select-none"
              :class="displayForm === 'decoded' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600'"
              @click="displayForm = 'decoded'"
            >
              {{ t('tools.urlParser.decoded') }}
            </button>
          </div>
        </div>

        <div class="space-y-1.5">
          <div
            v-for="row in partRows"
            :key="row.key"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
          >
            <span class="text-xs sm:text-sm text-slate-500 w-full sm:w-40 shrink-0">
              {{ row.label }}
              <span v-if="row.sub" class="block sm:inline text-[10px] text-slate-400">（{{ row.sub }}）</span>
            </span>
            <span
              class="font-mono text-xs sm:text-sm text-slate-800 break-all min-w-0 flex-1"
              :class="row.value === '' ? 'text-slate-400 font-normal' : ''"
            >
              {{ row.value === '' ? t('toolsCommon.none') : row.value }}
            </span>
            <span
              v-if="row.badge"
              class="chip shrink-0"
            >{{ row.badge }}</span>
            <CopyButton
              compact
              :text="row.value"
              :label="t('tools.urlParser.copyValue')"
              :disabled="row.value === ''"
            />
          </div>
        </div>
      </section>

      <!-- 查询参数表 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <h2 class="section-title flex-1 mb-0">{{ t('tools.urlParser.paramsTitle') }}</h2>
          <span v-if="searchParamRows.length" class="chip">
            {{ searchParamRows.length }} {{ t('toolsCommon.items') }}
          </span>
        </div>

        <div v-if="searchParamRows.length" class="space-y-2">
          <div
            v-for="pair in searchParamRows"
            :key="pair.id"
            class="rounded-xl border border-slate-100 bg-white/70 p-2.5 flex flex-col sm:flex-row gap-2 sm:gap-3"
          >
            <div class="flex items-center gap-2 min-w-0 sm:flex-1">
              <span class="text-[10px] text-slate-400 shrink-0 w-12">{{ t('tools.urlParser.keyCol') }}</span>
              <span class="font-mono text-xs sm:text-sm text-slate-800 break-all min-w-0 flex-1">{{ pair.key }}</span>
              <CopyButton compact :text="pair.key" :label="t('tools.urlParser.copyValue')" />
            </div>
            <div class="flex items-center gap-2 min-w-0 sm:flex-1">
              <span class="text-[10px] text-slate-400 shrink-0 w-12">{{ t('tools.urlParser.valueCol') }}</span>
              <span class="font-mono text-xs sm:text-sm text-slate-800 break-all min-w-0 flex-1">{{ pair.value }}</span>
              <CopyButton compact :text="pair.value" :label="t('tools.urlParser.copyValue')" />
            </div>
          </div>
        </div>
        <div
          v-else
          class="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400"
        >
          {{ t('tools.urlParser.noParams') }}
        </div>
      </section>
    </template>
  </ToolPage>
</template>
