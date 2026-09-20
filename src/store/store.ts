// 存储层：状态唯一来源、action 串行化（互斥队列）、localStorage 持久化。
// 业务判定全部委托 domain/rules，这里不写规则，只做状态迁移与一致性保证。

import { useSyncExternalStore } from "react";
import type {
  Cylinder,
  FillSession,
  GasBatch,
  LedgerEvent,
  MixOrder,
  State,
} from "../domain/types";
import {
  cylinderCodeExists,
  defaultClock,
  evaluateMeasured,
  preStartChecks,
  resumeChecks,
  type Clock,
  type Measured,
} from "../domain/rules";

const STORAGE_KEY = "fill-station-state-v1";

// ---------- 种子数据 ----------

function seedState(): State {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const plus = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const past = (days: number) => plus(-days);

  const cylinders: Cylinder[] = [
    { code: "TANK-204", volumeL: 12, workingPressure: 230, testExpiry: plus(120), inspecting: false, createdAt: iso(now) },
    { code: "TANK-219", volumeL: 11, workingPressure: 230, testExpiry: plus(20), inspecting: false, createdAt: iso(now) },
    { code: "TANK-231", volumeL: 24, workingPressure: 200, testExpiry: plus(12), inspecting: false, createdAt: iso(now) },
    { code: "TANK-188", volumeL: 12, workingPressure: 230, testExpiry: past(9), inspecting: false, createdAt: iso(now) },
  ];

  const batches: GasBatch[] = [
    { id: "B-AIR-01", label: "空气压缩机批次 A1", method: "AIR", o2: 20.9, he: 0, status: "ACTIVE" },
    { id: "B-NX32-02", label: "高氧膜分离批次 N32", method: "NITROX", o2: 36, he: 0, status: "ACTIVE" },
    { id: "B-TX21-03", label: "Trimix 21/35 批次 T03", method: "TRIMIX", o2: 21, he: 35, status: "ACTIVE" },
    { id: "B-NX32-01", label: "高氧膜分离批次 N31（纯度告警）", method: "NITROX", o2: 30, he: 0, status: "FAILED", note: "露点超标停用" },
  ];

  const stations = [
    { id: "ST-1", name: "1号充填位", sessionId: null as string | null },
    { id: "ST-2", name: "2号充填位", sessionId: null as string | null },
  ];

  const orders: MixOrder[] = [
    {
      id: "O-1001", cylinderCode: "TANK-204", method: "AIR",
      targetO2: 20.9, targetHe: 0, targetPressure: 200,
      residualPressure: 55, residualO2: 20.9, residualHe: 0,
      status: "QUEUED", createdAt: iso(now),
    },
    {
      id: "O-1002", cylinderCode: "TANK-219", method: "NITROX",
      targetO2: 32, targetHe: 0, targetPressure: 210,
      residualPressure: 40, residualO2: 32, residualHe: 0,
      status: "QUEUED", createdAt: iso(now),
    },
    {
      id: "O-1003", cylinderCode: "TANK-231", method: "TRIMIX",
      targetO2: 21, targetHe: 35, targetPressure: 180,
      residualPressure: 60, residualO2: 21, residualHe: 35,
      status: "QUEUED", createdAt: iso(now),
    },
    {
      id: "O-1004", cylinderCode: "TANK-188", method: "AIR",
      targetO2: 20.9, targetHe: 0, targetPressure: 200,
      residualPressure: 30, residualO2: 20.9, residualHe: 0,
      status: "QUEUED", createdAt: iso(now),
    },
  ];

  return {
    version: 1,
    cylinders,
    orders,
    batches,
    stations,
    sessions: [],
    cylinderEvents: Object.fromEntries(cylinders.map((c) => [c.code, [] as LedgerEvent[]])),
    seq: 1100,
  };
}

// ---------- 持久化 ----------

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* 损坏则回退种子 */
  }
  return seedState();
}

let state: State = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存储满等情况忽略 */
  }
}

function setState(next: State) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

