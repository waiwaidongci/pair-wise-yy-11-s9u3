// 业务规则层：全部为纯函数，不依赖 React、localStorage 或任何存储。
// 存储层和展示层都必须通过这里判定，保证规则唯一来源。

import type {
  Cylinder,
  FillMethod,
  GasBatch,
  MixOrder,
  State,
} from "./types";

// ---------- 时间：存储层注入 now，规则层不直接读时钟，便于测试与回放 ----------

export type Clock = () => Date;
export const defaultClock: Clock = () => new Date();

const DAY_MS = 86_400_000;

export function daysUntil(dateStr: string, now: Date): number {
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  return Math.ceil((t - now.getTime()) / DAY_MS);
}

export type InspectStatus = "EXPIRED" | "WARNING" | "OK";

export function inspectStatus(
  expiry: string,
  now: Date,
  warnDays = 30,
): InspectStatus {
  const d = daysUntil(expiry, now);
  if (d < 0) return "EXPIRED";
  if (d <= warnDays) return "WARNING";
  return "OK";
}

// ---------- 规则 1：检验有效期 ----------

export function checkInspection(c: Cylinder, now: Date): string | null {
  if (c.inspecting) return "气瓶送检中，需检验合格后才能登记充填";
  const d = daysUntil(c.testExpiry, now);
  if (d < 0) return `检验已过期 ${-d} 天（有效期至 ${c.testExpiry}），禁止开工，请送检`;
  return null;
}

// ---------- 规则 2：耐压不足（目标压力 > 公称耐压）----------

export function checkPressureRating(
  c: Cylinder,
  targetPressure: number,
): string | null {
  if (targetPressure > c.workingPressure) {
    return `目标压力 ${targetPressure}bar 超过公称耐压 ${c.workingPressure}bar，禁止开工`;
  }
  return null;
}

// ---------- 规则 3：余气冲突 ----------
// 有余压且余气组分与目标气体互不相容时，禁止直接开工，只能先排空。
// - 目标为空气：余气含氦视为冲突
// - 目标为高氧：余气含氦、或余气氧含量高于目标氧（氧只能上调不能下调）视为冲突
// - 目标为 Trimix：余气氧含量高于目标氧视为冲突（氧无法靠配气下调）

export interface ResidualInput {
  residualPressure: number;
  residualO2: number;
  residualHe: number;
  method: FillMethod;
  targetO2: number;
  targetHe: number;
}

export function checkResidualConflict(r: ResidualInput): string | null {
  const SIGNIFICANT_PRESSURE = 5; // bar：低于此值视为已排空，直接顶充无冲突
  if (r.residualPressure < SIGNIFICANT_PRESSURE) return null;

  const o2 = r.residualO2;
  const he = r.residualHe;
  switch (r.method) {
    case "AIR":
      if (he >= 1) return `余气含氦 ${he}%（残压 ${r.residualPressure}bar），与空气充填冲突，请先排空`;
      if (o2 >= 23) return `余气氧含量 ${o2}% 高于空气，与空气充填冲突，请先排空`;
      return null;
    case "NITROX":
      if (he >= 1) return `余气含氦 ${he}%，与高氧充填冲突，请先排空`;
      if (o2 > r.targetO2 + 1)
        return `余气氧 ${o2}% 高于目标 ${r.targetO2}%，配气无法下调氧含量，请先排空`;
      return null;
    case "TRIMIX":
      if (o2 > r.targetO2 + 1)
        return `余气氧 ${o2}% 高于目标 ${r.targetO2}%，配气无法下调氧含量，请先排空`;
      return null;
  }
}

// ---------- 规则 4：气源批次合格性与配比兼容 ----------

export function batchUsable(b: GasBatch): string | null {
  if (b.status !== "ACTIVE") return "气源批次已失效";
  return null;
}

/** 批次能否服务该配气单（类型匹配 + 配比方向可行） */
export function batchCompatible(b: GasBatch, o: MixOrder): string | null {
  const unusable = batchUsable(b);
  if (unusable) return unusable;
  switch (o.method) {
    case "AIR":
      if (b.method !== "AIR") return "空气充填只能使用空气批次";
      return null;
    case "NITROX":
      if (b.method === "AIR") return "高氧充填不能用纯空气批次";
      if (b.o2 + 1 < o.targetO2)
        return `批次氧 ${b.o2}% 低于目标 ${o.targetO2}%，无法调出目标比例`;
      if (b.he >= 1) return "高氧充填批次不应含氦";
      return null;
    case "TRIMIX":
      if (b.method !== "TRIMIX") return "Trimix 充填需使用 Trimix 批次";
      if (b.o2 + 1 < o.targetO2)
        return `批次氧 ${b.o2}% 低于目标 ${o.targetO2}%`;
      if (b.he + 1 < o.targetHe)
        return `批次氦 ${b.he}% 低于目标 ${o.targetHe}%`;
      return null;
  }
}

