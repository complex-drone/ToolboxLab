<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { readFileAsDataUrl } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()

const file = ref(null) // { name, size, type }
const previewUrl = ref('')
const dims = ref(null) // { width, height }
const parsed = ref(null) // exifr.parse 的原始结果
const loading = ref(false)

function str(v) {
  if (v === null || v === undefined || v === '') return ''
  return String(v).trim()
}

function trimNum(n) {
  return String(Math.round(n * 100) / 100)
}

/* ---------------- 字段计算 ---------------- */
const basicRows = computed(() =>
  [
    { label: t('tools.exifViewer.make'), value: str(parsed.value && parsed.value.Make) },
    { label: t('tools.exifViewer.model'), value: str(parsed.value && parsed.value.Model) },
    { label: t('tools.exifViewer.lens'), value: str(parsed.value && parsed.value.LensModel) },
    { label: t('tools.exifViewer.software'), value: str(parsed.value && parsed.value.Software) },
  ].filter((r) => r.value)
)

const isoValue = computed(() => {
  if (!parsed.value) return ''
  let v = parsed.value.ISO !== undefined ? parsed.value.ISO : parsed.value.ISOSpeedRatings
  if (Array.isArray(v)) v = v[0]
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : ''
})

const fNumberValue = computed(() => {
  const n = Number(parsed.value && parsed.value.FNumber)
  if (!Number.isFinite(n) || n <= 0) return ''
  return 'F' + trimNum(n)
})

const exposureValue = computed(() => {
  const n = Number(parsed.value && parsed.value.ExposureTime)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1) return '1/' + Math.round(1 / n)
  return trimNum(n) + ' s'
})

const focalValue = computed(() => {
  const n = Number(parsed.value && parsed.value.FocalLength)
  if (!Number.isFinite(n) || n <= 0) return ''
  return trimNum(n) + ' mm'
})

const flashValue = computed(() => {
  const n = Number(parsed.value && parsed.value.Flash)
  if (!Number.isFinite(n)) return ''
  // Flash 标志位第 0 位表示是否闪光
  return (n & 1) === 1 ? t('toolsCommon.yes') : t('toolsCommon.no')
})

const captureRows = computed(() =>
  [
    { label: t('tools.exifViewer.iso'), value: isoValue.value },
    { label: t('tools.exifViewer.fNumber'), value: fNumberValue.value },
    { label: t('tools.exifViewer.exposure'), value: exposureValue.value },
    { label: t('tools.exifViewer.focalLength'), value: focalValue.value },
    { label: t('tools.exifViewer.flash'), value: flashValue.value },
  ].filter((r) => r.value)
)

const lat = computed(() => {
  const p = parsed.value
  if (!p) return null
  if (typeof p.latitude === 'number' && Number.isFinite(p.latitude)) return p.latitude
  const v = Number(p.GPSLatitude)
  if (Number.isFinite(v) && v > 0) {
    const ref = String(p.GPSLatitudeRef || '').toUpperCase()
    return ref === 'S' ? -v : v
  }
  return null
})

const lon = computed(() => {
  const p = parsed.value
  if (!p) return null
  if (typeof p.longitude === 'number' && Number.isFinite(p.longitude)) return p.longitude
  const v = Number(p.GPSLongitude)
  if (Number.isFinite(v) && v > 0) {
    const ref = String(p.GPSLongitudeRef || '').toUpperCase()
    return ref === 'W' ? -v : v
  }
  return null
})

const hasGps = computed(() => lat.value !== null && lon.value !== null)

/** 是否有任何可展示的 EXIF 内容（防止只解析出未展示字段时空白） */
const hasVisibleData = computed(
  () => basicRows.value.length > 0 || captureRows.value.length > 0 || hasGps.value
)

const mapUrl = computed(() => {
  if (!hasGps.value) return ''
  return (
    'https://www.openstreetmap.org/?mlat=' +
    lat.value +
    '&mlon=' +
    lon.value +
    '#map=15/' +
    lat.value +
    '/' +
    lon.value
  )
})

/** 十进制经纬度转度分秒 */
function toDms(value, isLat) {
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = Math.round((minFloat - min) * 600) / 10
  return deg + '° ' + min + "' " + sec + '" ' + dir
}

const sizeLabel = computed(() => (file.value ? formatBytes(file.value.size) : ''))

