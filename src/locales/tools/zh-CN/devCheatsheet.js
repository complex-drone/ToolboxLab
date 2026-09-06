export default {
  title: '开发文档速查',
  description: '内置 HTML、CSS、JavaScript 常用语法卡片，支持关键词实时搜索',
  searchLabel: '搜索速查内容',
  searchPlaceholder: '搜索语法名称、关键词或说明…',
  tabs: {
    html: 'HTML',
    css: 'CSS',
    js: 'JavaScript',
  },
  copyCode: '复制代码',
  empty: '没有匹配的条目，换个关键词试试',
  items: {
    htmlDiv: {
      desc: '块级容器元素，用于划分页面结构，配合 class 组织布局',
    },
    htmlSpan: {
      desc: '行内容器，包裹一段文字或行内元素，便于单独设置样式',
    },
    htmlA: {
      desc: '超链接，href 指定跳转地址，target 为 blank 时在新标签页打开',
    },
    htmlImg: {
      desc: '图片元素，alt 提供替代文本，loading 为 lazy 时懒加载',
    },
    htmlUl: {
      desc: '无序列表，配合 li 使用；ol 为有序列表，dl 为描述列表',
    },
    htmlTable: {
      desc: '表格结构，thead 表头、tbody 表体，th 为表头单元格',
    },
    htmlForm: {
      desc: '表单容器，action 为提交地址，method 指定提交方式',
    },
    htmlInput: {
      desc: '单行输入框，type 决定形态，如 text、password、email、checkbox 等',
    },
    htmlSelect: {
      desc: '下拉选择框，option 为选项，selected 表示默认选中',
    },
    htmlTextarea: {
      desc: '多行文本输入，rows 控制行数，maxlength 限制最大长度',
    },
    htmlButton: {
      desc: '按钮，表单内默认 type 为 submit，普通按钮建议显式设为 button',
    },
    htmlIframe: {
      desc: '内嵌框架，在当前页面嵌入另一个文档，注意安全与性能',
    },
    htmlVideo: {
      desc: '视频播放器，controls 显示控制条，poster 为封面图',
    },
    htmlMeta: {
      desc: '文档元信息，charset 声明编码，viewport 控制移动端缩放',
    },
    htmlSemantic: {
      desc: '语义化标签，header、nav、main、article、aside、footer 提升可读性与无障碍体验',
    },
    htmlLabel: {
      desc: '表单标签，通过 for 关联输入框，点击即可聚焦对应控件',
    },
    cssFlexCenter: {
      desc: 'Flex 双轴居中，快速实现水平与垂直同时居中',
    },
    cssFlexBetween: {
      desc: '两端对齐常用于导航栏，gap 控制子项间距',
    },
    cssGridCols: {
      desc: 'Grid 三等分布局，repeat 与 1fr 是最常用的组合',
    },
    cssGridAuto: {
      desc: '自动填充响应式网格，无需媒体查询即可自适应列数',
    },
    cssPosition: {
      desc: 'absolute 相对最近的定位祖先定位，父级需设为 relative',
    },
    cssSticky: {
      desc: '粘性定位，滚动到阈值前随文档流，之后固定在顶部',
    },
    cssHover: {
      desc: '常用交互伪类：hover 悬停、active 按下、focus-visible 键盘聚焦',
    },
    cssNth: {
      desc: '结构伪类，nth-child 支持奇偶 even、odd 与倍数公式 2n',
    },
    cssBefore: {
      desc: '伪元素在元素前后插入内容，常用于装饰符号与清除浮动',
    },
    cssTransition: {
      desc: '过渡动画，让属性变化平滑进行，提升交互质感',
    },
    cssMedia: {
      desc: '媒体查询，按屏幕宽度应用不同样式，是响应式布局的基础',
    },
    cssEllipsis: {
      desc: '单行文本溢出显示省略号，三行属性必须同时使用',
    },
    cssGradient: {
      desc: '线性渐变背景，135deg 表示从左上到右下',
    },
    cssVars: {
      desc: 'CSS 自定义属性，在 root 中定义、用 var 引用，便于统一维护主题',
    },
    cssRadiusShadow: {
      desc: '圆角加柔和投影，是最常见的卡片质感组合',
    },
    cssCenterAbs: {
      desc: '绝对定位配合 translate 负偏移，实现固定居中弹窗',
    },
    jsMap: {
      desc: '映射每个元素并返回新数组，不改变原数组',
    },
    jsFilter: {
      desc: '过滤出满足条件的元素，返回新数组',
    },
    jsReduce: {
      desc: '归并为单个值，常用于求和、计数与对象分组',
    },
    jsFind: {
      desc: '查找第一个满足条件的元素及其下标，找不到时返回 undefined 与 -1',
    },
    jsSomeEvery: {
      desc: 'some 只要有一个满足即为真，every 要求全部满足',
    },
    jsIncludes: {
      desc: '包含判断，数组与字符串通用，indexOf 返回首次出现下标',
    },
    jsSplit: {
      desc: '字符串与数组互转，split 拆分、join 拼接',
    },
    jsTrim: {
      desc: '常用字符串处理：去首尾空格、大小写转换与截取',
    },
    jsSpread: {
      desc: '展开语法，用于数组与对象的浅拷贝和合并',
    },
    jsDestructure: {
      desc: '解构赋值，从对象或数组中快速取值，可设置默认值',
    },
    jsTemplate: {
      desc: '模板字符串，用反引号包裹，可嵌入变量与表达式',
    },
    jsOptional: {
      desc: '可选链，安全访问深层属性，不存在时返回 undefined 而不报错',
    },
    jsNullish: {
      desc: '空值合并只在左侧为 null 或 undefined 时取右侧，注意与或运算的区别',
    },
    jsJson: {
      desc: 'JSON 与对象互转，第三个参数 2 表示缩进美化输出',
    },
    jsDate: {
      desc: '日期常用操作：取年份、输出 ISO 格式与毫秒时间戳',
    },
    jsAsync: {
      desc: 'async await 串行异步流程，配合 try catch 捕获错误',
    },
    jsTimer: {
      desc: '定时器，setTimeout 延时执行一次，setInterval 周期执行',
    },
    jsStorage: {
      desc: '浏览器本地存储，只能存字符串，对象需先序列化',
    },
  },
}
