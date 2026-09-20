// 领域模型：气瓶充填闭环涉及的实体与状态。
// 本文件只描述数据结构，不含业务判定（判定见 rules.ts）。

export type FillMethod = "AIR" | "NITROX" | "TRIMIX";

export const METHOD_LABEL: Record<FillMethod, string> = {
  AIR: "空气",
  NITROX: "高氧",
  TRIMIX: "Trimix",
};

/** 气瓶主数据：编号全局唯一 */
export interface Cylinder {
  code: string; // 气瓶编号（唯一）
  volumeL: number; // 容积 L
  workingPressure: number; // 公称耐压 bar
  testExpiry: string; // 检验有效期 YYYY-MM-DD
  inspecting: boolean; // 是否送检中
  createdAt: string;
}

/** 气源批次 */
export interface GasBatch {
  id: string;
  label: string;
  method: FillMethod;
  o2: number; // 氧含量 %
  he: number; // 氦含量 %
  status: "ACTIVE" | "FAILED"; // 合格 / 失效
  note?: string;
}

/** 配气单（队列条目） */
export interface MixOrder {
  id: string;
  cylinderCode: string;
  method: FillMethod;
  targetO2: number; // 目标氧 %
  targetHe: number; // 目标氦 %
  targetPressure: number; // 目标压力 bar
  residualPressure: number; // 开工前残压 bar
  residualO2: number; // 余气氧 %（未知按 0 传，配合残压判定）
  residualHe: number; // 余气氦 %
  status: "QUEUED" | "FILLING" | "PAUSED" | "DONE" | "REVIEW" | "SIGNED" | "VOID";
  voidReason?: string;
  createdAt: string;
}

/** 工位：同一时刻只接一瓶 */
export interface Station {
  id: string;
  name: string;
  sessionId: string | null; // 锁定中的充填会话
}

/** 留痕事件 */
export interface LedgerEvent {
  at: string;
  type: string;
  detail: string;
}

/** 复核结论：复核只追加结论，绝不回写实测值 */
export interface ReviewDecision {
  reviewer: string;
  result: "CONFIRMED" | "REJECTED";
  comment: string;
  at: string;
}

/** 充填会话：开工即锁定气瓶、操作员、气源批次 */
export interface FillSession {
  id: string;
  orderId: string;
  cylinderCode: string;
  stationId: string;
  operator: string; // 锁定操作员
  batchId: string; // 锁定气源批次（换批后更新为重验合格批次）
  startedAt: string;
  state: "RUNNING" | "PAUSED" | "MEASURED" | "SIGNED";
  pauseReason?: string;
  // 实测值：提交后冻结
  measured?: {
    o2: number;
    he: number;
    pressure: number;
    at: string;
  };
  review?: ReviewDecision;
  signOff?: { signer: string; at: string };
  events: LedgerEvent[];
}

export interface State {
  version: 1;
  cylinders: Cylinder[];
  orders: MixOrder[];
  batches: GasBatch[];
  stations: Station[];
  sessions: FillSession[];
  cylinderEvents: Record<string, LedgerEvent[]>;
  seq: number;
}