// 跨标签页：以 storage 事件同步，保证多视图一致
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue) as State;
        listeners.forEach((l) => l());
      } catch {
        /* ignore */
      }
    }
  });
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getState(): State {
  return state;
}
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

// ---------- 互斥队列：所有写操作串行提交 ----------
// 并发点击开工时，请求在微任务层排队；首个通过者修改提交态并落盘后，
// 后续重复请求在 preStartChecks 的状态复核中必然失败（工位已锁 / 单已非 QUEUED）。

let tail: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => T): Promise<T> {
  const run = tail.then(() => {
    // job 基于最新快照同步执行，杜绝闭包陈旧状态
    return job();
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------- 工具 ----------

let clock: Clock = defaultClock;
export function setClock(c: Clock) {
  clock = c;
}
function nowIso() {
  return clock().toISOString();
}
function nowDate() {
  return clock();
}
/** 生成新 id；调用方须在最终 setState 时写入 seq: state.seq + 1 */
function nextId(prefix: string): string {
  return `${prefix}${state.seq + 1}`;
}
function ev(type: string, detail: string): LedgerEvent {
  return { at: nowIso(), type, detail };
}
function appendCylinderEvent(s: State, code: string, e: LedgerEvent): State {
  const list = s.cylinderEvents[code] ?? [];
  return {
    ...s,
    cylinderEvents: { ...s.cylinderEvents, [code]: [...list, e] },
  };
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---------- Action: 新登记气瓶（编号唯一）----------

export interface NewCylinderInput {
  code: string;
  volumeL: number;
  workingPressure: number;
  testExpiry: string;
  method: MixOrder["method"];
  targetO2: number;
  targetHe: number;
  targetPressure: number;
  residualPressure: number;
  residualO2: number;
  residualHe: number;
}

export function addCylinderWithOrder(input: NewCylinderInput): Promise<ActionResult> {
  return enqueue(() => {
    const code = input.code.trim().toUpperCase();
    if (!code) return { ok: false, message: "请填写气瓶编号" };
    if (cylinderCodeExists(state, code))
      return { ok: false, message: `气瓶编号 ${code} 已存在，编号必须唯一` };
    if (!input.testExpiry)
      return { ok: false, message: "请填写检验有效期" };
    if (input.targetPressure <= 0 || input.targetPressure > input.workingPressure)
      return { ok: false, message: `目标压力须为正且不超过公称耐压 ${input.workingPressure}bar` };

    const cylinder: Cylinder = {
      code,
      volumeL: input.volumeL,
      workingPressure: input.workingPressure,
      testExpiry: input.testExpiry,
      inspecting: false,
      createdAt: nowIso(),
    };
    const oid = nextId("O-");
    const order: MixOrder = {
      id: oid,
      cylinderCode: code,
      method: input.method,
      targetO2: input.targetO2,
      targetHe: input.targetHe,
      targetPressure: input.targetPressure,
      residualPressure: input.residualPressure,
      residualO2: input.residualO2,
      residualHe: input.residualHe,
      status: "QUEUED",
      createdAt: nowIso(),
    };
    const next: State = {
      ...state,
      seq: state.seq + 1,
      cylinders: [...state.cylinders, cylinder],
      orders: [...state.orders, order],
      cylinderEvents: { ...state.cylinderEvents, [code]: [ev("REGISTER", `登记入库并生成配气单 ${oid}`)] },
    };
    setState(next);
    return { ok: true, message: `${code} 已登记，配气单 ${oid} 进入待充填队列` };
  });
}

// ---------- Action: 开工（锁定气瓶/操作员/气源批次/工位）----------

export interface StartInput {
  orderId: string;
  stationId: string;
  operator: string;
  batchId: string;
}

export function startFill(input: StartInput): Promise<ActionResult> {
  return enqueue(() => {
    const s = state; // 唯一快照读取点
    const order = s.orders.find((o) => o.id === input.orderId);
    if (!order) return { ok: false, message: "配气单不存在" };
    const cylinder = s.cylinders.find((c) => c.code === order.cylinderCode);
    if (!cylinder) return { ok: false, message: "气瓶主数据缺失" };
    const batch = s.batches.find((b) => b.id === input.batchId);
    if (!batch) return { ok: false, message: "气源批次不存在" };
    const station = s.stations.find((x) => x.id === input.stationId);
    if (!station) return { ok: false, message: "工位不存在" };
    if (!input.operator.trim()) return { ok: false, message: "请填写操作员" };

    // 工位互锁优先给明确提示
    if (station.sessionId !== null)
      return { ok: false, message: `开工失败：${station.name}已锁定气瓶，一工位只接一瓶` };

    const errors = preStartChecks(s, { cylinder, order, batch }, nowDate());
    if (errors.length) return { ok: false, message: "开工被规则拦截：" + errors.join("；") };

    const sid = nextId("F-");
    const session: FillSession = {
      id: sid,
      orderId: order.id,
      cylinderCode: cylinder.code,
      stationId: station.id,
      operator: input.operator.trim(),
      batchId: batch.id,
      startedAt: nowIso(),
      state: "RUNNING",
      events: [ev("START", `开工：操作员 ${input.operator.trim()}，气源 ${batch.id}，工位 ${station.name}`)],
    };

    let next: State = {
      ...state,
      seq: state.seq + 1,
      sessions: [...state.sessions, session],
      orders: state.orders.map((o) => (o.id === order.id ? { ...o, status: "FILLING" } : o)),
      stations: state.stations.map((st) =>
        st.id === station.id ? { ...st, sessionId: sid } : st,
      ),
    };
    next = appendCylinderEvent(next, cylinder.code, ev("FILL_START", `配气单 ${order.id} 在 ${station.name} 开工，气源 ${batch.id}`));
    setState(next);
    return { ok: true, message: `已开工：${cylinder.code} 锁定于 ${station.name}（会话 ${sid}）` };
  });
}

// ---------- Action: 气源失效（批次标记失效，进行中的相关会话暂停）----------

export function failBatch(batchId: string, reason: string): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const batch = s.batches.find((b) => b.id === batchId);
    if (!batch) return { ok: false, message: "批次不存在" };
    if (batch.status === "FAILED") return { ok: false, message: "批次已处于失效状态" };

    const affected = s.sessions.filter(
      (ses) => ses.batchId === batchId && ses.state === "RUNNING",
    );

    let next: State = {
      ...s,
      batches: s.batches.map((b) => (b.id === batchId ? { ...b, status: "FAILED", note: reason || b.note } : b)),
    };
    next = {
      ...next,
      sessions: next.sessions.map((ses) =>
        ses.batchId === batchId && ses.state === "RUNNING"
          ? {
              ...ses,
              state: "PAUSED",
              pauseReason: `气源批次 ${batchId} 失效`,
              events: [...ses.events, ev("PAUSE", `气源批次 ${batchId} 失效，自动暂停`)],
            }
          : ses,
      ),
      orders: next.orders.map((o) => {
        const hit = affected.some((ses) => ses.orderId === o.id);
        return hit ? { ...o, status: "PAUSED" } : o;
      }),
    };
    for (const ses of affected) {
      next = appendCylinderEvent(next, ses.cylinderCode, ev("FILL_PAUSE", `气源失效暂停（${batchId}）`));
    }
    setState(next);
    return {
      ok: true,
      message:
        `批次 ${batchId} 已标记失效` +
        (affected.length ? `，${affected.length} 个进行中充填已暂停` : ""),
    };
  });
}

/** 恢复失效批次（仅演示/纠错用；恢复不自动续充，仍需换批重验） */
export function reactivateBatch(batchId: string): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const batch = s.batches.find((b) => b.id === batchId);
    if (!batch || batch.status === "ACTIVE")
      return { ok: false, message: "批次不存在或本就合格" };
    setState({
      ...s,
      batches: s.batches.map((b) => (b.id === batchId ? { ...b, status: "ACTIVE" } : b)),
    });
    return { ok: true, message: `批次 ${batchId} 已恢复合格` };
  });
}

