export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function parseConfig(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}
