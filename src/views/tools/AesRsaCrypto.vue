<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * AES / RSA 文本加解密（全部基于 Web Crypto，本地完成）
 * - AES-256-GCM：口令经 PBKDF2(SHA-256, 100000 迭代, 随机 16B salt) 派生密钥，随机 12B IV
 *   输出 Base64(salt[16] + iv[12] + ciphertext)
 * - RSA-OAEP(SHA-256)：生成 2048/4096 位密钥对，导出 SPKI / PKCS8 PEM
 * - 隐私要求：文本、口令、密钥均不持久化，仅持久化 Tab 与位数偏好
 */

const PBKDF2_ITERATIONS = 100000
const SALT_BYTES = 16
const IV_BYTES = 12
const GCM_TAG_BYTES = 16
const RSA_HASH = 'SHA-256'

const { t } = useI18n()
const toast = useToast()

/** 仅持久化偏好：Tab、AES 方向、RSA 位数 */
const config = useStorage('tool-aes-rsa-crypto-config', {
  tab: 'aes',
  aesMode: 'encrypt',
  rsaBits: 2048,
})

/** Web Crypto subtle 仅在 https / localhost 下可用，加载时检测 */
const subtleAvailable = typeof crypto !== 'undefined'
  && !!crypto.subtle
  && typeof crypto.subtle.deriveKey === 'function'
  && typeof crypto.subtle.generateKey === 'function'

// ==================== 通用编解码 ====================

