<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * User-Agent 解析：自写正则解析浏览器 / 操作系统 / 设备类型 / 渲染引擎，
 * 输入防抖 300ms 实时解析；图标映射与示例 UA 为组件常量
 */

/** 浏览器图标映射（专有名词为数据，不放语言包） */
const BROWSER_EMOJI = {
  chrome: '🌐',
  edge: '🌊',
  firefox: '🦊',
  safari: '🧭',
  opera: '🅾️',
  ie: 'ℹ️',
}

/** 操作系统图标映射 */
const OS_EMOJI = {
  windows: '🪟',
  macos: '🍎',
  ios: '📱',
  ipados: '📱',
  android: '🤖',
  linux: '🐧',
}

/** 设备类型图标映射 */
const DEVICE_EMOJI = {
  mobile: '📱',
  tablet: '📲',
  desktop: '🖥️',
}

/** 渲染引擎图标映射 */
const ENGINE_EMOJI = {
  blink: '⚡',
  webkit: '🌀',
  gecko: '🦎',
  trident: '🔱',
  edgehtml: '🌊',
}

/** 常见 UA 快捷示例（纯数据） */
const UA_EXAMPLES = [
  {
    key: 'exIphoneSafari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  {
    key: 'exAndroidChrome',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  },
  {
    key: 'exWindowsChrome',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  },
  {
    key: 'exMacSafari',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  },
  {
    key: 'exWindowsEdge',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  },
]

/** Windows NT 内核版本 → 发行版名称（NT 10.0 同时覆盖 Win10 / Win11） */
const WINDOWS_NT_NAMES = {
  '10.0': 'Windows 10/11',
  '6.3': 'Windows 8.1',
  '6.2': 'Windows 8',
  '6.1': 'Windows 7',
  '6.0': 'Windows Vista',
  '5.1': 'Windows XP',
}

const { t } = useI18n()

/** 持久化输入，首次访问默认为本机 UA */
const config = useStorage('tool-ua-parser-config', { ua: '' })
const initialUA =
  typeof config.value.ua === 'string' && config.value.ua
    ? config.value.ua
    : navigator.userAgent
const input = ref(initialUA)

/**
 * 浏览器识别：顺序即优先级——
 * Edg 需先于 Chrome（Edge UA 内含 Chrome 串），
 * Chrome / CriOS 需先于 Safari（Safari UA 内含 Chrome 或 WebKit 串）
 */
function detectBrowser(ua) {
  let m
  if ((m = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/))) {
    return { id: 'edge', name: 'Microsoft Edge', version: m[1] }
  }
  if ((m = ua.match(/(?:OPR|Opera)[ /]([\d.]+)/))) {
    return { id: 'opera', name: 'Opera', version: m[1] }
  }
  if ((m = ua.match(/FxiOS\/([\d.]+)/)) || (m = ua.match(/Firefox\/([\d.]+)/))) {
    return { id: 'firefox', name: 'Firefox', version: m[1] }
  }
  if ((m = ua.match(/(?:Chrome|CriOS|Chromium)\/([\d.]+)/))) {
    return { id: 'chrome', name: 'Chrome', version: m[1] }
  }
  if ((m = ua.match(/Version\/([\d.]+)[^)]*Safari/)) || (m = ua.match(/Safari\/([\d.]+)/))) {
    return { id: 'safari', name: 'Safari', version: m[1] }
  }
  if ((m = ua.match(/MSIE ([\d.]+)/))) {
    return { id: 'ie', name: 'Internet Explorer', version: m[1] }
  }
  if (/Trident/.test(ua) && (m = ua.match(/rv:([\d.]+)/))) {
    return { id: 'ie', name: 'Internet Explorer', version: m[1] }
  }
  return { id: '', name: '', version: '' }
}

