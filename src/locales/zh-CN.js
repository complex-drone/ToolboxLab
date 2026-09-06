export default {
  // 全局通用
  app: {
    name: 'ToolboxLab',
    description: '纯前端本地工具集，所有数据仅在本地处理',
    slogan: 'ToolboxLab',
  },

  // 导航
  nav: {
    home: '首页',
    about: '关于',
  },

  // 页脚
  footer: {
    copyright: '保留所有权利',
    privacy: '所有数据仅在本地处理，不会上传至任何服务器',
    repo: 'GitHub 仓库',
    feedback: '反馈问题',
  },

  // 首页
  home: {
    title: 'ToolboxLab',
    description: '纯前端本地工具集，所有数据仅在本地处理',
    bottomTip: '点击上方工具卡片，即可开始使用',
  },

  // 密码生成器
  password: {
    title: '密码生成器',
    description: '在浏览器本地生成高强度随机密码，不依赖任何后端',
    length: {
      label: '密码长度',
      unit: '位',
    },
    charset: {
      label: '字符选项',
      uppercase: '大写字母',
      lowercase: '小写字母',
      numbers: '数字',
      symbols: '特殊符号',
      sample: {
        uppercase: 'A-Z',
        lowercase: 'a-z',
        numbers: '0-9',
        symbols: '!@#$%',
      },
    },
    excludeAmbiguous: {
      label: '排除易混淆字符',
      hint: '避免 0/O、1/l 等易混淆字符',
    },
    excludeSymbols: {
      label: '排除特殊符号',
      stats: '{excluded} / {total} 已排除',
    },
    presets: {
      html: 'HTML',
      url: 'URL',
    },
    generate: {
      label: '生成新密码',
      loading: '生成中...',
    },
    copy: {
      label: '复制',
      copied: '已复制',
    },
    strength: {
      label: '密码强度',
      weak: '弱',
      medium: '中等',
      strong: '强',
      invalid: '无效',
      hint: '长度 {length} 位 · {types} 类字符 · 约 {entropy} bits 熵',
    },
    toast: {
      generated: '🔐 已生成新密码',
      copied: '✅ 已复制到剪贴板',
      copyFailed: '❌ 复制失败',
    },
    toggleVisibility: '切换密码可见性',
    placeholder: '点击「生成新密码」',
    randomSource: {
      label: '随机源',
      crypto: 'crypto.getRandomValues（加密级）',
      fallback: 'Math.random（降级）',
      note: '全部计算在本地浏览器完成',
    },
    selected: '已选',
    total: '总',
    warning: {
      allSymbolsExcluded: '⚠️ 特殊符号已全部排除，请至少保留一个符号或取消勾选"特殊符号"',
      noCharset: '请至少勾选一种字符类型',
    },
    actions: {
      excludeHtml: '排除 HTML 符号',
      cancelExcludeHtml: '取消排除 HTML 符号',
      excludeUrl: '排除 URL 符号',
      cancelExcludeUrl: '取消排除 URL 符号',
      reset: '重置',
    },
  },

  // 关于页面
  about: {
    title: '关于 ToolboxLab',
    description: '这是一个纯前端本地工具集，所有数据处理均在您的浏览器中完成，不会上传至任何服务器。',
    features: {
      privacy: {
        name: '隐私保护',
        desc: '所有计算在本地完成，数据不离开您的设备',
      },
      speed: {
        name: '快速响应',
        desc: '无需等待网络请求，即时生成结果',
      },
      design: {
        name: '现代设计',
        desc: '采用毛玻璃效果与流畅动画的精美界面',
      },
    },
    techStack: '技术栈',
    version: '版本',
  },

  // 语言切换
  language: {
    label: '语言',
    zhCN: '简体中文',
    enUS: 'English',
  },

  // 首页分类
  categories: {
    searchPlaceholder: '搜索工具名称或描述…',
    searchEmpty: '没有找到匹配的工具',
    toolsCount: '{count} 个工具在线使用',
    list: {
      format: { name: '格式校验与数据转换' },
      text: { name: '文本处理与开发辅助' },
      code: { name: '代码辅助与文档工具' },
      network: { name: '网络与站长工具' },
      media: { name: '文档与媒体处理' },
      security: { name: '安全、效率与杂项' },
    },
  },

  // 工具页公共文案（tools.<id> 下的具体文案在各工具语言包中）
  toolsCommon: {
    copied: '✅ 已复制到剪贴板',
    copyFailed: '❌ 复制失败',
    copy: '复制',
    copyAll: '复制全部',
    download: '下载',
    clear: '清空',
    reset: '重置',
    convert: '转换',
    swap: '交换',
    input: '输入',
    output: '输出',
    result: '结果',
    settings: '设置',
    options: '选项',
    preview: '预览',
    example: '示例',
    error: '处理出错，请检查输入',
    invalidInput: '输入内容无效',
    processing: '处理中…',
    fileTooLarge: '文件过大，最大支持 {size}',
    dropHint: '拖拽文件到此处，或点击选择',
    upload: '上传文件',
    reupload: '重新上传',
    unsupportedFile: '不支持的文件类型',
    notAvailable: '当前环境不可用',
    loaded: '加载成功',
    loadFailed: '加载失败',
    networkError: '网络请求失败，请稍后重试',
    bytes: '字节',
    chars: '字符',
    lines: '行',
    words: '词数',
    none: '暂无数据',
    total: '共',
    items: '项',
    yes: '是',
    no: '否',
    all: '全部',
    seconds: '秒',
    done: '完成',
  },
}