// ---------- 规则 5：工位互锁 ----------

export function stationFree(s: State, stationId: string): string | null {
  const st = s.stations.find((x) => x.id === stationId);
  if (!st) return "工位不存在";
  if (st.sessionId !== null) return "该工位已锁定一瓶，一工位只接一瓶";
  return null;
}

// ---------- 开工综合预检：不通过只能排空或送检 ----------

export interface StartContext {
  cylinder: Cylinder;
  order: MixOrder;
  batch: GasBatch;
}

export function preStartChecks(
  s: State,
  ctx: StartContext,
  now: Date,
): string[] {
  const errors: string[] = [];
  const e1 = checkInspection(ctx.cylinder, now);
  if (e1) errors.push(e1);
  const e2 = checkPressureRating(ctx.cylinder, ctx.order.targetPressure);
  if (e2) errors.push(e2);
  const e3 = checkResidualConflict({
    residualPressure: ctx.order.residualPressure,
    residualO2: ctx.order.residualO2,
    residualHe: ctx.order.residualHe,
    method: ctx.order.method,
    targetO2: ctx.order.targetO2,
    targetHe: ctx.order.targetHe,
  });
  if (e3) errors.push(e3);
  const e4 = batchCompatible(ctx.batch, ctx.order);
  if (e4) errors.push(`气源：${e4}`);
  // 同一配气单不得重复开工
  if (ctx.order.status !== "QUEUED") {
    errors.push("该配气单已进入充填流程，不能重复开工");
  }
  return errors;
}

// ---------- 暂停后换批重验（续充前复检全部前置条件）----------

export function resumeChecks(
  s: State,
  ctx: StartContext,
  now: Date,
): string[] {
  const errors: string[] = [];
  const e1 = checkInspection(ctx.cylinder, now);
  if (e1) errors.push(e1);
  const e4 = batchCompatible(ctx.batch, ctx.order);
  if (e4) errors.push(`气源：${e4}`);
  return errors;
}

// ---------- 规则 6：实测公差（超限只能留档转复核，实测值冻结）----------

export interface Measured {
  o2: number;
  he: number;
  pressure: number;
}

export interface ToleranceResult {
  inTolerance: boolean;
  violations: string[];
}

export function evaluateMeasured(
  o: MixOrder,
  m: Measured,
): ToleranceResult {
  const violations: string[] = [];

  // 压力：低于目标 -3% 视为欠充；高于目标即超压（任一超限转复核）
  const lower = o.targetPressure * 0.97;
  if (m.pressure > o.targetPressure)
    violations.push(`实测压力 ${m.pressure}bar 超压（目标 ${o.targetPressure}bar）`);
  else if (m.pressure < lower)
    violations.push(`实测压力 ${m.pressure}bar 欠充（不得低于 ${lower.toFixed(0)}bar）`);

  if (Math.abs(m.o2 - o.targetO2) > 1.5)
    violations.push(`实测氧 ${m.o2}% 与目标 ${o.targetO2}% 偏差超 ±1.5%`);

  const expectedHe = o.method === "TRIMIX" ? o.targetHe : 0;
  if (Math.abs(m.he - expectedHe) > 2.0)
    violations.push(`实测氦 ${m.he}% 与目标 ${expectedHe}% 偏差超 ±2.0%`);

  return { inTolerance: violations.length === 0, violations };
}

// ---------- 混合气比例提示（展示用建议，非强制）----------

export function mixSuggestion(method: FillMethod, targetO2: number, targetHe = 0): {
  o2: string;
  he: string;
  balance: string;
} {
  if (method === "AIR")
    return { o2: "20.9%", he: "0%", balance: "氮 ~78% / 氩等 ~1%" };
  if (method === "TRIMIX") {
    const n2 = Math.max(0, 100 - targetO2 - targetHe);
    return { o2: `${targetO2}%`, he: `${targetHe}%`, balance: `氮 ${n2.toFixed(1)}%` };
  }
  return {
    o2: `${targetO2}%`,
    he: "0%",
    balance: `氮 ${(100 - targetO2).toFixed(1)}%`,
  };
}

// ---------- 编号唯一性 ----------

export function cylinderCodeExists(s: State, code: string): boolean {
  return s.cylinders.some((c) => c.code === code.trim().toUpperCase());
}
