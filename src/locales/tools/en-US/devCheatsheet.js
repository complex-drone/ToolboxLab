export default {
  title: 'Dev Cheatsheet',
  description: 'Handy HTML, CSS and JavaScript syntax cards with instant keyword search',
  searchLabel: 'Search cheatsheet',
  searchPlaceholder: 'Search by name, keyword or description…',
  tabs: {
    html: 'HTML',
    css: 'CSS',
    js: 'JavaScript',
  },
  copyCode: 'Copy code',
  empty: 'No matching entries, try another keyword',
  items: {
    htmlDiv: {
      desc: 'Block-level container for grouping content and structuring page layout',
    },
    htmlSpan: {
      desc: 'Inline container that wraps a piece of text for targeted styling',
    },
    htmlA: {
      desc: 'Hyperlink. href sets the destination URL, target blank opens a new tab',
    },
    htmlImg: {
      desc: 'Image element. alt provides alternative text, loading lazy enables lazy loading',
    },
    htmlUl: {
      desc: 'Unordered list used with li. Use ol for ordered and dl for description lists',
    },
    htmlTable: {
      desc: 'Table structure: thead for the header, tbody for the body, th for header cells',
    },
    htmlForm: {
      desc: 'Form container. action is the submit URL and method sets the HTTP verb',
    },
    htmlInput: {
      desc: 'Single-line input. type controls the shape such as text, password, email or checkbox',
    },
    htmlSelect: {
      desc: 'Dropdown select box. option defines choices and selected marks the default',
    },
    htmlTextarea: {
      desc: 'Multi-line text input. rows sets the height and maxlength limits the length',
    },
    htmlButton: {
      desc: 'Button. It defaults to submit inside forms, so set an explicit button type otherwise',
    },
    htmlIframe: {
      desc: 'Inline frame that embeds another document. Mind security and performance',
    },
    htmlVideo: {
      desc: 'Video player. controls shows the control bar and poster sets the cover image',
    },
    htmlMeta: {
      desc: 'Document metadata. charset declares the encoding, viewport controls mobile scaling',
    },
    htmlSemantic: {
      desc: 'Semantic tags such as header, nav, main, article, aside and footer improve readability and accessibility',
    },
    htmlLabel: {
      desc: 'Form label linked to an input via for. Clicking it focuses the control',
    },
    cssFlexCenter: {
      desc: 'Flex centering on both axes, the quickest way to center horizontally and vertically',
    },
    cssFlexBetween: {
      desc: 'Space-between alignment, a common navbar pattern. gap controls the spacing',
    },
    cssGridCols: {
      desc: 'Three equal columns with Grid. repeat and 1fr are the most used combination',
    },
    cssGridAuto: {
      desc: 'Auto-fill responsive grid that adapts the column count without media queries',
    },
    cssPosition: {
      desc: 'absolute positions against the nearest positioned ancestor, so set the parent to relative',
    },
    cssSticky: {
      desc: 'Sticky positioning flows normally until the threshold, then stays pinned on top',
    },
    cssHover: {
      desc: 'Common interactive pseudo classes: hover, active and focus-visible for keyboard focus',
    },
    cssNth: {
      desc: 'Structural pseudo classes. nth-child supports even, odd and formulas like 2n',
    },
    cssBefore: {
      desc: 'Pseudo elements insert content before or after an element, great for decorations and clearfix',
    },
    cssTransition: {
      desc: 'Transitions make property changes smooth and improve interaction quality',
    },
    cssMedia: {
      desc: 'Media queries apply styles by screen width, the foundation of responsive layouts',
    },
    cssEllipsis: {
      desc: 'Single-line text overflow with an ellipsis; all three declarations are required',
    },
    cssGradient: {
      desc: 'Linear gradient background. 135deg runs from top-left to bottom-right',
    },
    cssVars: {
      desc: 'CSS custom properties defined on root and read with var for easy theming',
    },
    cssRadiusShadow: {
      desc: 'Rounded corners plus a soft shadow, the classic card look',
    },
    cssCenterAbs: {
      desc: 'Absolute positioning with a negative translate offset centers fixed dialogs',
    },
    jsMap: {
      desc: 'Transforms every element and returns a new array without mutating the original',
    },
    jsFilter: {
      desc: 'Keeps the elements that pass the test and returns a new array',
    },
    jsReduce: {
      desc: 'Folds the array into a single value, great for sums, counts and grouping',
    },
    jsFind: {
      desc: 'Finds the first matching element and its index; a miss yields undefined and -1',
    },
    jsSomeEvery: {
      desc: 'some passes if one element matches, every requires all elements to match',
    },
    jsIncludes: {
      desc: 'Containment checks for arrays and strings. indexOf returns the first position',
    },
    jsSplit: {
      desc: 'Convert between strings and arrays with split and join',
    },
    jsTrim: {
      desc: 'Everyday string helpers: trim edges, change case and slice substrings',
    },
    jsSpread: {
      desc: 'Spread syntax for shallow copies and merges of arrays and objects',
    },
    jsDestructure: {
      desc: 'Destructuring pulls values out of objects or arrays, with optional defaults',
    },
    jsTemplate: {
      desc: 'Template literals are wrapped in backticks and embed variables and expressions',
    },
    jsOptional: {
      desc: 'Optional chaining reaches deep properties safely and yields undefined instead of throwing',
    },
    jsNullish: {
      desc: 'Nullish coalescing falls back only on null or undefined, unlike the OR operator',
    },
    jsJson: {
      desc: 'Convert JSON to objects and back. The third argument 2 pretty-prints with indentation',
    },
    jsDate: {
      desc: 'Common date tasks: get the year, format ISO strings and read millisecond timestamps',
    },
    jsAsync: {
      desc: 'async await sequences asynchronous work, with try catch for errors',
    },
    jsTimer: {
      desc: 'Timers: setTimeout runs once after a delay, setInterval repeats periodically',
    },
    jsStorage: {
      desc: 'Browser storage keeps strings only, so serialize objects first',
    },
  },
}
