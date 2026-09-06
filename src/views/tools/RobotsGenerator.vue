<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * robots.txt 生成器
 * - 规则组：User-agent（常用爬虫下拉 + 自定义）+ Allow/Disallow 路径行 + 可选 Crawl-delay
 * - Sitemap URL 列表，逐行校验 http(s) 协议
 * - 实时生成预览；空规则组（无 User-agent 或无有效规则行）跳过不输出
 * - 三个常用预设一键填充；配置整体持久化
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 常量 ---------------- */

/** 常用爬虫预设（custom 表示自定义输入） */
const AGENT_PRESETS = ['*', 'Googlebot', 'Baiduspider', 'Bingbot']
const CUSTOM = '__custom__'

/** 禁止后台目录预设使用的路径 */
const ADMIN_PATHS = ['/admin/', '/administrator/', '/wp-admin/', '/manage/', '/backend/']

let uidSeed = 0
function nextId() {
  uidSeed += 1
  return Date.now().toString(36) + '-' + uidSeed.toString(36)
}

function makeRule(type = 'disallow', path = '') {
  return { id: nextId(), type, path }
}

function makeGroup() {
  return {
    id: nextId(),
    agent: '*',
    customAgent: '',
    delay: '',
    rules: [makeRule()],
  }
}

/* ---------------- 持久化配置 ---------------- */

const config = useStorage('tool-robots-generator-config', {
  groups: [makeGroup()],
  sitemaps: [],
})

const groups = computed(() => config.value.groups || [])
const sitemaps = computed(() => config.value.sitemaps || [])

/* ---------------- 校验 ---------------- */

/** 路径行是否无效：非空且不以 / 开头 */
function isPathInvalid(rule) {
  const p = (rule.path || '').trim()
  return p !== '' && !p.startsWith('/')
}

/** 解析 Crawl-delay：空为 null；非法返回 NaN；合法返回整数 */
function parseDelay(group) {
  const raw = String(group.delay == null ? '' : group.delay).trim()
  if (raw === '') return null
  if (!/^\d+$/.test(raw)) return NaN
  return parseInt(raw, 10)
}

function isDelayInvalid(group) {
  return Number.isNaN(parseDelay(group))
}

/** Sitemap 是否无效：需为 http(s) 开头的合法 URL */
function isSitemapInvalid(url) {
  const u = (url || '').trim()
  if (u === '') return false
  try {
    const parsed = new URL(u)
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:'
  } catch {
    return true
  }
}

/** 取规则组的 User-agent 名称（自定义时取输入框） */
function agentName(group) {
  return group.agent === CUSTOM ? (group.customAgent || '').trim() : group.agent
}

/** 规则组是否有效（可输出）：有 agent 且至少一条非空路径规则 */
function isGroupActive(group) {
  const hasAgent = agentName(group) !== ''
  const hasRule = (group.rules || []).some((r) => (r.path || '').trim() !== '')
  return hasAgent && hasRule
}

const validGroupCount = computed(() => groups.value.filter(isGroupActive).length)

/* ---------------- 生成 ---------------- */

const generatedText = computed(() => {
  const chunks = []
  for (const group of groups.value) {
    if (!isGroupActive(group)) continue
    const lines = ['User-agent: ' + agentName(group)]
    for (const rule of group.rules) {
      const p = (rule.path || '').trim()
      if (p === '') continue
      lines.push((rule.type === 'allow' ? 'Allow: ' : 'Disallow: ') + p)
    }
    const delay = parseDelay(group)
    if (delay !== null && !Number.isNaN(delay)) {
      lines.push('Crawl-delay: ' + delay)
    }
    chunks.push(lines.join('\n'))
  }
  const sitemapLines = []
  for (const url of sitemaps.value) {
    const u = (url || '').trim()
    if (u === '' || isSitemapInvalid(u)) continue
    sitemapLines.push('Sitemap: ' + u)
  }
  if (chunks.length === 0 && sitemapLines.length === 0) return ''
  const body = chunks.join('\n\n')
  return (body ? body + '\n\n' : '') + sitemapLines.join('\n') + '\n'
})

