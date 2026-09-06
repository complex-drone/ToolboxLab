/**
 * 工具注册表：全部工具的单一数据源
 * - id：camelCase，同时是语言包键 tools.<id> 和路由 name
 * - path：路由路径段（kebab-case）
 * - file：src/views/tools/ 下的组件文件名（PascalCase.vue）
 * - icon：首页卡片图标
 * 组件通过 import.meta.glob 按需解析，文件不存在时该工具不会出现在站点上
 */
const toolModules = import.meta.glob('../views/tools/*.vue')

function tool(id, path, file, icon) {
  return {
    id,
    path,
    icon,
    component: toolModules[`../views/tools/${file}`],
  }
}

/** 已有工具：密码生成器位于 components 目录 */
const passwordTool = {
  id: 'password',
  path: '/password',
  icon: '🔑',
  nameKey: 'password.title',
  descKey: 'password.description',
  component: () => import('../components/PasswordGenerator.vue'),
}

export const TOOL_CATEGORIES = [
  {
    key: 'format',
    icon: '🧰',
    tools: [
      tool('jsonFormatter', '/json-formatter', 'JsonFormatter.vue', '🧾'),
      tool('timestampConverter', '/timestamp-converter', 'TimestampConverter.vue', '⏱️'),
      tool('urlBase64', '/url-base64', 'UrlBase64.vue', '🔗'),
      tool('regexTester', '/regex-tester', 'RegexTester.vue', '🎯'),
      tool('uuidGenerator', '/uuid-generator', 'UuidGenerator.vue', '🆔'),
      tool('hashGenerator', '/hash-generator', 'HashGenerator.vue', '#️⃣'),
      tool('jwtDecoder', '/jwt-decoder', 'JwtDecoder.vue', '🎫'),
      tool('cronParser', '/cron-parser', 'CronParser.vue', '⏰'),
      tool('textStats', '/text-stats', 'TextStats.vue', '📊'),
      tool('caseConverter', '/case-converter', 'CaseConverter.vue', '🔤'),
      tool('textDiff', '/text-diff', 'TextDiff.vue', '↔️'),
      tool('textDedupe', '/text-dedupe', 'TextDedupe.vue', '🧹'),
      tool('dataFormatConverter', '/data-format-converter', 'DataFormatConverter.vue', '🔄'),
      tool('markdownPreview', '/markdown-preview', 'MarkdownPreview.vue', '📄'),
      tool('escapeTool', '/escape-tool', 'EscapeTool.vue', '📑'),
    ],
  },
  {
    key: 'text',
    icon: '✍️',
    tools: [
      tool('radixConverter', '/radix-converter', 'RadixConverter.vue', '🔢'),
      tool('mockDataGenerator', '/mock-data-generator', 'MockDataGenerator.vue', '🎲'),
      tool('loremIpsum', '/lorem-ipsum', 'LoremIpsum.vue', '📃'),
      tool('qrCodeGenerator', '/qr-code-generator', 'QrCodeGenerator.vue', '🔳'),
      tool('imageConverter', '/image-converter', 'ImageConverter.vue', '🖼️'),
      tool('imageCropper', '/image-cropper', 'ImageCropper.vue', '✂️'),
      tool('imageBase64', '/image-base64', 'ImageBase64.vue', '📇'),
      tool('exifViewer', '/exif-viewer', 'ExifViewer.vue', '📷'),
      tool('colorConverter', '/color-converter', 'ColorConverter.vue', '🎨'),
      tool('gradientGenerator', '/gradient-generator', 'GradientGenerator.vue', '🌈'),
      tool('boxShadowGenerator', '/box-shadow-generator', 'BoxShadowGenerator.vue', '🔲'),
      tool('flexboxGenerator', '/flexbox-generator', 'FlexboxGenerator.vue', '📐'),
      tool('ipLookup', '/ip-lookup', 'IpLookup.vue', '🌍'),
      tool('httpStatusCodes', '/http-status-codes', 'HttpStatusCodes.vue', '🚦'),
      tool('userAgentParser', '/user-agent-parser', 'UserAgentParser.vue', '🕵️'),
      tool('dnsLookup', '/dns-lookup', 'DnsLookup.vue', '📡'),
      tool('unitConverter', '/unit-converter', 'UnitConverter.vue', '⚖️'),
      tool('morseCode', '/morse-code', 'MorseCode.vue', '📻'),
      tool('randomPicker', '/random-picker', 'RandomPicker.vue', '🎰'),
      tool('sqlFormatter', '/sql-formatter', 'SqlFormatter.vue', '🗃️'),
    ],
  },
  {
    key: 'code',
    icon: '💻',
    tools: [
      tool('devCheatsheet', '/dev-cheatsheet', 'DevCheatsheet.vue', '📚'),
      tool('codeScreenshot', '/code-screenshot', 'CodeScreenshot.vue', '📸'),
      tool('codeLineCounter', '/code-line-counter', 'CodeLineCounter.vue', '📏'),
      tool('gitignoreGenerator', '/gitignore-generator', 'GitignoreGenerator.vue', '🙈'),
      tool('licenseGenerator', '/license-generator', 'LicenseGenerator.vue', '📜'),
      tool('commitGenerator', '/commit-generator', 'CommitGenerator.vue', '💬'),
      tool('openapiViewer', '/openapi-viewer', 'OpenapiViewer.vue', '📘'),
      tool('curlConverter', '/curl-converter', 'CurlConverter.vue', '🌀'),
      tool('whitespaceViewer', '/whitespace-viewer', 'WhitespaceViewer.vue', '👁️'),
      tool('mysqlToJava', '/mysql-to-java', 'MysqlToJava.vue', '☕'),
      tool('jsonToGo', '/json-to-go', 'JsonToGo.vue', '🐹'),
      tool('tomlFormatter', '/toml-formatter', 'TomlFormatter.vue', '🍅'),
      tool('yamlFormatter', '/yaml-formatter', 'YamlFormatter.vue', '🗒️'),
      tool('emojiSearch', '/emoji-search', 'EmojiSearch.vue', '😀'),
      tool('programmerCalculator', '/programmer-calculator', 'ProgrammerCalculator.vue', '_lcd'),
    ],
  },
  {
    key: 'network',
    icon: '🌐',
    tools: [
      tool('pingTest', '/ping-test', 'PingTest.vue', '🏓'),
      tool('whoisLookup', '/whois-lookup', 'WhoisLookup.vue', '🔎'),
      tool('httpHeadersViewer', '/http-headers-viewer', 'HttpHeadersViewer.vue', '📬'),
      tool('sslChecker', '/ssl-checker', 'SslChecker.vue', '🔒'),
      tool('robotsGenerator', '/robots-generator', 'RobotsGenerator.vue', '🤖'),
      tool('mimeLookup', '/mime-lookup', 'MimeLookup.vue', '🗂️'),
      tool('subnetCalculator', '/subnet-calculator', 'SubnetCalculator.vue', '🕸️'),
      tool('urlParser', '/url-parser', 'UrlParser.vue', '🧩'),
      tool('portLookup', '/port-lookup', 'PortLookup.vue', '🚪'),
      tool('htaccessToNginx', '/htaccess-to-nginx', 'HtaccessToNginx.vue', '⚙️'),
      tool('rssReader', '/rss-reader', 'RssReader.vue', '📰'),
      tool('currencyConverter', '/currency-converter', 'CurrencyConverter.vue', '💱'),
      tool('worldClock', '/world-clock', 'WorldClock.vue', '🕐'),
      tool('shortUrl', '/short-url', 'ShortUrl.vue', '🖇️'),
      tool('webpageScreenshot', '/webpage-screenshot', 'WebpageScreenshot.vue', '🖥️'),
    ],
  },
  {
    key: 'media',
    icon: '📀',
    tools: [
      tool('pdfToolbox', '/pdf-toolbox', 'PdfToolbox.vue', '📕'),
      tool('pdfToImage', '/pdf-to-image', 'PdfToImage.vue', '🎞️'),
      tool('officeConverter', '/office-converter', 'OfficeConverter.vue', '📙'),
      tool('excelToJson', '/excel-to-json', 'ExcelToJson.vue', '📈'),
      tool('mathEditor', '/math-editor', 'MathEditor.vue', '➗'),
      tool('mindMap', '/mind-map', 'MindMap.vue', '🧠'),
      tool('drawingCanvas', '/drawing-canvas', 'DrawingCanvas.vue', '🖌️'),
      tool('tableConverter', '/table-converter', 'TableConverter.vue', '🛠️'),
      tool('videoAspect', '/video-aspect', 'VideoAspect.vue', '🎬'),
      tool('videoToGif', '/video-to-gif', 'VideoToGif.vue', '📽️'),
      tool('svgOptimizer', '/svg-optimizer', 'SvgOptimizer.vue', '✒️'),
      tool('faviconGenerator', '/favicon-generator', 'FaviconGenerator.vue', '⭐'),
      tool('geoCoordinates', '/geo-coordinates', 'GeoCoordinates.vue', '📍'),
      tool('audioConverter', '/audio-converter', 'AudioConverter.vue', '🎵'),
      tool('chineseConverter', '/chinese-converter', 'ChineseConverter.vue', '🀄'),
    ],
  },
  {
    key: 'security',
    icon: '🛡️',
    tools: [
      passwordTool,
      tool('passwordStrength', '/password-strength', 'PasswordStrength.vue', '💪'),
      tool('aesRsaCrypto', '/aes-rsa-crypto', 'AesRsaCrypto.vue', '🔐'),
      tool('bcryptTool', '/bcrypt-tool', 'BcryptTool.vue', '🧱'),
      tool('sshKeyGenerator', '/ssh-key-generator', 'SshKeyGenerator.vue', '🗝️'),
      tool('fileChecksum', '/file-checksum', 'FileChecksum.vue', '☑️'),
      tool('pomodoroTimer', '/pomodoro-timer', 'PomodoroTimer.vue', '⏳'),
      tool('resumeBuilder', '/resume-builder', 'ResumeBuilder.vue', '📋'),
      tool('mbtiTest', '/mbti-test', 'MbtiTest.vue', '🎭'),
      tool('evmCalculator', '/evm-calculator', 'EvmCalculator.vue', '💹'),
      tool('barcodeGenerator', '/barcode-generator', 'BarcodeGenerator.vue', '🏷️'),
      tool('danmaku', '/danmaku', 'Danmaku.vue', '📢'),
      tool('rmbUppercase', '/rmb-uppercase', 'RmbUppercase.vue', '💴'),
    ],
  },
]

/** 所有工具（含分类信息引用），扁平化列表 */
export const ALL_TOOLS = TOOL_CATEGORIES.flatMap(cat =>
  cat.tools.map(t => ({ ...t, category: cat.key }))
)

/** 判断工具组件是否已存在（文件已实现） */
export function isToolAvailable(entry) {
  return typeof entry.component === 'function'
}

/** 工具显示标题的语言包键 */
export function toolNameKey(entry) {
  return entry.nameKey || `tools.${entry.id}.title`
}

/** 工具描述的语言包键 */
export function toolDescKey(entry) {
  return entry.descKey || `tools.${entry.id}.description`
}
