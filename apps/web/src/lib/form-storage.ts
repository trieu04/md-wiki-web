/** Form text kept in `sessionStorage` under `mw:form:<route>:<id>` (system-logic §10). */
export function readStored(key: string) {
  try {
    return globalThis.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null || value === '') globalThis.sessionStorage.removeItem(key);
    else globalThis.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the text stays in component state.
  }
}
