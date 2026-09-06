<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl, downloadBlob } from '@/utils/download'
import { formatBytes, byteLength } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/** 持久化配置：Tab 状态 */
const config = useStorage('tool-image-base64-config', { tab: 'encode' })

const TAB_KEYS = ['encode', 'decode']
const activeTab = computed(() =>
  TAB_KEYS.includes(config.value.tab) ? config.value.tab : 'encode'
)

const tabs = computed(() => [
  { key: 'encode', label: t('tools.imageBase64.tabEncode') },
  { key: 'decode', label: t('tools.imageBase64.tabDecode') },
])

function tabClass(active) {
  return active
    ? 'flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white shadow-sm transition select-none'
    : 'flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition select-none'
}

/* ---------------- 图片转 Base64 ---------------- */
const encodeInfo = ref(null) // { name, size, type, dataUrl }

async function onEncodeFile(file) {
  if (!file) return
  if (!String(file.type || '').startsWith('image/')) {
    toast.error(t('toolsCommon.unsupportedFile'))
    return
  }
  try {
    const dataUrl = await readFileAsDataUrl(file)
    encodeInfo.value = {
      name: file.name || 'image',
      size: file.size,
      type: file.type || 'image',
      dataUrl,
    }
    toast.success(t('toolsCommon.loaded'))
  } catch {
    toast.error(t('toolsCommon.loadFailed'))
  }
}

function clearEncode() {
  encodeInfo.value = null
}

const encodeChars = computed(() =>
  encodeInfo.value ? encodeInfo.value.dataUrl.length : 0
)
const encodeB64BytesLabel = computed(() =>
  encodeInfo.value ? formatBytes(byteLength(encodeInfo.value.dataUrl)) : ''
)
const encodeOriginalSizeLabel = computed(() =>
  encodeInfo.value ? formatBytes(encodeInfo.value.size) : ''
)

/* ---------------- Base64 转图片 ---------------- */
const b64Input = ref('')
const decodeError = ref('')
const decodeResult = ref(null) // { blob, url, mime, size, width, height }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** 通过文件头 magic number 识别 PNG / JPEG / GIF / WebP */
function detectImageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif'
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return ''
}

function releaseDecode() {
  if (decodeResult.value && decodeResult.value.url) {
    try {
      URL.revokeObjectURL(decodeResult.value.url)
    } catch {
      // ignore
    }
  }
}

async function parseInput() {
  releaseDecode()
  decodeResult.value = null
  const raw = b64Input.value.trim()
  if (!raw) {
    decodeError.value = ''
    return
  }
  try {
    let body = raw.replace(/\s+/g, '')
    let mime = ''
    // 容忍带 data:image/xxx;base64, 前缀的输入，自动剥离
    if (/^data:/i.test(body)) {
      const comma = body.indexOf(',')
      if (comma < 0) throw new Error('bad data url')
      const header = body.slice(0, comma)
      body = body.slice(comma + 1)
      if (!/;base64$/i.test(header)) throw new Error('not base64 data url')
      const mm = header.match(/^data:([^;,]+)/i)
      if (mm) mime = mm[1].toLowerCase()
    }
    if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
      throw new Error('invalid base64')
    }
    const binary = atob(body)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const detected = detectImageType(bytes)
    const finalMime = detected || (mime.indexOf('image/') === 0 ? mime : '')
    if (!finalMime) {
      decodeError.value = t('tools.imageBase64.notImage')
      return
    }

    const blob = new Blob([bytes], { type: finalMime })
    const url = URL.createObjectURL(blob)
    const info = { blob, url, mime: finalMime, size: bytes.length, width: 0, height: 0 }
    decodeResult.value = info
    decodeError.value = ''
    try {
      const img = await loadImage(url)
      info.width = img.naturalWidth
      info.height = img.naturalHeight
    } catch {
      // 无法确定尺寸时仅隐藏尺寸信息
    }
  } catch {
    decodeError.value = t('tools.imageBase64.invalidBase64')
  }
}

const debouncedParse = useDebounceFn(parseInput, 400)
watch(b64Input, () => debouncedParse())

