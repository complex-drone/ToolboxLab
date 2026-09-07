<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 设备信息查看器：页面加载即自动收集系统、硬件、屏幕、电池、网络、GPU 等信息
 * 电池电量与网络类型会持续监听变化，卸载时移除全部监听
 */

const { t } = useI18n()

/** 分组与检测项定义（key 与语言包 items.* 对应） */
const GROUP_DEFS = [
  { key: 'os', items: ['os', 'browser'] },
  { key: 'hardware', items: ['cpuCores', 'deviceMemory', 'maxTouchPoints'] },
  { key: 'screen', items: ['resolution', 'availArea', 'pixelRatio', 'colorDepth', 'orientation'] },
  { key: 'battery', items: ['batteryLevel', 'charging'] },
  { key: 'network', items: ['effectiveType', 'downlink', 'rtt', 'saveData'] },
  { key: 'gpu', items: ['gpuVendor', 'gpuRenderer'] },
  { key: 'system', items: ['language', 'platform'] },
]

const collecting = ref(false)

function buildGroups() {
  return GROUP_DEFS.map(g => ({
    key: g.key,
    items: g.items.map(key => ({ key, supported: false, value: '', display: '' })),
  }))
}

const groups = ref(buildGroups())

function findItem(groupKey, itemKey) {
  const g = groups.value.find(x => x.key === groupKey)
  return g ? g.items.find(x => x.key === itemKey) : null
}

/** 写入单项结果：value 为空/null 时标记为不支持 */
function setItem(groupKey, itemKey, value, display) {
  const it = findItem(groupKey, itemKey)
  if (!it) return
  const ok = value !== null && value !== undefined && value !== ''
  it.supported = ok
  it.value = ok ? String(value) : ''
  it.display = ok ? String(display !== undefined ? display : value) : ''
}

const allItems = computed(() => groups.value.reduce((acc, g) => acc.concat(g.items), []))
const supportedCount = computed(() => allItems.value.filter(i => i.supported).length)
const totalCount = computed(() => allItems.value.length)

/* ---------- 简化 UA 解析（组件内自实现） ---------- */

function detectOS(ua) {
  let m = ua.match(/Windows NT ([\d.]+)/)
  if (m) {
    const ntMap = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }
    return { name: 'Windows', version: ntMap[m[1]] || m[1] }
  }
  m = ua.match(/Android[\s/]([\d.]+)/)
  if (m) return { name: 'Android', version: m[1] }
  m = ua.match(/(?:iPhone|iPod).+?OS ([\d_]+)/) || ua.match(/CPU OS ([\d_]+)/)
  if (m) return { name: 'iOS', version: m[1].replace(/_/g, '.') }
  m = ua.match(/Mac OS X ([\d_.]+)/)
  if (m) {
    // macOS 且多点触控：多为 iPadOS 桌面模式
    if ((navigator.maxTouchPoints || 0) > 1) return { name: 'iPadOS', version: m[1].replace(/_/g, '.') }
    return { name: 'macOS', version: m[1].replace(/_/g, '.') }
  }
  if (/CrOS/.test(ua)) return { name: 'ChromeOS', version: '' }
  if (/Linux/.test(ua)) return { name: 'Linux', version: '' }
  return null
}

function detectBrowser(ua) {
  let m = ua.match(/Edg(?:e|A|iOS)\/([\d.]+)/)
  if (m) return { name: 'Edge', version: m[1] }
  m = ua.match(/Chrome\/([\d.]+)/)
  if (m) return { name: 'Chrome', version: m[1] }
  m = ua.match(/Firefox\/([\d.]+)/)
  if (m) return { name: 'Firefox', version: m[1] }
  m = ua.match(/Version\/([\d.]+)[\s\S]*Safari/)
  if (m) return { name: 'Safari', version: m[1] }
  return null
}

/* ---------- 屏幕相关 ---------- */

function updateScreen() {
  const s = window.screen
  setItem('screen', 'resolution', s ? s.width + ' x ' + s.height : null)
  setItem('screen', 'availArea', s ? s.availWidth + ' x ' + s.availHeight : null)
  setItem('screen', 'pixelRatio', window.devicePixelRatio || 1)
  setItem('screen', 'colorDepth', s ? s.colorDepth + ' bit' : null)
  const landscape = window.innerWidth >= window.innerHeight
  setItem(
    'screen',
    'orientation',
    landscape ? 'landscape' : 'portrait',
    t(landscape ? 'tools.deviceInfo.orientationLandscape' : 'tools.deviceInfo.orientationPortrait'),
  )
}

/* ---------- 电池 ---------- */

let battery = null

function updateBattery() {
  if (!battery) return
  setItem('battery', 'batteryLevel', Math.round((battery.level || 0) * 100) + ' %')
  setItem(
    'battery',
    'charging',
    battery.charging ? 'charging' : 'discharging',
    t(battery.charging ? 'tools.deviceInfo.chargingYes' : 'tools.deviceInfo.chargingNo'),
  )
}

async function collectBattery() {
  if (typeof navigator.getBattery !== 'function') return
  try {
    battery = await navigator.getBattery()
    updateBattery()
    battery.addEventListener('levelchange', updateBattery)
    battery.addEventListener('chargingchange', updateBattery)
  } catch {
    battery = null
  }
}

function removeBatteryListeners() {
  if (!battery) return
  battery.removeEventListener('levelchange', updateBattery)
  battery.removeEventListener('chargingchange', updateBattery)
  battery = null
}

/* ---------- 网络 ---------- */

function getConnection() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
}

