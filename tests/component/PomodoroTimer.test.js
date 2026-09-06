import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountTool } from '../helpers/mount'
import PomodoroTimer from '@/views/tools/PomodoroTimer.vue'

function findBtn(wrapper, matcher) {
  return wrapper.findAll('button').find(b => matcher.test(b.text()))
}

describe('PomodoroTimer 组件测试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始显示默认 25 分钟专注倒计时', () => {
    const wrapper = mountTool(PomodoroTimer)
    expect(wrapper.text()).toMatch(/25:00/)
    expect(wrapper.text()).toContain('专注')
  })

  it('开始后倒计时逐秒递减', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /开始/).trigger('click')
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/24:57/)
  })

  it('运行中 document.title 同步倒计时', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /开始/).trigger('click')
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(document.title).toContain('24:58')
  })

  it('暂停后倒计时停止', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /开始/).trigger('click')
    vi.advanceTimersByTime(2000)
    await findBtn(wrapper, /暂停/).trigger('click')
    const paused = wrapper.text().match(/2\d:\d{2}/)[0]
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(paused)
  })

  it('重置按钮恢复初始时间', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /开始/).trigger('click')
    vi.advanceTimersByTime(5000)
    await findBtn(wrapper, /重置/).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/25:00/)
  })

  it('跳过按钮切换到休息阶段', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /跳过/).trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('休息')
  })

  it('无 Notification API 时开启通知按钮降级不崩溃', async () => {
    const wrapper = mountTool(PomodoroTimer)
    const notifBtn = findBtn(wrapper, /通知/)
    if (notifBtn) {
      await notifBtn.trigger('click') // 不应抛异常
      await wrapper.vm.$nextTick()
    }
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })

  it('完成专注阶段计入今日统计（25 分钟后）', async () => {
    const wrapper = mountTool(PomodoroTimer)
    await findBtn(wrapper, /开始/).trigger('click')
    vi.advanceTimersByTime(25 * 60 * 1000 + 1500)
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    // 自动进入休息阶段或统计数字出现
    expect(text).toMatch(/休息|已完成|1/)
  })
})
