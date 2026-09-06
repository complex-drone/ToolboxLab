# ToolboxLab 测试报告

- 日期：2026-09-06
- 测试运行器：Vitest 2.1.9 + @vue/test-utils 2.4.6 + jsdom 25（`npm test`）
- 测试计划：[docs/TEST-PLAN.md](./TEST-PLAN.md)

## 1. 结果总览

| 维度 | 文件数 | 用例数 | 通过 | 失败 |
|---|---|---|---|---|
| 单元测试（utils / composable） | 5 | 77 | 77 | 0 |
| 组件测试（10 个代表性工具） | 10 | 60 | 60 | 0 |
| 集成测试（格式互转 / Markdown） | 2 | 11 | 11 | 0 |
| **合计** | **17** | **148** | **148** | **0** |

总耗时约 11 秒，满足测试计划中 <60s 的要求。生产构建在测试改动后验证通过。

## 2. 覆盖内容

### 2.1 单元测试（核心逻辑与边界）
- `utils/random`：拒绝采样值域覆盖（无取模偏差）、非法上界抛异常、洗牌为置换且不改原数组、抽样不重复
- `utils/format`：formatBytes 单位换算与非法输入（负数/NaN/Infinity → "-"）、byteLength（中文 3 字节、emoji 4 字节）、padZero
- `utils/clipboard`：Clipboard API 路径、execCommand 降级路径、双重失败返回 false、非字符串短路
- `composables/useToast`：类型设置、单条替换约定、到期自动移除（fake timers）、remove 仅清当前条
- `utils/rmb`（自组件提取的纯函数）：20+ 断言覆盖标准转换、角分边界（0.5→伍角 / 0.05→伍分 / 12.05→壹拾贰元零伍分）、跨组补零（1002→壹仟零贰元整 / 100000005→壹亿零伍元整）、小数截断标记、负数/超限/非法输入错误码

### 2.2 组件测试（渲染 / 交互 / 持久化 / i18n / 边界）
JsonFormatter（行列错误定位、格式化/压缩输出、缩进持久化）、TextStats（空输入全 0、中英混排计数、UTF-8 字节）、CaseConverter（混合风格拆词、HTTPServer 连续大写、风格检测）、RmbUppercase（UI 全流程 + 负数/超限报错 + 持久化 + 示例按钮）、UnitConverter（米↔英尺双向、温度特殊函数、存储进制切换、交换）、HttpStatusCodes（数字/中英文关键词过滤、特殊字符不崩溃、展开描述）、RegexTester（匹配计数与高亮、非法正则不崩溃、**HTML 转义防 XSS 验证**、修饰符持久化）、PomodoroTimer（倒计时推进、title 同步、暂停/重置/跳过、无 Notification API 降级、完成计数）、TextDedupe（去重统计、升降序、忽略大小写、加密洗牌集合不变、拼音开关禁用态）、IpLookup（mock 成功渲染字段与地图链接、网络失败行内错误、非 200 降级重试、非法 IP 校验）

### 2.3 集成测试（完整流程）
- DataFormatConverter：JSON→YAML、YAML→JSON、交换互换、嵌套对象数组、非法输入保持输出为空且不崩溃
- MarkdownPreview：GFM 表格/任务列表、代码高亮 class、标题渲染、**`<script>` 注入与 `javascript:` 链接被 DOMPurify 清洗（安全验证）**、空输入

## 3. 首轮运行失败分析（10 失败 → 0）

首轮 148 例中 10 例失败，归因与处置如下：

