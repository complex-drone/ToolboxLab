import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountTool } from '../helpers/mount'
import { flushPromises } from '@vue/test-utils'
import IpLookup from '@/views/tools/IpLookup.vue'

const SUCCESS_PAYLOAD = {
  ip: '203.0.113.7',
  city: '杭州',
  region: '浙江省',
  country: '中国',
  connection: { isp: '中国电信', asn: 4134 },
  latitude: 30.27,
  longitude: 120.16,
  timezone: { id: 'Asia/Shanghai' },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IpLookup 组件测试（网络层 mock）', () => {
  it('查询成功渲染 IP / ISP / 经纬度等字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SUCCESS_PAYLOAD),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountTool(IpLookup)
    await flushPromises()
    await wrapper.vm.$nextTick()
    const text = wrapper.text()
    expect(text).toContain('203.0.113.7')
    expect(text).toContain('中国电信')
    expect(text).toContain('杭州')
    // 经纬度与地图链接
    expect(wrapper.find('a[href*="openstreetmap"]').exists()).toBe(true)
  })

  it('网络失败显示行内错误且不崩溃', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))
    const wrapper = mountTool(IpLookup)
    await flushPromises()
    await wrapper.vm.$nextTick()
    // 行内错误 + 全局 Toast 双通道提示
    expect(wrapper.text()).toContain('查询失败，请检查输入或稍后重试')
    expect(wrapper.text()).not.toMatch(/NaN|undefined/)
  })

  it('非 200 响应走降级 API（失败后重试）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(SUCCESS_PAYLOAD),
      })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountTool(IpLookup)
    await flushPromises()
    await wrapper.vm.$nextTick()
    // 降级后仍能拿到结果（不同 API 字段映射由组件内部处理）
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('手动输入非法 IP 显示校验错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SUCCESS_PAYLOAD) }))
    const wrapper = mountTool(IpLookup)
    await flushPromises()
    const input = wrapper.find('input')
    await input.setValue('not-an-ip')
    const btn = wrapper.findAll('button').find(b => b.text() === '查询')
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('请输入合法的 IPv4 地址或域名')
  })
})