/** 操作系统识别：iOS / iPadOS / Android 需先于 macOS 与 Linux 判断 */
function detectOs(ua) {
  let m
  if ((m = ua.match(/Windows NT ([\d.]+)/))) {
    return {
      id: 'windows',
      name: WINDOWS_NT_NAMES[m[1]] || 'Windows',
      version: 'NT ' + m[1],
    }
  }
  if (/Windows Phone/.test(ua)) {
    m = ua.match(/Windows Phone ([\d.]+)/)
    return { id: 'windows', name: 'Windows Phone', version: m ? m[1] : '' }
  }
  if (/iPhone|iPod/.test(ua)) {
    m = ua.match(/OS ([\d_]+)/)
    return { id: 'ios', name: 'iOS', version: m ? m[1].replace(/_/g, '.') : '' }
  }
  if (/iPad/.test(ua)) {
    m = ua.match(/CPU OS ([\d_]+)/)
    return {
      id: 'ipados',
      name: 'iPadOS',
      version: m ? m[1].replace(/_/g, '.') : '',
    }
  }
  if ((m = ua.match(/Android[\s/]([\d.]+)/))) {
    return { id: 'android', name: 'Android', version: m[1] }
  }
  if ((m = ua.match(/Mac OS X ([\d_.]+)/))) {
    return { id: 'macos', name: 'macOS', version: m[1].replace(/_/g, '.') }
  }
  if (/Macintosh|Mac OS/.test(ua)) {
    return { id: 'macos', name: 'macOS', version: '' }
  }
  if (/Linux/.test(ua)) {
    return { id: 'linux', name: 'Linux', version: '' }
  }
  return { id: '', name: '', version: '' }
}

/** 设备类型：平板关键词与 Android 无 Mobile 标记判平板，Mobi / iPhone 判手机 */
function detectDevice(ua, osId) {
  if (/iPad|Tablet|PlayBook|Silk/.test(ua) || (osId === 'android' && !/Mobile/.test(ua))) {
    return 'tablet'
  }
  if (/Mobi|iPhone|iPod|Windows Phone/.test(ua)) {
    return 'mobile'
  }
  if (osId) {
    return 'desktop'
  }
  return ''
}

/** 渲染引擎识别：新版 Edge / Chrome / Opera 为 Blink，Firefox 为 Gecko，Safari 为 WebKit */
function detectEngine(ua, browserId) {
  let m
  if (browserId === 'ie') {
    m = ua.match(/Trident\/([\d.]+)/)
    return { id: 'trident', name: 'Trident', version: m ? m[1] : '' }
  }
  // 旧版 Edge 使用 EdgeHTML（UA 特征为 Edge/ 且不含 Edg/）
  if (/Edge\/([\d.]+)/.test(ua) && !/Edg\//.test(ua)) {
    m = ua.match(/Edge\/([\d.]+)/)
    return { id: 'edgehtml', name: 'EdgeHTML', version: m ? m[1] : '' }
  }
  if (browserId === 'firefox') {
    m = ua.match(/rv:([\d.]+)/)
    return { id: 'gecko', name: 'Gecko', version: m ? m[1] : '' }
  }
  if (browserId === 'chrome' || browserId === 'edge' || browserId === 'opera') {
    m = ua.match(/AppleWebKit\/([\d.]+)/)
    return { id: 'blink', name: 'Blink', version: m ? m[1] : '' }
  }
  if (browserId === 'safari') {
    m = ua.match(/AppleWebKit\/([\d.]+)/)
    return { id: 'webkit', name: 'WebKit', version: m ? m[1] : '' }
  }
  if ((m = ua.match(/AppleWebKit\/([\d.]+)/))) {
    return { id: 'webkit', name: 'WebKit', version: m[1] }
  }
  if ((m = ua.match(/Gecko\/([\d.]+)/))) {
    return { id: 'gecko', name: 'Gecko', version: m[1] }
  }
  return { id: '', name: '', version: '' }
}

/** 解析入口：空输入返回 null，异常时静默返回 null 不崩溃 */
function parseUA(raw) {
  const ua = raw.trim()
  if (!ua) return null
  try {
    const browser = detectBrowser(ua)
    const os = detectOs(ua)
    const device = detectDevice(ua, os.id)
    const engine = detectEngine(ua, browser.id)
    return { browser, os, device, engine }
  } catch {
    return null
  }
}

const parsed = ref(parseUA(input.value))

// 300ms 防抖实时解析
const debouncedParse = useDebounceFn(() => {
  parsed.value = parseUA(input.value)
}, 300)

watch(input, value => {
  config.value.ua = value
  debouncedParse()
})

function useMyUA() {
  input.value = navigator.userAgent
  parsed.value = parseUA(input.value)
}

function clearInput() {
  input.value = ''
  config.value.ua = ''
  parsed.value = null
}

function loadExample(ua) {
  input.value = ua
  config.value.ua = ua
  parsed.value = parseUA(ua)
}

