<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/** 持久化配置：Tab 状态 */
const config = useStorage('tool-url-base64-config', { tab: 'url' })

const TAB_KEYS = ['url', 'base64', 'image']
const activeTab = computed(() =>
  TAB_KEYS.includes(config.value.tab) ? config.value.tab : 'url'
)

const tabs = computed(() => [
  { key: 'url', label: t('tools.urlBase64.tabUrl') },
  { key: 'base64', label: t('tools.urlBase64.tabBase64') },
  { key: 'image', label: t('tools.urlBase64.tabImage') },
])

function tabClass(active) {
  return active
    ? 'flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white shadow-sm transition select-none'
    : 'flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition select-none'
}

/* ---------------- URL 编解码 ---------------- */
const urlEncIn = ref('')
const urlEncOut = ref('')
const urlDecIn = ref('')
const urlDecOut = ref('')
const urlDecError = ref(false)

function runUrlEncode() {
  try {
    urlEncOut.value = urlEncIn.value ? encodeURIComponent(urlEncIn.value) : ''
  } catch {
    urlEncOut.value = ''
  }
}

function runUrlDecode(showToast) {
  const src = urlDecIn.value
  if (!src) {
    urlDecOut.value = ''
    urlDecError.value = false
    return
  }
  try {
    urlDecOut.value = decodeURIComponent(src)
    urlDecError.value = false
  } catch {
    urlDecOut.value = ''
    urlDecError.value = true
    if (showToast) toast.error(t('tools.urlBase64.invalidUrl'))
  }
}

const debouncedUrlEncode = useDebounceFn(() => runUrlEncode(), 300)
const debouncedUrlDecode = useDebounceFn(() => runUrlDecode(false), 300)
watch(urlEncIn, () => debouncedUrlEncode())
watch(urlDecIn, () => debouncedUrlDecode())

function swapUrl() {
  if (!urlEncOut.value) return
  urlDecIn.value = urlEncOut.value
  runUrlDecode(true)
}

function clearUrlEncode() {
  urlEncIn.value = ''
  urlEncOut.value = ''
}

function clearUrlDecode() {
  urlDecIn.value = ''
  urlDecOut.value = ''
  urlDecError.value = false
}

/* ---------------- Base64 文本（UTF-8 安全） ---------------- */
const b64EncIn = ref('')
const b64EncOut = ref('')
const b64EncError = ref(false)
const b64DecIn = ref('')
const b64DecOut = ref('')
const b64DecError = ref(false)

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUtf8(text) {
  const cleaned = text.replace(/\s+/g, '')
  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new Error('invalid base64')
  }
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  return decoder.decode(bytes)
}

function runB64Encode(showToast) {
  const src = b64EncIn.value
  if (!src) {
    b64EncOut.value = ''
    b64EncError.value = false
    return
  }
  try {
    b64EncOut.value = utf8ToBase64(src)
    b64EncError.value = false
  } catch {
    b64EncOut.value = ''
    b64EncError.value = true
    if (showToast) toast.error(t('toolsCommon.error'))
  }
}

function runB64Decode(showToast) {
  const src = b64DecIn.value
  if (!src) {
    b64DecOut.value = ''
    b64DecError.value = false
    return
  }
  try {
    b64DecOut.value = base64ToUtf8(src)
    b64DecError.value = false
  } catch {
    b64DecOut.value = ''
    b64DecError.value = true
    if (showToast) toast.error(t('tools.urlBase64.invalidBase64'))
  }
}

const debouncedB64Encode = useDebounceFn(() => runB64Encode(false), 300)
const debouncedB64Decode = useDebounceFn(() => runB64Decode(false), 300)
watch(b64EncIn, () => debouncedB64Encode())
watch(b64DecIn, () => debouncedB64Decode())

function swapB64() {
  if (!b64EncOut.value) return
  b64DecIn.value = b64EncOut.value
  runB64Decode(true)
}

