import type { AppState } from "../domain/types";

// 存储层：localStorage 持久化，队列/工位/历史同源，刷新后一致
const KEY = "hxyfront-62010:closed-loop:v1";

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    const valid =
      parsed &&
      parsed.version === 1 &&
      Array.isArray(parsed.cylinders) &&
      Array.isArray(parsed.batches) &&
      Array.isArray(parsed.orders) &&
      Array.isArray(parsed.stations) &&
      Array.isArray(parsed.records);
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 存储不可用时静默降级为内存态
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
