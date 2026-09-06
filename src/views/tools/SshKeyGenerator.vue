<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * SSH 密钥生成（全部本地完成）
 * - RSA-2048/4096：WebCrypto RSA-OAEP 生成，SPKI / PKCS8 导出
 * - Ed25519：优先 WebCrypto Ed25519，不支持时降级 tweetnacl（nacl.sign.keyPair）
 * - OpenSSH authorized_keys 格式自行实现 wire format：
 *   32 位大端长度前缀的 string / mpint（RSA 的 e、n 做去前导零与高位补零处理）
 * - 私钥不持久化；仅持久化算法、位数、comment 偏好
 */

const ED25519_SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]
const ED25519_PKCS8_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]

const { t } = useI18n()
const toast = useToast()

/** 仅持久化偏好：算法、RSA 位数、comment */
const config = useStorage('tool-ssh-key-config', {
  algo: 'ed25519', // 'ed25519' | 'rsa'
  rsaBits: 2048,
  comment: '',
})

/** 首次使用时生成默认随机标识（写入 useStorage 后持久化） */
if (!config.value.comment) {
  config.value.comment = randomCommentId()
}

/** Web Crypto subtle 仅在 https / localhost 下可用 */
const subtleAvailable = typeof crypto !== 'undefined'
  && !!crypto.subtle
  && typeof crypto.subtle.generateKey === 'function'

const busy = ref(false)
const error = ref('')
const result = ref(null)
// { keyType: 'ssh-rsa' | 'ssh-ed25519', fileBase: 'id_rsa' | 'id_ed25519',
//   bits, engine: 'webcrypto' | 'tweetnacl', openssh, publicPem, privatePem }

const isRsa = computed(() => config.value.algo === 'rsa')
const rsaUnavailable = computed(() => isRsa.value && !subtleAvailable)
const generateDisabled = computed(() => busy.value || (isRsa.value && !subtleAvailable))

function switchAlgo(algo) {
  config.value.algo = algo
}

async function generateKey() {
  if (generateDisabled.value) return
  busy.value = true
  error.value = ''
  try {
    if (isRsa.value) {
      result.value = await generateRsa()
    } else {
      result.value = await generateEd25519()
    }
    toast.success(t('tools.sshKeyGenerator.generatedDone'))
  } catch {
    result.value = null
    error.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    busy.value = false
  }
}

async function generateRsa() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: config.value.rsaBits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  )
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  // JWK 提供大整数的 Base64URL 表示，便于构造 OpenSSH wire format
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const opensshBody = concatBytes(
    sshEncodeString(new TextEncoder().encode('ssh-rsa')),
    sshEncodeMpint(base64UrlToBytes(jwk.e)),
    sshEncodeMpint(base64UrlToBytes(jwk.n))
  )
  const comment = currentComment()
  return {
    keyType: 'ssh-rsa',
    fileBase: 'id_rsa',
    bits: config.value.rsaBits,
    engine: 'webcrypto',
    openssh: `ssh-rsa ${bytesToBase64(opensshBody)} ${comment}`,
    publicPem: toPem(spki, 'PUBLIC KEY'),
    privatePem: toPem(pkcs8, 'PRIVATE KEY'),
  }
}

async function generateEd25519() {
  let pubRaw
  let spki
  let pkcs8
  let engine = 'webcrypto'
  try {
    // 优先使用 WebCrypto Ed25519（Chrome 137+ / Firefox 129+ / Safari 17+）
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  } catch {
    // 降级 tweetnacl：secretKey 前 32 字节为种子，后 32 字节为公钥
    engine = 'tweetnacl'
    const mod = await import('tweetnacl')
    const nacl = mod.default && typeof mod.default.sign === 'function' ? mod.default : mod
    const pair = nacl.sign.keyPair()
    pubRaw = pair.publicKey
    const seed = pair.secretKey.slice(0, 32)
    spki = new Uint8Array([...ED25519_SPKI_PREFIX, ...pubRaw])
    pkcs8 = new Uint8Array([...ED25519_PKCS8_PREFIX, ...seed])
  }
  // Ed25519 公钥固定 32 字节，无需前导零处理
  const opensshBody = concatBytes(
    sshEncodeString(new TextEncoder().encode('ssh-ed25519')),
    sshEncodeString(pubRaw)
  )
  const comment = currentComment()
  return {
    keyType: 'ssh-ed25519',
    fileBase: 'id_ed25519',
    bits: 256,
    engine,
    openssh: `ssh-ed25519 ${bytesToBase64(opensshBody)} ${comment}`,
    publicPem: toPem(spki, 'PUBLIC KEY'),
    privatePem: toPem(pkcs8, 'PRIVATE KEY'),
  }
}

