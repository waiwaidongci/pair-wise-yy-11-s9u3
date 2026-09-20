import type { AppState, Cylinder, FillOrder, FillRecord, Measured } from "./types";
import {
  ACTIVE_STATUSES,
  batchMatchesOrder,
  cylinderLocked,
  gasKindOf,
  gasKindLabel,
  measuredIssues,
  residualLabel,
  startBlockers,
  toISODate,
} from "./rules";
import type { Transition, TransitionResult } from "../store/createStore";

// 状态迁移层：全部为纯函数，UI 只组装参数，规则集中在 domain
const ok = (state: AppState, message: string): TransitionResult => ({ ok: true, message, state });
const fail = (message: string): TransitionResult => ({ ok: false, message });

function appendRecord(s: AppState, r: Omit<FillRecord, "id">): AppState {
  const seq = s.seq + 1;
  return { ...s, seq, records: [...s.records, { ...r, id: `R-${seq}` }] };
}

function patchOrder(s: AppState, id: string, patch: Partial<FillOrder>): AppState {
  return { ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

function patchCylinder(s: AppState, id: string, patch: Partial<Cylinder>): AppState {
  return { ...s, cylinders: s.cylinders.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

function releaseStation(s: AppState, orderId: string): AppState {
  return { ...s, stations: s.stations.map((st) => (st.orderId === orderId ? { ...st, orderId: null } : st)) };
}

const numOk = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

// 新配气单 → 入队
export function createOrder(
  draft: { cylinderId: string; targetPressureBar: number; targetO2: number; targetHe: number; method: string },
  now: number
): Transition {
  return (s) => {
    const c = s.cylinders.find((x) => x.id === draft.cylinderId);
    if (!c) return fail("气瓶不存在");
    if (s.orders.some((o) => o.cylinderId === c.id && ACTIVE_STATUSES.includes(o.status))) {
      return fail("该气瓶已有进行中的配气单");
    }
    if (!numOk(draft.targetPressureBar, 1, 400)) return fail("目标压力需在 1~400bar");
    if (!numOk(draft.targetO2, 0, 100) || !numOk(draft.targetHe, 0, 100)) return fail("氧/氦含量需在 0~100%");
    if (draft.targetO2 + draft.targetHe > 100) return fail("氧+氦含量不能超过 100%");
    const seq = s.seq + 1;
    const order: FillOrder = {
      id: `O-${seq}`,
      cylinderId: c.id,
      targetPressureBar: draft.targetPressureBar,
      targetO2: draft.targetO2,
      targetHe: draft.targetHe,
      method: draft.method,
      operator: null,
      batchId: null,
      stationId: null,
      status: "queued",
      createdAt: now,
      startedAt: null,
      measured: null,
    };
    let ns: AppState = { ...s, seq, orders: [...s.orders, order] };
    ns = appendRecord(ns, {
      at: now,
      orderId: order.id,
      cylinderId: c.id,
      kind: "created",
      detail: `配气单创建：${gasKindLabel(gasKindOf(order.targetO2, order.targetHe))} 目标 ${order.targetPressureBar}bar · O₂ ${order.targetO2}% · He ${order.targetHe}% · ${order.method}`,
    });
    return ok(ns, `配气单 ${order.id} 已加入待充填队列`);
  };
}

// 登记气瓶：编号唯一
export function addCylinder(
  draft: { id: string; volumeL: number; ratedPressureBar: number; inspectionValidUntil: string },
  _now: number
): Transition {
  return (s) => {
    const id = draft.id.trim().toUpperCase();
    if (!id) return fail("请填写气瓶编号");
    if (s.cylinders.some((c) => c.id === id)) return fail(`编号 ${id} 已存在，气瓶编号必须唯一`);
    if (!numOk(draft.volumeL, 1, 60)) return fail("容积需在 1~60L");
    if (!numOk(draft.ratedPressureBar, 50, 450)) return fail("耐压需在 50~450bar");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.inspectionValidUntil)) return fail("请选择检验有效期");
    const c: Cylinder = {
      id,
      volumeL: draft.volumeL,
      ratedPressureBar: draft.ratedPressureBar,
      inspectionValidUntil: draft.inspectionValidUntil,
      residualGas: "none",
      residualPressureBar: 0,
    };
    return ok({ ...s, cylinders: [...s.cylinders, c] }, `气瓶 ${id} 已登记`);
  };
}

// 开工：一工位一瓶，锁定气瓶/操作员/批次；重复并发开工仅生效一次
export function startFill(orderId: string, stationId: string, operator: string, batchId: string, now: number): Transition {
  return (s) => {
    const errs = startBlockers(s, orderId, stationId, operator, batchId, new Date(now));
    if (errs.length) return fail(errs.join("；"));
    const op = operator.trim();
    const order = s.orders.find((o) => o.id === orderId)!;
    let ns = patchOrder(s, orderId, { status: "filling", stationId, operator: op, batchId, startedAt: now });
    ns = { ...ns, stations: ns.stations.map((st) => (st.id === stationId ? { ...st, orderId } : st)) };
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: order.cylinderId,
      kind: "started",
      detail: `开工锁定：气瓶 ${order.cylinderId} · 操作员 ${op} · 批次 ${batchId}`,
    });
    return ok(ns, `${orderId} 已开工并锁定（气瓶/操作员/批次）`);
  };
}

