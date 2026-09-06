<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * 简历生成器：表单数据全部持久化，右侧 A4 比例实时预览
 * 支持两套模板、window.print 导出 PDF（@media print 只打印预览区）与独立 HTML 下载
 */

const emptyResume = () => ({
  name: '',
  phone: '',
  email: '',
  city: '',
  intention: '',
  website: '',
  summary: '',
  education: [],
  work: [],
  skills: '',
})

const resume = useStorage('tool-resume-builder-data', emptyResume())
const templateId = useStorage('tool-resume-builder-template', 'simple')

const { t, locale } = useI18n()
const toast = useToast()

// 历史数据兜底：确保数组与字符串字段结构完整
if (!Array.isArray(resume.value.education)) resume.value.education = []
if (!Array.isArray(resume.value.work)) resume.value.work = []
if (typeof resume.value.skills !== 'string') resume.value.skills = ''

const TEMPLATES = [
  { id: 'simple', name: 'Simple' },
  { id: 'pro', name: 'Pro' },
]

const skillsList = computed(() =>
  String(resume.value.skills || '')
    .split(/[,，、;；]/)
    .map(s => s.trim())
    .filter(Boolean)
)

const hasAnyData = computed(() => {
  const r = resume.value
  const hasText = field => Boolean(String(field || '').trim())
  return Boolean(
    hasText(r.name) ||
      hasText(r.phone) ||
      hasText(r.email) ||
      hasText(r.city) ||
      hasText(r.intention) ||
      hasText(r.website) ||
      hasText(r.summary) ||
      (Array.isArray(r.education) && r.education.length > 0) ||
      (Array.isArray(r.work) && r.work.length > 0) ||
      skillsList.value.length > 0
  )
})

const contactItems = computed(() =>
  [
    { label: t('tools.resumeBuilder.phoneLabel'), value: String(resume.value.phone || '').trim() },
    { label: t('tools.resumeBuilder.emailLabel'), value: String(resume.value.email || '').trim() },
    { label: t('tools.resumeBuilder.cityLabel'), value: String(resume.value.city || '').trim() },
    { label: t('tools.resumeBuilder.websiteLabel'), value: String(resume.value.website || '').trim() },
  ].filter(item => item.value)
)

const contactLine = computed(() =>
  contactItems.value.map(item => `${item.label} ${item.value}`).join(' · ')
)

/* ---------- 条目增删 ---------- */
function addEducation() {
  resume.value.education.push({ school: '', major: '', degree: '', period: '' })
}
function removeEducation(index) {
  resume.value.education.splice(index, 1)
}
function addWork() {
  resume.value.work.push({ company: '', position: '', period: '', desc: '' })
}
function removeWork(index) {
  resume.value.work.splice(index, 1)
}
function removeSkill(index) {
  resume.value.skills = skillsList.value.filter((_, i) => i !== index).join(', ')
}

/* ---------- 一键清空（二次确认按钮模式） ---------- */
const confirmingClear = ref(false)
let clearTimer = null
function onClearClick() {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    clearTimer = setTimeout(() => {
      confirmingClear.value = false
      clearTimer = null
    }, 3000)
    return
  }
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  confirmingClear.value = false
  resume.value = emptyResume()
  toast.success(t('tools.resumeBuilder.cleared'))
}

