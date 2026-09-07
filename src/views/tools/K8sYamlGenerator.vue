<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import yaml from 'js-yaml'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * Kubernetes YAML 生成器
 * - 资源类型 Tab：Deployment / Service / Ingress / ConfigMap / Secret
 * - 表单按资源类型分别持久化；名称做 k8s 命名规范行内校验
 * - 实时生成 YAML（js-yaml dump），复制 + 下载 .yaml
 */
const { t } = useI18n()
const toast = useToast()

/* ---------------- 常量 ---------------- */

const RESOURCE_TABS = [
  { id: 'deployment', labelKey: 'tabDeployment' },
  { id: 'service', labelKey: 'tabService' },
  { id: 'ingress', labelKey: 'tabIngress' },
  { id: 'configmap', labelKey: 'tabConfigMap' },
  { id: 'secret', labelKey: 'tabSecret' },
]

const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

let uidSeed = 0
function nextId() {
  uidSeed += 1
  return 'k' + Date.now().toString(36) + '-' + uidSeed.toString(36)
}

function makePair(key = '', value = '') {
  return { id: nextId(), key, value }
}

function makePort() {
  return { id: nextId(), name: '', port: '80', targetPort: '80', nodePort: '', protocol: 'TCP' }
}

function makePath() {
  return { id: nextId(), path: '/', serviceName: '', servicePort: '80' }
}

/* ---------------- 持久化（按资源类型分别保存） ---------------- */

const config = useStorage(
  'tool-k8s-yaml-generator',
  {
    activeTab: 'deployment',
    deployment: {
      name: 'my-app',
      namespace: 'default',
      image: 'nginx:1.27-alpine',
      containerPort: '80',
      replicas: '2',
      env: [],
      labels: [makePair('app', 'my-app')],
      cpuLimit: '500m',
      memLimit: '256Mi',
      cpuRequest: '100m',
      memRequest: '128Mi',
    },
    service: {
      name: 'my-app-svc',
      namespace: 'default',
      serviceType: 'ClusterIP',
      clusterIP: '',
      labels: [],
      ports: [makePort()],
    },
    ingress: {
      name: 'my-app-ingress',
      namespace: 'default',
      host: 'app.example.com',
      labels: [],
      paths: [makePath()],
    },
    configMap: {
      name: 'app-config',
      namespace: 'default',
      labels: [],
      data: [makePair('LOG_LEVEL', 'info')],
    },
    secret: {
      name: 'app-secret',
      namespace: 'default',
      labels: [],
      base64Enabled: false,
      data: [makePair('API_KEY', 'change-me')],
    },
  },
  undefined,
  { mergeDefaults: true },
)

/* ---------------- 校验工具 ---------------- */

function isK8sName(v) {
  return K8S_NAME_RE.test(String(v || '').trim())
}

/** 名称非空但不合规时标红 */
function isNameInvalidFor(tab) {
  const f = config.value[tab]
  const n = String((f && f.name) || '').trim()
  return n !== '' && !K8S_NAME_RE.test(n)
}

/** 空值视为合法（可选字段），非空必须是 1-65535 的整数 */
function isPortEmpty(v) {
  return String(v == null ? '' : v).trim() === ''
}

