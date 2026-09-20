import type { ReactNode } from "react";
import type { AppState, Measured, OrderStatus, RecordKind } from "../domain/types";
import type { Transition, TransitionResult } from "../store/createStore";

// 展示层公共件：只读状态 + 触发迁移，不内含业务规则
export interface PanelProps {
  state: AppState;
  run: (t: Transition) => TransitionResult;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  queued: "待充填",
  filling: "充填中",
  paused: "已暂停",
  measuring: "待实测",
  pendingSignoff: "待签收",
  review: "复核中",
  signed: "已签收",
  invalidated: "已失效",
  cancelled: "已撤单",
};

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  created: "创建配气单",
  started: "开工锁定",
  paused: "气源失效暂停",
  resumed: "重验续充",
  "measured-ok": "实测合格",
  overlimit: "超限留档",
  reviewed: "复核确认",
  signed: "签收",
  invalidated: "签收失效",
  vented: "排空",
  inspected: "送检",
  cancelled: "撤单",
};

export function fmtTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function MeasuredChips({ m }: { m: Measured }) {
  return (
    <span className="chip-m">
      <em>{m.pressureBar}bar</em>
      <em>O₂ {m.o2}%</em>
      <em>He {m.he}%</em>
    </span>
  );
}