/* ---------------- 文件处理 ---------------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function resetState() {
  file.value = null
  previewUrl.value = ''
  dims.value = null
  parsed.value = null
}

async function onFile(f) {
  if (!f) return
  resetState()
  file.value = { name: f.name || 'image', size: f.size, type: f.type || 'image' }
  loading.value = true

  // 缩略图与尺寸信息（失败不影响 EXIF 解析）
  try {
    const dataUrl = await readFileAsDataUrl(f)
    previewUrl.value = dataUrl
    const img = await loadImage(dataUrl)
    dims.value = { width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    // 预览失败不作为错误处理
  }

  // EXIF 解析：失败或空结果一律按无 EXIF 处理
  try {
    const exifr = await import('exifr')
    const data = await exifr.parse(f, { tiff: true, exif: true, gps: true, ifd0: true })
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      parsed.value = data
    }
  } catch {
    parsed.value = null
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <ToolPage tool-id="exifViewer">
    <!-- 上传 + 缩略图 + 文件信息 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <FileDropZone
        accept="image/*"
        :multiple="false"
        :maxSizeMB="30"
        @files="onFile"
      />

      <div v-if="file" class="mt-4">
        <h2 class="section-title">{{ t('tools.exifViewer.fileInfo') }}</h2>
        <div class="flex flex-col sm:flex-row gap-4 items-start">
          <img
            v-if="previewUrl"
            :src="previewUrl"
            :alt="file.name"
            class="w-full sm:w-48 max-h-56 object-contain rounded-xl border border-slate-200 bg-white"
          />
          <dl class="flex-1 min-w-0 w-full grid gap-1.5 text-sm content-start">
            <div class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.fileName') }}:</dt>
              <dd class="text-slate-700 break-all">{{ file.name }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.fileSize') }}:</dt>
              <dd class="text-slate-700">{{ sizeLabel }}（{{ file.size }} {{ t('toolsCommon.bytes') }}）</dd>
            </div>
            <div class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.fileType') }}:</dt>
              <dd class="text-slate-700 break-all">{{ file.type }}</dd>
            </div>
            <div v-if="dims" class="flex gap-2">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.dimensions') }}:</dt>
              <dd class="text-slate-700">{{ dims.width }} × {{ dims.height }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <!-- EXIF 数据 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div v-if="loading" class="text-sm text-slate-500 text-center py-6">
        {{ t('toolsCommon.processing') }}
      </div>

      <div v-else-if="!file" class="text-sm text-slate-400 text-center py-6">
        {{ t('toolsCommon.none') }}
      </div>

      <!-- 无 EXIF 的友善空状态 -->
      <div v-else-if="!hasVisibleData" class="text-center py-8">
        <div class="mx-auto w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-6 h-6"
            aria-hidden="true"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <p class="text-sm text-slate-500 leading-relaxed max-w-md mx-auto">
          {{ t('tools.exifViewer.noExif') }}
        </p>
      </div>

      <template v-else>
        <template v-if="basicRows.length">
          <h3 class="section-title">{{ t('tools.exifViewer.basicGroup') }}</h3>
          <dl class="grid gap-1.5 text-sm mb-5">
            <div v-for="row in basicRows" :key="row.label" class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ row.label }}:</dt>
              <dd class="text-slate-700 break-all">{{ row.value }}</dd>
            </div>
          </dl>
        </template>

        <template v-if="captureRows.length">
          <h3 class="section-title">{{ t('tools.exifViewer.captureGroup') }}</h3>
          <dl class="grid gap-1.5 text-sm mb-5">
            <div v-for="row in captureRows" :key="row.label" class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ row.label }}:</dt>
              <dd class="text-slate-700 break-all">{{ row.value }}</dd>
            </div>
          </dl>
        </template>

        <template v-if="hasGps">
          <h3 class="section-title">{{ t('tools.exifViewer.gpsGroup') }}</h3>
          <dl class="grid gap-1.5 text-sm">
            <div class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.latLabel') }}:</dt>
              <dd class="text-slate-700 break-all">
                {{ lat.toFixed(6) }}（{{ toDms(lat, true) }}）
              </dd>
            </div>
            <div class="flex gap-2 min-w-0">
              <dt class="text-slate-400 shrink-0">{{ t('tools.exifViewer.lonLabel') }}:</dt>
              <dd class="text-slate-700 break-all">
                {{ lon.toFixed(6) }}（{{ toDms(lon, false) }}）
              </dd>
            </div>
          </dl>
          <a
            :href="mapUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2"
          >
            {{ t('tools.exifViewer.viewOnMap') }}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </template>
      </template>
    </div>
  </ToolPage>
</template>
