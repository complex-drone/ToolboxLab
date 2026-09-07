<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * Nginx 配置生成器
 * - 场景 Tab：静态站点 / 反向代理 / 负载均衡 / URL 重定向
 * - SSL / gzip 开关；反代生成标准 5 个 proxy_set_header
 * - 实时生成完整配置，复制 + 下载 .conf；全部配置持久化
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 常量 ---------------- */

const SCENE_TABS = [
  { id: 'static', labelKey: 'tabStatic' },
  { id: 'proxy', labelKey: 'tabProxy' },
  { id: 'lb', labelKey: 'tabLb' },
  { id: 'redirect', labelKey: 'tabRedirect' },
]

const ALGORITHMS = [
  { id: 'round_robin', labelKey: 'algoRoundRobin' },
  { id: 'least_conn', labelKey: 'algoLeastConn' },
  { id: 'ip_hash', labelKey: 'algoIpHash' },
]

let uidSeed = 0
function nextId() {
  uidSeed += 1
  return 'n' + Date.now().toString(36) + '-' + uidSeed.toString(36)
}

function makeRedirect() {
  return { id: nextId(), from: '/old-path', to: '', code: '301' }
}

/* ---------------- 持久化 ---------------- */

const config = useStorage(
  'tool-nginx-config-generator',
  {
    activeTab: 'static',
    domains: 'example.com\nwww.example.com',
    listenPort: '80',
    gzip: true,
    sslEnabled: false,
    sslCert: '/etc/nginx/ssl/example.com.pem',
    sslKey: '/etc/nginx/ssl/example.com.key',
    root: '/var/www/html',
    indexFiles: 'index.html',
    spaFallback: false,
    proxyTarget: 'http://127.0.0.1:3000',
    proxyPath: '/',
    upstreamName: 'backend',
    upstreamServers: '127.0.0.1:3001\n127.0.0.1:3002',
    lbAlgorithm: 'round_robin',
    redirects: [{ id: nextId(), from: '/old-path', to: 'https://new.example.com/page', code: '301' }],
  },
  undefined,
  { mergeDefaults: true },
)

/* ---------------- 校验 ---------------- */

function isPortInvalid(v) {
  const s = String(v == null ? '' : v).trim()
  if (s === '') return true
  const n = Number(s)
  return !Number.isInteger(n) || n < 1 || n > 65535
}

function isTargetInvalid(v) {
  const s = String(v || '').trim()
  if (s === '') return false
  try {
    const u = new URL(s)
    return u.protocol !== 'http:' && u.protocol !== 'https:'
  } catch {
    return true
  }
}

const UPSTREAM_RE = /^[A-Za-z0-9_-]+$/