/* ---------------- 增删操作 ---------------- */

function addGroup() {
  config.value.groups = [...groups.value, makeGroup()]
}

function removeGroup(id) {
  config.value.groups = groups.value.filter((g) => g.id !== id)
}

function addRule(group) {
  group.rules = [...(group.rules || []), makeRule()]
}

function removeRule(group, ruleId) {
  group.rules = (group.rules || []).filter((r) => r.id !== ruleId)
}

function addSitemap() {
  config.value.sitemaps = [...sitemaps.value, '']
}

function removeSitemap(index) {
  config.value.sitemaps = sitemaps.value.filter((_, i) => i !== index)
}

/* ---------------- 预设 ---------------- */

function applyPreset(kind) {
  if (kind === 'allowAll') {
    config.value.groups = [
      {
        id: nextId(),
        agent: '*',
        customAgent: '',
        delay: '',
        rules: [makeRule('allow', '/')],
      },
    ]
  } else if (kind === 'disallowAll') {
    config.value.groups = [
      {
        id: nextId(),
        agent: '*',
        customAgent: '',
        delay: '',
        rules: [makeRule('disallow', '/')],
      },
    ]
  } else {
    config.value.groups = [
      {
        id: nextId(),
        agent: '*',
        customAgent: '',
        delay: '',
        rules: ADMIN_PATHS.map((p) => makeRule('disallow', p)),
      },
    ]
  }
  config.value.sitemaps = sitemaps.value
  toast.info(t('tools.robotsGenerator.presetApplied'))
}

/* ---------------- 复制 / 下载 ---------------- */

