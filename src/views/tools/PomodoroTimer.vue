<script setup>
import { ref, computed, watch, watchEffect, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { padZero } from '@/utils/format'

/**
 * 番茄钟：专注 / 短休息 / 长休息循环（每 4 个专注后进入长休息）
 * 计时基于 endTime 时间戳，后台节流不漂移；visibilitychange 回来立即校正
 */

const DURATIONS = [
  { key: 'focusMin', def: 25 },
  { key: 'shortMin', def: 5 },
  { key: 'longMin', def: 15 },
]
const DURATION_DEFAULTS = { focusMin: 25, shortMin: 5, longMin: 15 }
const RING_RADIUS = 96
const RING_CIRC = 2 * Math.PI * RING_RADIUS
const RING_COLORS = { focus: '#3b82f6', short: '#10b981', long: '#8b5cf6' }

const { t } = useI18n()
const toast = useToast()

/** 持久化：时长设置 / 自动开始，以及按日期的完成统计与循环计数 */
const settings = useStorage('tool-pomodoro-settings', {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  autoStart: false,
})
const stats = useStorage('tool-pomodoro-stats', {})
const cycle = useStorage('tool-pomodoro-cycle', 0)

const phase = ref('focus')
const running = ref(false)
const remainingMs = ref(25 * 60000)
const endAt = ref(0)

let timerId = null
let audioCtx = null
const defaultTitle = document.title

function phaseMs(p) {
  const key = p === 'short' ? 'shortMin' : p === 'long' ? 'longMin' : 'focusMin'
  const raw = Number(settings.value[key])
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DURATION_DEFAULTS[key]
  return Math.min(120, Math.max(1, minutes)) * 60000
}

const totalMs = computed(() => phaseMs(phase.value))
const mmss = computed(() => {
  const totalSec = Math.max(0, Math.ceil(remainingMs.value / 1000))
  return `${padZero(Math.floor(totalSec / 60))}:${padZero(totalSec % 60)}`
})
const progressFrac = computed(() => {
  const total = totalMs.value
  if (!total) return 0
  return Math.min(1, Math.max(0, 1 - remainingMs.value / total))
})
const ringOffset = computed(() => RING_CIRC * (1 - progressFrac.value))
const ringColor = computed(() => RING_COLORS[phase.value] || RING_COLORS.focus)

const phaseLabel = computed(() => {
  if (phase.value === 'short') return t('tools.pomodoroTimer.phaseShort')
  if (phase.value === 'long') return t('tools.pomodoroTimer.phaseLong')
  return t('tools.pomodoroTimer.phaseFocus')
})
const cycleHint = computed(() =>
  t('tools.pomodoroTimer.cycleProgress', { n: (Number(cycle.value) % 4) + 1 })
)

/* ---------- 每日统计 ---------- */
function dateKey(d) {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`
}
function todayKey() {
  return dateKey(new Date())
}
const todayCount = computed(() => Number(stats.value[todayKey()]) || 0)
const last7 = computed(() => {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dateKey(d)
    days.push({
      key,
      label: `${padZero(d.getMonth() + 1)}/${padZero(d.getDate())}`,
      count: Number(stats.value[key]) || 0,
      today: i === 0,
    })
  }
  return days
})
const maxDayCount = computed(() => Math.max(1, ...last7.value.map(d => d.count)))
const weekTotal = computed(() => last7.value.reduce((sum, d) => sum + d.count, 0))

function barHeight(count) {
  if (!count) return 4
  return Math.max(8, Math.round((count / maxDayCount.value) * 84))
}

/* ---------- 计时控制 ---------- */
function normalizeDuration(key) {
  let v = parseInt(settings.value[key], 10)
  if (!Number.isFinite(v)) v = DURATION_DEFAULTS[key]
  settings.value[key] = Math.min(120, Math.max(1, v))
}

function start() {
  if (remainingMs.value <= 0) remainingMs.value = totalMs.value
  endAt.value = Date.now() + remainingMs.value
  running.value = true
}

function pause() {
  if (!running.value) return
  remainingMs.value = Math.max(0, endAt.value - Date.now())
  running.value = false
}

function resetPhase() {
  running.value = false
  remainingMs.value = totalMs.value
}

/** 进入下一阶段：专注结束后按循环决定长 / 短休息 */
function goNext(afterFocus) {
  const next = afterFocus
    ? (Number(cycle.value) % 4 === 0 ? 'long' : 'short')
    : 'focus'
  phase.value = next
  remainingMs.value = phaseMs(next)
  if (settings.value.autoStart) start()
}

function skip() {
  goNext(phase.value === 'focus')
}

function complete() {
  running.value = false
  remainingMs.value = 0
  const finishedFocus = phase.value === 'focus'
  if (finishedFocus) {
    const key = todayKey()
    stats.value = { ...stats.value, [key]: (Number(stats.value[key]) || 0) + 1 }
    cycle.value = Number(cycle.value) + 1
  }
  announce(finishedFocus)
  goNext(finishedFocus)
}

function tick() {
  if (!running.value) return
  remainingMs.value = Math.max(0, endAt.value - Date.now())
  if (remainingMs.value <= 0) complete()
}

/* ---------- 提示音：WebAudio 短促双音 ---------- */
function playTone(freq, startDelay, duration) {
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  const at = audioCtx.currentTime + startDelay
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(at)
  osc.stop(at + duration + 0.05)
  osc.onended = () => {
    try {
      osc.disconnect()
      gain.disconnect()
    } catch {
      /* 忽略 */
    }
  }
}

function playBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!audioCtx) audioCtx = new AC()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    playTone(880, 0, 0.18)
    playTone(660, 0.22, 0.28)
  } catch {
    /* 忽略音频错误 */
  }
}

/* ---------- 桌面通知：未授权 / 被拒 / 不可用时降级为 toast + 提示音 ---------- */
const notifyPerm = ref(
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
)

const notifyStateLabel = computed(() => {
  if (notifyPerm.value === 'granted') return t('tools.pomodoroTimer.notifyStateOn')
  if (notifyPerm.value === 'denied') return t('tools.pomodoroTimer.notifyStateDenied')
  return t('tools.pomodoroTimer.notifyStateOff')
})

async function enableNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    toast.error(t('tools.pomodoroTimer.notifyUnavailable'))
    return
  }
  try {
    const perm = await Notification.requestPermission()
    notifyPerm.value = perm
    if (perm === 'granted') {
      toast.success(t('tools.pomodoroTimer.notifyEnabled'))
    } else {
      toast.info(t('tools.pomodoroTimer.notifyDenied'))
    }
  } catch {
    toast.error(t('tools.pomodoroTimer.notifyUnavailable'))
  }
}

function announce(finishedFocus) {
  playBeep()
  const body = finishedFocus
    ? t('tools.pomodoroTimer.notifyFocusDone')
    : t('tools.pomodoroTimer.notifyBreakDone')
  if (notifyPerm.value === 'granted') {
    try {
      const notification = new Notification(t('tools.pomodoroTimer.notifyAppTitle'), { body })
      notification.onclick = () => {
        try {
          window.focus()
          notification.close()
        } catch {
          /* 忽略 */
        }
      }
    } catch {
      /* 忽略 */
    }
  }
  toast.info(
    finishedFocus ? t('tools.pomodoroTimer.focusDoneToast') : t('tools.pomodoroTimer.breakDoneToast')
  )
}

/* ---------- 页面标题随倒计时更新 ---------- */
watchEffect(() => {
  const active = running.value || remainingMs.value < totalMs.value
  document.title = active
    ? t('tools.pomodoroTimer.titleFormat', { time: mmss.value, phase: phaseLabel.value })
    : defaultTitle
})

/* 非运行状态修改时长时，同步刷新当前阶段剩余时间 */
watch(totalMs, () => {
  if (!running.value) remainingMs.value = totalMs.value
})

/* 后台切回时立即校正（防节流漂移） */
function onVisibility() {
  tick()
}

onMounted(() => {
  for (const d of DURATIONS) normalizeDuration(d.key)
  remainingMs.value = totalMs.value
  timerId = window.setInterval(tick, 250)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  if (timerId) window.clearInterval(timerId)
  timerId = null
  document.removeEventListener('visibilitychange', onVisibility)
  document.title = defaultTitle
  if (audioCtx) {
    try {
      audioCtx.close()
    } catch {
      /* 忽略 */
    }
    audioCtx = null
  }
})
</script>

<template>
  <ToolPage tool-id="pomodoroTimer">
    <!-- 计时器主体 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col items-center">
        <span class="chip mb-4">{{ phaseLabel }}</span>

        <div class="relative">
          <svg viewBox="0 0 220 220" class="h-52 w-52 -rotate-90 sm:h-64 sm:w-64" aria-hidden="true">
            <circle cx="110" cy="110" r="96" fill="none" stroke="#e2e8f0" stroke-width="12" />
            <circle
              cx="110"
              cy="110"
              r="96"
              fill="none"
              :stroke="ringColor"
              stroke-width="12"
              stroke-linecap="round"
              :stroke-dasharray="RING_CIRC"
              :stroke-dashoffset="ringOffset"
              style="transition: stroke-dashoffset 0.25s linear"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-5xl font-extrabold tracking-wide text-slate-800 tabular-nums sm:text-6xl">
              {{ mmss }}
            </span>
            <span v-if="phase === 'focus'" class="mt-1 text-xs text-slate-400">{{ cycleHint }}</span>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button type="button" class="btn-primary min-w-[7rem]" :disabled="running" @click="start">
            {{ t('tools.pomodoroTimer.start') }}
          </button>
          <button type="button" class="btn-ghost" :disabled="!running" @click="pause">
            {{ t('tools.pomodoroTimer.pause') }}
          </button>
          <button type="button" class="btn-ghost" @click="resetPhase">
            {{ t('toolsCommon.reset') }}
          </button>
          <button type="button" class="btn-ghost" @click="skip">
            {{ t('tools.pomodoroTimer.skip') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pomodoroTimer.settingsTitle') }}</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div v-for="d in DURATIONS" :key="d.key">
          <label class="label-base" :for="'pomodoro-' + d.key">
            {{ t('tools.pomodoroTimer.' + d.key) }}
          </label>
          <div class="flex items-center gap-2">
            <input
              :id="'pomodoro-' + d.key"
              v-model.number="settings[d.key]"
              type="number"
              min="1"
              max="120"
              class="input-base"
              :disabled="running"
              @change="normalizeDuration(d.key)"
            />
            <span class="shrink-0 text-xs text-slate-400">{{ t('tools.pomodoroTimer.minutes') }}</span>
          </div>
        </div>
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.pomodoroTimer.rangeHint') }}</p>

      <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <label class="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
          <input v-model="settings.autoStart" type="checkbox" class="h-4 w-4 accent-blue-600" />
          {{ t('tools.pomodoroTimer.autoStart') }}
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-slate-600">{{ t('tools.pomodoroTimer.notifyTitle') }}</span>
          <span class="chip">{{ notifyStateLabel }}</span>
          <button
            v-if="notifyPerm === 'default'"
            type="button"
            class="btn-ghost !py-1"
            @click="enableNotifications"
          >
            {{ t('tools.pomodoroTimer.enableNotify') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 今日统计 + 最近 7 天迷你条形图 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pomodoroTimer.statsTitle') }}</h2>
      <p class="text-xl font-bold text-blue-600 sm:text-2xl">
        {{ t('tools.pomodoroTimer.todayDone', { n: todayCount }) }}
      </p>
      <p class="mb-2 mt-4 text-xs font-medium text-slate-400">
        {{ t('tools.pomodoroTimer.last7') }}
      </p>
      <div class="flex h-32 items-end justify-between gap-1.5 sm:gap-3">
        <div
          v-for="day in last7"
          :key="day.key"
          class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span class="text-[10px] tabular-nums text-slate-400">{{ day.count || '' }}</span>
          <div
            class="w-full max-w-[2.5rem] rounded-t-md transition-all"
            :class="day.count ? (day.today ? 'bg-blue-600' : 'bg-blue-400/70') : 'bg-slate-100'"
            :style="{ height: barHeight(day.count) + 'px' }"
          ></div>
          <span
            class="max-w-full truncate text-[10px]"
            :class="day.today ? 'font-semibold text-blue-600' : 'text-slate-400'"
          >
            {{ day.label }}
          </span>
        </div>
      </div>
      <p v-if="weekTotal === 0" class="mt-2 text-center text-xs text-slate-400">
        {{ t('tools.pomodoroTimer.noRecord') }}
      </p>
    </section>
  </ToolPage>
</template>
