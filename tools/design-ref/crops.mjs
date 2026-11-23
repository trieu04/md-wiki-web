// The key in variants.json is the output name (and defaults to the gallery wrapper ID).
export function cropPlan(config) {
  return Object.entries(config.crops ?? {}).map(([id, crop]) => {
    const [component, variant] = id.split('/');
    if (
      !/^[A-Z][a-zA-Z0-9]*\/[a-z0-9_-]+$/.test(id) ||
      !Object.hasOwn(config, crop.frame) ||
      crop.frame === 'crops' ||
      !Object.hasOwn(config[crop.frame], crop.variant) ||
      !crop.selector?.trim() ||
      (crop.structure &&
        (!Array.isArray(crop.structure) ||
          crop.structure.length !== 2 ||
          crop.structure.some((column) => typeof column !== 'string' || !column.trim())))
    )
      throw new Error(`Invalid design crop: ${id}`);
    return { ...crop, id, component, name: variant };
  });
}

// Visual probes compare the columns themselves, not the not-yet-implemented screens.
// Use contrasting frame palette colors so pixelmatch detects either column's edges.
export const layoutProbeStyle = `
  [data-layout-probe] > * { visibility: hidden !important; }
  [data-layout-probe="0"] { background: #2453d6 !important; }
  [data-layout-probe="1"] { background: #14161b !important; }
`;

// Runs in the page. Match only the reference heights (the app doesn't render
// the screen content yet); let the app determine the widths and wrapping.
export function markLayoutColumns(root, { selectors, heights }) {
  return selectors.map((selector, index) => {
    const column = root.querySelector(selector);
    if (!column) throw new Error(`Missing layout column: ${selector}`);
    column.setAttribute('data-layout-probe', String(index));
    if (heights) column.style.minHeight = `${heights[index]}px`;
    return column.getBoundingClientRect().height;
  });
}

export function clearLayoutColumns(root) {
  for (const column of root.querySelectorAll('[data-layout-probe]')) {
    column.removeAttribute('data-layout-probe');
  }
}
