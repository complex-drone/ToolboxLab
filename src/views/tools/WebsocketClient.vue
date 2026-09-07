<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * WebSocket 测试客户端：连接任意 ws/wss 服务，
 * 收发消息并保留日志（最多 200 条），支持应用层心跳 Ping、
 * JSON 消息美化与日志导出；卸载时关闭连接并清理定时器
 */

const EXAMPLE_URLS = ['wss://ws.postman-echo.com/raw', 'wss://echo.websocket.events']
const MAX_LOGS = 200
const NO_RESPONSE_MS = 30000
const PING_PAYLOAD = 'ping'
const PING_INTERVAL_MIN = 1
const PING_INTERVAL_MAX = 300

const { t } = useI18n()
const toast = useToast()

/** 持久化连接地址与心跳配置 */
const config = useStorage('tool-websocket-client-config', {
  url: EXAMPLE_URLS[0],
  pingEnabled: false,
  pingInterval: 10,
})
const url = ref(typeof config.value.url === 'string' && config.value.url ? config.value.url : EXAMPLE_URLS[0])
const pingEnabled = ref(config.value.pingEnabled === true)
const pingInterval = ref(
  Number.isFinite(Number(config.value.pingInterval))
    ? clampInterval(Number(config.value.pingInterval))
    : 10,
)
watch(url, value => {
  config.value.url = value
})
watch(pingEnabled, value => {
  config.value.pingEnabled = value
})
watch(pingInterval, value => {
  config.value.pingInterval = clampInterval(Number(value))
})

function clampInterval(value) {
  const num = Math.round(Number(value))
  if (!Number.isFinite(num)) return 10
  return Math.min(PING_INTERVAL_MAX, Math.max(PING_INTERVAL_MIN, num))
}

function onIntervalChange() {
  pingInterval.value = clampInterval(pingInterval.value)
}

/** 连接状态：connecting / open / closed / error */
const status = ref('closed')
const statusMeta = computed(() => {
  switch (status.value) {
    case 'connecting':
      return { key: 'connecting', cls: 'bg-amber-50 text-amber-700 border-amber-200', dotCls: 'bg-amber-500 animate-pulse' }
    case 'open':
      return { key: 'open', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotCls: 'bg-emerald-500' }
    case 'error':
      return { key: 'error', cls: 'bg-red-50 text-red-600 border-red-200', dotCls: 'bg-red-500' }
    default:
      return { key: 'closed', cls: 'bg-slate-100 text-slate-500 border-slate-200', dotCls: 'bg-slate-400' }
  }
})

const isConnected = computed(() => status.value === 'open')
const busy = computed(() => status.value === 'open' || status.value === 'connecting')

/** 消息草稿与日志 */
const draft = ref('')
const inlineError = ref('')
const logs = ref([])
let logSeq = 0

function addLog(dir, content, extra = {}) {
  const entry = { id: ++logSeq, dir, time: new Date(), content: String(content), isJson: false, isPing: false, expanded: false, ...extra }
  logs.value = [...logs.value.slice(-(MAX_LOGS - 1)), entry]
}

function fmtTime(value) {
  const d = value instanceof Date ? value : new Date(value)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return hh + ':' + mm + ':' + ss
}

function dirArrow(dir) {
  if (dir === 'in') return '↓'
  if (dir === 'out') return '↑'
  return '•'
}

function dirCls(dir) {
  if (dir === 'in') return 'text-blue-600'
  if (dir === 'out') return 'text-amber-600'
  return 'text-slate-400'
}

/** 自动滚动：用户向上滚动后暂停，回到底部恢复 */
const logBoxRef = ref(null)
const autoScroll = ref(true)

function onLogScroll() {
  const el = logBoxRef.value
  if (!el) return
  autoScroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
}

