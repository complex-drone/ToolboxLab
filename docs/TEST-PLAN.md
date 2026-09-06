# ToolboxLab 测试计划

## 1. 目标与范围

为 ToolboxLab 的 93 个在线工具建立可持续的自动化测试体系，覆盖三个维度：

| 维度 | 范围 | 工具链 |
|---|---|---|
| 单元测试 | 核心算法、转换/校验函数、composable | Vitest（node/jsdom） |
| 组件测试 | 代表性工具的渲染、交互、持久化、i18n、边界输入 | Vitest + @vue/test-utils + jsdom |
| 集成测试 | 输入 → 处理 → 输出的完整流程、错误降级路径 | 同上 + fetch/canvas mock |

网络类工具（IP/Whois/SSL 等 15 个）单元层以「mock 网络层 + 降级路径」为主，不做真实请求；
媒体类工具（视频/PDF 等）依赖 Canvas/Web Worker，jsdom 不支持，以浏览器验收为准。
真实浏览器补充验收已于 2026-09-06 完成（10 个网络工具 + 6 个媒体工具 + axe 可访问性扫描），
过程中发现并修复 5 个真实缺陷，详见 [TEST-REPORT-SUPPLEMENT.md](./TEST-REPORT-SUPPLEMENT.md)。

## 2. 测试基础设施

- 运行器：Vitest 2.x（复用 Vite 配置与 `@` 别名）
- 环境：jsdom；`tests/setup.js` 补齐 `crypto.getRandomValues/randomUUID`，每个用例前清空 localStorage，用例后恢复真实定时器与 mock
- i18n：`tests/helpers/i18n.js` 加载**真实双语语言包**（与线上一致的合并逻辑）——缺键会直接导致断言失败，防止文案回归
- 运行：`npm test`（单次）/ `npm run test:watch`

## 3. 单元测试用例矩阵

### 3.1 utils/random（加密随机源）
| 用例 | 类型 |
|---|---|
| randomInt 输出严格落在 [0, max) 且覆盖全值域（抽样 1 万次） | 正向 |
| randomInt(1) 恒为 0；randomInt(0/-1/1.5) 抛异常 | 边界 |
| randomIntBetween 双端包含 | 边界 |
| secureShuffle 是置换（元素与数量不变）且不修改原数组 | 正向 |
| randomPick 空数组抛异常；sampleWithoutReplacement 不重复、n≥长度时返回全排列 | 边界 |

### 3.2 utils/format
| 用例 | 类型 |
|---|---|
| formatBytes: 0/512/1024/1536/1048576/负数/NaN/Infinity | 边界 |
| byteLength: 空串/ASCII/中文(3B)/emoji(4B) | 边界 |
| padZero 补零与绝对值 | 正向 |

### 3.3 utils/clipboard
| 用例 | 类型 |
|---|---|
| Clipboard API 可用时写入成功返回 true | 正向 |
| API 缺失时降级 execCommand；execCommand 失败返回 false | 异常 |
| 非字符串输入直接返回 false | 边界 |

### 3.4 composables/useToast
| 用例 | 类型 |
|---|---|
| success/info/error 设置正确类型；show 默认 success | 正向 |
| 新 Toast 替换旧 Toast（单条展示约定） | 正向 |
| 到期自动移除（fake timers） | 正向 |
| remove 仅移除当前显示的那条 | 边界 |

### 3.5 utils/rmb（从 RmbUppercase.vue 提取的纯函数）
| 用例 | 类型 |
|---|---|
| 1234.56→壹仟贰佰叁拾肆元伍角陆分；10→壹拾元整；0→零元整 | 正向 |
| 0.5→伍角；0.05→伍分；12.05→壹拾贰元零伍分 | 边界 |
| 1002→壹仟零贰元整（中间补零）；110→壹佰壹拾元整 | 边界 |
| 1000000→壹佰万元整；100000005→壹亿零伍元整 | 边界 |
| 负数/超上限/非法输入的处理行为 | 异常 |

## 4. 组件测试用例矩阵（10 个代表性工具）

选择原则：覆盖 6 大分类 + 高风险算法 + 三类持久化/防抖/随机源模式。

| 组件 | 关键用例 |
|---|---|
| JsonFormatter | 合法 JSON 格式化输出；非法 JSON 行列错误；空输入不崩溃；缩进选项持久化 |
| TextStats | 空输入全 0；中文/emoji 计数与字节；防抖后更新 |
| CaseConverter | 混合风格拆词；五种风格输出；空输入 |
| RmbUppercase | 上面 3.5 的 UI 版；负数/超限行内报错；持久化 |
| UnitConverter | 长度双向；温度特殊函数；存储二进制/十进制切换；交换 |
| HttpStatusCodes | 数字/关键词过滤；正则特殊字符输入不崩溃（潜在 bug 探测）；分组渲染 |
| RegexTester | 匹配数与分组；非法正则不崩溃；HTML 转义防 XSS；i18n |
| PomodoroTimer | 初始 25:00；fake timers 倒计时推进；暂停/重置；无 Notification API 降级 |
| TextDedupe | 去重统计；升/降序；忽略大小写；空输入 |
| IpLookup | fetch 失败 → 行内错误 + 不崩溃；成功响应 → 字段渲染（mock） |

## 5. 集成测试用例矩阵

| 流程 | 用例 |
|---|---|
| DataFormatConverter | JSON→YAML 完整流程；交换互换；非法 YAML 显示解析错误；XML 往返 |
| MarkdownPreview | GFM 表格/任务列表渲染；代码高亮 class；`<script>` 注入被 DOMPurify 清洗（安全）；复制 HTML 按钮存在 |

## 6. 通过标准

1. 全部用例通过；新增修复必须附回归用例
2. 组件测试断言用户可见文案（经 i18n），禁止 selector 硬编码实现细节
3. 单次 `npm test` 总时长 < 60s