/* ---------- 打印 / 导出 PDF ---------- */
function printResume() {
  try {
    window.print()
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------- 独立 HTML 导出 ---------- */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function nl2br(value) {
  return esc(value).replace(/\r?\n/g, '<br />')
}

function buildHtmlDoc() {
  const r = resume.value
  const isPro = templateId.value === 'pro'
  const docTitle = String(r.name || '').trim()
    ? `${String(r.name).trim()} - ${t('tools.resumeBuilder.htmlDocTitle')}`
    : t('tools.resumeBuilder.htmlDocTitle')
  const skills = skillsList.value

  const eduHtml = (r.education || [])
    .map(
      item => `
        <div class="row">
          <div class="row-main">
            <p class="strong">${esc(item.school)}</p>
            <p class="sub">${esc([item.major, item.degree].filter(Boolean).join(' · '))}</p>
          </div>
          <span class="period">${esc(item.period)}</span>
        </div>`
    )
    .join('')

  const workHtml = (r.work || [])
    .map(
      item => `
        <div class="entry">
          <div class="row">
            <div class="row-main">
              <p class="strong">${esc([item.company, item.position].filter(Boolean).join(' · '))}</p>
            </div>
            <span class="period">${esc(item.period)}</span>
          </div>
          ${item.desc ? `<p class="sub">${nl2br(item.desc)}</p>` : ''}
        </div>`
    )
    .join('')

  const section = (title, inner) =>
    inner ? `<section><h2>${esc(title)}</h2>${inner}</section>` : ''
  const summaryHtml = String(r.summary || '').trim()
    ? `<p class="sub">${nl2br(r.summary)}</p>`
    : ''
  const skillsHtml = skills.length
    ? `<p class="sub">${esc(skills.join(' · '))}</p>`
    : ''

  const css = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b;background:#f1f5f9;padding:24px}.sheet{max-width:794px;margin:0 auto;background:#fff;min-height:1123px;box-shadow:0 8px 30px rgba(15,23,42,.12)}h1{font-size:26px;color:#0f172a}h2{font-size:14px;font-weight:700;color:#0f172a;padding-bottom:4px;margin:20px 0 10px}.sub{font-size:12.5px;line-height:1.7;color:#334155;white-space:pre-wrap}.strong{font-size:13.5px;font-weight:600;color:#0f172a}.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px}.row-main{min-width:0}.period{flex-shrink:0;font-size:11px;color:#64748b;white-space:nowrap}.entry{margin-bottom:12px}.intent{font-size:13px;color:#475569;margin-top:4px}.simple{padding:48px}.simple header{text-align:center;border-bottom:2px solid #0f172a;padding-bottom:14px}.simple .contact{font-size:11.5px;color:#64748b;margin-top:8px}.simple section h2{border-bottom:1.5px solid #0f172a}.pro-wrap{padding:0}.pro{display:flex;min-height:1123px}.pro aside{width:34%;background:#1e293b;color:#f8fafc;padding:40px 26px}.pro aside h1{color:#fff;font-size:22px}.pro aside .intent{color:#93c5fd;font-size:12px;margin-top:6px}.pro aside .contact{margin-top:26px}.pro aside .contact p{font-size:12px;line-height:1.9;color:#e2e8f0;word-break:break-all}.pro aside h2{color:#fff;font-size:13px;border-bottom:1px solid rgba(255,255,255,.3);margin-top:26px}.pro aside ul{list-style:none}.pro aside li{font-size:12px;line-height:2;color:#e2e8f0}.pro main{flex:1;padding:40px 32px;min-width:0}.pro main section h2{border-bottom:1.5px solid #0f172a}`

  const body = isPro
    ? `<div class="sheet pro-wrap"><div class="pro">
        <aside>
          <h1>${esc(r.name)}</h1>
          ${r.intention ? `<p class="intent">${esc(r.intention)}</p>` : ''}
          <div class="contact">${contactItems.value
            .map(item => `<p>${esc(item.label)}: ${esc(item.value)}</p>`)
            .join('')}</div>
          ${skills.length
            ? `<h2>${esc(t('tools.resumeBuilder.secSkills'))}</h2><ul>${skills
                .map(s => `<li>${esc(s)}</li>`)
                .join('')}</ul>`
            : ''}
        </aside>
        <main>
          ${section(t('tools.resumeBuilder.secSummary'), summaryHtml)}
          ${section(t('tools.resumeBuilder.secEducation'), eduHtml)}
          ${section(t('tools.resumeBuilder.secWork'), workHtml)}
        </main>
      </div></div>`
    : `<div class="sheet simple">
        <header>
          <h1>${esc(r.name)}</h1>
          ${r.intention ? `<p class="intent">${esc(r.intention)}</p>` : ''}
          <p class="contact">${esc(contactLine.value)}</p>
        </header>
        ${section(t('tools.resumeBuilder.secSummary'), summaryHtml)}
        ${section(t('tools.resumeBuilder.secEducation'), eduHtml)}
        ${section(t('tools.resumeBuilder.secWork'), workHtml)}
        ${section(t('tools.resumeBuilder.secSkills'), skillsHtml)}
      </div>`

  return `<!DOCTYPE html>
<html lang="${esc(locale.value)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(docTitle)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`
}

function exportHtml() {
  try {
    const base =
      String(resume.value.name || '')
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '') || 'resume'
    downloadText(buildHtmlDoc(), `${base}.html`, 'text/html;charset=utf-8')
    toast.success(t('tools.resumeBuilder.exported'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

onBeforeUnmount(() => {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
})
</script>

<template>
  <ToolPage tool-id="resumeBuilder">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <!-- 表单区 -->
      <div class="resume-form-col">
        <!-- 基本信息 + 简介 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="section-title mb-0">{{ t('tools.resumeBuilder.basicsTitle') }}</h2>
            <button type="button" class="btn-danger" @click="onClearClick">
              {{ confirmingClear ? t('tools.resumeBuilder.confirmClear') : t('toolsCommon.clear') }}
            </button>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="label-base" for="rb-name">{{ t('tools.resumeBuilder.nameLabel') }}</label>
              <input
                id="rb-name"
                v-model="resume.name"
                class="input-base"
                :placeholder="t('tools.resumeBuilder.namePlaceholder')"
              />
            </div>
            <div>
              <label class="label-base" for="rb-phone">{{ t('tools.resumeBuilder.phoneLabel') }}</label>
              <input id="rb-phone" v-model="resume.phone" class="input-base" />
            </div>
            <div>
              <label class="label-base" for="rb-email">{{ t('tools.resumeBuilder.emailLabel') }}</label>
              <input
                id="rb-email"
                v-model="resume.email"
                class="input-base"
                :placeholder="t('tools.resumeBuilder.emailPlaceholder')"
              />
            </div>
            <div>
              <label class="label-base" for="rb-city">{{ t('tools.resumeBuilder.cityLabel') }}</label>
              <input id="rb-city" v-model="resume.city" class="input-base" />
            </div>
            <div>
              <label class="label-base" for="rb-intention">
                {{ t('tools.resumeBuilder.intentionLabel') }}
              </label>
              <input
                id="rb-intention"
                v-model="resume.intention"
                class="input-base"
                :placeholder="t('tools.resumeBuilder.intentionPlaceholder')"
              />
            </div>
            <div>
              <label class="label-base" for="rb-website">
                {{ t('tools.resumeBuilder.websiteLabel') }}
              </label>
              <input
                id="rb-website"
                v-model="resume.website"
                class="input-base"
                :placeholder="t('tools.resumeBuilder.websitePlaceholder')"
              />
            </div>
          </div>
          <div class="mt-3">
            <label class="label-base" for="rb-summary">{{ t('tools.resumeBuilder.summaryTitle') }}</label>
            <textarea
              id="rb-summary"
              v-model="resume.summary"
              rows="4"
              class="input-base w-full"
              :placeholder="t('tools.resumeBuilder.summaryPlaceholder')"
            ></textarea>
          </div>
        </section>

        <!-- 教育经历 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="section-title mb-0">{{ t('tools.resumeBuilder.educationTitle') }}</h2>
            <button type="button" class="btn-ghost !py-1" @click="addEducation">
              {{ t('tools.resumeBuilder.addEducation') }}
            </button>
          </div>
          <p
            v-if="resume.education.length === 0"
            class="py-3 text-center text-sm text-slate-400"
          >
            {{ t('tools.resumeBuilder.emptyEntries') }}
          </p>
          <div v-for="(item, i) in resume.education" :key="'edu-' + i" class="entry-card">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-medium text-slate-400">{{ i + 1 }}</span>
              <button type="button" class="btn-danger !py-1" @click="removeEducation(i)">
                {{ t('tools.resumeBuilder.removeEntry') }}
              </button>
            </div>
            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label class="label-base" :for="'edu-school-' + i">
                  {{ t('tools.resumeBuilder.school') }}
                </label>
                <input
                  :id="'edu-school-' + i"
                  v-model="item.school"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.schoolPlaceholder')"
                />
              </div>
              <div>
                <label class="label-base" :for="'edu-major-' + i">
                  {{ t('tools.resumeBuilder.major') }}
                </label>
                <input
                  :id="'edu-major-' + i"
                  v-model="item.major"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.majorPlaceholder')"
                />
              </div>
              <div>
                <label class="label-base" :for="'edu-degree-' + i">
                  {{ t('tools.resumeBuilder.degree') }}
                </label>
                <input
                  :id="'edu-degree-' + i"
                  v-model="item.degree"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.degreePlaceholder')"
                />
              </div>
              <div>
                <label class="label-base" :for="'edu-period-' + i">
                  {{ t('tools.resumeBuilder.period') }}
                </label>
                <input
                  :id="'edu-period-' + i"
                  v-model="item.period"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.periodPlaceholder')"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- 工作经历 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="section-title mb-0">{{ t('tools.resumeBuilder.workTitle') }}</h2>
            <button type="button" class="btn-ghost !py-1" @click="addWork">
              {{ t('tools.resumeBuilder.addWork') }}
            </button>
          </div>
          <p v-if="resume.work.length === 0" class="py-3 text-center text-sm text-slate-400">
            {{ t('tools.resumeBuilder.emptyEntries') }}
          </p>
          <div v-for="(item, i) in resume.work" :key="'work-' + i" class="entry-card">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-medium text-slate-400">{{ i + 1 }}</span>
              <button type="button" class="btn-danger !py-1" @click="removeWork(i)">
                {{ t('tools.resumeBuilder.removeEntry') }}
              </button>
            </div>
            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label class="label-base" :for="'work-company-' + i">
                  {{ t('tools.resumeBuilder.company') }}
                </label>
                <input
                  :id="'work-company-' + i"
                  v-model="item.company"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.companyPlaceholder')"
                />
              </div>
              <div>
                <label class="label-base" :for="'work-position-' + i">
                  {{ t('tools.resumeBuilder.position') }}
                </label>
                <input
                  :id="'work-position-' + i"
                  v-model="item.position"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.positionPlaceholder')"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="label-base" :for="'work-period-' + i">
                  {{ t('tools.resumeBuilder.period') }}
                </label>
                <input
                  :id="'work-period-' + i"
                  v-model="item.period"
                  class="input-base"
                  :placeholder="t('tools.resumeBuilder.periodPlaceholder')"
                />
              </div>
              <div class="sm:col-span-2">
                <label class="label-base" :for="'work-desc-' + i">
                  {{ t('tools.resumeBuilder.workDesc') }}
                </label>
                <textarea
                  :id="'work-desc-' + i"
                  v-model="item.desc"
                  rows="3"
                  class="input-base w-full"
                  :placeholder="t('tools.resumeBuilder.descPlaceholder')"
                ></textarea>
              </div>
            </div>
          </div>
        </section>

        <!-- 技能 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <h2 class="section-title">{{ t('tools.resumeBuilder.skillsTitle') }}</h2>
          <input
            v-model="resume.skills"
            class="input-base"
            :placeholder="t('tools.resumeBuilder.skillsPlaceholder')"
          />
          <div v-if="skillsList.length" class="mt-3 flex flex-wrap gap-2">
            <span v-for="(skill, i) in skillsList" :key="skill + '-' + i" class="chip">
              {{ skill }}
              <button
                type="button"
                class="ml-1 text-blue-400 transition hover:text-red-500"
                :aria-label="t('tools.resumeBuilder.removeEntry')"
                @click="removeSkill(i)"
              >
                ×
              </button>
            </span>
          </div>
        </section>
      </div>

      <!-- 预览区（移动端在表单下方） -->
      <div class="resume-preview-col lg:sticky lg:top-4">
        <!-- 模板选择 -->
        <section class="glass-card resume-no-print p-4 sm:p-6 mb-4">
          <h2 class="section-title">{{ t('tools.resumeBuilder.templateTitle') }}</h2>
          <div class="grid grid-cols-2 gap-3">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.id"
              type="button"
              class="template-card"
              :class="{ active: templateId === tpl.id }"
              :aria-pressed="templateId === tpl.id"
              @click="templateId = tpl.id"
            >
              <span class="template-thumb" :class="tpl.id === 'pro' ? 'thumb-pro' : 'thumb-simple'">
                <template v-if="tpl.id === 'simple'">
                  <span class="tt-head"></span>
                  <span class="tt-line"></span>
                  <span class="tt-line tt-short"></span>
                </template>
                <template v-else>
                  <span class="tt-side"></span>
                  <span class="tt-main">
                    <span class="tt-line"></span>
                    <span class="tt-line tt-short"></span>
                  </span>
                </template>
              </span>
              <span class="text-sm font-medium text-slate-700">
                {{ t('tools.resumeBuilder.template' + tpl.name) }}
              </span>
              <span class="text-xs text-slate-400">
                {{ t('tools.resumeBuilder.template' + tpl.name + 'Desc') }}
              </span>
            </button>
          </div>
        </section>

        <!-- 实时预览 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <div class="resume-no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="section-title mb-0">{{ t('tools.resumeBuilder.previewTitle') }}</h2>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-primary !py-1.5" @click="printResume">
                {{ t('tools.resumeBuilder.printBtn') }}
              </button>
              <button type="button" class="btn-ghost" @click="printResume">
                {{ t('tools.resumeBuilder.exportPdfBtn') }}
              </button>
              <button type="button" class="btn-ghost" @click="exportHtml">
                {{ t('tools.resumeBuilder.exportHtmlBtn') }}
              </button>
            </div>
          </div>

          <div id="resume-print-area" class="resume-paper">
            <!-- 空数据引导 -->
            <div v-if="!hasAnyData" class="paper-empty">
              {{ t('tools.resumeBuilder.emptyPreview') }}
            </div>

            <!-- 简约模板 -->
            <div v-else-if="templateId === 'simple'" class="p-5 sm:p-8">
              <header class="paper-head">
                <h3 class="text-xl font-bold text-slate-900 sm:text-2xl">
                  {{ resume.name || t('tools.resumeBuilder.namePlaceholder') }}
                </h3>
                <p v-if="resume.intention" class="mt-1 text-[12px] text-slate-600">
                  {{ resume.intention }}
                </p>
                <p v-if="contactLine" class="mt-2 text-[11px] leading-relaxed text-slate-500">
                  {{ contactLine }}
                </p>
              </header>

              <section v-if="String(resume.summary || '').trim()" class="mt-4">
                <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secSummary') }}</h4>
                <p class="paper-body whitespace-pre-line">{{ resume.summary }}</p>
              </section>

              <section v-if="resume.education.length" class="mt-4">
                <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secEducation') }}</h4>
                <div v-for="(item, i) in resume.education" :key="'pe-' + i" class="paper-row">
                  <div class="min-w-0">
                    <p class="paper-strong">{{ item.school }}</p>
                    <p v-if="item.major || item.degree" class="paper-body">
                      {{ [item.major, item.degree].filter(Boolean).join(' · ') }}
                    </p>
                  </div>
                  <span class="paper-period">{{ item.period }}</span>
                </div>
              </section>

              <section v-if="resume.work.length" class="mt-4">
                <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secWork') }}</h4>
                <div v-for="(item, i) in resume.work" :key="'pw-' + i" class="mb-3">
                  <div class="paper-row">
                    <div class="min-w-0">
                      <p class="paper-strong">
                        {{ [item.company, item.position].filter(Boolean).join(' · ') }}
                      </p>
                    </div>
                    <span class="paper-period">{{ item.period }}</span>
                  </div>
                  <p v-if="item.desc" class="paper-body whitespace-pre-line">{{ item.desc }}</p>
                </div>
              </section>

              <section v-if="skillsList.length" class="mt-4">
                <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secSkills') }}</h4>
                <p class="paper-body">{{ skillsList.join(' · ') }}</p>
              </section>
            </div>

            <!-- 专业模板：蓝色侧栏 -->
            <div v-else class="flex h-full">
              <aside class="pro-side w-[34%] shrink-0">
                <h3 class="break-words text-lg font-bold text-white sm:text-xl">
                  {{ resume.name || t('tools.resumeBuilder.namePlaceholder') }}
                </h3>
                <p v-if="resume.intention" class="mt-1 break-words text-[11px] text-blue-200">
                  {{ resume.intention }}
                </p>
                <div v-if="contactItems.length" class="mt-4 space-y-1.5">
                  <p
                    v-for="item in contactItems"
                    :key="item.label"
                    class="break-all text-[11px] leading-relaxed text-slate-100"
                  >
                    {{ item.label }} · {{ item.value }}
                  </p>
                </div>
                <div v-if="skillsList.length" class="mt-5">
                  <h4 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-blue-200">
                    {{ t('tools.resumeBuilder.secSkills') }}
                  </h4>
                  <ul class="space-y-1">
                    <li v-for="(skill, i) in skillsList" :key="'ps-' + i" class="text-[11px] text-slate-100">
                      {{ skill }}
                    </li>
                  </ul>
                </div>
              </aside>
              <main class="min-w-0 flex-1 p-4 sm:p-5">
                <section v-if="String(resume.summary || '').trim()">
                  <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secSummary') }}</h4>
                  <p class="paper-body whitespace-pre-line">{{ resume.summary }}</p>
                </section>
                <section v-if="resume.education.length" class="mt-4">
                  <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secEducation') }}</h4>
                  <div v-for="(item, i) in resume.education" :key="'qe-' + i" class="paper-row">
                    <div class="min-w-0">
                      <p class="paper-strong">{{ item.school }}</p>
                      <p v-if="item.major || item.degree" class="paper-body">
                        {{ [item.major, item.degree].filter(Boolean).join(' · ') }}
                      </p>
                    </div>
                    <span class="paper-period">{{ item.period }}</span>
                  </div>
                </section>
                <section v-if="resume.work.length" class="mt-4">
                  <h4 class="paper-section-title">{{ t('tools.resumeBuilder.secWork') }}</h4>
                  <div v-for="(item, i) in resume.work" :key="'qw-' + i" class="mb-3">
                    <div class="paper-row">
                      <div class="min-w-0">
                        <p class="paper-strong">
                          {{ [item.company, item.position].filter(Boolean).join(' · ') }}
                        </p>
                      </div>
                      <span class="paper-period">{{ item.period }}</span>
                    </div>
                    <p v-if="item.desc" class="paper-body whitespace-pre-line">{{ item.desc }}</p>
                  </div>
                </section>
              </main>
            </div>
          </div>
        </section>
      </div>
    </div>
  </ToolPage>
</template>

<style scoped>
/* 条目卡片 */
.entry-card {
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.55);
  padding: 12px;
  margin-bottom: 10px;
}
.entry-card:last-child {
  margin-bottom: 0;
}

/* 模板选择卡片 */
.template-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px;
  border-radius: 14px;
  border: 1.5px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.template-card:hover {
  border-color: rgba(59, 130, 246, 0.55);
}
.template-card.active {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.template-thumb {
  display: flex;
  width: 100%;
  height: 44px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  background: #fff;
}
.tt-head {
  display: block;
  width: 40%;
  height: 5px;
  margin: 8px auto 4px;
  background: #0f172a;
  border-radius: 2px;
}
.tt-line {
  display: block;
  width: 70%;
  height: 4px;
  border-radius: 2px;
  background: #cbd5e1;
  margin-bottom: 4px;
}
.tt-short {
  width: 45%;
}
.thumb-simple {
  flex-direction: column;
  align-items: center;
  padding: 0 10px;
}
.thumb-simple .tt-head {
  margin-top: 7px;
}
.thumb-pro .tt-side {
  width: 32%;
  height: 100%;
  background: #1e293b;
  flex-shrink: 0;
}
.thumb-pro .tt-main {
  flex: 1;
  padding: 8px 10px;
}

/* A4 比例预览纸 */
.resume-paper {
  width: 100%;
  aspect-ratio: 210 / 297;
  background: #fff;
  color: #1e293b;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
  overflow-y: auto;
  text-align: left;
}
.paper-empty {
  min-height: 320px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.8;
}
.paper-head {
  text-align: center;
  border-bottom: 2px solid #0f172a;
  padding-bottom: 12px;
}
.paper-section-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  border-bottom: 1.5px solid #0f172a;
  padding-bottom: 4px;
  margin-bottom: 8px;
}
.paper-body {
  font-size: 11.5px;
  line-height: 1.65;
  color: #334155;
  word-break: break-word;
}
.paper-strong {
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
}
.paper-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.paper-period {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #64748b;
  white-space: nowrap;
}
.pro-side {
  background: #1e293b;
  padding: 16px;
}
@media (min-width: 640px) {
  .pro-side {
    padding: 20px;
  }
}
</style>

<style>
/* 打印样式：只打印预览区，A4 边距，保留侧栏颜色 */
@media print {
  body {
    background: #fff !important;
  }
  .bg-decor,
  .site-header,
  .top-nav,
  .site-footer {
    display: none !important;
  }
  .site-main {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .tool-page {
    max-width: none !important;
  }
  .tool-page > header {
    display: none !important;
  }
  .resume-form-col,
  .resume-no-print {
    display: none !important;
  }
  .resume-preview-col {
    position: static !important;
  }
  .resume-preview-col .glass-card {
    box-shadow: none !important;
    border: none !important;
    background: transparent !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  #resume-print-area {
    width: 100% !important;
    aspect-ratio: auto !important;
    overflow: visible !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page {
    size: A4;
    margin: 12mm;
  }
}
</style>