function clearB64Encode() {
  b64EncIn.value = ''
  b64EncOut.value = ''
  b64EncError.value = false
}

function clearB64Decode() {
  b64DecIn.value = ''
  b64DecOut.value = ''
  b64DecError.value = false
}

/* ---------------- 图片转 Base64 ---------------- */
const imageInfo = ref(null)

async function onImageFile(file) {
  if (!file) return
  if (!String(file.type || '').startsWith('image/')) {
    toast.error(t('toolsCommon.unsupportedFile'))
    return
  }
  try {
    const dataUrl = await readFileAsDataUrl(file)
    imageInfo.value = {
      name: file.name,
      size: file.size,
      type: file.type,
      dataUrl,
    }
    toast.success(t('toolsCommon.loaded'))
  } catch {
    toast.error(t('toolsCommon.loadFailed'))
  }
}

function clearImage() {
  imageInfo.value = null
}

const imageSizeLabel = computed(() =>
  imageInfo.value ? formatBytes(imageInfo.value.size) : ''
)
</script>

<template>
  <ToolPage tool-id="urlBase64">
    <!-- Tab 切换 -->
    <div
      class="glass-card p-3 sm:p-4 mb-4 flex flex-wrap gap-1"
      role="tablist"
      :aria-label="t('tools.urlBase64.modeLabel')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        :class="tabClass(activeTab === tab.key)"
        @click="config.tab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- URL 编解码 -->
    <div v-if="activeTab === 'url'" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.urlEncodeTitle') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!urlEncIn"
            @click="runUrlEncode"
          >
            {{ t('toolsCommon.convert') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!urlEncIn && !urlEncOut"
            @click="clearUrlEncode"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="urlEncIn"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('tools.urlBase64.urlEncPlaceholder')"
        :aria-label="t('tools.urlBase64.plainLabel')"
      ></textarea>
      <div class="flex flex-wrap items-center justify-between gap-2 mt-3 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.encodedLabel') }}</span>
        <CopyButton :text="urlEncOut" :label="t('toolsCommon.copy')" />
      </div>
      <textarea
        readonly
        :value="urlEncOut"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('toolsCommon.none')"
        :aria-label="t('tools.urlBase64.encodedLabel')"
      ></textarea>

      <div class="flex justify-center my-4">
        <button
          type="button"
          class="btn-ghost"
          :disabled="!urlEncOut"
          :aria-label="t('tools.urlBase64.swapHint')"
          @click="swapUrl"
        >
          {{ t('toolsCommon.swap') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.urlDecodeTitle') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!urlDecIn"
            @click="runUrlDecode(true)"
          >
            {{ t('toolsCommon.convert') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!urlDecIn && !urlDecOut"
            @click="clearUrlDecode"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="urlDecIn"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('tools.urlBase64.urlDecPlaceholder')"
        :aria-label="t('tools.urlBase64.encodedLabel')"
      ></textarea>
      <p v-if="urlDecError" class="text-red-600 text-sm mt-1">
        {{ t('tools.urlBase64.invalidUrl') }}
      </p>
      <div class="flex flex-wrap items-center justify-between gap-2 mt-3 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.decodedLabel') }}</span>
        <CopyButton :text="urlDecOut" :label="t('toolsCommon.copy')" />
      </div>
      <textarea
        readonly
        :value="urlDecOut"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('toolsCommon.none')"
        :aria-label="t('tools.urlBase64.decodedLabel')"
      ></textarea>
    </div>

    <!-- Base64 文本 -->
    <div v-if="activeTab === 'base64'" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.base64EncodeTitle') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!b64EncIn"
            @click="runB64Encode(true)"
          >
            {{ t('toolsCommon.convert') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!b64EncIn && !b64EncOut"
            @click="clearB64Encode"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="b64EncIn"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('tools.urlBase64.b64EncPlaceholder')"
        :aria-label="t('tools.urlBase64.plainLabel')"
      ></textarea>
      <div class="flex flex-wrap items-center justify-between gap-2 mt-3 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.encodedLabel') }}</span>
        <CopyButton :text="b64EncOut" :label="t('toolsCommon.copy')" />
      </div>
      <textarea
        readonly
        :value="b64EncOut"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('toolsCommon.none')"
        :aria-label="t('tools.urlBase64.encodedLabel')"
      ></textarea>

      <div class="flex justify-center my-4">
        <button
          type="button"
          class="btn-ghost"
          :disabled="!b64EncOut"
          :aria-label="t('tools.urlBase64.swapHint')"
          @click="swapB64"
        >
          {{ t('toolsCommon.swap') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.base64DecodeTitle') }}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!b64DecIn"
            @click="runB64Decode(true)"
          >
            {{ t('toolsCommon.convert') }}
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!b64DecIn && !b64DecOut"
            @click="clearB64Decode"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="b64DecIn"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('tools.urlBase64.b64DecPlaceholder')"
        :aria-label="t('tools.urlBase64.encodedLabel')"
      ></textarea>
      <p v-if="b64DecError" class="text-red-600 text-sm mt-1">
        {{ t('tools.urlBase64.invalidBase64') }}
      </p>
      <div class="flex flex-wrap items-center justify-between gap-2 mt-3 mb-1.5">
        <span class="label-base mb-0">{{ t('tools.urlBase64.decodedLabel') }}</span>
        <CopyButton :text="b64DecOut" :label="t('toolsCommon.copy')" />
      </div>
      <textarea
        readonly
        :value="b64DecOut"
        class="input-base w-full font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="t('toolsCommon.none')"
        :aria-label="t('tools.urlBase64.decodedLabel')"
      ></textarea>
    </div>

    <!-- 图片转 Base64 -->
    <div v-if="activeTab === 'image'" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.urlBase64.tabImage') }}</h2>
      <FileDropZone
        accept="image/*"
        :multiple="false"
        :maxSizeMB="5"
        :hint="t('tools.urlBase64.imageHint')"
        @files="onImageFile"
      />

      <div v-if="imageInfo" class="mt-4 flex flex-col sm:flex-row gap-4 items-start">
        <img
          :src="imageInfo.dataUrl"
          :alt="imageInfo.name"
          class="w-full max-w-[240px] sm:w-44 sm:max-w-none max-h-48 object-contain rounded-xl border border-slate-200 bg-white"
        />
        <div class="flex-1 min-w-0 w-full">
          <dl class="grid grid-cols-1 gap-1.5 text-sm">
            <div class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">
                {{ t('tools.urlBase64.fileNameLabel') }}:
              </dt>
              <dd class="text-slate-700 break-all">{{ imageInfo.name }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="text-slate-400 shrink-0">
                {{ t('tools.urlBase64.fileSizeLabel') }}:
              </dt>
              <dd class="text-slate-700">
                {{
                  t('tools.urlBase64.sizeWithBytes', {
                    size: imageSizeLabel,
                    bytes: imageInfo.size,
                  })
                }}
              </dd>
            </div>
            <div class="flex gap-2">
              <dt class="text-slate-400 shrink-0">
                {{ t('tools.urlBase64.fileTypeLabel') }}:
              </dt>
              <dd class="text-slate-700 break-all">{{ imageInfo.type }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="text-slate-400 shrink-0">
                {{ t('tools.urlBase64.lengthLabel') }}:
              </dt>
              <dd class="text-slate-700">
                {{ imageInfo.dataUrl.length }} {{ t('toolsCommon.chars') }}
              </dd>
            </div>
          </dl>
          <div class="flex flex-wrap gap-2 mt-3">
            <CopyButton
              :text="imageInfo.dataUrl"
              :label="t('tools.urlBase64.copyBase64')"
            />
            <button type="button" class="btn-danger" @click="clearImage">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </ToolPage>
</template>