// ---------- Action: 换合格批次并重验后续充 ----------

export function resumeWithBatch(sessionId: string, batchId: string): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const ses = s.sessions.find((x) => x.id === sessionId);
    if (!ses) return { ok: false, message: "会话不存在" };
    if (ses.state !== "PAUSED") return { ok: false, message: "只有暂停中的会话可以换批续充" };
    const order = s.orders.find((o) => o.id === ses.orderId);
    const cylinder = s.cylinders.find((c) => c.code === ses.cylinderCode);
    const batch = s.batches.find((b) => b.id === batchId);
    if (!order || !cylinder || !batch) return { ok: false, message: "关联数据缺失" };

    const errors = resumeChecks(s, { cylinder, order, batch }, nowDate());
    if (errors.length) return { ok: false, message: "换批重验未通过：" + errors.join("；") };

    const next: State = {
      ...s,
      batches: s.batches,
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              batchId,
              state: "RUNNING" as const,
              pauseReason: undefined,
              events: [...x.events, ev("RESUME", `换用合格批次 ${batchId} 并重验通过，继续充填`)],
            }
          : x,
      ),
      orders: s.orders.map((o) => (o.id === order.id ? { ...o, status: "FILLING" as const } : o)),
    };
    setState(appendCylinderEvent(next, cylinder.code, ev("FILL_RESUME", `换批 ${batchId} 重验后续充`)));
    return { ok: true, message: `重验通过，已切换到 ${batchId} 并续充` };
  });
}