function extFromMime(mime) {
  const sub = String(mime || '').split('/')[1] || ''
  const clean = sub.split(';')[0].toLowerCase()
  if (clean === 'jpeg' || clean === 'jpg') return 'jpg'
  if (clean === 'svg') return 'svg'
  return clean || 'img'
}

function downloadDecode() {
  if (!decodeResult.value) return
  try {
    downloadBlob(
      decodeResult.value.blob,
      'image-base64.' + extFromMime(decodeResult.value.mime)
    )
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function clearDecode() {
  b64Input.value = ''
  decodeError.value = ''
  releaseDecode()
  decodeResult.value = null
}

const decodeSizeLabel = computed(() =>
  decodeResult.value ? formatBytes(decodeResult.value.size) : ''
)

onBeforeUnmount(() => {
  releaseDecode()
})
</script>

<template>
  <ToolPage tool-id="imageBase64">
    <!-- Tab 切换 -->
    <div
      class="glass-card p-3 sm:p-4 mb-4 flex flex-wrap gap-1"
      role="tablist"
      :aria-label="t('tools.imageBase64.title')"
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

    <!-- 图片转 Base64 -->
    <div v-if="activeTab === 'encode'" class="glass-card p-4 sm:p-6 mb-4">
      <FileDropZone
        accept="image/*"
        :multiple="false"
        :maxSizeMB="10"
        :hint="t('tools.imageBase64.encodeHint')"
        @files="onEncodeFile"
      />

      <template v-if="encodeInfo">
        <div class="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1.5">
          <span class="label-base mb-0">{{ t('tools.imageBase64.base64Output') }}</span>
          <div class="flex flex-wrap gap-2">
            <CopyButton
              :text="encodeInfo.dataUrl"
              :label="t('toolsCommon.copyAll')"
            />
            <button type="button" class="btn-danger" @click="clearEncode">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>
        <textarea
          readonly
          :value="encodeInfo.dataUrl"
          rows="6"
          spellcheck="false"
          class="input-base w-full font-mono break-all"
          :aria-label="t('tools.imageBase64.base64Output')"
        ></textarea>
        <div class="flex flex-wrap gap-2 mt-3">
          <span class="chip">
            {{ t('tools.imageBase64.originalSize') }} {{ encodeOriginalSizeLabel }}
          </span>
          <span class="chip">
            {{ t('tools.imageBase64.base64Length') }} {{ encodeChars }} {{ t('toolsCommon.chars') }}
          </span>
          <span class="chip">≈ {{ encodeB64BytesLabel }}</span>
        </div>
      </template>
    </div>

    <!-- Base64 转图片 -->
    <div v-if="activeTab === 'decode'" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.imageBase64.decodeInput') }}</h2>
      <textarea
        v-model="b64Input"
        rows="6"
        spellcheck="false"
        class="input-base w-full font-mono break-all"
        :placeholder="t('tools.imageBase64.decodePlaceholder')"
        :aria-label="t('tools.imageBase64.decodeInput')"
      ></textarea>
      <p v-if="decodeError" class="text-red-600 text-sm mt-2">{{ decodeError }}</p>

      <template v-if="decodeResult">
        <h2 class="section-title mt-5">{{ t('tools.imageBase64.decodeResult') }}</h2>
        <div class="flex justify-center">
          <img
            :src="decodeResult.url"
            :alt="t('tools.imageBase64.previewAlt')"
            class="max-w-full max-h-[420px] object-contain rounded-xl border border-slate-200 bg-white"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <span class="chip">
            {{ t('tools.imageBase64.detectFormat') }} {{ decodeResult.mime }}
          </span>
          <span class="chip">{{ decodeSizeLabel }}</span>
          <span v-if="decodeResult.width" class="chip">
            {{ decodeResult.width }} × {{ decodeResult.height }}
          </span>
          <button type="button" class="btn-ghost" @click="downloadDecode">
            {{ t('toolsCommon.download') }}
          </button>
          <button type="button" class="btn-danger" @click="clearDecode">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </template>
    </div>
  </ToolPage>
</template>
