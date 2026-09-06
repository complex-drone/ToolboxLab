<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 子网计算器
 * - 两个输入框：IP + 掩码；掩码自动识别点分（255.255.255.0）与 CIDR（/24 或 24）两种写法
 * - 全部位运算（>>>）纯函数：网络/广播地址、通配符、可用主机、首末主机、IP 类别
 * - 二进制展示：32 位按 8 位分组，网络位（蓝）与主机位（红）着色
 * - 输入持久化；非法输入行内报错，不参与计算
 */
const { t } = useI18n()

/* ---------------- 持久化输入 ---------------- */

const input = useStorage('tool-subnet-calculator-input', {
  ip: '192.168.1.10',
  mask: '255.255.255.0',
})

/* ---------------- 纯函数：IPv4 解析 ---------------- */

/** 解析点分 IPv4 为 uint32；非法返回 null */
function parseIp(str) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(str)
  if (!m) return null
  let n = 0
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(m[i], 10)
    if (octet > 255) return null
    n = (n * 256 + octet) >>> 0
  }
  return n
}

/** uint32 转点分字符串 */
function toIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** 统计 1 位个数 */
function popcount(n) {
  let v = n >>> 0
  let c = 0
  while (v) {
    v &= v - 1
    c++
  }
  return c
}

/**
 * 解析掩码输入（点分或 CIDR）。
 * 返回 { mask, prefix }；非法返回 { error: 'format' | 'range' | 'contiguous' }
 */