watch(
  () => logs.value.length,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    const el = logBoxRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

function scrollToBottom() {
  autoScroll.value = true
  nextTick(() => {
    const el = logBoxRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/** WebSocket 连接管理 */
let socket = null
let sock = null
let manualClose = false
let hadError = false

function validateWsUrl(raw) {
  const value = String(raw || '').trim()
  if (!value || /\s/.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
  } catch {
    return false
  }
}

function connect() {
  const target = url.value.trim()
  if (!validateWsUrl(target)) {
    inlineError.value = t('tools.websocketClient.errInvalidUrl')
    toast.error(t('tools.websocketClient.errInvalidUrl'))
    return
  }
  inlineError.value = ''
  silentClose()
  manualClose = false
  hadError = false
  status.value = 'connecting'
  addLog('sys', t('tools.websocketClient.logConnecting'))
  try {
    sock = new WebSocket(target)
    socket = sock
  } catch {
    status.value = 'error'
    hadError = true
    addLog('sys', t('tools.websocketClient.logError'))
    toast.error(t('tools.websocketClient.errConnectFailed'))
    return
  }
  /** 旧连接的事件回调直接忽略，避免重连时串扰 */
  const isCurrent = () => socket === sock
  sock.onopen = () => {
    if (!isCurrent()) return
    status.value = 'open'
    markActivity()
    resetSentAt()
    addLog('sys', t('tools.websocketClient.logOpened'))
    startHeartbeat()
  }
  sock.onmessage = event => {
    if (!isCurrent()) return
    markActivity()
    const raw = typeof event.data === 'string' ? event.data : String(event.data ?? '')
    const extra = {}
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') {
          extra.isJson = true
          extra.pretty = JSON.stringify(parsed, null, 2)
        }
      } catch {
        // 非 JSON 消息按原文展示
      }
    }
    addLog('in', raw, extra)
  }
  sock.onerror = () => {
    if (!isCurrent()) return
    hadError = true
    status.value = 'error'
    addLog('sys', t('tools.websocketClient.logError'))
    toast.error(t('tools.websocketClient.errConnectFailed'))
  }
  sock.onclose = () => {
    if (!isCurrent()) return
    stopHeartbeat()
    if (manualClose) {
      status.value = 'closed'
      return
    }
    if (hadError) {
      status.value = 'error'
    } else {
      status.value = 'closed'
      addLog('sys', t('tools.websocketClient.logClosed'))
    }
  }
}

function silentClose() {
  if (socket) {
    manualClose = true
    try {
      socket.close()
    } catch {
      // 忽略关闭异常
    }
    socket = null
  }
  stopHeartbeat()
}

function disconnect() {
  manualClose = true
  if (socket) {
    try {
      socket.close()
    } catch {
      // 忽略关闭异常
    }
    socket = null
  }
  stopHeartbeat()
  status.value = 'closed'
  addLog('sys', t('tools.websocketClient.logClosedByUser'))
}

function toggleConnection() {
  if (busy.value) disconnect()
  else connect()
}

/** 心跳：应用层 Ping 与 30 秒无响应检测 */
let heartbeatTimer = null
let lastActivityAt = 0
let lastSentAt = 0
const nowTick = ref(0)

function markActivity() {
  lastActivityAt = Date.now()
}

function resetSentAt() {
  lastSentAt = 0
}

function startHeartbeat() {
  stopHeartbeat()
  markActivity()
  resetSentAt()
  heartbeatTimer = setInterval(onHeartbeatTick, 1000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function onHeartbeatTick() {
  nowTick.value++
  if (!isConnected.value) return
  if (pingEnabled.value) {
    const intervalMs = pingInterval.value * 1000
    if (Date.now() - lastSentAt >= intervalMs) sendRaw(PING_PAYLOAD, true)
  }
}

const noResponse = computed(() => {
  nowTick.value
  return isConnected.value && lastActivityAt > 0 && Date.now() - lastActivityAt > NO_RESPONSE_MS
})

/** HTTPS 页面下连接 ws:// 会被浏览器混合内容策略拦截 */
const insecureWarning = computed(() => {
  const target = url.value.trim()
  return window.location.protocol === 'https:' && target.startsWith('ws://')
})

/** 发送消息 */
function sendRaw(text, isPing) {
  if (!socket || !isConnected.value) return false
  try {
    socket.send(text)
  } catch {
    toast.error(t('tools.websocketClient.errSendFailed'))
    return false
  }
  lastSentAt = Date.now()
  addLog('out', text, { isPing: isPing === true })
  return true
}

function sendDraft() {
  const text = draft.value
  if (!text) return
  if (!isConnected.value) {
    toast.error(t('tools.websocketClient.errNotConnected'))
    return
  }
  if (sendRaw(text, false)) draft.value = ''
}

/** 清空与导出 */
function clearLogs() {
  logs.value = []
  inlineError.value = ''
}

function exportLogs(format) {
  if (!logs.value.length) {
    toast.info(t('tools.websocketClient.errEmptyLog'))
    return
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  try {
    if (format === 'json') {
      const payload = logs.value.map(log => ({
        time: log.time.toISOString(),
        direction: log.dir,
        content: log.content,
      }))
      downloadText(JSON.stringify(payload, null, 2), 'websocket-log-' + stamp + '.json', 'application/json;charset=utf-8')
    } else {
      const lines = logs.value.map(log => {
        const mark = log.dir === 'in' ? 'RECV' : log.dir === 'out' ? 'SEND' : 'SYS '
        return '[' + fmtTime(log.time) + '] ' + mark + ' ' + log.content
      })
      downloadText(lines.join('\n'), 'websocket-log-' + stamp + '.txt')
    }
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  silentClose()
  socket = null
})
</script>

<template>
  <ToolPage tool-id="websocketClient">
    <!-- 连接控制 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h2 class="section-title !mb-0">{{ t('tools.websocketClient.connectionTitle') }}</h2>
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shrink-0"
          :class="statusMeta.cls"
        >
          <span class="w-2 h-2 rounded-full" :class="statusMeta.dotCls" aria-hidden="true"></span>
          {{ t('tools.websocketClient.status.' + statusMeta.key) }}
        </span>
      </div>
      <label class="label-base" for="ws-url-input">{{ t('tools.websocketClient.urlLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="ws-url-input"
          v-model="url"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.websocketClient.urlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="connect"
        />
        <button type="button" :class="busy ? 'btn-danger' : 'btn-primary'" class="shrink-0" @click="toggleConnection">
          {{ busy ? t('tools.websocketClient.disconnectBtn') : t('tools.websocketClient.connectBtn') }}
        </button>
      </div>
      <p v-if="inlineError" class="mt-2 text-sm text-red-600">{{ inlineError }}</p>
      <p v-if="insecureWarning" class="mt-2 text-sm text-amber-600">{{ t('tools.websocketClient.insecureWarning') }}</p>
      <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-slate-400">{{ t('tools.websocketClient.exampleLabel') }}</span>
        <button
          v-for="example in EXAMPLE_URLS"
          :key="example"
          type="button"
          class="chip font-mono cursor-pointer hover:bg-blue-100"
          @click="url = example"
        >
          {{ example }}
        </button>
      </div>

      <!-- 心跳设置 -->
      <div class="mt-3 pt-3 border-t border-slate-100">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input v-model="pingEnabled" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.websocketClient.pingToggle') }}
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-slate-600">
            <span>{{ t('tools.websocketClient.pingIntervalLabel') }}</span>
            <input
              v-model.number="pingInterval"
              type="number"
              min="1"
              max="300"
              class="input-base !w-20 text-center"
              @change="onIntervalChange"
            />
            <span>{{ t('toolsCommon.seconds') }}</span>
          </label>
        </div>
        <p v-if="noResponse" class="mt-2 text-sm text-amber-600 flex items-center gap-1.5">
          <span aria-hidden="true">⚠</span>
          <span>{{ t('tools.websocketClient.noResponseHint') }}</span>
        </p>
      </div>
    </section>

    <!-- 消息收发 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.websocketClient.messageTitle') }}</h2>
      <textarea
        v-model="draft"
        rows="3"
        class="input-base font-mono"
        :placeholder="t('tools.websocketClient.sendPlaceholder')"
        :disabled="!isConnected"
        @keydown.ctrl.enter.prevent="sendDraft"
        @keydown.meta.enter.prevent="sendDraft"
      ></textarea>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <span class="text-xs text-slate-400 mr-auto">{{ t('tools.websocketClient.sendHint') }}</span>
        <button type="button" class="btn-primary" :disabled="!isConnected || !draft" @click="sendDraft">
          {{ t('tools.websocketClient.sendBtn') }}
        </button>
      </div>

      <!-- 消息日志 -->
      <div class="mt-5">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 class="text-sm font-medium text-slate-600">
            {{ t('tools.websocketClient.logTitle') }} ({{ logs.length }} / {{ MAX_LOGS }})
          </h3>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-ghost" :disabled="!logs.length" @click="exportLogs('json')">
              {{ t('tools.websocketClient.exportJson') }}
            </button>
            <button type="button" class="btn-ghost" :disabled="!logs.length" @click="exportLogs('text')">
              {{ t('tools.websocketClient.exportText') }}
            </button>
            <button type="button" class="btn-danger" :disabled="!logs.length" @click="clearLogs">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>
        <div
          ref="logBoxRef"
          class="h-80 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2"
          @scroll="onLogScroll"
        >
          <p v-if="!logs.length" class="h-full flex items-center justify-center text-sm text-slate-400">
            {{ t('tools.websocketClient.emptyLog') }}
          </p>
          <div v-for="log in logs" :key="log.id" class="flex items-start gap-2">
            <span class="text-[11px] text-slate-400 font-mono shrink-0 pt-0.5">{{ fmtTime(log.time) }}</span>
            <span class="shrink-0 font-bold pt-0.5 text-sm" :class="dirCls(log.dir)" aria-hidden="true">
              {{ dirArrow(log.dir) }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <span v-if="log.isJson" class="chip !px-1.5 !py-0 text-[10px] bg-sky-50 !text-sky-700 border-sky-100">
                  {{ t('tools.websocketClient.jsonChip') }}
                </span>
                <span v-if="log.isPing" class="chip !px-1.5 !py-0 text-[10px] bg-violet-50 !text-violet-700 border-violet-100">
                  {{ t('tools.websocketClient.pingChip') }}
                </span>
                <span class="text-xs font-mono text-slate-700 break-all whitespace-pre-wrap">{{ log.content }}</span>
              </div>
              <pre
                v-if="log.isJson && log.expanded"
                class="mt-1.5 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed font-mono text-slate-700 whitespace-pre-wrap break-all max-h-64 overflow-auto"
              >{{ log.pretty }}</pre>
              <button
                v-if="log.isJson"
                type="button"
                class="mt-1 text-[11px] text-blue-600 hover:underline"
                @click="log.expanded = !log.expanded"
              >
                {{ log.expanded ? t('tools.websocketClient.collapseJson') : t('tools.websocketClient.expandJson') }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="!autoScroll && logs.length" class="mt-2 flex items-center justify-between gap-2">
          <span class="text-xs text-slate-400">{{ t('tools.websocketClient.autoScrollPaused') }}</span>
          <button type="button" class="btn-ghost" @click="scrollToBottom">
            {{ t('tools.websocketClient.backToBottom') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 心跳实现说明 -->
    <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5" role="note">
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.websocketClient.pingNote') }}</p>
    </div>
  </ToolPage>
</template>
