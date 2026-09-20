import { useSyncExternalStore } from "react";
import type { AppState } from "../domain/types";

export interface TransitionResult {
  ok: boolean;
  message: string;
  state?: AppState;
}

// 状态迁移：纯函数，接收当前状态，返回结果（成功时携带新状态）
export type Transition = (s: AppState) => TransitionResult;

// 单一状态源：dispatch 同步执行，前置校验与落库在同一调用内完成，
// 因此重复/并发开工只会有一个生效。
export function createStore(initial: AppState, persist: (s: AppState) => void) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    dispatch(t: Transition): TransitionResult {
      const r = t(state);
      if (r.ok && r.state && r.state !== state) {
        state = r.state;
        persist(state);
        listeners.forEach((l) => l());
      }
      return r;
    },
    replace(next: AppState) {
      state = next;
      persist(state);
      listeners.forEach((l) => l());
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export function useStoreState(store: Store): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