function parseMask(str) {
  const raw = str.trim()
  // CIDR 形式：/24 或 24
  if (/^\/?\d+$/.test(raw)) {
    const prefix = parseInt(raw.replace(/^\//, ''), 10)
    if (prefix > 32) return { error: 'range' }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return { mask, prefix }
  }
  // 点分形式
  const mask = parseIp(raw)
  if (mask === null) return { error: 'format' }
  // 合法性：~mask 必须形如 0...01...1（即掩码为连续 1 后跟连续 0）
  const inv = (~mask) >>> 0
  if ((inv & (inv + 1)) !== 0) return { error: 'contiguous' }
  return { mask, prefix: popcount(mask) }
}

/* ---------------- 校验状态 ---------------- */

const ipError = computed(() => {
  const raw = (input.value.ip || '').trim()
  if (raw === '') return ''
  return parseIp(raw) === null ? 'ipInvalid' : ''
})

const maskError = computed(() => {
  const raw = (input.value.mask || '').trim()
  if (raw === '') return ''
  const r = parseMask(raw)
  if (r.error === 'format') return 'maskFormatInvalid'
  if (r.error === 'range') return 'maskRangeInvalid'
  if (r.error === 'contiguous') return 'maskContiguousInvalid'
  return ''
})

const inputReady = computed(
  () =>
    (input.value.ip || '').trim() !== '' &&
    (input.value.mask || '').trim() !== '' &&
    ipError.value === '' &&
    maskError.value === ''
)

/* ---------------- 计算 ---------------- */

const calc = computed(() => {
  if (!inputReady.value) return null
  try {
    const ip = parseIp(input.value.ip.trim())
    const { mask, prefix } = parseMask(input.value.mask.trim())
    const network = (ip & mask) >>> 0
    const wildcard = (~mask) >>> 0
    const broadcast = (network | wildcard) >>> 0
    const firstOctet = (ip >>> 24) & 255
    const ipClass =
      firstOctet <= 127 ? 'A' : firstOctet <= 191 ? 'B' : firstOctet <= 223 ? 'C' : firstOctet <= 239 ? 'D' : 'E'
    const totalAddrs = Math.pow(2, 32 - prefix)
    // /31 按 RFC 3021 点对点链路有 2 个可用主机；/32 为单机路由
    const usableHosts = prefix === 31 ? 2 : prefix === 32 ? 1 : totalAddrs - 2
    const firstHost = prefix >= 31 ? network : (network + 1) >>> 0
    const lastHost = prefix === 32 ? network : prefix === 31 ? broadcast : (broadcast - 1) >>> 0
    return { ip, mask, prefix, network, wildcard, broadcast, ipClass, totalAddrs, usableHosts, firstHost, lastHost }
  } catch {
    return null
  }
})

const resultRows = computed(() => {
  const c = calc.value
  if (!c) return []
  return [
    { label: t('tools.subnetCalculator.ipClass'), value: c.ipClass },
    { label: t('tools.subnetCalculator.prefixLabel'), value: '/' + c.prefix },
    { label: t('tools.subnetCalculator.netmask'), value: toIp(c.mask) },
    { label: t('tools.subnetCalculator.wildcard'), value: toIp(c.wildcard) },
    { label: t('tools.subnetCalculator.networkAddr'), value: toIp(c.network) + '/' + c.prefix },
    { label: t('tools.subnetCalculator.broadcastAddr'), value: toIp(c.broadcast) },
    { label: t('tools.subnetCalculator.totalAddrs'), value: c.totalAddrs.toLocaleString() },
    { label: t('tools.subnetCalculator.usableHosts'), value: c.usableHosts.toLocaleString() },
    { label: t('tools.subnetCalculator.firstHost'), value: toIp(c.firstHost) },
    { label: t('tools.subnetCalculator.lastHost'), value: toIp(c.lastHost) },
  ]
})

/* ---------------- 二进制展示（网络位 / 主机位着色） ---------------- */

/** uint32 按 8 位分组拆位，idx < prefix 的位为网络位 */
function binaryGroups(n, prefix) {
  const groups = []
  for (let g = 0; g < 4; g++) {
    const bits = []
    for (let b = 0; b < 8; b++) {
      const idx = g * 8 + b
      bits.push({ bit: (n >>> (31 - idx)) & 1, network: idx < prefix })
    }
    groups.push(bits)
  }
  return groups
}

const binaryRows = computed(() => {
  const c = calc.value
  if (!c) return []
  const mk = (label, n) => ({ label, groups: binaryGroups(n, c.prefix) })
  return [
    mk(t('tools.subnetCalculator.ipLabel'), c.ip),
    mk(t('tools.subnetCalculator.netmask'), c.mask),
    mk(t('tools.subnetCalculator.networkAddr'), c.network),
    mk(t('tools.subnetCalculator.broadcastAddr'), c.broadcast),
  ]
})
</script>

<template>
  <ToolPage tool-id="subnetCalculator">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="label-base" for="subnet-ip">{{ t('tools.subnetCalculator.ipLabel') }}</label>
          <input
            id="subnet-ip"
            v-model="input.ip"
            type="text"
            class="input-base font-mono"
            :class="ipError ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''"
            :placeholder="t('tools.subnetCalculator.ipPlaceholder')"
            autocomplete="off"
            spellcheck="false"
          />
          <p v-if="ipError" class="mt-1 text-xs text-rose-500">{{ t('tools.subnetCalculator.' + ipError) }}</p>
        </div>
        <div>
          <label class="label-base" for="subnet-mask">{{ t('tools.subnetCalculator.maskLabel') }}</label>
          <input
            id="subnet-mask"
            v-model="input.mask"
            type="text"
            class="input-base font-mono"
            :class="maskError ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''"
            :placeholder="t('tools.subnetCalculator.maskPlaceholder')"
            autocomplete="off"
            spellcheck="false"
          />
          <p v-if="maskError" class="mt-1 text-xs text-rose-500">{{ t('tools.subnetCalculator.' + maskError) }}</p>
          <p v-else class="mt-1 text-xs text-slate-400">{{ t('tools.subnetCalculator.maskHint') }}</p>
        </div>
      </div>
    </section>

    <!-- 计算结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.subnetCalculator.resultTitle') }}</h2>
        <span v-if="calc" class="chip font-mono font-semibold">{{ calc.ipClass }} · /{{ calc.prefix }}</span>
      </div>

      <div v-if="calc" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <div
          v-for="row in resultRows"
          :key="row.label"
          class="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5"
        >
          <span class="text-sm text-slate-500 shrink-0">{{ row.label }}</span>
          <span class="font-mono text-sm font-semibold text-slate-800 break-all text-right">{{ row.value }}</span>
        </div>
      </div>
      <p v-if="calc" class="mt-3 text-xs text-slate-400">{{ t('tools.subnetCalculator.usableHostsHint') }}</p>
      <div
        v-else
        class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400"
      >
        {{ t('tools.subnetCalculator.emptyInput') }}
      </div>
    </section>

    <!-- 二进制展示 -->
    <section v-if="calc" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.subnetCalculator.binaryTitle') }}</h2>
        <span class="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-600"></span>
          {{ t('tools.subnetCalculator.legendNetwork') }}
        </span>
        <span class="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span class="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500"></span>
          {{ t('tools.subnetCalculator.legendHost') }}
        </span>
      </div>

      <div class="space-y-2.5">
        <div v-for="row in binaryRows" :key="row.label" class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="text-xs text-slate-500 w-20 sm:w-24 shrink-0">{{ row.label }}</span>
          <div class="font-mono text-xs sm:text-sm flex flex-wrap gap-x-2.5 gap-y-1 min-w-0" :aria-label="row.label">
            <span v-for="(group, gi) in row.groups" :key="gi" class="whitespace-nowrap">
              <span
                v-for="(b, bi) in group"
                :key="bi"
                :class="b.network ? 'text-blue-600 font-semibold' : 'text-rose-500'"
              >{{ b.bit }}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  </ToolPage>
</template>
