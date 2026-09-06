<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * JWT 解码器：仅本地解码 header.payload.signature，
 * 时间戳转本地时间并标注过期状态，签名只做 Base64URL 格式检查（不验证）
 */

// 演示用示例令牌（payload：iat/nbf=2023-11-14，exp=2030-01-01）
const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRvb2xib3hMYWIiLCJyb2xlIjoiZGVtbyIsImlhdCI6MTcwMDAwMDAwMCwibmJmIjoxNzAwMDAwMDAwLCJleHAiOjE4OTM0NTYwMDB9.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

const { t, locale } = useI18n()

/** 持久化最后输入（JWT 为演示数据） */
const config = useStorage('tool-jwt-decoder-config', {
  input: '',
})

const input = ref(typeof config.value.input === 'string' ? config.value.input : '')

const error = ref('')
/** 解析结果：{ headerJson, payloadJson, header, payload, signature } */
const parsed = ref(null)

const B64URL_RE = /^[A-Za-z0-9_-]+$/
const TIME_CLAIMS = ['exp', 'iat', 'nbf']

/** Base64URL 解码：- 换 +，_ 换 /，补齐 padding，再按 UTF-8 还原 */
function base64UrlDecode(segment) {
  let b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function decodeSegmentToCompactJson(segment) {
  const json = JSON.parse(base64UrlDecode(segment))
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('not-an-object')
  }
  return JSON.stringify(json, null, 2)
}

function doParse(raw) {
  const value = raw.trim()
  if (!value) {
    error.value = ''
    parsed.value = null
    return
  }
  const parts = value.split('.')
  const [headSeg, payloadSeg, sigSeg] = parts
  if (parts.length !== 3 || !headSeg || !payloadSeg) {
    error.value = t('tools.jwtDecoder.errFormat')
    parsed.value = null
    return
  }
  try {
    const headerJson = decodeSegmentToCompactJson(headSeg)
    const payloadJson = decodeSegmentToCompactJson(payloadSeg)
    error.value = ''
    parsed.value = {
      headerJson,
      payloadJson,
      header: JSON.parse(base64UrlDecode(headSeg)),
      payload: JSON.parse(base64UrlDecode(payloadSeg)),
      signature: sigSeg || '',
    }
  } catch {
    parsed.value = null
    // 定位出错段：header 段能解码则视为 payload 段出错
    let headOk = false
    try {
      decodeSegmentToCompactJson(headSeg)
      headOk = true
    } catch {
      /* header 段解析失败 */
    }
    error.value = headOk
      ? t('tools.jwtDecoder.errPayload')
      : t('tools.jwtDecoder.errHeader')
  }
}
const debouncedParse = useDebounceFn(() => doParse(input.value), 300)

watch(input, value => {
  config.value.input = value
  debouncedParse()
})
// 初始解析持久化的输入
doParse(input.value)

function loadSample() {
  input.value = SAMPLE_JWT
  doParse(SAMPLE_JWT)
}

function clearInput() {
  input.value = ''
  config.value.input = ''
  doParse('')
}

onBeforeUnmount(() => {
  parsed.value = null
  error.value = ''
})

/** i18n locale → Intl locale */
const intlLocale = computed(() => (locale.value === 'en-US' ? 'en-US' : 'zh-CN'))