/** 结果卡片数据 */
const tiles = computed(() => {
  const p = parsed.value
  if (!p) return []
  const deviceKey = p.device
    ? 'device' + p.device.charAt(0).toUpperCase() + p.device.slice(1)
    : ''
  return [
    {
      key: 'browser',
      emoji: p.browser.id ? BROWSER_EMOJI[p.browser.id] || '🌐' : '❓',
      label: t('tools.userAgentParser.secBrowser'),
      name: p.browser.id ? p.browser.name : t('tools.userAgentParser.unknown'),
      version: p.browser.version
        ? t('tools.userAgentParser.versionLabel') + ' ' + p.browser.version
        : '',
      note: '',
    },
    {
      key: 'os',
      emoji: p.os.id ? OS_EMOJI[p.os.id] || '💻' : '❓',
      label: t('tools.userAgentParser.secOs'),
      name: p.os.id ? p.os.name : t('tools.userAgentParser.unknown'),
      version: p.os.version
        ? t('tools.userAgentParser.versionLabel') + ' ' + p.os.version
        : '',
      note:
        p.os.id === 'windows' && p.os.version === 'NT 10.0'
          ? t('tools.userAgentParser.winNote')
          : '',
    },
    {
      key: 'device',
      emoji: p.device ? DEVICE_EMOJI[p.device] || '❓' : '❓',
      label: t('tools.userAgentParser.secDevice'),
      name: deviceKey ? t('tools.userAgentParser.' + deviceKey) : t('tools.userAgentParser.deviceUnknown'),
      version: '',
      note: '',
    },
    {
      key: 'engine',
      emoji: p.engine.id ? ENGINE_EMOJI[p.engine.id] || '⚙️' : '❓',
      label: t('tools.userAgentParser.secEngine'),
      name: p.engine.id ? p.engine.name : t('tools.userAgentParser.unknown'),
      version: p.engine.version
        ? t('tools.userAgentParser.versionLabel') + ' ' + p.engine.version
        : '',
      note: '',
    },
  ]
})
</script>

<template>
  <ToolPage tool-id="userAgentParser">
    <!-- 输入区：默认为本机 UA，可编辑 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="ua-input">{{ t('tools.userAgentParser.inputLabel') }}</label>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" @click="useMyUA">
            {{ t('tools.userAgentParser.myUaBtn') }}
          </button>
          <button type="button" class="btn-danger" :disabled="!input" @click="clearInput">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="ua-input"
        v-model="input"
        rows="4"
        class="input-base w-full font-mono break-all"
        :placeholder="t('tools.userAgentParser.inputPlaceholder')"
        :aria-label="t('tools.userAgentParser.inputLabel')"
        spellcheck="false"
      ></textarea>
      <div class="mt-2">
        <CopyButton :text="input" :label="t('toolsCommon.copy')" />
      </div>
    </section>

    <!-- 常见 UA 快捷示例 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <p class="label-base">{{ t('tools.userAgentParser.examples') }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="example in UA_EXAMPLES"
          :key="example.key"
          type="button"
          class="btn-ghost"
          @click="loadExample(example.ua)"
        >
          {{ t('tools.userAgentParser.' + example.key) }}
        </button>
      </div>
    </section>

    <!-- 空输入提示 -->
    <section
      v-if="!input.trim()"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.userAgentParser.emptyHint') }}
    </section>

    <!-- 解析结果：卡片化展示 -->
    <template v-else-if="parsed">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <section
          v-for="tile in tiles"
          :key="tile.key"
          class="glass-card p-4 sm:p-6 mb-0 min-w-0"
        >
          <div class="flex items-center gap-2.5 mb-2">
            <span class="text-2xl leading-none" aria-hidden="true">{{ tile.emoji }}</span>
            <span class="text-xs text-slate-400">{{ tile.label }}</span>
          </div>
          <p class="text-base font-semibold text-slate-800 break-words">{{ tile.name }}</p>
          <p v-if="tile.version" class="mt-1 font-mono text-sm text-slate-500 break-all">
            {{ tile.version }}
          </p>
          <p v-if="tile.note" class="mt-2 text-xs leading-relaxed text-amber-600">
            {{ tile.note }}
          </p>
        </section>
      </div>
      <p class="mb-4 px-1 text-xs leading-relaxed text-slate-400">
        {{ t('tools.userAgentParser.engineNote') }}
      </p>
    </template>
  </ToolPage>
</template>
