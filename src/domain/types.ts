// 领域模型：气瓶、气源批次、配气单、工位、留档记录
export type GasKind = "air" | "eanx" | "trimix";
export type ResidualGas = GasKind | "none";

export interface Cylinder {
  id: string; // 气瓶编号（唯一）
  volumeL: number;
  ratedPressureBar: number; // 耐压
  inspectionValidUntil: string; // 检验有效期 YYYY-MM-DD
  residualGas: ResidualGas; // 余气类型
  residualPressureBar: number; // 残压
}

export type BatchStatus = "qualified" | "failed";

export interface GasBatch {
  id: string; // 气源批次号
  label: string;
  o2: number; // 批次氧含量 %
  he: number; // 批次氦含量 %
  status: BatchStatus;
}

export type OrderStatus =
  | "queued" // 待充填（在队列）
  | "filling" // 充填中（已锁定气瓶/操作员/批次）
  | "paused" // 气源失效，暂停待重验
  | "measuring" // 充填完成，待录入实测
  | "pendingSignoff" // 实测合格，待签收
  | "review" // 超限留档，转复核
  | "signed" // 已签收
  | "invalidated" // 签收后换单，已失效
  | "cancelled"; // 已撤单

export interface Measured {
  pressureBar: number;
  o2: number;
  he: number;
  at: number;
}

export interface FillOrder {
  id: string;
  cylinderId: string;
  targetPressureBar: number;
  targetO2: number;
  targetHe: number;
  method: string; // 充填方式
  operator: string | null; // 开工时锁定的操作员
  batchId: string | null; // 开工时锁定的气源批次
  stationId: string | null; // 占用工位
  status: OrderStatus;
  createdAt: number;
  startedAt: number | null;
  measured: Measured | null; // 实测值（复核也不可改）
}

export type RecordKind =
  | "created"
  | "started"
  | "paused"
  | "resumed"
  | "measured-ok"
  | "overlimit"
  | "reviewed"
  | "signed"
  | "invalidated"
  | "vented"
  | "inspected"
  | "cancelled";

export interface FillRecord {
  id: string;
  at: number;
  orderId: string | null;
  cylinderId: string;
  kind: RecordKind;
  detail: string;
  measured?: Measured; // 留档实测快照，不可改
}

export interface Station {
  id: string;
  name: string;
  orderId: string | null; // 一工位只接一瓶
}

export interface AppState {
  version: 1;
  seq: number;
  cylinders: Cylinder[];
  batches: GasBatch[];
  orders: FillOrder[];
  stations: Station[];
  records: FillRecord[];
}
