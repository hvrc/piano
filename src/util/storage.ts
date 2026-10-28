// localStorage can throw (private mode, blocked site data). Everything stored through these
// helpers is a convenience that the app works without.

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function storageGetJson<T extends object>(key: string): Partial<T> {
  try {
    const v = JSON.parse(storageGet(key) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
