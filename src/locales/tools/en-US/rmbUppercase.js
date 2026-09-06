export default {
  title: 'RMB in Words',
  description: 'Convert amounts to standard Chinese capital words for RMB, following yuan-jiao-fen and integer rules, ideal for invoices',
  amountLabel: 'Amount (CNY)',
  amountPlaceholder: 'Enter an amount, e.g. 1234.56',
  examples: 'Examples',
  resultPlaceholder: 'The Chinese capital words appear once an amount is entered',
  truncatedHint: 'More than two decimal places were entered. Only the first two are used (no rounding)',
  digitTable: 'Capital digits: ',
  unitTable: 'Place units: ',
  note: 'Rules: the maximum amount is 9999 hundred million (999900000000) with up to two decimals. "整" is appended when there are no jiao or fen, "零" is inserted after yuan when there are fen but no jiao, and consecutive zeros in the middle merge into a single "零"',
  errors: {
    negative: 'Please enter an amount no less than 0. Negative values are not supported',
    overLimit: 'The amount exceeds the limit of 9999 hundred million. Please enter a smaller amount',
    invalid: 'Please enter a valid amount, e.g. 1234.56',
  },
}
