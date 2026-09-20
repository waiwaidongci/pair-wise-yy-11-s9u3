import type {
  AppState,
  Cylinder,
  FillOrder,
  GasBatch,
  GasKind,
  Measured,
  OrderStatus,
  ResidualGas,
} from "./types";

// 允差与阈值：业务规则集中在此，存储与展示层不直接写死
export const O2_TOLERANCE = 1; // 氧含量允差 ±1%
export const HE_TOLERANCE = 1; // 氦含量允差 ±1%
export const PRESSURE_TOLERANCE = 5; // 压力允差 ±5bar
export const EXPIRY_WARNING_DAYS = 30; // 检验临期提醒天数

// 占用气瓶/工位锁的状态
export const LOCKING_STATUSES: OrderStatus[] = ["filling", "paused", "measuring", "pendingSignoff"];
// 进行中的（非终态）工单状态
export const ACTIVE_STATUSES: OrderStatus[] = ["queued", ...LOCKING_STATUSES, "review"];

export function gasKindOf(o2: number, he: number): GasKind {
  if (he > 0) return "trimix";
  if (o2 > 22) return "eanx";
  return "air";
}

export function gasKindLabel(kind: GasKind): string {
  return kind === "air" ? "空气" : kind === "eanx" ? "高氧" : "Trimix";
}

export function residualLabel(r: ResidualGas): string {
  return r === "none" ? "无余气" : gasKindLabel(r);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isInspectionExpired(c: Cylinder, now: Date): boolean {
  return c.inspectionValidUntil < toISODate(now);
}

export function daysUntilInspection(c: Cylinder, now: Date): number {
  const target = new Date(c.inspectionValidUntil + "T00:00:00").getTime();
  const today = new Date(toISODate(now) + "T00:00:00").getTime();
  return Math.round((target - today) / 86400000);
}

export type BlockCode = "expired" | "pressure" | "residual";
export interface BlockReason {
  code: BlockCode;
  label: string;
}

// 开工禁区：检验过期 / 耐压不足 / 余气冲突 —— 命中即不得开工，只能排空或送检
export function blockReasons(c: Cylinder, o: FillOrder, now: Date): BlockReason[] {
  const reasons: BlockReason[] = [];
  if (isInspectionExpired(c, now)) reasons.push({ code: "expired", label: "检验过期" });
  if (c.ratedPressureBar < o.targetPressureBar) {
    reasons.push({ code: "pressure", label: `耐压不足(${c.ratedPressureBar}<${o.targetPressureBar}bar)` });
  }
  const kind = gasKindOf(o.targetO2, o.targetHe);
  if (c.residualGas !== "none" && c.residualGas !== kind) {
    reasons.push({ code: "residual", label: `余气冲突(${residualLabel(c.residualGas)}≠${gasKindLabel(kind)})` });
  }
  return reasons;
}

export function cylinderLocked(s: AppState, cylinderId: string): boolean {
  return s.orders.some((o) => o.cylinderId === cylinderId && LOCKING_STATUSES.includes(o.status));
}

// 批次气体与配气单目标一致性（开工校验与续充重验共用）
export function batchMatchesOrder(b: GasBatch, o: FillOrder): boolean {
  return (
    gasKindOf(b.o2, b.he) === gasKindOf(o.targetO2, o.targetHe) &&
    Math.abs(b.o2 - o.targetO2) <= O2_TOLERANCE &&
    Math.abs(b.he - o.targetHe) <= HE_TOLERANCE
  );
}

// 开工前置校验：返回全部阻断原因，空数组表示可开工
export function startBlockers(
  s: AppState,
  orderId: string,
  stationId: string,
  operator: string,
  batchId: string,
  now: Date
): string[] {
  const errs: string[] = [];
  const order = s.orders.find((o) => o.id === orderId);
  const station = s.stations.find((x) => x.id === stationId);
  if (!order) return ["配气单不存在"];
  if (!station) return ["工位不存在"];
  if (order.status !== "queued") errs.push("该配气单已开工，重复/并发开工仅生效一次");
  if (station.orderId) errs.push(`${station.name}已被占用，一工位只接一瓶`);
  const c = s.cylinders.find((x) => x.id === order.cylinderId);
  if (!c) {
    errs.push("气瓶不存在");
  } else {
    for (const r of blockReasons(c, order, now)) errs.push(`${r.label}，禁止开工（仅可排空或送检）`);
    if (cylinderLocked(s, c.id)) errs.push("气瓶已被其他工单锁定");
  }
  if (!operator.trim()) errs.push("请填写操作员");
  const b = s.batches.find((x) => x.id === batchId);
  if (!batchId) errs.push("请选择气源批次");
  else if (!b) errs.push("气源批次不存在");
  else {
    if (b.status !== "qualified") errs.push("气源批次已失效，须换合格批次");
    else if (!batchMatchesOrder(b, order)) errs.push("批次气体与配气单目标不符");
  }
  return errs;
}

// 实测超限判定：氧/氦/压力任一超允差，或超过气瓶耐压
export function measuredIssues(o: FillOrder, c: Cylinder | undefined, m: Measured): string[] {
  const issues: string[] = [];
  if (Math.abs(m.o2 - o.targetO2) > O2_TOLERANCE) {
    issues.push(`氧含量超限(实测${m.o2}%/目标${o.targetO2}%)`);
  }
  if (Math.abs(m.he - o.targetHe) > HE_TOLERANCE) {
    issues.push(`氦含量超限(实测${m.he}%/目标${o.targetHe}%)`);
  }
  if (Math.abs(m.pressureBar - o.targetPressureBar) > PRESSURE_TOLERANCE) {
    issues.push(`压力超限(实测${m.pressureBar}/目标${o.targetPressureBar}bar)`);
  }
  if (c && m.pressureBar > c.ratedPressureBar) {
    issues.push(`超过气瓶耐压(${c.ratedPressureBar}bar)`);
  }
  return issues;
}
