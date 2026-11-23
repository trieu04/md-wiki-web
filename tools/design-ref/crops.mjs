// The key in variants.json is the output name (and defaults to the gallery wrapper ID).
export function cropPlan(config) {
  return Object.entries(config.crops ?? {}).map(([id, crop]) => {
    const [component, variant] = id.split('/');
    if (
      !/^[A-Z][a-zA-Z0-9]*\/[a-z0-9_-]+$/.test(id) ||
      !Object.hasOwn(config, crop.frame) ||
      crop.frame === 'crops' ||
      !Object.hasOwn(config[crop.frame], crop.variant) ||
      !crop.selector?.trim()
    )
      throw new Error(`Invalid design crop: ${id}`);
    return { ...crop, id, component, name: variant };
  });
}