function toPort(v) {
  const n = Number(String(v == null ? '' : v).trim())
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

function isPortInvalid(v) {
  return !isPortEmpty(v) && toPort(v) === null
}

function cleanMap(rows) {
  const out = {}
  for (const r of rows || []) {
    const k = String((r && r.key) || '').trim()
    if (k) out[k] = String((r && r.value) == null ? '' : (r && r.value)).trim()
  }
  return out
}

/** 行内校验：键非空时值非法与否无关，仅要求键非空即计入 */
function hasAnyPair(rows) {
  return (rows || []).some((r) => String((r && r.key) || '').trim() !== '')
}

function assert(cond, key) {
  if (!cond) throw new Error('k8s:' + key)
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(String(str))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/* ---------------- 生成 ---------------- */

function metaOf(f) {
  const metadata = { name: String(f.name || '').trim() }
  const ns = String(f.namespace || '').trim()
  if (ns) metadata.namespace = ns
  const labels = cleanMap(f.labels)
  if (Object.keys(labels).length) metadata.labels = labels
  return metadata
}

function buildDeployment() {
  const f = config.value.deployment
  assert(String(f.name || '').trim() !== '', 'nameRequired')
  assert(isK8sName(f.name), 'nameInvalid')
  assert(String(f.image || '').trim() !== '', 'imageRequired')

  const labels = cleanMap(f.labels)
  const tplLabels = Object.keys(labels).length ? labels : { app: String(f.name).trim() }

  const container = { name: String(f.name).trim(), image: String(f.image).trim() }
  if (!isPortEmpty(f.containerPort)) {
    const cp = toPort(f.containerPort)
    assert(cp !== null, 'portInvalid')
    container.ports = [{ containerPort: cp }]
  }
  const envList = (f.env || [])
    .filter((e) => String(e.key || '').trim() !== '')
    .map((e) => ({ name: String(e.key).trim(), value: String(e.value == null ? '' : e.value) }))
  if (envList.length) container.env = envList

  const limits = {}
  const requests = {}
  if (String(f.cpuLimit || '').trim()) limits.cpu = String(f.cpuLimit).trim()
  if (String(f.memLimit || '').trim()) limits.memory = String(f.memLimit).trim()
  if (String(f.cpuRequest || '').trim()) requests.cpu = String(f.cpuRequest).trim()
  if (String(f.memRequest || '').trim()) requests.memory = String(f.memRequest).trim()
  const resources = {}
  if (Object.keys(limits).length) resources.limits = limits
  if (Object.keys(requests).length) resources.requests = requests
  if (Object.keys(resources).length) container.resources = resources

  const parsedReplicas = parseInt(f.replicas, 10)
  const replicas = Number.isInteger(parsedReplicas) && parsedReplicas >= 0 ? parsedReplicas : 1

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metaOf(f),
    spec: {
      replicas,
      selector: { matchLabels: tplLabels },
      template: {
        metadata: { labels: tplLabels },
        spec: { containers: [container] },
      },
    },
  }
}

function buildService() {
  const f = config.value.service
  assert(String(f.name || '').trim() !== '', 'nameRequired')
  assert(isK8sName(f.name), 'nameInvalid')
  const validPorts = (f.ports || []).filter((p) => toPort(p.port) !== null && String(p.targetPort || '').trim() !== '')
  assert(validPorts.length > 0, 'portsRequired')

  const spec = { type: f.serviceType === 'NodePort' ? 'NodePort' : 'ClusterIP' }
  if (spec.type === 'ClusterIP' && String(f.clusterIP || '').trim() !== '') {
    spec.clusterIP = String(f.clusterIP).trim()
  }
  const selector = cleanMap(f.labels)
  if (Object.keys(selector).length) spec.selector = selector

  spec.ports = validPorts.map((p) => {
    const port = { port: toPort(p.port) }
    const name = String(p.name || '').trim()
    if (name) port.name = name
    const rawTarget = String(p.targetPort || '').trim()
    const targetNum = toPort(rawTarget)
    port.targetPort = targetNum !== null ? targetNum : rawTarget
    const np = toPort(p.nodePort)
    if (spec.type === 'NodePort' && np !== null) port.nodePort = np
    port.protocol = p.protocol === 'UDP' ? 'UDP' : p.protocol === 'SCTP' ? 'SCTP' : 'TCP'
    return port
  })

  return { apiVersion: 'v1', kind: 'Service', metadata: metaOf(f), spec }
}

function buildIngress() {
  const f = config.value.ingress
  assert(String(f.name || '').trim() !== '', 'nameRequired')
  assert(isK8sName(f.name), 'nameInvalid')
  const validPaths = (f.paths || []).filter(
    (p) => String(p.serviceName || '').trim() !== '' && toPort(p.servicePort) !== null,
  )
  assert(validPaths.length > 0, 'pathsRequired')

  const rule = {}
  const host = String(f.host || '').trim()
  if (host) rule.host = host
  rule.http = {
    paths: validPaths.map((p) => ({
      path: String(p.path || '').trim() || '/',
      pathType: 'Prefix',
      backend: {
        service: {
          name: String(p.serviceName).trim(),
          port: { number: toPort(p.servicePort) },
        },
      },
    })),
  }

  return { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: metaOf(f), spec: { rules: [rule] } }
}

function buildConfigMap() {
  const f = config.value.configMap
  assert(String(f.name || '').trim() !== '', 'nameRequired')
  assert(isK8sName(f.name), 'nameInvalid')
  const data = cleanMap(f.data)
  assert(Object.keys(data).length > 0, 'dataRequired')
  return { apiVersion: 'v1', kind: 'ConfigMap', metadata: metaOf(f), data }
}

function buildSecret() {
  const f = config.value.secret
  assert(String(f.name || '').trim() !== '', 'nameRequired')
  assert(isK8sName(f.name), 'nameInvalid')
  assert(hasAnyPair(f.data), 'dataRequired')
  const entries = (f.data || [])
    .filter((d) => String(d.key || '').trim() !== '')
    .map((d) => [String(d.key).trim(), String(d.value == null ? '' : d.value)])
  const dataField = f.base64Enabled ? 'data' : 'stringData'
  const data = {}
  for (const [k, v] of entries) data[k] = f.base64Enabled ? toBase64(v) : v
  return { apiVersion: 'v1', kind: 'Secret', metadata: metaOf(f), type: 'Opaque', [dataField]: data }
}

const BUILDERS = {
  deployment: buildDeployment,
  service: buildService,
  ingress: buildIngress,
  configmap: buildConfigMap,
  secret: buildSecret,
}

/** 实时预览：生成失败时返回行内错误说明 */
const preview = computed(() => {
  try {
    const build = BUILDERS[config.value.activeTab] || buildDeployment
    const text = yaml.dump(build(), { indent: 2, noRefs: true, lineWidth: -1 })
    return { text, error: '' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.startsWith('k8s:')) {
      return { text: '', error: t('tools.k8sYamlGenerator.' + msg.slice(4)) }
    }
    return { text: '', error: t('toolsCommon.error') }
  }
})

/* ---------------- 行增删 ---------------- */

function currentForm() {
  return config.value[config.value.activeTab]
}

/** 当前资源类型的标签行（供模板渲染） */
const currentFormLabels = computed(() => currentForm().labels || [])

function addPairRow(listKey, make) {
  const f = currentForm()
  f[listKey] = [...(f[listKey] || []), make()]
}

function removePairRow(listKey, id) {
  const f = currentForm()
  f[listKey] = (f[listKey] || []).filter((r) => r.id !== id)
}

const addEnvRow = () => addPairRow('env', () => makePair())
const removeEnvRow = (id) => removePairRow('env', id)
const addLabelRow = () => addPairRow('labels', () => makePair())
const removeLabelRow = (id) => removePairRow('labels', id)
const addDataRow = () => addPairRow('data', () => makePair())
const removeDataRow = (id) => removePairRow('data', id)
const addPortRow = () => addPairRow('ports', () => makePort())
const removePortRow = (id) => removePairRow('ports', id)
const addPathRow = () => addPairRow('paths', () => makePath())
const removePathRow = (id) => removePairRow('paths', id)

/* ---------------- 下载 ---------------- */

function downloadYaml() {
  try {
    if (!preview.value.text) return
    const f = currentForm()
    const rawName = String(f.name || '').trim()
    const base = isK8sName(rawName) ? rawName : config.value.activeTab
    downloadText(preview.value.text, base + '.yaml', 'text/yaml;charset=utf-8')
    toast.success(t('tools.k8sYamlGenerator.downloadDone'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="k8sYamlGenerator">
    <!-- 资源类型 Tab + 表单 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.k8sYamlGenerator.tabsTitle') }}</h2>
      <div class="flex flex-wrap gap-2 mb-5" role="tablist" :aria-label="t('tools.k8sYamlGenerator.tabsTitle')">
        <button
          v-for="tab in RESOURCE_TABS"
          :key="tab.id"
          type="button"
          role="tab"
          class="px-3.5 py-1.5 rounded-xl text-sm font-medium border transition select-none"
          :class="
            config.activeTab === tab.id
              ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
              : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="config.activeTab === tab.id ? 'true' : 'false'"
          @click="config.activeTab = tab.id"
        >
          {{ t('tools.k8sYamlGenerator.' + tab.labelKey) }}
        </button>
      </div>

      <!-- Deployment 表单 -->
      <div v-if="config.activeTab === 'deployment'">
        <h3 class="text-sm font-semibold text-slate-600 mb-3">{{ t('tools.k8sYamlGenerator.basicTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="k8s-dep-name">{{ t('tools.k8sYamlGenerator.nameLabel') }}</label>
            <input
              id="k8s-dep-name"
              v-model="config.deployment.name"
              type="text"
              class="input-base font-mono"
              :class="isNameInvalidFor('deployment') ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.namePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isNameInvalidFor('deployment')" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.nameInvalid') }}
            </p>
          </div>
          <div>
            <label class="label-base" for="k8s-dep-ns">{{ t('tools.k8sYamlGenerator.namespaceLabel') }}</label>
            <input
              id="k8s-dep-ns"
              v-model="config.deployment.namespace"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.namespacePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label-base" for="k8s-dep-image">{{ t('tools.k8sYamlGenerator.imageLabel') }}</label>
            <input
              id="k8s-dep-image"
              v-model="config.deployment.image"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.imagePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div>
            <label class="label-base" for="k8s-dep-port">{{ t('tools.k8sYamlGenerator.portLabel') }}</label>
            <input
              id="k8s-dep-port"
              v-model="config.deployment.containerPort"
              type="text"
              inputmode="numeric"
              class="input-base font-mono"
              :class="isPortInvalid(config.deployment.containerPort) ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.portPlaceholder')"
              autocomplete="off"
            />
            <p v-if="isPortInvalid(config.deployment.containerPort)" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.portInvalid') }}
            </p>
          </div>
          <div>
            <label class="label-base" for="k8s-dep-replicas">{{ t('tools.k8sYamlGenerator.replicasLabel') }}</label>
            <input
              id="k8s-dep-replicas"
              v-model="config.deployment.replicas"
              type="number"
              min="0"
              step="1"
              class="input-base"
              autocomplete="off"
            />
          </div>
        </div>

        <!-- 环境变量 -->
        <div class="mt-5">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.envTitle') }}</h3>
            <button type="button" class="btn-ghost" @click="addEnvRow">
              + {{ t('tools.k8sYamlGenerator.addEnv') }}
            </button>
          </div>
          <div class="space-y-2">
            <div v-for="row in config.deployment.env" :key="row.id" class="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                v-model="row.key"
                type="text"
                class="input-base font-mono w-full sm:w-44 shrink-0"
                :placeholder="t('tools.k8sYamlGenerator.envKeyPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-model="row.value"
                type="text"
                class="input-base font-mono w-full sm:flex-1"
                :placeholder="t('tools.k8sYamlGenerator.envValuePlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="btn-ghost shrink-0"
                :aria-label="t('tools.k8sYamlGenerator.deleteRow')"
                @click="removeEnvRow(row.id)"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 资源限制 -->
        <div class="mt-5">
          <h3 class="section-title">{{ t('tools.k8sYamlGenerator.resTitle') }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label class="label-base" for="k8s-dep-cpul">{{ t('tools.k8sYamlGenerator.cpuLimitLabel') }}</label>
              <input
                id="k8s-dep-cpul"
                v-model="config.deployment.cpuLimit"
                type="text"
                class="input-base font-mono"
                :placeholder="t('tools.k8sYamlGenerator.cpuLimitPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <div>
              <label class="label-base" for="k8s-dep-meml">{{ t('tools.k8sYamlGenerator.memLimitLabel') }}</label>
              <input
                id="k8s-dep-meml"
                v-model="config.deployment.memLimit"
                type="text"
                class="input-base font-mono"
                :placeholder="t('tools.k8sYamlGenerator.memLimitPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <div>
              <label class="label-base" for="k8s-dep-cpur">{{ t('tools.k8sYamlGenerator.cpuRequestLabel') }}</label>
              <input
                id="k8s-dep-cpur"
                v-model="config.deployment.cpuRequest"
                type="text"
                class="input-base font-mono"
                :placeholder="t('tools.k8sYamlGenerator.cpuRequestPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <div>
              <label class="label-base" for="k8s-dep-memr">{{ t('tools.k8sYamlGenerator.memRequestLabel') }}</label>
              <input
                id="k8s-dep-memr"
                v-model="config.deployment.memRequest"
                type="text"
                class="input-base font-mono"
                :placeholder="t('tools.k8sYamlGenerator.memRequestPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Service 表单 -->
      <div v-else-if="config.activeTab === 'service'">
        <h3 class="text-sm font-semibold text-slate-600 mb-3">{{ t('tools.k8sYamlGenerator.basicTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="k8s-svc-name">{{ t('tools.k8sYamlGenerator.nameLabel') }}</label>
            <input
              id="k8s-svc-name"
              v-model="config.service.name"
              type="text"
              class="input-base font-mono"
              :class="isNameInvalidFor('service') ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.namePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isNameInvalidFor('service')" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.nameInvalid') }}
            </p>
          </div>
          <div>
            <label class="label-base" for="k8s-svc-ns">{{ t('tools.k8sYamlGenerator.namespaceLabel') }}</label>
            <input
              id="k8s-svc-ns"
              v-model="config.service.namespace"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.namespacePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div>
            <label class="label-base" for="k8s-svc-type">{{ t('tools.k8sYamlGenerator.svcTypeLabel') }}</label>
            <select id="k8s-svc-type" v-model="config.service.serviceType" class="input-base">
              <option value="ClusterIP">{{ t('tools.k8sYamlGenerator.svcTypeClusterIP') }}</option>
              <option value="NodePort">{{ t('tools.k8sYamlGenerator.svcTypeNodePort') }}</option>
            </select>
          </div>
          <div v-if="config.service.serviceType === 'ClusterIP'">
            <label class="label-base" for="k8s-svc-ip">{{ t('tools.k8sYamlGenerator.clusterIPLabel') }}</label>
            <input
              id="k8s-svc-ip"
              v-model="config.service.clusterIP"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.clusterIPPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <!-- 端口映射 -->
        <div class="mt-5">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.portsTitle') }}</h3>
            <button type="button" class="btn-ghost" @click="addPortRow">
              + {{ t('tools.k8sYamlGenerator.addPort') }}
            </button>
          </div>
          <div class="space-y-2">
            <div v-for="row in config.service.ports" :key="row.id" class="flex flex-wrap items-center gap-2">
              <input
                v-model="row.name"
                type="text"
                class="input-base font-mono w-full sm:w-32 shrink-0"
                :placeholder="t('tools.k8sYamlGenerator.portNamePlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-model="row.port"
                type="text"
                inputmode="numeric"
                class="input-base font-mono w-24 shrink-0"
                :class="isPortInvalid(row.port) ? 'border-rose-400 focus:border-rose-400' : ''"
                :placeholder="t('tools.k8sYamlGenerator.svcPortLabel')"
                :aria-label="t('tools.k8sYamlGenerator.svcPortLabel')"
                autocomplete="off"
              />
              <input
                v-model="row.targetPort"
                type="text"
                class="input-base font-mono w-28 shrink-0"
                :placeholder="t('tools.k8sYamlGenerator.targetPortLabel')"
                :aria-label="t('tools.k8sYamlGenerator.targetPortLabel')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-if="config.service.serviceType === 'NodePort'"
                v-model="row.nodePort"
                type="text"
                inputmode="numeric"
                class="input-base font-mono w-28 shrink-0"
                :class="isPortInvalid(row.nodePort) ? 'border-rose-400 focus:border-rose-400' : ''"
                :placeholder="t('tools.k8sYamlGenerator.nodePortLabel')"
                :aria-label="t('tools.k8sYamlGenerator.nodePortLabel')"
                autocomplete="off"
              />
              <select
                v-model="row.protocol"
                class="input-base w-24 shrink-0"
                :aria-label="t('tools.k8sYamlGenerator.protocolLabel')"
              >
                <option value="TCP">{{ t('tools.k8sYamlGenerator.protoTcp') }}</option>
                <option value="UDP">{{ t('tools.k8sYamlGenerator.protoUdp') }}</option>
                <option value="SCTP">{{ t('tools.k8sYamlGenerator.protoSctp') }}</option>
              </select>
              <button
                type="button"
                class="btn-ghost shrink-0"
                :aria-label="t('tools.k8sYamlGenerator.deleteRow')"
                @click="removePortRow(row.id)"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Ingress 表单 -->
      <div v-else-if="config.activeTab === 'ingress'">
        <h3 class="text-sm font-semibold text-slate-600 mb-3">{{ t('tools.k8sYamlGenerator.basicTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="label-base" for="k8s-ing-name">{{ t('tools.k8sYamlGenerator.nameLabel') }}</label>
            <input
              id="k8s-ing-name"
              v-model="config.ingress.name"
              type="text"
              class="input-base font-mono"
              :class="isNameInvalidFor('ingress') ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.namePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isNameInvalidFor('ingress')" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.nameInvalid') }}
            </p>
          </div>
          <div>
            <label class="label-base" for="k8s-ing-ns">{{ t('tools.k8sYamlGenerator.namespaceLabel') }}</label>
            <input
              id="k8s-ing-ns"
              v-model="config.ingress.namespace"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.namespacePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="label-base" for="k8s-ing-host">{{ t('tools.k8sYamlGenerator.hostLabel') }}</label>
            <input
              id="k8s-ing-host"
              v-model="config.ingress.host"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.hostPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <!-- 路径映射 -->
        <div class="mt-5">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.pathsTitle') }}</h3>
            <button type="button" class="btn-ghost" @click="addPathRow">
              + {{ t('tools.k8sYamlGenerator.addPath') }}
            </button>
          </div>
          <div class="space-y-2">
            <div v-for="row in config.ingress.paths" :key="row.id" class="flex flex-wrap items-center gap-2">
              <input
                v-model="row.path"
                type="text"
                class="input-base font-mono w-full sm:w-36 shrink-0"
                :placeholder="t('tools.k8sYamlGenerator.pathPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-model="row.serviceName"
                type="text"
                class="input-base font-mono w-full sm:flex-1 sm:min-w-[160px]"
                :placeholder="t('tools.k8sYamlGenerator.backendNamePlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-model="row.servicePort"
                type="text"
                inputmode="numeric"
                class="input-base font-mono w-28 shrink-0"
                :class="isPortInvalid(row.servicePort) ? 'border-rose-400 focus:border-rose-400' : ''"
                :placeholder="t('tools.k8sYamlGenerator.backendPortPlaceholder')"
                :aria-label="t('tools.k8sYamlGenerator.backendPortPlaceholder')"
                autocomplete="off"
              />
              <button
                type="button"
                class="btn-ghost shrink-0"
                :aria-label="t('tools.k8sYamlGenerator.deleteRow')"
                @click="removePathRow(row.id)"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ConfigMap / Secret 表单 -->
      <div v-else>
        <h3 class="text-sm font-semibold text-slate-600 mb-3">{{ t('tools.k8sYamlGenerator.basicTitle') }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <div v-if="config.activeTab === 'secret'">
            <label class="label-base" for="k8s-secret-name">{{ t('tools.k8sYamlGenerator.nameLabel') }} (Secret)</label>
            <input
              id="k8s-secret-name"
              v-model="config.secret.name"
              type="text"
              class="input-base font-mono"
              :class="isNameInvalidFor('secret') ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.namePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isNameInvalidFor('secret')" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.nameInvalid') }}
            </p>
          </div>
          <div v-else>
            <label class="label-base" for="k8s-cm-name">{{ t('tools.k8sYamlGenerator.nameLabel') }} (ConfigMap)</label>
            <input
              id="k8s-cm-name"
              v-model="config.configMap.name"
              type="text"
              class="input-base font-mono"
              :class="isNameInvalidFor('configmap') ? 'border-rose-400 focus:border-rose-400' : ''"
              :placeholder="t('tools.k8sYamlGenerator.namePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <p v-if="isNameInvalidFor('configmap')" class="mt-1 text-xs text-rose-500">
              {{ t('tools.k8sYamlGenerator.nameInvalid') }}
            </p>
          </div>
          <div v-if="config.activeTab === 'secret'">
            <label class="label-base" for="k8s-secret-ns">{{ t('tools.k8sYamlGenerator.namespaceLabel') }}</label>
            <input
              id="k8s-secret-ns"
              v-model="config.secret.namespace"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.namespacePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div v-else>
            <label class="label-base" for="k8s-cm-ns">{{ t('tools.k8sYamlGenerator.namespaceLabel') }}</label>
            <input
              id="k8s-cm-ns"
              v-model="config.configMap.namespace"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.k8sYamlGenerator.namespacePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <!-- Secret Base64 开关 -->
        <div v-if="config.activeTab === 'secret'" class="mt-4">
          <label class="inline-flex items-center gap-2 cursor-pointer select-none">
            <input v-model="config.secret.base64Enabled" type="checkbox" class="h-4 w-4 accent-blue-600" />
            <span class="text-sm text-slate-600">{{ t('tools.k8sYamlGenerator.base64Toggle') }}</span>
          </label>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">
            {{ t('tools.k8sYamlGenerator.base64Hint') }}
          </p>
        </div>

        <!-- 键值数据 -->
        <div class="mt-4">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <h3 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.dataTitle') }}</h3>
            <button type="button" class="btn-ghost" @click="addDataRow">
              + {{ t('tools.k8sYamlGenerator.addData') }}
            </button>
          </div>
          <div class="space-y-2">
            <div
              v-for="row in config.activeTab === 'secret' ? config.secret.data : config.configMap.data"
              :key="row.id"
              class="flex flex-wrap sm:flex-nowrap items-center gap-2"
            >
              <input
                v-model="row.key"
                type="text"
                class="input-base font-mono w-full sm:w-44 shrink-0"
                :placeholder="t('tools.k8sYamlGenerator.dataKeyPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <input
                v-model="row.value"
                type="text"
                class="input-base font-mono w-full sm:flex-1"
                :placeholder="t('tools.k8sYamlGenerator.dataValuePlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="btn-ghost shrink-0"
                :aria-label="t('tools.k8sYamlGenerator.deleteRow')"
                @click="removeDataRow(row.id)"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 标签（Deployment / Service / Ingress / ConfigMap / Secret 共用结构） -->
      <div class="mt-5">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h3 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.labelsTitle') }}</h3>
          <button type="button" class="btn-ghost" @click="addLabelRow">
            + {{ t('tools.k8sYamlGenerator.addLabel') }}
          </button>
        </div>
        <div class="space-y-2">
          <div v-for="row in currentFormLabels" :key="row.id" class="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input
              v-model="row.key"
              type="text"
              class="input-base font-mono w-full sm:w-44 shrink-0"
              :placeholder="t('tools.k8sYamlGenerator.labelKeyPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <input
              v-model="row.value"
              type="text"
              class="input-base font-mono w-full sm:flex-1"
              :placeholder="t('tools.k8sYamlGenerator.labelValuePlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="btn-ghost shrink-0"
              :aria-label="t('tools.k8sYamlGenerator.deleteRow')"
              @click="removeLabelRow(row.id)"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 实时预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title flex-1 mb-0">{{ t('tools.k8sYamlGenerator.previewTitle') }}</h2>
        <CopyButton :text="preview.text" :label="t('toolsCommon.copy')" :disabled="!preview.text" />
        <button type="button" class="btn-primary" :disabled="!preview.text" @click="downloadYaml">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('tools.k8sYamlGenerator.downloadName') }}
        </button>
      </div>

      <pre
        v-if="preview.text"
        class="font-mono text-xs sm:text-sm leading-relaxed bg-slate-800/95 text-slate-100 rounded-xl px-4 py-3 overflow-auto max-h-[480px]"
        tabindex="0"
      >{{ preview.text }}</pre>
      <div
        v-else
        class="rounded-xl border border-dashed px-4 py-10 text-center text-sm"
        :class="preview.error ? 'border-amber-300 text-amber-600' : 'border-slate-300 text-slate-400'"
        role="alert"
      >
        {{ preview.error || t('tools.k8sYamlGenerator.emptyPreview') }}
      </div>
    </section>
  </ToolPage>
</template>
