# ToolboxLab 补充测试报告（遗留事项闭环）

- 日期：2026-09-06
- 方式：真实浏览器（Chromium，IAB）对主测试报告遗留事项 ②③④ 逐项验收；①为测试基建事项，做加固与说明
- 回归结果：148/148 测试通过，`verify:tools` 通过，生产构建通过（95 URL sitemap）
- 关联文档：[TEST-REPORT.md](./TEST-REPORT.md)

## 遗留项 ②：网络类工具真实 API 验收

### 验收结果（10/10 通过）

| 工具 | 真实验收内容 | 结果 |
|---|---|---|
| IP 查询 | 自动获取本机 IP（ipwho.is）+ OSM 地图链接 | ✅ 真实 IP 返回 |
| DNS 查询 | Cloudflare DOH 解析 github.com A 记录 | ✅ 20.205.243.166 + TTL |
| Ping 检测 | HTTP 层真实探测 github.com ×2 | ✅ 延迟 166-637ms、丢包率 0%、统计完整 |
| Whois | rdap.org（302 → Verisign）查询 github.com | ✅ 注册 2007/10/10、到期 2026/10/10、剩余 34 天、EPP 状态、NS 列表 |
| SSL 证书 | crt.sh 查询 github.com | ✅ Let's Encrypt、2026/09/01~11/30、剩余 85 天、SAN/CT 统计 |
| 货币汇率 | open.er-api.com 166 币种 + 换算 | ✅ 100 USD = 672.89 CNY、更新时间显示 |
| RSS 阅读器 | github.blog/feed 直连降级通道 | ✅ 12 篇文章（经竞态修复后） |
| 短链接 | spoo.me 真实生成 | ✅ 返回可用短链 |
| 网页截图 | mshots 生成 github.com 截图 | ✅ 1280×960 真实位图（自动重试机制生效） |
| 地理编码 | Nominatim 逆编码 (39.9042, 116.4074) | ✅ 北京地址 + 地图链接 |

### 真实环境发现的缺陷与修复（4 项）

| # | 缺陷 | 根因（真实浏览器诊断） | 修复 | 回归 |
|---|---|---|---|---|
| 1 | **SSL 检测完全不可用** | `api.ssllabs.com` 不发送 CORS 头，浏览器永远无法直连（no-cors 证明网络可达）；公共代理（allorigins/codetabs/corsproxy）在真实网络全部不可用或收费 | **数据源切换为 crt.sh 证书透明日志**（原生 CORS）：展示颁发者、有效期、剩余天数预警、SAN 列表、CT 记录数；组件与双语语言包重写，`verify:tools` 键结构校验通过 | 浏览器实测 ✅ |
| 2 | **短链生成不可用** | is.gd 的 `create.php` 同样 CORS 受限（网络可达但无法读取响应） | **主通道切换为 spoo.me**（原生 CORS，POST 表单，支持 `alias` 自定义后缀），is.gd 保留为降级通道；双通道响应字段归一化（`short_url`/`shorturl`）；文案同步更新 | 浏览器实测 ✅ |
| 3 | **RSS 阅读器并发竞态** | 页面挂载自动加载持久化 URL 与用户手动点击的加载并发执行，无请求序号守卫，旧请求的失败结果覆盖新请求的成功结果 | `loadFeed` 增加 `loadSeq` 序号守卫，所有异步分支在写状态前校验 | 浏览器实测 ✅（github.blog 12 篇文章） |
| 4 | **Whois 首查偶发失败无重试** | rdap.org 冷启动偶发快速失败（5 秒内 reject，非超时） | 增加 1 次静默自动重试（500ms 间隔），两次均失败才报错 | 浏览器实测 ✅ |

### 环境限制记录（非缺陷）

- hnrss.org 不发送 CORS 头，直连失败属预期行为，工具已给出正确的 CORS 限制说明文案
- rss2json 免费接口当前返回 500（`count` 参数改为付费功能，移除参数后也 500），服务方问题；直连降级通道已验证可用，rss2json 保留为首通道待其恢复
- 验证手法备忘：`mode: 'no-cors'` 探测可达性 + `mode: 'cors'` 探测可读性，可精确区分「网络不可达」与「CORS 受限」

## 遗留项 ③：媒体类工具真实验收

jsdom 不支持文件选择器，采用**页面内构造文件 + 派发 `DragEvent('drop')`** 注入 `FileDropZone`，打通上传之后的全部真实管道：