// ---------- Action: 录入实测（工位释放；合格待签收 / 超限留档转复核）----------

export function submitMeasured(
  sessionId: string,
  m: Measured,
): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const ses = s.sessions.find((x) => x.id === sessionId);
    if (!ses) return { ok: false, message: "会话不存在" };
    if (ses.state !== "RUNNING") return { ok: false, message: "只有进行中的会话可以录入实测" };
    const order = s.orders.find((o) => o.id === ses.orderId);
    if (!order) return { ok: false, message: "配气单缺失" };

    if (m.pressure <= 0 || m.o2 < 0 || m.o2 > 100 || m.he < 0 || m.he > 100)
      return { ok: false, message: "实测数值不合法" };

    const result = evaluateMeasured(order, m);
    const measured = { ...m, at: nowIso() };
    const newStatus: MixOrder["status"] = result.inTolerance ? "DONE" : "REVIEW";

    let next: State = {
      ...s,
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              state: "MEASURED",
              measured,
              events: [
                ...x.events,
                ev(
                  "MEASURED",
                  result.inTolerance
                    ? `实测 O₂ ${m.o2}% / He ${m.he}% / ${m.pressure}bar，公差内，待签收`
                    : `实测 O₂ ${m.o2}% / He ${m.he}% / ${m.pressure}bar，超限留档转复核：${result.violations.join("；")}`,
                ),
              ],
            }
          : x,
      ),
      orders: s.orders.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o)),
      // 实测提交即释放工位
      stations: s.stations.map((st) => (st.id === ses.stationId ? { ...st, sessionId: null } : st)),
    };
    next = appendCylinderEvent(
      next,
      ses.cylinderCode,
      ev(result.inTolerance ? "MEASURED_OK" : "MEASURED_REVIEW", `实测完成（${result.inTolerance ? "公差内" : "超限转复核"}），工位已释放`),
    );
    setState(next);
    return {
      ok: true,
      message: result.inTolerance
        ? "实测在公差内，进入待签收"
        : "实测超限，已留档并转复核（实测值不可修改）",
    };
  });
}

// ---------- Action: 复核（只追加结论，不改实测）----------

