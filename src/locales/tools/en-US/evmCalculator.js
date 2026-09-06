export default {
  title: 'EVM Calculator',
  description: 'Enter BAC, AC, PV and EV to compute SPI, CPI and other earned value metrics with a project health status',
  inputsTitle: 'Basic Inputs',
  fillExample: 'Sample Data',
  exampleFilled: 'Sample data filled in. Feel free to adjust the values',
  errNonNegative: 'Please enter a number no less than 0 (up to 2 decimals)',
  statusTitle: 'Project Health',
  status: {
    good: 'On Track',
    warn: 'Needs Attention',
    bad: 'At Risk',
    idle: 'Waiting for Input',
  },
  advice: {
    good: 'Schedule and cost are both within plan. Keep the current pace and keep monitoring the variances',
    warn: 'Schedule or cost has drifted slightly from plan. Analyze the cause and take corrective action soon',
    bad: 'Schedule or cost is far off plan. Investigate critical tasks immediately and re-plan resources and scope',
    idle: 'Fill in the four basic values (BAC, AC, PV, EV) to see the health status',
  },
  metricsTitle: 'Earned Value Metrics',
  divZeroHint: 'This metric cannot be computed because a denominator is 0 (or an upstream metric is missing). It shows as "—" (a dash)',
  fields: {
    bac: {
      label: 'BAC (Budget at Completion)',
      placeholder: 'e.g. 100000',
    },
    ac: {
      label: 'AC (Actual Cost)',
      placeholder: 'e.g. 52000',
    },
    pv: {
      label: 'PV (Planned Value)',
      placeholder: 'e.g. 60000',
    },
    ev: {
      label: 'EV (Earned Value)',
      placeholder: 'e.g. 57000',
    },
  },
  metrics: {
    sv: {
      name: 'SV Schedule Variance',
      meaning: 'Schedule difference versus plan; below 0 means behind schedule',
    },
    cv: {
      name: 'CV Cost Variance',
      meaning: 'Cost difference versus actual spend; below 0 means over budget',
    },
    spi: {
      name: 'SPI Schedule Performance Index',
      meaning: 'Below 1 means behind schedule; the closer to 1, the more on plan',
    },
    cpi: {
      name: 'CPI Cost Performance Index',
      meaning: 'Below 1 means over budget; the closer to 1, the more efficient the spending',
    },
    eac: {
      name: 'EAC Estimate at Completion',
      meaning: 'Projected total cost based on the current cost efficiency',
    },
    etc: {
      name: 'ETC Estimate to Complete',
      meaning: 'Additional cost expected to finish the remaining work',
    },
    vac: {
      name: 'VAC Variance at Completion',
      meaning: 'Projected total cost minus budget; below 0 means an expected overrun',
    },
    tcpi: {
      name: 'TCPI To-Complete Performance Index',
      meaning: 'Cost efficiency required on remaining work to hit budget; above 1 means the remaining budget is tight',
    },
  },
  note: 'Formulas and thresholds follow common Earned Value Management (EVM) rules: SPI and CPI at or above 1 are healthy, 0.9 to 1 means mild deviation, below 0.9 means high risk. Results are for reference only and should be judged against the real project situation',
}