function serverNames() {
  return String(config.value.domains || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function assert(cond, key) {
  if (!cond) throw new Error('ngx:' + key)
}

/* ---------------- 生成 ---------------- */

function proxyHeaderLines(target) {
  return [
    '    location ' + normalizePath(config.value.proxyPath) + ' {',
    '        proxy_pass ' + target + ';',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_set_header X-Forwarded-Host $host;',
    '    }',
  ]
}

function normalizePath(p) {
  const s = String(p || '').trim()
  if (s === '') return '/'
  return s.startsWith('/') ? s : '/' + s
}

function gzipLines() {
  if (!config.value.gzip) return ['    gzip off;', '']
  return [
    '    gzip on;',
    '    gzip_min_length 1024;',
    '    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml;',
    '',
  ]
}

function upstreamBlock() {
  const f = config.value
  const name = String(f.upstreamName || '').trim()
  const servers = String(f.upstreamServers || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  assert(name !== '', 'upstreamNameRequired')
  assert(UPSTREAM_RE.test(name), 'upstreamNameInvalid')
  assert(servers.length > 0, 'serversRequired')

  const lines = ['upstream ' + name + ' {']
  if (f.lbAlgorithm === 'least_conn') lines.push('    least_conn;')
  else if (f.lbAlgorithm === 'ip_hash') lines.push('    ip_hash;')
  for (const s of servers) lines.push('    server ' + s + ';')
  lines.push('}')
  lines.push('')
  return lines
}

function staticBody() {
  const f = config.value
  assert(String(f.root || '').trim() !== '', 'rootRequired')
  const root = String(f.root).trim()
  const index = String(f.indexFiles || '').trim() || 'index.html'
  const lines = []
  lines.push('    location / {')
  lines.push('        root ' + root + ';')
  lines.push('        index ' + index + ';')
  lines.push(f.spaFallback ? '        try_files $uri $uri/ /index.html;' : '        try_files $uri $uri/ =404;')
  lines.push('    }')
  return lines
}

function proxyBody() {
  const f = config.value
  const target = String(f.proxyTarget || '').trim()
  assert(target !== '', 'targetInvalid')
  assert(!isTargetInvalid(target), 'targetInvalid')
  return proxyHeaderLines(target)
}

function lbBody() {
  const name = String(config.value.upstreamName || '').trim()
  return proxyHeaderLines('http://' + name)
}

function redirectBody() {
  const rules = (config.value.redirects || []).filter((r) => String(r.from || '').trim() !== '' && String(r.to || '').trim() !== '')
  assert(rules.length > 0, 'redirectRequired')
  const lines = []
  for (const r of rules) {
    const code = r.code === '302' ? '302' : '301'
    lines.push('    location ' + normalizePath(r.from) + ' {')
    lines.push('        return ' + code + ' ' + String(r.to).trim() + ';')
    lines.push('    }')
  }
  return lines
}

function generateConf() {
  const f = config.value
  const names = serverNames()
  assert(names.length > 0, 'domainsRequired')
  assert(!isPortInvalid(f.listenPort), 'portInvalid')
  if (f.sslEnabled) {
    assert(String(f.sslCert || '').trim() !== '' && String(f.sslKey || '').trim() !== '', 'sslCertRequired')
  }

  const out = []
  out.push('# ' + t('tools.nginxConfigGenerator.title') + ' - ToolboxLab')
  out.push('')

  if (f.activeTab === 'lb') out.push(...upstreamBlock())

  // 启用 SSL 时，额外输出 HTTP 跳转 HTTPS 的 server 块
  if (f.sslEnabled) {
    out.push('# HTTP -> HTTPS')
    out.push('server {')
    out.push('    listen ' + String(f.listenPort).trim() + ';')
    out.push('    server_name ' + names.join(' ') + ';')
    out.push('    return 301 https://$host$request_uri;')
    out.push('}')
    out.push('')
  }

  const body =
    f.activeTab === 'static' ? staticBody() : f.activeTab === 'proxy' ? proxyBody() : f.activeTab === 'lb' ? lbBody() : redirectBody()

  out.push('server {')
  if (f.sslEnabled) {
    out.push('    listen 443 ssl http2;')
  } else {
    out.push('    listen ' + String(f.listenPort).trim() + ';')
  }
  out.push('    server_name ' + names.join(' ') + ';')
  out.push('')
  if (f.sslEnabled) {
    out.push('    ssl_certificate ' + String(f.sslCert).trim() + ';')
    out.push('    ssl_certificate_key ' + String(f.sslKey).trim() + ';')
    out.push('')
    out.push('    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;')
    out.push('')
  }
  out.push(...gzipLines())
  out.push(...body)
  out.push('}')
  out.push('')
  return out.join('\n')
}

const preview = computed(() => {
  try {
    return { text: generateConf(), error: '' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.startsWith('ngx:')) {
      return { text: '', error: t('tools.nginxConfigGenerator.' + msg.slice(4)) }
    }
    return { text: '', error: t('toolsCommon.error') }
  }
})

/* ---------------- 行增删 ---------------- */

function addRedirect() {
  config.value.redirects = [...(config.value.redirects || []), makeRedirect()]
}

function removeRedirect(id) {
  config.value.redirects = (config.value.redirects || []).filter((r) => r.id !== id)
}

/* ---------------- 下载 ---------------- */

function downloadConf() {
  try {
    if (!preview.value.text) return
    const first = serverNames()[0] || 'nginx'
    const safe = first.toLowerCase().replace(/[^a-z0-9.-]/g, '-') || 'nginx'
    downloadText(preview.value.text, safe + '.conf', 'text/plain;charset=utf-8')
    toast.success(t('tools.nginxConfigGenerator.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="nginxConfigGenerator">
    <!-- 服务器基础 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.nginxConfigGenerator.tabsTitle') }}</h2>
      <div class="flex flex-wrap gap-2 mb-5" role="tablist" :aria-label="t('tools.nginxConfigGenerator.tabsTitle')">
        <button
          v-for="tab in SCENE_TABS"
          :key="tab.id"
          type="button"
          role="tab"
          class="px-3.5 py-1.5 rounded-xl text-sm font-medium border transition select-none"
          :class="
            config.activeTab === tab.id
              ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
              : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="config.activeTab === tab.id ? 'true' : 'false'"
          @click="config.activeTab = tab.id"
        >
          {{ t('tools.nginxConfigGenerator.' + tab.labelKey) }}
        </button>
      </div>

      <h3 class="text-sm font-semibold text-slate-600 mb-3">{{ t('tools.nginxConfigGenerator.basicTitle') }}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <div class="sm:col-span-2">
          <label class="label-base" for="ngx-domains">{{ t('tools.nginxConfigGenerator.domainsLabel') }}</label>
          <textarea
            id="ngx-domains"
            v-model="config.domains"
            rows="3"
            class="input-base font-mono"
            :placeholder="t('tools.nginxConfigGenerator.domainsPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <label class="label-base" for="ngx-port">{{ t('tools.nginxConfigGenerator.portLabel') }}</label>
          <input
            id="ngx-port"
            v-model="config.listenPort"
            type="text"
            inputmode="numeric"
            class="input-base font-mono"
            :class="isPortInvalid(config.listenPort) ? 'border-rose-400 focus:border-rose-400' : ''"
            placeholder="80"
            autocomplete="off"
          />
          <p v-if="isPortInvalid(config.listenPort)" class="mt-1 text-xs text-rose-500">
            {{ t('tools.nginxConfigGenerator.portInvalid') }}
          </p>
        </div>
        <div class="flex flex-col justify-end gap-2 pb-1">
          <label class="inline-flex items-center gap-2 cursor-pointer select-none">
            <input v-model="config.gzip" type="checkbox" class="h-4 w-4 accent-blue-600" />
            <span class="text-sm text-slate-600">{{ t('tools.nginxConfigGenerator.gzipLabel') }}</span>
          </label>
          <label class="inline-flex items-center gap-2 cursor-pointer select-none">
            <input v-model="config.sslEnabled" type="checkbox" class="h-4 w-4 accent-blue-600" />
            <span class="text-sm text-slate-600">{{ t('tools.nginxConfigGenerator.sslLabel') }}</span>
          </label>
        </div>
      </div>

      <!-- SSL 设置 -->
      <div v-if="config.sslEnabled" class="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-3 sm:p-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="ngx-cert">{{ t('tools.nginxConfigGenerator.sslCertLabel') }}</label>
            <input
              id="ngx-cert"
              v-model="config.sslCert"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.sslCertPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div>
            <label class="label-base" for="ngx-key">{{ t('tools.nginxConfigGenerator.sslKeyLabel') }}</label>
            <input
              id="ngx-key"
              v-model="config.sslKey"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.sslKeyPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400 leading-relaxed">{{ t('tools.nginxConfigGenerator.sslHint') }}</p>
      </div>
    </section>

    <!-- 场景设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 静态站点 -->
      <div v-if="config.activeTab === 'static'">
        <h3 class="section-title mb-3">{{ t('tools.nginxConfigGenerator.staticTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="ngx-root">{{ t('tools.nginxConfigGenerator.rootLabel') }}</label>
            <input
              id="ngx-root"
              v-model="config.root"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.rootPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div>
            <label class="label-base" for="ngx-index">{{ t('tools.nginxConfigGenerator.indexLabel') }}</label>
            <input
              id="ngx-index"
              v-model="config.indexFiles"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.indexPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>
        <label class="mt-3 inline-flex items-center gap-2 cursor-pointer select-none">
          <input v-model="config.spaFallback" type="checkbox" class="h-4 w-4 accent-blue-600" />
          <span class="text-sm text-slate-600">{{ t('tools.nginxConfigGenerator.spaLabel') }}</span>
        </label>
      </div>

      <!-- 反向代理 -->
      <div v-else-if="config.activeTab === 'proxy'">
        <h3 class="section-title mb-3">{{ t('tools.nginxConfigGenerator.proxyTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div class="sm:col-span-2">
            <label class="label-base" for="ngx-target">{{ t('tools.nginxConfigGenerator.targetLabel') }}</label>
            <input
              id="ngx-target"
              v-model="config.proxyTarget"
              type="text"
              class="input-base font-mono"
              :class="isTargetInvalid(config.proxyTarget) ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.nginxConfigGenerator.targetPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isTargetInvalid(config.proxyTarget)" class="mt-1 text-xs text-rose-500">
              {{ t('tools.nginxConfigGenerator.targetInvalid') }}
            </p>
          </div>
          <div>
            <label class="label-base" for="ngx-path">{{ t('tools.nginxConfigGenerator.pathLabel') }}</label>
            <input
              id="ngx-path"
              v-model="config.proxyPath"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.pathPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>
      </div>

      <!-- 负载均衡 -->
      <div v-else-if="config.activeTab === 'lb'">
        <h3 class="section-title mb-3">{{ t('tools.nginxConfigGenerator.lbTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="ngx-upstream">{{ t('tools.nginxConfigGenerator.upstreamNameLabel') }}</label>
            <input
              id="ngx-upstream"
              v-model="config.upstreamName"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.upstreamNamePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div>
            <label class="label-base" for="ngx-algo">{{ t('tools.nginxConfigGenerator.algorithmLabel') }}</label>
            <select id="ngx-algo" v-model="config.lbAlgorithm" class="input-base">
              <option v-for="algo in ALGORITHMS" :key="algo.id" :value="algo.id">
                {{ t('tools.nginxConfigGenerator.' + algo.labelKey) }}
              </option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="label-base" for="ngx-servers">{{ t('tools.nginxConfigGenerator.serversLabel') }}</label>
            <textarea
              id="ngx-servers"
              v-model="config.upstreamServers"
              rows="4"
              class="input-base font-mono"
              :placeholder="t('tools.nginxConfigGenerator.serversPlaceholder')"
              spellcheck="false"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- URL 重定向 -->
      <div v-else>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <h3 class="section-title flex-1 mb-0">{{ t('tools.nginxConfigGenerator.redirectTitle') }}</h3>
          <button type="button" class="btn-primary" @click="addRedirect">
            + {{ t('tools.nginxConfigGenerator.addRedirect') }}
          </button>
        </div>
        <div class="space-y-2">
          <div v-for="row in config.redirects" :key="row.id" class="flex flex-wrap items-center gap-2">
            <input
              v-model="row.from"
              type="text"
              class="input-base font-mono w-full sm:w-40 shrink-0"
              :placeholder="t('tools.nginxConfigGenerator.fromPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <input
              v-model="row.to"
              type="text"
              class="input-base font-mono w-full sm:flex-1 sm:min-w-[180px]"
              :placeholder="t('tools.nginxConfigGenerator.toPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <select v-model="row.code" class="input-base w-40 sm:w-48 shrink-0" :aria-label="t('tools.nginxConfigGenerator.codeLabel')">
              <option value="301">{{ t('tools.nginxConfigGenerator.redirect301') }}</option>
              <option value="302">{{ t('tools.nginxConfigGenerator.redirect302') }}</option>
            </select>
            <button
              type="button"
              class="btn-ghost shrink-0"
              :aria-label="t('tools.nginxConfigGenerator.deleteRow')"
              @click="removeRedirect(row.id)"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 实时预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.nginxConfigGenerator.previewTitle') }}</h2>
        <CopyButton :text="preview.text" :label="t('toolsCommon.copy')" :disabled="!preview.text" />
        <button type="button" class="btn-primary" :disabled="!preview.text" @click="downloadConf">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('tools.nginxConfigGenerator.downloadName') }}
        </button>
      </div>

      <pre
        v-if="preview.text"
        class="font-mono text-xs sm:text-sm leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[480px]"
        tabindex="0"
      >{{ preview.text }}</pre>
      <div
        v-else
        class="rounded-xl border border-dashed px-4 py-10 text-center text-sm"
        :class="preview.error ? 'border-amber-300 text-amber-600' : 'border-slate-300 text-slate-400'"
        role="alert"
      >
        {{ preview.error || t('tools.nginxConfigGenerator.emptyPreview') }}
      </div>
    </section>
  </ToolPage>
</template>