// 气源批次合格/失效；失效时正在使用它的工单立即暂停
export function setBatchStatus(batchId: string, status: "qualified" | "failed", now: number): Transition {
  return (s) => {
    const b = s.batches.find((x) => x.id === batchId);
    if (!b) return fail("批次不存在");
    if (b.status === status) return fail(status === "failed" ? "该批次已处于失效状态" : "该批次已是合格状态");
    let ns: AppState = { ...s, batches: s.batches.map((x) => (x.id === batchId ? { ...x, status } : x)) };
    let paused = 0;
    if (status === "failed") {
      const affected = ns.orders.filter((o) => o.batchId === batchId && o.status === "filling");
      ns = {
        ...ns,
        orders: ns.orders.map((o) => (o.batchId === batchId && o.status === "filling" ? { ...o, status: "paused" as const } : o)),
      };
      for (const o of affected) {
        ns = appendRecord(ns, {
          at: now,
          orderId: o.id,
          cylinderId: o.cylinderId,
          kind: "paused",
          detail: `气源批次 ${batchId} 失效，充填暂停，待换合格批次并重验`,
        });
        paused += 1;
      }
    }
    return ok(
      ns,
      status === "failed"
        ? paused
          ? `批次 ${batchId} 已失效，${paused} 个在充工单已暂停`
          : `批次 ${batchId} 已标记失效`
        : `批次 ${batchId} 已恢复合格`
    );
  };
}

// 换合格批次并重验后续充
export function resumeFill(orderId: string, batchId: string, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "paused") return fail("仅暂停中的工单可续充");
    const b = s.batches.find((x) => x.id === batchId);
    if (!b) return fail("批次不存在");
    if (b.status !== "qualified") return fail("重验未通过：批次仍处失效状态");
    if (!batchMatchesOrder(b, o)) return fail("重验未通过：批次气体与配气单目标不符");
    let ns = patchOrder(s, orderId, { status: "filling", batchId });
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: o.cylinderId,
      kind: "resumed",
      detail: `更换批次 ${batchId}，重验合格，继续充填`,
    });
    return ok(ns, "重验通过，已续充");
  };
}

// 充填完成 → 待录入实测
export function finishFilling(orderId: string, _now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "filling") return fail("仅充填中的工单可完成");
    return ok(patchOrder(s, orderId, { status: "measuring" }), "充填完成，请录入实测值");
  };
}

// 录入实测：合格→待签收；超限→留档转复核（实测值不可修改）
export function submitMeasured(orderId: string, m: { pressureBar: number; o2: number; he: number }, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "measuring") return fail("当前状态不可录入实测");
    if (!numOk(m.pressureBar, 0, 450) || !numOk(m.o2, 0, 100) || !numOk(m.he, 0, 100)) return fail("实测数值无效");
    if (m.o2 + m.he > 100) return fail("氧+氦含量不能超过 100%");
    const measured: Measured = { ...m, at: now };
    const c = s.cylinders.find((x) => x.id === o.cylinderId);
    const issues = measuredIssues(o, c, measured);
    let ns = patchOrder(s, orderId, { measured });
    if (issues.length === 0) {
      ns = patchOrder(ns, orderId, { status: "pendingSignoff" });
      ns = appendRecord(ns, {
        at: now,
        orderId,
        cylinderId: o.cylinderId,
        kind: "measured-ok",
        measured,
        detail: `实测合格：${m.pressureBar}bar · O₂ ${m.o2}% · He ${m.he}%`,
      });
      return ok(ns, "实测合格，待签收");
    }
    ns = patchOrder(ns, orderId, { status: "review", stationId: null });
    ns = releaseStation(ns, orderId);
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: o.cylinderId,
      kind: "overlimit",
      measured,
      detail: `超限留档转复核：${issues.join("；")}`,
    });
    return ok(ns, "实测超限，已留档转复核（实测值不可修改）");
  };
}

// 复核：只确认留档结论，不改实测；气瓶重新入队
export function reviewOrder(orderId: string, reviewer: string, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "review") return fail("该工单不在复核状态");
    const r = reviewer.trim();
    if (!r) return fail("请填写复核人");
    let ns = patchOrder(s, orderId, {
      status: "queued",
      measured: null,
      operator: null,
      batchId: null,
      stationId: null,
      startedAt: null,
    });
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: o.cylinderId,
      kind: "reviewed",
      detail: `复核确认（${r}）：实测留档不改，气瓶重新入队充填`,
    });
    return ok(ns, "复核完成：实测留档不改，已重新入队");
  };
}