function downloadRobots() {
  try {
    if (!generatedText.value) return
    downloadText(generatedText.value, 'robots.txt', 'text/plain;charset=utf-8')
    toast.success(t('tools.robotsGenerator.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="robotsGenerator">
    <!-- 常用预设 + 规则组 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.robotsGenerator.presetsTitle') }}</h2>
        <button type="button" class="btn-ghost" @click="applyPreset('allowAll')">
          {{ t('tools.robotsGenerator.presetAllowAll') }}
        </button>
        <button type="button" class="btn-ghost" @click="applyPreset('disallowAll')">
          {{ t('tools.robotsGenerator.presetDisallowAll') }}
        </button>
        <button type="button" class="btn-ghost" @click="applyPreset('admin')">
          {{ t('tools.robotsGenerator.presetAdmin') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.robotsGenerator.groupsTitle') }}</h2>
        <span class="chip">
          {{ validGroupCount }} / {{ groups.length }} {{ t('tools.robotsGenerator.groupsUnit') }}
        </span>
        <button type="button" class="btn-primary" @click="addGroup">
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {{ t('tools.robotsGenerator.addGroup') }}
        </button>
      </div>

      <div class="space-y-4">
        <div
          v-for="(group, gi) in groups"
          :key="group.id"
          class="rounded-xl border p-3 sm:p-4"
          :class="isGroupActive(group) ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white/60'"
        >
          <!-- 组头：User-agent + 删除组 -->
          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-0">
              <label class="label-base" :for="'agent-' + group.id">
                {{ t('tools.robotsGenerator.userAgentLabel') }} · {{ gi + 1 }}
              </label>
              <select :id="'agent-' + group.id" v-model="group.agent" class="input-base">
                <option v-for="a in AGENT_PRESETS" :key="a" :value="a">{{ a }}</option>
                <option :value="CUSTOM">{{ t('tools.robotsGenerator.agentCustom') }}</option>
              </select>
            </div>
            <div v-if="group.agent === CUSTOM" class="flex-1 min-w-[180px]">
              <label class="label-base" :for="'agent-custom-' + group.id">&nbsp;</label>
              <input
                :id="'agent-custom-' + group.id"
                v-model="group.customAgent"
                type="text"
                class="input-base"
                :placeholder="t('tools.robotsGenerator.agentPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <button
              type="button"
              class="btn-danger ml-auto"
              :aria-label="t('tools.robotsGenerator.deleteGroup')"
              @click="removeGroup(group.id)"
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
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>

          <!-- 路径规则行 -->
          <div class="mt-3 space-y-2">
            <div v-for="rule in group.rules" :key="rule.id" class="flex flex-wrap items-center gap-2">
              <select v-model="rule.type" class="input-base w-28 shrink-0" :aria-label="t('tools.robotsGenerator.ruleType')">
                <option value="disallow">{{ t('tools.robotsGenerator.disallow') }}</option>
                <option value="allow">{{ t('tools.robotsGenerator.allow') }}</option>
              </select>
              <div class="flex-1 min-w-[160px]">
                <input
                  v-model="rule.path"
                  type="text"
                  class="input-base font-mono"
                  :class="isPathInvalid(rule) ? 'border-rose-400 focus:border-rose-400' : ''"
                  :placeholder="t('tools.robotsGenerator.pathPlaceholder')"
                  autocomplete="off"
                  spellcheck="false"
                  @keydown.enter.prevent="addRule(group)"
                />
              </div>
              <button
                type="button"
                class="btn-ghost shrink-0"
                :aria-label="t('tools.robotsGenerator.deleteRule')"
                @click="removeRule(group, rule.id)"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <p v-if="isPathInvalid(rule)" class="w-full text-xs text-rose-500 -mt-1">
                {{ t('tools.robotsGenerator.pathInvalid') }}
              </p>
            </div>
            <button type="button" class="btn-ghost" @click="addRule(group)">
              + {{ t('tools.robotsGenerator.addRule') }}
            </button>
          </div>

          <!-- Crawl-delay -->
          <div class="mt-3 max-w-[220px]">
            <label class="label-base" :for="'delay-' + group.id">
              {{ t('tools.robotsGenerator.crawlDelayLabel') }}
            </label>
            <input
              :id="'delay-' + group.id"
              v-model="group.delay"
              type="text"
              inputmode="numeric"
              class="input-base"
              :class="isDelayInvalid(group) ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.robotsGenerator.crawlDelayPlaceholder')"
              autocomplete="off"
            />
            <p v-if="isDelayInvalid(group)" class="mt-1 text-xs text-rose-500">
              {{ t('tools.robotsGenerator.crawlDelayInvalid') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Sitemap 列表 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.robotsGenerator.sitemapsTitle') }}</h2>
        <span v-if="sitemaps.length" class="chip">
          {{ sitemaps.length }} {{ t('tools.robotsGenerator.sitemapsUnit') }}
        </span>
        <button type="button" class="btn-primary" @click="addSitemap">
          + {{ t('tools.robotsGenerator.addSitemap') }}
        </button>
      </div>

      <div v-if="sitemaps.length" class="space-y-2">
        <div v-for="(url, i) in sitemaps" :key="i" class="flex flex-wrap items-center gap-2">
          <div class="flex-1 min-w-[200px]">
            <input
              v-model="sitemaps[i]"
              type="url"
              class="input-base font-mono"
              :class="isSitemapInvalid(url) ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.robotsGenerator.sitemapPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <button
            type="button"
            class="btn-ghost shrink-0"
            :aria-label="t('tools.robotsGenerator.deleteSitemap')"
            @click="removeSitemap(i)"
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <p v-if="isSitemapInvalid(url)" class="w-full text-xs text-rose-500 -mt-1">
            {{ t('tools.robotsGenerator.sitemapInvalid') }}
          </p>
        </div>
      </div>
      <p v-else class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>
    </section>

    <!-- 实时预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.robotsGenerator.previewTitle') }}</h2>
        <CopyButton :text="generatedText" :label="t('toolsCommon.copy')" :disabled="!generatedText" />
        <button
          type="button"
          class="btn-primary"
          :disabled="!generatedText"
          @click="downloadRobots"
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
          {{ t('tools.robotsGenerator.downloadName') }}
        </button>
      </div>

      <pre
        v-if="generatedText"
        class="font-mono text-xs sm:text-sm leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[420px]"
        tabindex="0"
      >{{ generatedText }}</pre>
      <div
        v-else
        class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400"
      >
        {{ t('tools.robotsGenerator.emptyPreview') }}
      </div>
    </section>
  </ToolPage>
</template>
