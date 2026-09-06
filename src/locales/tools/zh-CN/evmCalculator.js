export default {
  title: 'EVM 挣值计算器',
  description: '输入 BAC、AC、PV、EV，自动计算 SPI、CPI 等挣值指标并给出项目健康状态',
  inputsTitle: '基础输入',
  fillExample: '示例数据',
  exampleFilled: '已填入示例数据，可在此基础上修改',
  errNonNegative: '请输入不小于 0 的数字（最多两位小数）',
  statusTitle: '项目健康状态',
  status: {
    good: '状态良好',
    warn: '需要关注',
    bad: '存在风险',
    idle: '等待输入',
  },
  advice: {
    good: '进度与成本均在计划之内，建议保持当前节奏并持续监控偏差趋势',
    warn: '进度或成本已轻度偏离计划，建议分析偏差原因并在近期采取纠正措施',
    bad: '进度或成本严重偏离计划，建议立即排查关键任务并重新评估资源与范围',
    idle: '请先填入四个基础值（BAC、AC、PV、EV），再查看健康状态',
  },
  metricsTitle: '挣值指标',
  divZeroHint: '该项因分母为 0（或上游指标缺失）无法计算，已显示为「—」',
  fields: {
    bac: {
      label: 'BAC 完工预算',
      placeholder: '如 100000',
    },
    ac: {
      label: 'AC 实际成本',
      placeholder: '如 52000',
    },
    pv: {
      label: 'PV 计划价值',
      placeholder: '如 60000',
    },
    ev: {
      label: 'EV 挣值',
      placeholder: '如 57000',
    },
  },
  metrics: {
    sv: {
      name: 'SV 进度偏差',
      meaning: '与计划相比的进度差额，小于 0 表示进度落后',
    },
    cv: {
      name: 'CV 成本偏差',
      meaning: '与实际成本相比的差额，小于 0 表示成本超支',
    },
    spi: {
      name: 'SPI 进度绩效指数',
      meaning: '小于 1 表示进度落后，越接近 1 越符合计划',
    },
    cpi: {
      name: 'CPI 成本绩效指数',
      meaning: '小于 1 表示成本超支，越接近 1 资金效率越高',
    },
    eac: {
      name: 'EAC 完工估算',
      meaning: '按当前成本效率推算的预计总成本',
    },
    etc: {
      name: 'ETC 完工尚需',
      meaning: '完成剩余工作预计还需投入的成本',
    },
    vac: {
      name: 'VAC 完工偏差',
      meaning: '预计总成本与预算的差额，小于 0 表示预计将超支',
    },
    tcpi: {
      name: 'TCPI 完工尚需绩效指数',
      meaning: '剩余工作要达到预算所需的成本效率，大于 1 表示剩余预算偏紧',
    },
  },
  note: '公式与判定基于挣值管理（EVM）通用规则：SPI、CPI 不小于 1 为良好，0.9 至 1 之间为轻度偏离，小于 0.9 为高风险。结果仅供参考，请结合项目实际情况判断',
}