export function reviewSession(
  sessionId: string,
  reviewer: string,
  result: "CONFIRMED" | "REJECTED",
  comment: string,
): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const ses = s.sessions.find((x) => x.id === sessionId);
    if (!ses || ses.state !== "MEASURED" || !ses.measured)
      return { ok: false, message: "该会话不处于待复核状态" };
    const order = s.orders.find((o) => o.id === ses.orderId);
    if (!order || order.status !== "REVIEW")
      return { ok: false, message: "配气单不在复核队列" };
    if (!reviewer.trim()) return { ok: false, message: "请填写复核人" };

    const decision = { reviewer: reviewer.trim(), result, comment: comment.trim(), at: nowIso() };
    const nextStatus: MixOrder["status"] = result === "CONFIRMED" ? "DONE" : "QUEUED";

    let next: State = {
      ...s,
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              review: decision,
              events: [
                ...x.events,
                ev(
                  "REVIEW",
                  result === "CONFIRMED"
                    ? `复核通过（${reviewer.trim()}）：${comment.trim() || "认可实测，放行签收"}；实测值保持不变`
                    : `复核驳回（${reviewer.trim()}）：${comment.trim() || "实测不可接受"}；配气单退回队列，实测值保持留档不变`,
                ),
              ],
            }
          : x,
      ),
      orders: s.orders.map((o) =>
        o.id === order.id
          ? result === "CONFIRMED"
            ? { ...o, status: "DONE" }
            : // 驳回：保留实测留档在历史会话中，配气单以原始目标回队列重新充填
              { ...o, status: "QUEUED" }
          : o,
      ),
    };
    next = appendCylinderEvent(
      next,
      ses.cylinderCode,
      ev("REVIEW", result === "CONFIRMED" ? "复核通过，放行签收" : "复核驳回，配气单退回队列（实测留档不变）"),
    );
    setState(next);
    return {
      ok: true,
      message:
        result === "CONFIRMED"
          ? "复核通过，可签收（实测值未改动）"
          : "已驳回，配气单回到待充填队列（实测值未改动）",
    };
  });
}

// ---------- Action: 签收 ----------

export function signOff(sessionId: string, signer: string): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const ses = s.sessions.find((x) => x.id === sessionId);
    if (!ses || ses.state !== "MEASURED" || !ses.measured)
      return { ok: false, message: "会话不可签收" };
    const order = s.orders.find((o) => o.id === ses.orderId);
    if (!order || order.status !== "DONE")
      return { ok: false, message: "只有公差内或复核通过的气瓶可以签收" };
    if (!signer.trim()) return { ok: false, message: "请填写签收人" };

    let next: State = {
      ...s,
      sessions: s.sessions.map((x) =>
        x.id === sessionId
          ? {
              ...x,
              state: "SIGNED",
              signOff: { signer: signer.trim(), at: nowIso() },
              events: [...x.events, ev("SIGN", `签收人 ${signer.trim()}`)],
            }
          : x,
      ),
      orders: s.orders.map((o) => (o.id === order.id ? { ...o, status: "SIGNED" } : o)),
    };
    next = appendCylinderEvent(next, ses.cylinderCode, ev("SIGNED", `配气单 ${order.id} 已签收`));
    setState(next);
    return { ok: true, message: `${ses.cylinderCode} 签收完成` };
  });
}

// ---------- Action: 签收后改配气单：原单失效，气瓶回队列 ----------

export interface ReorderInput {
  cylinderCode: string;
  method: MixOrder["method"];
  targetO2: number;
  targetHe: number;
  targetPressure: number;
  residualPressure: number;
  residualO2: number;
  residualHe: number;
}

export function reorderAfterSign(input: ReorderInput): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const cylinder = s.cylinders.find((c) => c.code === input.cylinderCode);
    if (!cylinder) return { ok: false, message: "气瓶不存在" };
    const lastSigned = [...s.orders].reverse().find(
      (o) => o.cylinderCode === cylinder.code && o.status === "SIGNED",
    );
    if (!lastSigned)
      return { ok: false, message: "只有已签收的气瓶可以申请换配气单" };
    if (input.targetPressure > cylinder.workingPressure)
      return { ok: false, message: `目标压力超过公称耐压 ${cylinder.workingPressure}bar` };

    const oid = nextId("O-");
    const newOrder: MixOrder = {
      id: oid,
      cylinderCode: cylinder.code,
      method: input.method,
      targetO2: input.targetO2,
      targetHe: input.targetHe,
      targetPressure: input.targetPressure,
      residualPressure: input.residualPressure,
      residualO2: input.residualO2,
      residualHe: input.residualHe,
      status: "QUEUED",
      createdAt: nowIso(),
    };
    let next: State = {
      ...s,
      seq: s.seq + 1,
      orders: [
        ...s.orders.map((o) =>
          o.id === lastSigned.id
            ? { ...o, status: "VOID" as const, voidReason: "签收后客户更换配气单，原单失效" }
            : o,
        ),
        newOrder,
      ],
    };
    next = appendCylinderEvent(
      next,
      cylinder.code,
      ev("REORDER", `换配气单：原单 ${lastSigned.id} 失效，新单 ${oid} 回到待充填队列`),
    );
    setState(next);
    return { ok: true, message: `原配气单已失效，新单 ${oid} 已回队列` };
  });
}