function currentComment() {
  const trimmed = (config.value.comment || '').trim()
  if (trimmed) return trimmed
  const generated = randomCommentId()
  config.value.comment = generated
  return generated
}

// ==================== 编解码工具 ====================

function bytesToBase64(bytes) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64UrlToBytes(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  return base64ToBytes(norm + '='.repeat((4 - (norm.length % 4)) % 4))
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function toPem(derBytes, label) {
  const b64 = bytesToBase64(derBytes)
  const lines = b64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/** SSH wire format：32 位大端长度 + 数据 */
function sshEncodeString(bytes) {
  const out = new Uint8Array(4 + bytes.length)
  new DataView(out.buffer).setUint32(0, bytes.length, false)
  out.set(bytes, 4)
  return out
}

/** SSH mpint：大端最小表示，高位为 1 时前补 0x00，值 0 编码为空串 */
function sshEncodeMpint(bytes) {
  let start = 0
  while (start < bytes.length && bytes[start] === 0) start++
  const mag = bytes.slice(start)
  if (mag.length === 0) return sshEncodeString(new Uint8Array(0))
  if ((mag[0] & 0x80) !== 0) {
    const padded = new Uint8Array(mag.length + 1)
    padded.set(mag, 1)
    return sshEncodeString(padded)
  }
  return sshEncodeString(mag)
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 默认随机标识：toolboxlab- + 8 位随机 hex */
function randomCommentId() {
  const buf = new Uint8Array(4)
  crypto.getRandomValues(buf)
  const hex = Array.from(buf)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `toolboxlab-${hex}`
}

function downloadOpenssh() {
  if (!result.value) return
  downloadText(`${result.value.openssh}\n`, `${result.value.fileBase}.pub`)
  toast.success(t('toolsCommon.done'))
}

function downloadPublicPem() {
  if (!result.value) return
  downloadText(result.value.publicPem, `${result.value.fileBase}.pub.pem`)
  toast.success(t('toolsCommon.done'))
}

function downloadPrivatePem() {
  if (!result.value) return
  downloadText(result.value.privatePem, `${result.value.fileBase}.pem`)
  toast.success(t('toolsCommon.done'))
}

const TIPS = ['tipPrivate', 'tipBrowser', 'tipProduction']

onBeforeUnmount(() => {
  // 私钥仅存于组件内存，卸载时随组件释放
  result.value = null
})
</script>

<template>
  <ToolPage tool-id="sshKeyGenerator">
    <!-- Web Crypto 不可用提示（RSA 不可用，Ed25519 可降级 tweetnacl） -->
    <div
      v-if="!subtleAvailable"
      class="glass-card p-4 mb-4 border-amber-200 bg-amber-50/80"
      role="alert"
    >
      <p class="text-sm font-medium text-amber-700">
        {{ t('tools.sshKeyGenerator.subtleUnavailable') }}
      </p>
    </div>

    <!-- 算法选择与生成 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.sshKeyGenerator.algoLabel') }}</h2>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-ghost"
          :class="{ '!bg-blue-600 !text-white !border-blue-600': config.algo === 'ed25519' }"
          :aria-pressed="config.algo === 'ed25519'"
          :disabled="busy"
          @click="switchAlgo('ed25519')"
        >
          {{ t('tools.sshKeyGenerator.algoEd25519') }}
        </button>
        <button
          type="button"
          class="btn-ghost"
          :class="{ '!bg-blue-600 !text-white !border-blue-600': config.algo === 'rsa' }"
          :aria-pressed="config.algo === 'rsa'"
          :disabled="busy"
          @click="switchAlgo('rsa')"
        >
          {{ t('tools.sshKeyGenerator.algoRsa') }}
        </button>

        <template v-if="isRsa">
          <span class="text-xs font-medium text-slate-500 ml-2">{{ t('tools.sshKeyGenerator.keyBitsLabel') }}</span>
          <div class="flex gap-1.5">
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.rsaBits === 2048 }"
              :aria-pressed="config.rsaBits === 2048"
              :disabled="busy"
              @click="config.rsaBits = 2048"
            >
              2048
            </button>
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.rsaBits === 4096 }"
              :aria-pressed="config.rsaBits === 4096"
              :disabled="busy"
              @click="config.rsaBits = 4096"
            >
              4096
            </button>
          </div>
        </template>
      </div>
      <p v-if="rsaUnavailable" class="mt-2 text-sm text-red-600">
        {{ t('tools.sshKeyGenerator.rsaUnavailableHint') }}
      </p>

      <label class="label-base mt-4" for="ssh-comment-input">{{ t('tools.sshKeyGenerator.commentLabel') }}</label>
      <input
        id="ssh-comment-input"
        v-model="config.comment"
        type="text"
        class="input-base w-full sm:max-w-sm"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('tools.sshKeyGenerator.commentPlaceholder')"
      />

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary" :disabled="generateDisabled" @click="generateKey">
          {{ busy ? t('tools.sshKeyGenerator.generating') : t('tools.sshKeyGenerator.generateButton') }}
        </button>
        <span v-if="busy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 生成结果 -->
    <template v-if="result">
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.sshKeyGenerator.publicKeyTitle') }}</h2>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="chip font-mono">{{ result.keyType }}</span>
            <span v-if="result.keyType === 'ssh-rsa'" class="chip !bg-slate-50 !text-slate-500 !border-slate-200">{{ result.bits }}</span>
            <span
              v-if="result.keyType === 'ssh-ed25519'"
              class="chip !bg-slate-50 !text-slate-500 !border-slate-200"
            >
              {{ result.engine === 'tweetnacl'
                ? t('tools.sshKeyGenerator.engineTweetnacl')
                : t('tools.sshKeyGenerator.engineWebcrypto') }}
            </span>
          </div>
        </div>

        <!-- OpenSSH authorized_keys 格式 -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <span class="text-sm font-medium text-slate-600">{{ t('tools.sshKeyGenerator.opensshFormat') }}</span>
          <div class="flex gap-1.5">
            <CopyButton :text="result.openssh" />
            <button type="button" class="btn-ghost" @click="downloadOpenssh">
              {{ t('toolsCommon.download') }} .pub
            </button>
          </div>
        </div>
        <textarea
          :value="result.openssh"
          rows="3"
          readonly
          class="input-base w-full font-mono text-xs bg-slate-50 break-all"
          spellcheck="false"
        ></textarea>

        <!-- PEM 公钥 -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5 mt-4">
          <span class="text-sm font-medium text-slate-600">{{ t('tools.sshKeyGenerator.pemPublicFormat') }}</span>
          <div class="flex gap-1.5">
            <CopyButton :text="result.publicPem" />
            <button type="button" class="btn-ghost" @click="downloadPublicPem">
              {{ t('toolsCommon.download') }} .pub.pem
            </button>
          </div>
        </div>
        <textarea
          :value="result.publicPem"
          rows="5"
          readonly
          class="input-base w-full font-mono text-xs bg-slate-50"
          spellcheck="false"
        ></textarea>
      </section>

      <!-- 私钥 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <h2 class="section-title mb-0">{{ t('tools.sshKeyGenerator.privateKeyTitle') }}</h2>
          <div class="flex gap-1.5">
            <CopyButton :text="result.privatePem" />
            <button type="button" class="btn-ghost" @click="downloadPrivatePem">
              {{ t('toolsCommon.download') }} {{ result.fileBase }}.pem
            </button>
          </div>
        </div>
        <textarea
          :value="result.privatePem"
          rows="6"
          readonly
          class="input-base w-full font-mono text-xs bg-red-50/60"
          spellcheck="false"
        ></textarea>
        <p class="mt-2 text-xs text-red-500">{{ t('tools.sshKeyGenerator.privateKeyWarning') }}</p>
      </section>
    </template>

    <!-- 安全提示 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.sshKeyGenerator.tipsTitle') }}</h2>
      <ul class="space-y-1.5">
        <li v-for="tip in TIPS" :key="tip" class="flex items-start gap-2 text-sm text-slate-600">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400"></span>
          <span>{{ t(`tools.sshKeyGenerator.${tip}`) }}</span>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>