// 签收：释放工位，余气档案更新为实充气体
export function signoff(orderId: string, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "pendingSignoff") return fail("仅待签收工单可签收");
    if (!o.measured) return fail("缺少实测值，禁止签收");
    const kind = gasKindOf(o.targetO2, o.targetHe);
    const m = o.measured;
    let ns = patchOrder(s, orderId, { status: "signed", stationId: null });
    ns = releaseStation(ns, orderId);
    ns = patchCylinder(ns, o.cylinderId, { residualGas: kind, residualPressureBar: m.pressureBar });
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: o.cylinderId,
      kind: "signed",
      measured: m,
      detail: `签收完成：${gasKindLabel(kind)} ${m.pressureBar}bar · O₂ ${m.o2}% · He ${m.he}%`,
    });
    return ok(ns, `${orderId} 已签收`);
  };
}

// 签收后换配气单：原签收立即失效，新单回队列
export function reorder(orderId: string, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "signed") return fail("仅已签收工单可换配气单");
    const seq = s.seq + 1;
    const fresh: FillOrder = {
      id: `O-${seq}`,
      cylinderId: o.cylinderId,
      targetPressureBar: o.targetPressureBar,
      targetO2: o.targetO2,
      targetHe: o.targetHe,
      method: o.method,
      operator: null,
      batchId: null,
      stationId: null,
      status: "queued",
      createdAt: now,
      startedAt: null,
      measured: null,
    };
    let ns: AppState = {
      ...s,
      seq,
      orders: [...s.orders.map((x) => (x.id === orderId ? { ...x, status: "invalidated" as const } : x)), fresh],
    };
    ns = appendRecord(ns, {
      at: now,
      orderId,
      cylinderId: o.cylinderId,
      kind: "invalidated",
      detail: `签收后换配气单，原签收单 ${orderId} 失效`,
    });
    ns = appendRecord(ns, {
      at: now,
      orderId: fresh.id,
      cylinderId: o.cylinderId,
      kind: "created",
      detail: `换单重开：目标 ${fresh.targetPressureBar}bar · O₂ ${fresh.targetO2}% · He ${fresh.targetHe}%`,
    });
    return ok(ns, `原签收单已失效，新配气单 ${fresh.id} 已回队列`);
  };
}

// 排空余气（仅未被工单锁定的气瓶）
export function ventCylinder(cylinderId: string, now: number): Transition {
  return (s) => {
    const c = s.cylinders.find((x) => x.id === cylinderId);
    if (!c) return fail("气瓶不存在");
    if (cylinderLocked(s, cylinderId)) return fail("气瓶已被工单锁定，禁止排空");
    if (c.residualGas === "none" || c.residualPressureBar <= 0) return fail("瓶内无余气，无需排空");
    let ns = patchCylinder(s, cylinderId, { residualGas: "none", residualPressureBar: 0 });
    ns = appendRecord(ns, {
      at: now,
      orderId: null,
      cylinderId,
      kind: "vented",
      detail: `排空余气（原 ${residualLabel(c.residualGas)} · ${c.residualPressureBar}bar）`,
    });
    return ok(ns, `${cylinderId} 已排空`);
  };
}

// 送检（仅未被工单锁定的气瓶），检验有效期顺延两年
export function sendInspection(cylinderId: string, now: number): Transition {
  return (s) => {
    const c = s.cylinders.find((x) => x.id === cylinderId);
    if (!c) return fail("气瓶不存在");
    if (cylinderLocked(s, cylinderId)) return fail("气瓶已被工单锁定，禁止送检");
    const until = toISODate(new Date(now + 2 * 366 * 86400000));
    let ns = patchCylinder(s, cylinderId, { inspectionValidUntil: until });
    ns = appendRecord(ns, {
      at: now,
      orderId: null,
      cylinderId,
      kind: "inspected",
      detail: `送检完成，检验有效期更新至 ${until}`,
    });
    return ok(ns, `${cylinderId} 已送检，有效期至 ${until}`);
  };
}

// 撤单（仅队列中的配气单）
export function cancelOrder(orderId: string, now: number): Transition {
  return (s) => {
    const o = s.orders.find((x) => x.id === orderId);
    if (!o) return fail("工单不存在");
    if (o.status !== "queued") return fail("仅队列中的配气单可撤销");
    let ns = patchOrder(s, orderId, { status: "cancelled" });
    ns = appendRecord(ns, { at: now, orderId, cylinderId: o.cylinderId, kind: "cancelled", detail: "配气单已撤销" });
    return ok(ns, `${orderId} 已撤单`);
  };
}
