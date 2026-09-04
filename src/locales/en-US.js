export default {
  // 全局通用
  app: {
    name: 'ToolboxLab',
    description: 'Pure frontend local toolset, all data processed locally',
    slogan: 'ToolboxLab',
  },

  // 导航
  nav: {
    home: 'Home',
    about: 'About',
  },

  // 页脚
  footer: {
    copyright: 'All rights reserved',
    privacy: 'All data is processed locally and will not be uploaded to any server',
  },

  // 首页
  home: {
    title: 'ToolboxLab',
    description: 'Pure frontend local toolset, all data processed locally',
    bottomTip: 'Click on the tool card above to get started',
  },

  // 密码生成器
  password: {
    title: 'Password Generator',
    description: 'Generate high-strength random passwords locally in the browser, no backend required',
    length: {
      label: 'Password Length',
      unit: 'chars',
    },
    charset: {
      label: 'Character Options',
      uppercase: 'Uppercase',
      lowercase: 'Lowercase',
      numbers: 'Numbers',
      symbols: 'Symbols',
      sample: {
        uppercase: 'A-Z',
        lowercase: 'a-z',
        numbers: '0-9',
        symbols: '!@#$%',
      },
    },
    excludeAmbiguous: {
      label: 'Exclude Ambiguous Characters',
      hint: 'Avoid ambiguous characters like 0/O, 1/l',
    },
    excludeSymbols: {
      label: 'Exclude Special Symbols',
      stats: '{excluded} / {total} excluded',
    },
    presets: {
      html: 'HTML',
      url: 'URL',
    },
    generate: {
      label: 'Generate Password',
      loading: 'Generating...',
    },
    copy: {
      label: 'Copy',
      copied: 'Copied',
    },
    strength: {
      label: 'Password Strength',
      weak: 'Weak',
      medium: 'Medium',
      strong: 'Strong',
      invalid: 'Invalid',
      hint: '{length} chars · {types} types · ~{entropy} bits entropy',
    },
    toast: {
      generated: '🔐 Password generated',
      copied: '✅ Copied to clipboard',
      copyFailed: '❌ Copy failed',
    },
    toggleVisibility: 'Toggle password visibility',
    placeholder: 'Click "Generate Password"',
    randomSource: {
      label: 'Random Source',
      crypto: 'crypto.getRandomValues (cryptographic)',
      fallback: 'Math.random (fallback)',
      note: 'All calculations done locally in browser',
    },
    selected: 'Selected',
    total: 'Total',
    warning: {
      allSymbolsExcluded: '⚠️ All special symbols excluded, please keep at least one or uncheck "Symbols"',
      noCharset: 'Please select at least one character type',
    },
    actions: {
      excludeHtml: 'Exclude HTML Symbols',
      cancelExcludeHtml: 'Include HTML Symbols',
      excludeUrl: 'Exclude URL Symbols',
      cancelExcludeUrl: 'Include URL Symbols',
      reset: 'Reset',
    },
  },

  // 关于页面
  about: {
    title: 'About ToolboxLab',
    description: 'This is a pure frontend local toolset. All data processing is done in your browser and will not be uploaded to any server.',
    features: {
      privacy: {
        name: 'Privacy Protection',
        desc: 'All calculations are done locally, data never leaves your device',
      },
      speed: {
        name: 'Fast Response',
        desc: 'No need to wait for network requests, instant results',
      },
      design: {
        name: 'Modern Design',
        desc: 'Beautiful interface with glassmorphism and smooth animations',
      },
    },
    techStack: 'Tech Stack',
    version: 'Version',
  },

  // 语言切换
  language: {
    label: 'Language',
    zhCN: '简体中文',
    enUS: 'English',
  },
}
