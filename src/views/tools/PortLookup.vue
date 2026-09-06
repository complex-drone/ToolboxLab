<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 端口参考：内置常用 TCP/UDP 端口数据集，
 * 支持按端口号 / 服务名实时搜索与分类筛选，纯静态数据无需联网
 */

/** 常用端口数据集（service 为语言包键名，category 对应分类筛选） */
const PORTS = [
  { port: 20, protocol: 'TCP', service: 'ftpData', category: 'file' },
  { port: 21, protocol: 'TCP', service: 'ftp', category: 'file' },
  { port: 22, protocol: 'TCP', service: 'ssh', category: 'remote' },
  { port: 23, protocol: 'TCP', service: 'telnet', category: 'remote' },
  { port: 25, protocol: 'TCP', service: 'smtp', category: 'email' },
  { port: 53, protocol: 'TCP/UDP', service: 'dns', category: 'other' },
  { port: 67, protocol: 'UDP', service: 'dhcpServer', category: 'other' },
  { port: 68, protocol: 'UDP', service: 'dhcpClient', category: 'other' },
  { port: 69, protocol: 'UDP', service: 'tftp', category: 'file' },
  { port: 80, protocol: 'TCP', service: 'http', category: 'web' },
  { port: 88, protocol: 'TCP/UDP', service: 'kerberos', category: 'other' },
  { port: 110, protocol: 'TCP', service: 'pop3', category: 'email' },
  { port: 113, protocol: 'TCP', service: 'ident', category: 'other' },
  { port: 123, protocol: 'UDP', service: 'ntp', category: 'other' },
  { port: 135, protocol: 'TCP', service: 'rpc', category: 'other' },
  { port: 137, protocol: 'TCP/UDP', service: 'netbiosNs', category: 'file' },
  { port: 138, protocol: 'TCP/UDP', service: 'netbiosDgm', category: 'file' },
  { port: 139, protocol: 'TCP', service: 'netbiosSsn', category: 'file' },
  { port: 143, protocol: 'TCP', service: 'imap', category: 'email' },
  { port: 161, protocol: 'TCP/UDP', service: 'snmp', category: 'other' },
  { port: 162, protocol: 'TCP/UDP', service: 'snmpTrap', category: 'other' },
  { port: 179, protocol: 'TCP', service: 'bgp', category: 'other' },
  { port: 389, protocol: 'TCP/UDP', service: 'ldap', category: 'other' },
  { port: 443, protocol: 'TCP', service: 'https', category: 'web' },
  { port: 445, protocol: 'TCP', service: 'smb', category: 'file' },
  { port: 465, protocol: 'TCP', service: 'smtps', category: 'email' },
  { port: 514, protocol: 'TCP/UDP', service: 'syslog', category: 'other' },
  { port: 587, protocol: 'TCP', service: 'submission', category: 'email' },
  { port: 636, protocol: 'TCP', service: 'ldaps', category: 'other' },
  { port: 873, protocol: 'TCP', service: 'rsync', category: 'file' },
  { port: 990, protocol: 'TCP', service: 'ftps', category: 'file' },
  { port: 993, protocol: 'TCP', service: 'imaps', category: 'email' },
  { port: 995, protocol: 'TCP', service: 'pop3s', category: 'email' },
  { port: 1080, protocol: 'TCP', service: 'socks', category: 'other' },
  { port: 1194, protocol: 'TCP/UDP', service: 'openvpn', category: 'remote' },
  { port: 1433, protocol: 'TCP', service: 'mssql', category: 'database' },
  { port: 1521, protocol: 'TCP', service: 'oracle', category: 'database' },
  { port: 1723, protocol: 'TCP', service: 'pptp', category: 'remote' },
  { port: 1883, protocol: 'TCP', service: 'mqtt', category: 'other' },
  { port: 2049, protocol: 'TCP/UDP', service: 'nfs', category: 'file' },
  { port: 2181, protocol: 'TCP', service: 'zookeeper', category: 'other' },
  { port: 2375, protocol: 'TCP', service: 'docker', category: 'other' },
  { port: 2376, protocol: 'TCP', service: 'dockerTls', category: 'other' },
  { port: 3128, protocol: 'TCP', service: 'squid', category: 'web' },
  { port: 3306, protocol: 'TCP', service: 'mysql', category: 'database' },
  { port: 3389, protocol: 'TCP/UDP', service: 'rdp', category: 'remote' },
  { port: 5060, protocol: 'TCP/UDP', service: 'sip', category: 'other' },
  { port: 5432, protocol: 'TCP', service: 'postgresql', category: 'database' },
  { port: 5672, protocol: 'TCP', service: 'amqp', category: 'other' },
  { port: 5900, protocol: 'TCP', service: 'vnc', category: 'remote' },
  { port: 6379, protocol: 'TCP', service: 'redis', category: 'database' },
  { port: 8080, protocol: 'TCP', service: 'httpAlt', category: 'web' },
  { port: 8443, protocol: 'TCP', service: 'httpsAlt', category: 'web' },
  { port: 9092, protocol: 'TCP', service: 'kafka', category: 'other' },
  { port: 9200, protocol: 'TCP', service: 'elasticsearch', category: 'database' },
  { port: 11211, protocol: 'TCP/UDP', service: 'memcached', category: 'database' },
  { port: 27017, protocol: 'TCP', service: 'mongodb', category: 'database' },
  { port: 25565, protocol: 'TCP', service: 'minecraft', category: 'other' },
]

