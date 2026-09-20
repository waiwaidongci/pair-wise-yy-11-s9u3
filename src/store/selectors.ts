// 视图层派生数据：从存储的唯一状态推导出队列、工位、历史等展示模型。
// 这里不修改状态；所有判定复用 domain/rules。

import type { Cylinder, FillSession, MixOrder, State } from "../domain/types";
import { inspectStatus, preStartChecks, resumeChecks } from "../domain/rules";

export interface QueueRow {
  order: MixOrder;
  cylinder?: Cylinder;
  inspect: ReturnType<typeof inspectStatus>;
  /** 在指定气源批次下的开工预检结果（用于队列卡片直接展示拦截原因） */
  precheck: (batchId: string) => string[];
}

export function queueRows(s: State, now: Date): QueueRow[] {
  return s.orders
    .filter((o) => o.status === "QUEUED")
    .map((order) => {
      const cylinder = s.cylinders.find((c) => c.code === order.cylinderCode);
      return {
        order,
        cylinder,
        inspect: cylinder ? inspectStatus(cylinder.testExpiry, now) : "OK",
        precheck: (batchId: string) => {
          const batch = s.batches.find((b) => b.id === batchId);
          if (!cylinder || !batch) return ["数据缺失"];
          return preStartChecks(s, { cylinder, order, batch }, now);
        },
      };
    });
}

export interface StationView {
  id: string;
  name: string;
  session: FillSession | null;
  order: MixOrder | null;
  cylinder: Cylinder | null;
  /** 暂停状态下，各合格批次用于换批重验的报错（空数组=可续充） */
  resumeErrors: Record<string, string[]>;
}

export function stationViews(s: State, now: Date): StationView[] {
  return s.stations.map((st) => {
    const session = s.sessions.find((x) => x.id === st.sessionId) ?? null;
    const order = session ? s.orders.find((o) => o.id === session.orderId) ?? null : null;
    const cylinder = session
      ? s.cylinders.find((c) => c.code === session.cylinderCode) ?? null
      : null;
    const resumeErrors: Record<string, string[]> = {};
    if (session?.state === "PAUSED" && order && cylinder) {
      for (const b of s.batches) {
        resumeErrors[b.id] = resumeChecks(s, { cylinder, order, batch: b }, now);
      }
    }
    return { id: st.id, name: st.name, session, order, cylinder, resumeErrors };
  });
}

export interface HistoryRow {
  session: FillSession;
  order: MixOrder | null;
  cylinder: Cylinder | null;
}

/** 单瓶历史：该瓶所有充填会话（含留档复核记录） */
export function cylinderHistory(s: State, code: string): HistoryRow[] {
  return s.sessions
    .filter((x) => x.cylinderCode === code)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map((session) => ({
      session,
      order: s.orders.find((o) => o.id === session.orderId) ?? null,
      cylinder: s.cylinders.find((c) => c.code === code) ?? null,
    }));
}

export function metrics(s: State, now: Date) {
  const queued = s.orders.filter((o) => o.status === "QUEUED").length;
  const expired = s.cylinders.filter(
    (c) => inspectStatus(c.testExpiry, now) === "EXPIRED" || c.inspecting,
  ).length;
  const doneSessions = s.sessions.filter((x) => x.measured);
  const avgO2 = doneSessions.length
    ? doneSessions.reduce((acc, x) => acc + (x.measured?.o2 ?? 0), 0) / doneSessions.length
    : 0;
  const signed = s.sessions.filter((x) => x.state === "SIGNED").length;
  return { queued, expired, avgO2, signed, running: s.stations.filter((st) => st.sessionId).length };
}

/** 待签收 / 待复核 */
export function awaitingList(s: State): {
  review: HistoryRow[];
  signable: HistoryRow[];
} {
  const rows = s.sessions
    .filter((x) => x.state === "MEASURED")
    .map((session) => ({
      session,
      order: s.orders.find((o) => o.id === session.orderId) ?? null,
      cylinder: s.cylinders.find((c) => c.code === session.cylinderCode) ?? null,
    }));
  return {
    review: rows.filter((r) => r.order?.status === "REVIEW"),
    signable: rows.filter((r) => r.order?.status === "DONE"),
  };
}

/** 已签收气瓶（可申请换配气单） */
export function signedCylinders(s: State): Cylinder[] {
  const codes = new Set(
    s.orders.filter((o) => o.status === "SIGNED").map((o) => o.cylinderCode),
  );
  return s.cylinders.filter((c) => codes.has(c.code));
}