function bytesToBase64(bytes) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToBytes(b64) {
  const clean = b64.replace(/\s+/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** PEM 模板在 JS 常量中拼接（语言包内禁止大括号等符号） */
function toPem(derBytes, label) {
  const b64 = bytesToBase64(derBytes)
  const lines = b64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

function pemToBytes(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return base64ToBytes(b64)
}

// ==================== AES ====================

const aesText = ref('') // 加密时为明文，解密时为 Base64 密文
const aesPassphrase = ref('')
const aesResult = ref('')
const aesError = ref('')
const aesBusy = ref(false)

const aesInputLabel = computed(() =>
  config.value.aesMode === 'encrypt'
    ? t('tools.aesRsaCrypto.plaintextLabel')
    : t('tools.aesRsaCrypto.cipherLabel')
)
const aesResultLabel = computed(() =>
  config.value.aesMode === 'encrypt'
    ? t('tools.aesRsaCrypto.aesResultLabel')
    : t('tools.aesRsaCrypto.aesDecryptResultLabel')
)

async function deriveAesKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function runAes() {
  if (!subtleAvailable || aesBusy.value) return
  aesError.value = ''
  if (!aesText.value.trim() || !aesPassphrase.value) {
    aesError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  aesBusy.value = true
  try {
    if (config.value.aesMode === 'encrypt') {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const key = await deriveAesKey(aesPassphrase.value, salt)
      const data = new TextEncoder().encode(aesText.value)
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
      const out = new Uint8Array(SALT_BYTES + IV_BYTES + ciphertext.length)
      out.set(salt, 0)
      out.set(iv, SALT_BYTES)
      out.set(ciphertext, SALT_BYTES + IV_BYTES)
      aesResult.value = bytesToBase64(out)
    } else {
      let raw
      try {
        raw = base64ToBytes(aesText.value)
      } catch {
        throw new Error('invalid-base64')
      }
      if (raw.length < SALT_BYTES + IV_BYTES + GCM_TAG_BYTES) {
        throw new Error('too-short')
      }
      const salt = raw.slice(0, SALT_BYTES)
      const iv = raw.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
      const ciphertext = raw.slice(SALT_BYTES + IV_BYTES)
      const key = await deriveAesKey(aesPassphrase.value, salt)
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
      aesResult.value = new TextDecoder().decode(plain)
    }
  } catch {
    aesResult.value = ''
    aesError.value = config.value.aesMode === 'decrypt'
      ? t('tools.aesRsaCrypto.decryptFailed')
      : t('toolsCommon.error')
    toast.error(aesError.value)
  } finally {
    aesBusy.value = false
  }
}

function switchAesMode(mode) {
  if (config.value.aesMode === mode) return
  config.value.aesMode = mode
  aesResult.value = ''
  aesError.value = ''
}

function clearAes() {
  aesText.value = ''
  aesPassphrase.value = ''
  aesResult.value = ''
  aesError.value = ''
}

// ==================== RSA ====================

const rsaKeyPair = ref(null) // { bits, publicPem, privatePem }，仅存内存
const rsaKeyBusy = ref(false)
const rsaKeyError = ref('')
const showPrivateKey = ref(false)

const rsaInput = ref('') // 加密时为明文，解密时为 Base64 密文
const rsaResult = ref('')
const rsaError = ref('')
const rsaBusy = ref(false)

/** RSA-OAEP(SHA-256) 单次可加密的最大字节数：keyBits/8 - 2*hashLen - 2 */
const activeKeyBits = computed(() => (rsaKeyPair.value ? rsaKeyPair.value.bits : config.value.rsaBits))
const rsaMaxBytes = computed(() => activeKeyBits.value / 8 - 2 * 32 - 2)

const rsaInputBytes = computed(() => new TextEncoder().encode(rsaInput.value).length)
const rsaOverLimit = computed(() => rsaInputBytes.value > rsaMaxBytes.value)

function switchTab(tab) {
  config.value.tab = tab
}

async function generateRsaKey() {
  if (!subtleAvailable || rsaKeyBusy.value) return
  rsaKeyError.value = ''
  rsaKeyBusy.value = true
  try {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: config.value.rsaBits,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: RSA_HASH,
      },
      true,
      ['encrypt', 'decrypt']
    )
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    rsaKeyPair.value = {
      bits: config.value.rsaBits,
      publicPem: toPem(new Uint8Array(spki), 'PUBLIC KEY'),
      privatePem: toPem(new Uint8Array(pkcs8), 'PRIVATE KEY'),
    }
    showPrivateKey.value = false
    toast.success(t('tools.aesRsaCrypto.keyGenerated'))
  } catch {
    rsaKeyError.value = t('toolsCommon.error')
    toast.error(rsaKeyError.value)
  } finally {
    rsaKeyBusy.value = false
  }
}

async function importRsaPublic(pem) {
  return crypto.subtle.importKey(
    'spki',
    pemToBytes(pem),
    { name: 'RSA-OAEP', hash: RSA_HASH },
    false,
    ['encrypt']
  )
}

async function importRsaPrivate(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(pem),
    { name: 'RSA-OAEP', hash: RSA_HASH },
    false,
    ['decrypt']
  )
}

async function runRsaEncrypt() {
  if (!subtleAvailable || rsaBusy.value || !rsaKeyPair.value) return
  rsaError.value = ''
  if (!rsaInput.value.trim()) {
    rsaError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  if (rsaOverLimit.value) {
    rsaError.value = t('tools.aesRsaCrypto.rsaTooLong', { n: rsaMaxBytes.value })
    toast.error(rsaError.value)
    return
  }
  rsaBusy.value = true
  try {
    const key = await importRsaPublic(rsaKeyPair.value.publicPem)
    const data = new TextEncoder().encode(rsaInput.value)
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, data)
    rsaResult.value = bytesToBase64(new Uint8Array(encrypted))
  } catch {
    rsaResult.value = ''
    rsaError.value = t('toolsCommon.error')
    toast.error(rsaError.value)
  } finally {
    rsaBusy.value = false
  }
}

async function runRsaDecrypt() {
  if (!subtleAvailable || rsaBusy.value || !rsaKeyPair.value) return
  rsaError.value = ''
  if (!rsaInput.value.trim()) {
    rsaError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  rsaBusy.value = true
  try {
    let cipherBytes
    try {
      cipherBytes = base64ToBytes(rsaInput.value)
    } catch {
      throw new Error('invalid-base64')
    }
    const key = await importRsaPrivate(rsaKeyPair.value.privatePem)
    const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, cipherBytes)
    rsaResult.value = new TextDecoder().decode(plain)
  } catch {
    rsaResult.value = ''
    rsaError.value = t('tools.aesRsaCrypto.rsaDecryptFailed')
    toast.error(rsaError.value)
  } finally {
    rsaBusy.value = false
  }
}

function clearRsa() {
  rsaInput.value = ''
  rsaResult.value = ''
  rsaError.value = ''
}

function downloadPem(which) {
  if (!rsaKeyPair.value) return
  const bits = rsaKeyPair.value.bits
  if (which === 'public') {
    downloadText(rsaKeyPair.value.publicPem, `public_key_${bits}.pem`)
  } else {
    downloadText(rsaKeyPair.value.privatePem, `private_key_${bits}.pem`)
  }
  toast.success(t('toolsCommon.done'))
}
</script>

<template>
  <ToolPage tool-id="aesRsaCrypto">
    <!-- Web Crypto 不可用横幅 -->
    <div
      v-if="!subtleAvailable"
      class="glass-card p-4 mb-4 border-red-200 bg-red-50/80"
      role="alert"
    >
      <p class="text-sm font-medium text-red-600">
        {{ t('tools.aesRsaCrypto.subtleUnavailable') }}
      </p>
    </div>

    <!-- Tab 切换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="section-title mb-0 mr-1">{{ t('tools.aesRsaCrypto.tabLabel') }}</span>
        <div class="flex gap-1.5">
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': config.tab === 'aes' }"
            :aria-pressed="config.tab === 'aes'"
            @click="switchTab('aes')"
          >
            AES
          </button>
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': config.tab === 'rsa' }"
            :aria-pressed="config.tab === 'rsa'"
            @click="switchTab('rsa')"
          >
            RSA
          </button>
        </div>
      </div>
    </section>

    <!-- AES -->
    <template v-if="config.tab === 'aes'">
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 class="section-title mb-0">AES-256-GCM</h2>
          <div class="flex gap-1.5">
            <button
              type="button"
              class="btn-ghost"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.aesMode === 'encrypt' }"
              :aria-pressed="config.aesMode === 'encrypt'"
              @click="switchAesMode('encrypt')"
            >
              {{ t('tools.aesRsaCrypto.aesEncryptMode') }}
            </button>
            <button
              type="button"
              class="btn-ghost"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.aesMode === 'decrypt' }"
              :aria-pressed="config.aesMode === 'decrypt'"
              @click="switchAesMode('decrypt')"
            >
              {{ t('tools.aesRsaCrypto.aesDecryptMode') }}
            </button>
          </div>
        </div>

        <label class="label-base" for="aes-text-input">{{ aesInputLabel }}</label>
        <textarea
          id="aes-text-input"
          v-model="aesText"
          rows="4"
          class="input-base w-full font-mono"
          spellcheck="false"
          :placeholder="config.aesMode === 'encrypt'
            ? t('tools.aesRsaCrypto.plaintextPlaceholder')
            : t('tools.aesRsaCrypto.cipherPlaceholder')"
        ></textarea>

        <label class="label-base mt-3" for="aes-passphrase">{{ t('tools.aesRsaCrypto.passphraseLabel') }}</label>
        <input
          id="aes-passphrase"
          v-model="aesPassphrase"
          type="password"
          class="input-base w-full"
          autocomplete="new-password"
          spellcheck="false"
          :placeholder="t('tools.aesRsaCrypto.passphrasePlaceholder')"
        />

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="!subtleAvailable || aesBusy"
            @click="runAes"
          >
            {{ config.aesMode === 'encrypt'
              ? t('tools.aesRsaCrypto.aesEncryptMode')
              : t('tools.aesRsaCrypto.aesDecryptMode') }}
          </button>
          <button type="button" class="btn-danger" @click="clearAes">
            {{ t('toolsCommon.clear') }}
          </button>
          <span v-if="aesBusy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
        </div>
        <p v-if="aesError" class="mt-2 text-sm text-red-600">{{ aesError }}</p>
      </section>

      <!-- AES 参数信息 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.aesRsaCrypto.aesParamsTitle') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.aesRsaCrypto.paramAlgo') }}</p>
            <p class="text-sm font-semibold text-slate-700">AES-256-GCM</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.aesRsaCrypto.paramKdf') }}</p>
            <p class="text-sm font-semibold text-slate-700">PBKDF2-SHA-256</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.aesRsaCrypto.paramIterations') }}</p>
            <p class="text-sm font-semibold text-slate-700">{{ PBKDF2_ITERATIONS.toLocaleString('en-US') }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.aesRsaCrypto.paramSaltIv') }}</p>
            <p class="text-sm font-semibold text-slate-700">
              salt {{ SALT_BYTES }} · IV {{ IV_BYTES }} {{ t('toolsCommon.bytes') }}
            </p>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ t('tools.aesRsaCrypto.aesFormatNote') }}</p>
      </section>

      <!-- AES 结果 -->
      <section v-if="aesResult || aesBusy" class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 class="section-title mb-0">{{ aesResultLabel }}</h2>
          <CopyButton :text="aesResult" :disabled="!aesResult" />
        </div>
        <textarea
          :value="aesResult"
          rows="4"
          readonly
          class="input-base w-full font-mono bg-slate-50"
          spellcheck="false"
        ></textarea>
      </section>
    </template>

    <!-- RSA -->
    <template v-else>
      <!-- 密钥生成 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.aesRsaCrypto.rsaKeyTitle') }}</h2>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium text-slate-500">{{ t('tools.aesRsaCrypto.keyBitsLabel') }}</span>
            <div class="flex gap-1.5">
              <button
                type="button"
                class="btn-ghost"
                :class="{ '!bg-blue-600 !text-white !border-blue-600': config.rsaBits === 2048 }"
                :aria-pressed="config.rsaBits === 2048"
                :disabled="rsaKeyBusy"
                @click="config.rsaBits = 2048"
              >
                2048
              </button>
              <button
                type="button"
                class="btn-ghost"
                :class="{ '!bg-blue-600 !text-white !border-blue-600': config.rsaBits === 4096 }"
                :aria-pressed="config.rsaBits === 4096"
                :disabled="rsaKeyBusy"
                @click="config.rsaBits = 4096"
              >
                4096
              </button>
            </div>
          </div>
          <button
            type="button"
            class="btn-primary"
            :disabled="!subtleAvailable || rsaKeyBusy"
            @click="generateRsaKey"
          >
            {{ rsaKeyBusy ? t('tools.aesRsaCrypto.generatingKey') : t('tools.aesRsaCrypto.generateKey') }}
          </button>
          <span v-if="rsaKeyBusy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
        </div>
        <p v-if="rsaKeyError" class="mt-2 text-sm text-red-600">{{ rsaKeyError }}</p>
        <p v-else-if="!rsaKeyPair" class="mt-2 text-xs text-slate-400">
          {{ t('tools.aesRsaCrypto.keyNotGeneratedHint') }}
        </p>

        <template v-if="rsaKeyPair">
          <!-- 公钥 -->
          <div class="mt-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <span class="text-sm font-medium text-slate-600">
                {{ t('tools.aesRsaCrypto.publicKeyPem') }}
              </span>
              <div class="flex gap-1.5">
                <CopyButton :text="rsaKeyPair.publicPem" />
                <button type="button" class="btn-ghost" @click="downloadPem('public')">
                  {{ t('toolsCommon.download') }} .pem
                </button>
              </div>
            </div>
            <textarea
              :value="rsaKeyPair.publicPem"
              rows="5"
              readonly
              class="input-base w-full font-mono text-xs bg-slate-50"
              spellcheck="false"
            ></textarea>
          </div>

          <!-- 私钥 -->
          <div class="mt-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <span class="text-sm font-medium text-slate-600">
                {{ t('tools.aesRsaCrypto.privateKeyPem') }}
              </span>
              <div class="flex gap-1.5">
                <button type="button" class="btn-ghost !py-1" @click="showPrivateKey = !showPrivateKey">
                  {{ showPrivateKey
                    ? t('tools.aesRsaCrypto.hidePrivateKey')
                    : t('tools.aesRsaCrypto.showPrivateKey') }}
                </button>
                <CopyButton :text="rsaKeyPair.privatePem" />
                <button type="button" class="btn-ghost" @click="downloadPem('private')">
                  {{ t('toolsCommon.download') }} .pem
                </button>
              </div>
            </div>
            <textarea
              v-if="showPrivateKey"
              :value="rsaKeyPair.privatePem"
              rows="8"
              readonly
              class="input-base w-full font-mono text-xs bg-red-50/60"
              spellcheck="false"
            ></textarea>
            <p v-else class="text-xs text-slate-400">{{ t('tools.aesRsaCrypto.privateKeyWarning') }}</p>
          </div>
        </template>
      </section>

      <!-- RSA 加解密 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.aesRsaCrypto.rsaOperateTitle') }}</h2>

        <label class="label-base" for="rsa-text-input">{{ t('tools.aesRsaCrypto.rsaInputLabel') }}</label>
        <textarea
          id="rsa-text-input"
          v-model="rsaInput"
          rows="4"
          class="input-base w-full font-mono"
          spellcheck="false"
          :placeholder="t('tools.aesRsaCrypto.rsaInputPlaceholder')"
        ></textarea>
        <p v-if="rsaOverLimit" class="mt-1.5 text-xs text-red-600">
          {{ t('tools.aesRsaCrypto.rsaTooLong', { n: rsaMaxBytes }) }}
        </p>
        <p v-else class="mt-1.5 text-xs text-slate-400">
          {{ t('tools.aesRsaCrypto.rsaMaxLength', { bits: activeKeyBits, n: rsaMaxBytes }) }}
          · {{ t('toolsCommon.bytes') }} {{ rsaInputBytes }}
        </p>
        <p v-if="!rsaKeyPair" class="mt-1.5 text-xs text-amber-600">
          {{ t('tools.aesRsaCrypto.keyNotGeneratedHint') }}
        </p>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="!subtleAvailable || rsaBusy || !rsaKeyPair || rsaOverLimit"
            @click="runRsaEncrypt"
          >
            {{ t('tools.aesRsaCrypto.rsaEncrypt') }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="!subtleAvailable || rsaBusy || !rsaKeyPair"
            @click="runRsaDecrypt"
          >
            {{ t('tools.aesRsaCrypto.rsaDecrypt') }}
          </button>
          <button type="button" class="btn-danger" @click="clearRsa">
            {{ t('toolsCommon.clear') }}
          </button>
          <span v-if="rsaBusy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
        </div>
        <p v-if="rsaError" class="mt-2 text-sm text-red-600">{{ rsaError }}</p>
      </section>

      <!-- RSA 结果 -->
      <section v-if="rsaResult" class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 class="section-title mb-0">{{ t('toolsCommon.result') }}</h2>
          <CopyButton :text="rsaResult" />
        </div>
        <textarea
          :value="rsaResult"
          rows="4"
          readonly
          class="input-base w-full font-mono bg-slate-50"
          spellcheck="false"
        ></textarea>
      </section>
    </template>
  </ToolPage>
</template>