/** 分类筛选 Tab（all 与 categories.* 语言包键一一对应） */
const CATEGORIES = ['all', 'web', 'email', 'database', 'remote', 'file', 'other']

const { t } = useI18n()

const keyword = ref('')
const activeCategory = ref('all')

/** 读取某条端口数据的语言包文案（name / desc） */
function serviceText(entry, kind) {
  return t('tools.portLookup.services.' + entry.service + '.' + kind)
}

/** 实时过滤：分类 + 关键词（端口号 / 服务键 / 本地化名称与描述） */
const filteredPorts = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return PORTS.filter(entry => activeCategory.value === 'all' || entry.category === activeCategory.value)
    .filter(entry => {
      if (!q) return true
      return (
        String(entry.port).includes(q) ||
        entry.service.toLowerCase().includes(q) ||
        serviceText(entry, 'name').toLowerCase().includes(q) ||
        serviceText(entry, 'desc').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => a.port - b.port)
})

const resultCount = computed(() => filteredPorts.value.length)

function categoryLabel(category) {
  return t('tools.portLookup.categories.' + category)
}

/** 协议徽章配色：区分 TCP / UDP / 双协议 */
function protocolClass(protocol) {
  if (protocol === 'TCP') return 'bg-emerald-50 text-emerald-600 border-emerald-100'
  if (protocol === 'UDP') return 'bg-amber-50 text-amber-600 border-amber-100'
  return 'bg-slate-100 text-slate-500 border-slate-200'
}
</script>

<template>
  <ToolPage tool-id="portLookup">
    <!-- 搜索与分类筛选 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="relative">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="keyword"
          type="text"
          class="input-base pl-9"
          :placeholder="t('tools.portLookup.searchPlaceholder')"
          :aria-label="t('tools.portLookup.searchPlaceholder')"
          spellcheck="false"
          autocomplete="off"
        />
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="cat in CATEGORIES"
          :key="cat"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-medium transition select-none"
          :class="
            activeCategory === cat
              ? 'bg-blue-600 text-white font-semibold shadow-sm'
              : 'text-slate-600 bg-white/70 border border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          @click="activeCategory = cat"
        >
          {{ categoryLabel(cat) }}
        </button>
      </div>
    </section>

    <!-- 端口列表 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-1">
        <h2 class="section-title !mb-0">{{ t('tools.portLookup.listTitle') }}</h2>
        <span class="chip shrink-0">{{ t('tools.portLookup.resultCount', { n: resultCount }) }}</span>
      </div>

      <ul v-if="resultCount" class="divide-y divide-slate-100">
        <li
          v-for="entry in filteredPorts"
          :key="entry.port + '-' + entry.service"
          class="py-3 flex items-start gap-3"
        >
          <!-- 端口徽章（等宽字体） -->
          <span
            class="shrink-0 min-w-[3.5rem] text-center px-2 py-1 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 font-mono text-sm font-semibold"
          >
            {{ entry.port }}
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-700">{{ serviceText(entry, 'name') }}</p>
            <p class="mt-0.5 text-xs text-slate-500 leading-relaxed">{{ serviceText(entry, 'desc') }}</p>
          </div>
          <div class="shrink-0 flex flex-col items-end gap-1.5 sm:flex-row sm:items-center">
            <span
              class="px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap"
              :class="protocolClass(entry.protocol)"
            >
              {{ entry.protocol }}
            </span>
            <span class="chip">{{ categoryLabel(entry.category) }}</span>
          </div>
        </li>
      </ul>

      <!-- 空状态 -->
      <div v-else class="py-10 text-center">
        <svg
          class="w-10 h-10 mx-auto text-slate-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8.5" y1="11" x2="13.5" y2="11" />
        </svg>
        <p class="mt-3 text-sm text-slate-400">{{ t('tools.portLookup.emptyResult') }}</p>
      </div>
    </section>

    <!-- 数据来源说明 -->
    <div
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5"
      role="note"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.portLookup.note') }}</p>
    </div>
  </ToolPage>
</template>