/** 秒级 Unix 时间戳 → 本地日期时间 */
function formatTimestamp(sec) {
  try {
    return new Date(sec * 1000).toLocaleString(intlLocale.value, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return String(sec)
  }
}

/** 时间字段（exp/iat/nbf）列表 */
const timeClaims = computed(() => {
  if (!parsed.value || !parsed.value.payload) return []
  const nowSec = Date.now() / 1000
  const labels = {
    exp: 'tools.jwtDecoder.claimExp',
    iat: 'tools.jwtDecoder.claimIat',
    nbf: 'tools.jwtDecoder.claimNbf',
  }
  return TIME_CLAIMS.filter(key => key in parsed.value.payload).map(key => {
    const value = parsed.value.payload[key]
    const valid = typeof value === 'number' && Number.isFinite(value)
    return {
      key,
      label: t(labels[key]),
      text: valid ? formatTimestamp(value) : String(value),
      past: valid && value < nowSec,
    }
  })
})

const expClaim = computed(() => timeClaims.value.find(c => c.key === 'exp') || null)
const nbfClaim = computed(() => timeClaims.value.find(c => c.key === 'nbf') || null)

const algValue = computed(() => {
  const alg = parsed.value && parsed.value.header ? parsed.value.header.alg : undefined
  return alg === undefined || alg === null ? t('tools.jwtDecoder.notSet') : String(alg)
})
const typValue = computed(() => {
  const typ = parsed.value && parsed.value.header ? parsed.value.header.typ : undefined
  return typ === undefined || typ === null ? t('tools.jwtDecoder.notSet') : String(typ)
})

const sigState = computed(() => {
  if (!parsed.value) return 'none'
  if (!parsed.value.signature) return 'empty'
  return B64URL_RE.test(parsed.value.signature) ? 'valid' : 'invalid'
})
</script>

<template>
  <ToolPage tool-id="jwtDecoder">
    <!-- 仅解码不验证签名的明确提示 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.jwtDecoder.disclaimer') }}</p>
    </div>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="jwt-input">{{ t('tools.jwtDecoder.inputLabel') }}</label>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" @click="loadSample">
            {{ t('tools.jwtDecoder.sample') }}
          </button>
          <button type="button" class="btn-danger" :disabled="!input" @click="clearInput">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="jwt-input"
        v-model="input"
        rows="5"
        class="input-base w-full font-mono break-all"
        :placeholder="t('tools.jwtDecoder.inputPlaceholder')"
        :aria-label="t('tools.jwtDecoder.inputLabel')"
        spellcheck="false"
      ></textarea>
      <p v-if="error" class="mt-2 text-red-600 text-sm">{{ error }}</p>
    </section>

    <!-- 解析结果 -->
    <template v-if="parsed">
      <!-- 概要信息 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip">
            {{ t('tools.jwtDecoder.algLabel') }}: {{ algValue }}
          </span>
          <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
            {{ t('tools.jwtDecoder.typLabel') }}: {{ typValue }}
          </span>
          <span
            v-if="expClaim"
            class="chip"
            :class="expClaim.past
              ? '!bg-red-50 !text-red-600 !border-red-200'
              : '!bg-green-50 !text-green-600 !border-green-200'"
          >
            {{ expClaim.past ? t('tools.jwtDecoder.expired') : t('tools.jwtDecoder.notExpired') }}
          </span>
          <span
            v-if="nbfClaim"
            class="chip"
            :class="nbfClaim.past
              ? '!bg-green-50 !text-green-600 !border-green-200'
              : '!bg-amber-50 !text-amber-600 !border-amber-200'"
          >
            {{ nbfClaim.past ? t('tools.jwtDecoder.reached') : t('tools.jwtDecoder.notReached') }}
          </span>
        </div>
      </section>

      <!-- Header / Payload -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <section class="glass-card p-4 sm:p-6 mb-0 min-w-0">
          <div class="flex items-center justify-between mb-2">
            <h2 class="section-title mb-0">{{ t('tools.jwtDecoder.header') }}</h2>
            <CopyButton compact :text="parsed.headerJson" />
          </div>
          <pre class="w-full font-mono text-[13px] leading-5 text-slate-700 bg-white/70 border border-slate-100 rounded-xl p-3 overflow-x-auto">{{ parsed.headerJson }}</pre>
        </section>
        <section class="glass-card p-4 sm:p-6 mb-0 min-w-0">
          <div class="flex items-center justify-between mb-2">
            <h2 class="section-title mb-0">{{ t('tools.jwtDecoder.payload') }}</h2>
            <CopyButton compact :text="parsed.payloadJson" />
          </div>
          <pre class="w-full font-mono text-[13px] leading-5 text-slate-700 bg-white/70 border border-slate-100 rounded-xl p-3 overflow-x-auto">{{ parsed.payloadJson }}</pre>
        </section>
      </div>

      <!-- 时间字段 -->
      <section v-if="timeClaims.length" class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.jwtDecoder.timeClaims') }}</h2>
        <ul class="space-y-2">
          <li
            v-for="claim in timeClaims"
            :key="claim.key"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
          >
            <span class="text-sm font-medium text-slate-600">{{ claim.label }}</span>
            <code class="font-mono text-xs text-slate-400">{{ claim.key }}</code>
            <span class="text-sm text-slate-700 font-mono">{{ claim.text }}</span>
            <span
              v-if="claim.key === 'exp'"
              class="chip ml-auto"
              :class="claim.past
                ? '!bg-red-50 !text-red-600 !border-red-200'
                : '!bg-green-50 !text-green-600 !border-green-200'"
            >
              {{ claim.past ? t('tools.jwtDecoder.expired') : t('tools.jwtDecoder.notExpired') }}
            </span>
          </li>
        </ul>
      </section>

      <!-- 签名 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.jwtDecoder.signature') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <code class="flex-1 min-w-0 break-all font-mono text-xs text-slate-500 bg-white/70 border border-slate-100 rounded-xl px-3 py-2">
            {{ parsed.signature || '—' }}
          </code>
          <span
            v-if="sigState === 'empty'"
            class="chip !bg-slate-50 !text-slate-500 !border-slate-200"
          >
            {{ t('tools.jwtDecoder.sigEmpty') }}
          </span>
          <span
            v-else-if="sigState === 'valid'"
            class="chip !bg-green-50 !text-green-600 !border-green-200"
          >
            {{ t('tools.jwtDecoder.sigValid') }}
          </span>
          <span v-else class="chip !bg-red-50 !text-red-600 !border-red-200">
            {{ t('tools.jwtDecoder.sigInvalid') }}
          </span>
        </div>
      </section>
    </template>
  </ToolPage>
</template>
