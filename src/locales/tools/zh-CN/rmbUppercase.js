export default {
  title: '人民币大写',
  description: '金额一键转换为标准中文大写，支持元角分与整的规则，财务报销单据必备',
  amountLabel: '金额（元）',
  amountPlaceholder: '请输入金额，例如 1234.56',
  examples: '快捷示例',
  resultPlaceholder: '输入金额后即可显示对应的人民币大写',
  truncatedHint: '小数超过两位，已截断前两位转换（未四舍五入）',
  digitTable: '大写数字：',
  unitTable: '数位单位：',
  note: '规则说明：金额上限 9999 亿，最多保留两位小数；无角无分时末尾加「整」，有分无角时在元后加「零」，中间连续零合并为一个「零」',
  errors: {
    negative: '请输入不小于 0 的金额，不支持负数',
    overLimit: '金额超出上限 9999 亿，请缩小金额后重试',
    invalid: '请输入有效的金额数字，例如 1234.56',
  },
}