| 工具 | 注入物 | 验收结果 |
|---|---|---|
| PDF 工具箱 | 程序构造的最小合法 PDF（精确 xref 偏移） | ✅ pdf-lib 解析成功：文件列出、页数=1 |
| Excel 转 JSON | 含中文的 UTF-8 CSV | ✅ 表格预览 + JSON 导出（经乱码修复后） |
| 音频转换 | 程序生成的 440Hz 正弦波 WAV（0.5s/8kHz/16bit） | ✅ 解码显示参数 → 转换输出 7.9 KB（与理论值一致）→ 可播放预览 |
| 视频比例转换 | canvas.captureStream + MediaRecorder 录制的 1s/320×180 WebM（VP9） | ✅ 元数据读取正确 → 实时重编码输出 6.0 KB WebM + 可播放 |
| 绘图画布 | CUA 真实鼠标拖拽绘制 | ✅ 笔迹像素采样非白 → 撤销后全部还原 |
| 思维导图 | mind-elixir 渲染 + CUA 点击根节点 + 真实 Tab 键 | ✅ 初始 5 节点 → Tab 新增子节点至 6 |

### 真实环境发现的缺陷与修复（1 项）

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| 5 | **UTF-8 无 BOM 的 CSV 中文乱码**（`中文测试` → `ä¸­æ`） | SheetJS 对无 BOM 的 CSV 默认按 cp1252 解码；macOS/Linux/网页导出的 CSV 普遍无 BOM | `XLSX.read` 增加 `codepage: 65001`（ExcelToJson 与 OfficeConverter 两处） | 浏览器实测 ✅ |

## 遗留项 ④：可访问性验收

| 检查项 | 方法 | 结果 |
|---|---|---|
| 自动化规则扫描 | 注入 axe-core 4.10 扫描首页与单位换算页 | ✅ **0 违规**（40 条规则通过、48 条不适用） |
| 可访问名 | 遍历全部可聚焦元素（a/button/input/select） | ✅ 首屏 14 个采样全部有 aria-label 或可见文本，无匿名控件 |
| 键盘导航 | CUA 发送真实 Tab 键 | ✅ 焦点按 DOM 序移动（分类 Tab → 精度 → 单位 → 输入框） |
| 焦点可见性 | 读取焦点元素计算样式 | ✅ 浏览器原生 focus outline 未被 CSS 移除 |

## 遗留项 ①：假定时器 × 动态 import（测试基建）

无浏览器验收动作可做，本轮完成的加固：

1. **根因确认**：Vitest 假定时器会冻结 `setTimeout`，而 Vite 动态 import 的模块加载依赖宏任务，导致懒加载永不完成且无报错（渲染管线静默等待）。
2. **测试加固**：MarkdownPreview 集成测试原为固定 600ms 真实等待，高负载下出现时序抖动（本轮回归中实际触发一次）。已改为**轮询组件渲染状态**（每 150ms 检查 `setupState.html`，上限 6 秒），负载稳定性与用例时长兼顾。
3. **规范沉淀**：涉及懒加载组件的测试禁用 `vi.useFakeTimers`，等待渲染一律用轮询断言；已写入测试计划注意事项与组件内注释。

## 修复清单汇总（本轮 5 项产品缺陷 + 1 项测试加固）

| # | 文件 | 类型 |
|---|---|---|
| 1 | `src/views/tools/SslChecker.vue` + 两份语言包 | 数据源重写（crt.sh） |
| 2 | `src/views/tools/ShortUrl.vue` + 两份语言包 | 双通道改造（spoo.me 主 + is.gd 备） |
| 3 | `src/views/tools/RssReader.vue` | 并发竞态守卫 |
| 4 | `src/views/tools/WhoisLookup.vue` | 静默自动重试 |
| 5 | `src/views/tools/ExcelToJson.vue`、`OfficeConverter.vue` | CSV 编码 `codepage: 65001` |
| 6 | `tests/integration/MarkdownPreview.test.js` | 轮询等待替代固定 sleep |

## 结论

- 遗留事项 ②③④ 全部在真实浏览器完成验收，合计 **16 个工具/场景通过**；过程中发现并修复 **5 个仅能在真实环境暴露的产品缺陷**（2 个 CORS 数据源不可用、1 个并发竞态、1 个无重试、1 个编码乱码）
- 可访问性基线良好（axe 零违规 + 键盘可用），后续可在 CI 中引入 axe 定期回归
- 全部修复已通过 148 个自动化用例 + `verify:tools` + 生产构建回归