| # | 失败用例 | 根因 | 处置 | 类别 |
|---|---|---|---|---|
| 1 | i18n 助手加载失败（12 个文件级失败） | `import.meta.glob` 不接受模板字符串（与项目 locales/index.js 曾踩的坑相同） | 改为两个字面量 glob | 测试代码 |
| 2 | clipboard「API 可用」用例 | jsdom 无 `document.execCommand`，且 `isSecureContext=false` 跳过 Clipboard API | 测试挂载 execCommand mock 并 stub 安全上下文 | 测试代码（环境限制） |
| 3 | JsonFormatter 合法提示断言 | 断言文案与语言包不一致（实际为「JSON 格式有效」） | 修正断言 | 测试代码 |
| 4 | UnitConverter 双向换算 | 测试期望值计算错误（0.3048 ft→m 应为 0.0929） | 修正期望值 | 测试代码 |
| 5 | TextDedupe 忽略大小写 | 选择器用 `attributes('disabled')` 真值判断，空字符串误判为可用，实际点到被禁用的「拼音」框 | 改用 `element.hasAttribute('disabled')` | 测试代码 |
| 6-7 | IpLookup 失败/校验文案 | 断言的是 Toast 文案（Toast 由 App.vue 渲染，不在挂载树内）；校验文案措辞不同 | 断言行内错误真实文案 | 测试代码 |
| 8 | DataFormatConverter 首次转换输出为空 | 首次运行动态加载 js-yaml，单轮 flushPromises 不足 | 多轮冲刷微任务 + 宏任务间隙 | 测试代码 |
| 9 | DataFormatConverter YAML→JSON | 默认输出格式为 YAML，测试未切换输出下拉 | 显式设置输出格式 | 测试代码 |
| 10 | MarkdownPreview 全部渲染断言 | **Vitest 假定时器会阻断动态 import 解析**（marked/highlight.js/DOMPurify 懒加载永不完成），渲染管线静默等待 | 该文件改用真实定时器等待防抖；已在计划中注明此环境限制 | 测试基础设施限制 |

## 4. 产品代码修复与改进清单

| # | 文件 | 变更 | 性质 |
|---|---|---|---|
| 1 | `src/utils/rmb.js`（新增）+ `src/views/tools/RmbUppercase.vue` | 将人民币大写核心转换提取为纯函数 `convertToRmbUppercase`，组件改为导入；配套 20+ 单元断言 | 可测性重构（行为不变，构建与组件测试均验证） |
| 2 | `package.json` / `vitest.config.js` / `tests/**` | 新增测试脚本 `test`、`test:watch`、`verify:tools` 与完整测试基建 | 工程化 |
| 3 | `src/views/tools/CodeScreenshot.vue` | （上一轮浏览器验收发现）highlight.js `html` 语言注册改为复用 xml 定义模块 | 缺陷修复 |

**探测性测试结论（无缺陷但值得记录的安全/健壮性证据）**：
- RegexTester 对测试文本先整体 HTML 转义再高亮，`<img onerror>` 注入无 img 元素产生（防 XSS ✓）
- MarkdownPreview 渲染结果经 DOMPurify 消毒，`<script>` 与 `javascript:` 链接均被清除（✓）
- HttpStatusCodes 过滤为 `indexOf` 字符串匹配，正则特殊字符输入无注入风险（✓）
- IpLookup 网络失败为「行内错误 + Toast」双通道，且自动降级第二 API（✓）
- 随机源（randomInt 拒绝采样）经 1 万次抽样验证无值域盲区（✓）

## 5. 已知测试边界（遗留事项）

> **2026-09-06 更新**：以下 4 项遗留事项已在真实浏览器中完成补充验收，发现并修复 5 个产品缺陷（含 SSL/短链两个 CORS 数据源不可用、RSS 并发竞态、Whois 无重试、CSV 编码乱码）。详见 [TEST-REPORT-SUPPLEMENT.md](./TEST-REPORT-SUPPLEMENT.md)。原遗留记录保留如下：

1. **假定时器 × 动态 import**：Vitest 假定时器环境下懒加载模块无法解析，涉及懒加载组件的测试需用真实定时器，等待渲染一律用轮询断言（MarkdownPreview 测试已按此加固）。
2. **网络类工具**（Ping/Whois/SSL/RSS/汇率/短链/截图/地理编码）单元层仅 mock 网络层验证降级路径；真实 API 行为已浏览器验收通过（10/10）。
3. **媒体类工具**（视频/PDF/画布/思维导图/音频）依赖 Canvas/WebWorker/编解码器，jsdom 不支持；已通过页面内构造文件 + drop 事件注入在真实浏览器验收通过（6/6）。
4. **可访问性**：已注入 axe-core 4.10 扫描首页与工具页（0 违规），键盘导航与焦点可见性抽查通过；后续可在 CI 中引入 axe 定期回归。

## 6. 复现方式

```bash
npm test        # 单次运行全部 148 个用例
npm run test:watch   # 监听模式
npm run build   # 生产构建（含 sitemap）
```