// ---------- Action: 排空（余气冲突的唯一出路之一）----------

export function ventOrder(orderId: string): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, message: "配气单不存在" };
    if (order.status !== "QUEUED")
      return { ok: false, message: "只有队列中的配气单可以排空" };

    // 排空后残压归零、余气组分清零，原单可直接重新开工
    const next: State = {
      ...s,
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, residualPressure: 0, residualO2: 0, residualHe: 0 }
          : o,
      ),
    };
    setState(
      appendCylinderEvent(next, order.cylinderCode, ev("VENT", `配气单 ${orderId} 已排空，残压清零，可重新开工`)),
    );
    return { ok: true, message: "已排空，残压与余气组分清零，可重新开工" };
  });
}

// ---------- Action: 送检（检验过期/耐压疑问的唯一出路之一）----------

export function sendToInspection(
  cylinderCode: string,
  orderId: string | null,
): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const cylinder = s.cylinders.find((c) => c.code === cylinderCode);
    if (!cylinder) return { ok: false, message: "气瓶不存在" };
    if (cylinder.inspecting) return { ok: false, message: "该瓶已在送检中" };

    let orders = s.orders.map((o) => {
      if (o.cylinderCode !== cylinderCode) return o;
      if (["FILLING", "PAUSED"].includes(o.status)) return o; // 锁定中的单不允许动
      if (orderId && o.id !== orderId) return o;
      if (["QUEUED", "DONE", "REVIEW"].includes(o.status))
        return { ...o, status: "VOID" as const, voidReason: "气瓶送检，配气单作废" };
      return o;
    });

    let next: State = {
      ...s,
      cylinders: s.cylinders.map((c) => (c.code === cylinderCode ? { ...c, inspecting: true } : c)),
      orders,
    };
    next = appendCylinderEvent(next, cylinderCode, ev("INSPECT_SEND", "气瓶送检，未开工配气单作废"));
    setState(next);
    return { ok: true, message: `${cylinderCode} 已送检，相关队列配气单作废` };
  });
}

/** 检验合格回归：登记新有效期 */
export function returnFromInspection(
  cylinderCode: string,
  newExpiry: string,
): Promise<ActionResult> {
  return enqueue(() => {
    const s = state;
    const cylinder = s.cylinders.find((c) => c.code === cylinderCode);
    if (!cylinder || !cylinder.inspecting)
      return { ok: false, message: "该瓶未处于送检状态" };
    if (!newExpiry) return { ok: false, message: "请填写新的检验有效期" };
    let next: State = {
      ...s,
      cylinders: s.cylinders.map((c) =>
        c.code === cylinderCode ? { ...c, inspecting: false, testExpiry: newExpiry } : c,
      ),
    };
    next = appendCylinderEvent(next, cylinderCode, ev("INSPECT_BACK", `检验合格回归，新有效期至 ${newExpiry}，可重新登记配气单`));
    setState(next);
    return { ok: true, message: `${cylinderCode} 检验合格，已可重新登记配气单` };
  });
}

/** 清空本地数据并重置为种子（演示用） */
export function resetDemo(): Promise<ActionResult> {
  return enqueue(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(seedState());
    return { ok: true, message: "已重置为演示数据" };
  });
}