function collectNetwork() {
  const c = getConnection()
  if (!c) return
  setItem('network', 'effectiveType', c.effectiveType || null)
  setItem('network', 'downlink', Number.isFinite(c.downlink) ? c.downlink + ' Mbps' : null)
  setItem('network', 'rtt', Number.isFinite(c.rtt) ? c.rtt + ' ms' : null)
  setItem(
    'network',
    'saveData',
    typeof c.saveData === 'boolean' ? c.saveData : null,
    typeof c.saveData === 'boolean' ? t(c.saveData ? 'toolsCommon.yes' : 'toolsCommon.no') : '',
  )
}

function onNetworkChange() {
  collectNetwork()
}

/* ---------- GPU ---------- */

function collectGpu() {
  let vendor = null
  let renderer = null
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      vendor = vendor ? String(vendor) : null
      renderer = renderer ? String(renderer) : null
    }
  } catch {
    vendor = null
    renderer = null
  }
  setItem('gpu', 'gpuVendor', vendor, vendor || t('tools.deviceInfo.unsupported'))
  setItem('gpu', 'gpuRenderer', renderer, renderer || t('tools.deviceInfo.unsupported'))
}

/* ---------- 系统语言与平台 ---------- */

function collectSystem() {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages.join(', ')
    : navigator.language || ''
  setItem('system', 'language', langs || null)
  const uaData = navigator.userAgentData
  const platform = navigator.platform || (uaData && uaData.platform) || ''
  setItem('system', 'platform', platform || null)
}

/* ---------- 汇总收集 ---------- */

function collectAll() {
  const ua = navigator.userAgent || ''
  const os = detectOS(ua)
  setItem('os', 'os', os ? os.name + (os.version ? ' ' + os.version : '') : null)
  const browser = detectBrowser(ua)
  setItem('os', 'browser', browser ? browser.name + ' ' + browser.version : null)

  const cores = navigator.hardwareConcurrency
  setItem('hardware', 'cpuCores', Number.isFinite(cores) && cores > 0 ? cores : null)
  const mem = navigator.deviceMemory
  setItem('hardware', 'deviceMemory', Number.isFinite(mem) && mem > 0 ? mem + ' GB' : null)
  const touch = navigator.maxTouchPoints
  setItem('hardware', 'maxTouchPoints', Number.isFinite(touch) ? touch : null)

  updateScreen()
  collectNetwork()
  collectGpu()
  collectSystem()
}

/* ---------- 复制全部（分组多行文本） ---------- */

const allText = computed(() => {
  const lines = []
  groups.value.forEach(g => {
    lines.push('[' + t('tools.deviceInfo.groups.' + g.key) + ']')
    g.items.forEach(it => {
      lines.push(t('tools.deviceInfo.items.' + it.key) + ': ' + (it.supported ? it.value : t('tools.deviceInfo.unsupported')))
    })
  })
  return lines.join('\n')
})

const refreshLabel = computed(() => (collecting.value ? t('tools.deviceInfo.collecting') : t('tools.deviceInfo.refreshBtn')))

function refresh() {
  if (collecting.value) return
  collecting.value = true
  groups.value = buildGroups()
  collectAll()
  collectNetwork()
  collecting.value = false
}

/* ---------- 生命周期与监听 ---------- */

function onResize() {
  updateScreen()
}

onMounted(() => {
  collecting.value = true
  collectAll()
  collectBattery()
  collecting.value = false
  window.addEventListener('resize', onResize)
  const conn = getConnection()
  if (conn && typeof conn.addEventListener === 'function') {
    conn.addEventListener('change', onNetworkChange)
  }
})

onBeforeUnmount(() => {
  removeBatteryListeners()
  window.removeEventListener('resize', onResize)
  const conn = getConnection()
  if (conn && typeof conn.removeEventListener === 'function') {
    conn.removeEventListener('change', onNetworkChange)
  }
})
</script>

<template>
  <ToolPage tool-id="deviceInfo">
    <!-- 顶部操作区：支持率 + 重新收集 + 复制全部 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        <div class="flex flex-wrap items-center gap-2 flex-1">
          <span class="chip">{{ t('tools.deviceInfo.supportLabel') }}：{{ supportedCount }} / {{ totalCount }}</span>
          <span v-if="collecting" class="text-sm text-slate-500">{{ t('tools.deviceInfo.collecting') }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" class="btn-ghost" :disabled="collecting" @click="refresh">
            {{ refreshLabel }}
          </button>
          <CopyButton :text="allText" :label="t('toolsCommon.copyAll')" />
        </div>
      </div>
    </section>

    <!-- 分组信息卡片 -->
    <section
      v-for="group in groups"
      :key="group.key"
      class="glass-card p-4 sm:p-6 mb-4"
    >
      <h2 class="section-title">{{ t('tools.deviceInfo.groups.' + group.key) }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div
          v-for="item in group.items"
          :key="item.key"
          class="rounded-xl border border-slate-200 bg-white/70 p-3 flex items-start justify-between gap-2"
        >
          <div class="min-w-0 flex-1">
            <p class="text-xs text-slate-400 mb-1">{{ t('tools.deviceInfo.items.' + item.key) }}</p>
            <p
              v-if="item.supported"
              class="text-sm font-mono text-slate-700 break-all leading-relaxed"
            >
              {{ item.display }}
            </p>
            <p v-else class="text-sm text-slate-400 leading-relaxed">
              {{ t('tools.deviceInfo.unsupported') }}
            </p>
          </div>
          <CopyButton v-if="item.supported" compact :text="item.value" class="mt-1" />
        </div>
      </div>
    </section>

    <!-- 说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.deviceInfo.localNote') }}</p>
    </div>
  </ToolPage>
</template>
