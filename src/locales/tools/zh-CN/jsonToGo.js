export default {
  title: 'JSON 转 Go Struct',
  description: '把 JSON 实时转换为 Go struct 定义，支持嵌套结构、数组、json tag 与 omitempty',
  nestedStyle: '嵌套对象风格',
  styleNamed: '独立命名 struct（同形状自动复用）',
  styleInline: '内联匿名 struct',
  omitempty: '为 json tag 追加 omitempty',
  inputPlaceholder: '在此粘贴 JSON，300ms 后自动转换为 Go struct…',
  parseFailed: 'JSON 解析失败',
  positionHint: '错误位置：第 %1 行，第 %2 列附近',
  bigIntHint: '以下字段中的整数超出 int64 安全范围，已映射为 float64：',
}
