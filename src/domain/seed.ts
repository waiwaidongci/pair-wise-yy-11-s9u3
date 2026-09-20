import { toISODate } from "./rules";
import type { AppState, FillRecord, Measured } from "./types";

// 演示数据：覆盖队列/在充/待签收/复核/已签收/各类禁区气瓶
export function buildSeed(now: Date): AppState {
  const iso = (days: number) => toISODate(new Date(now.getTime() + days * 86400000));
  const t = (hoursAgo: number) => now.getTime() - hoursAgo * 3600000;
  const m = (pressureBar: number, o2: number, he: number, at: number): Measured => ({ pressureBar, o2, he, at });

  const records: FillRecord[] = [
    { id: "R-1", at: t(26), orderId: "O-1008", cylinderId: "TANK-277", kind: "created", detail: "配气单创建：空气 目标 200bar · O₂ 21% · He 0% · 空气直充" },
    { id: "R-2", at: t(25), orderId: "O-1008", cylinderId: "TANK-277", kind: "started", detail: "开工锁定：气瓶 TANK-277 · 操作员 阿海 · 批次 B-AIR-01" },
    { id: "R-3", at: t(24.5), orderId: "O-1008", cylinderId: "TANK-277", kind: "measured-ok", measured: m(201, 21, 0, t(24.5)), detail: "实测合格：201bar · O₂ 21% · He 0%" },
    { id: "R-4", at: t(24), orderId: "O-1008", cylinderId: "TANK-277", kind: "signed", measured: m(201, 21, 0, t(24.5)), detail: "签收完成：空气 201bar · O₂ 21% · He 0%" },
    { id: "R-5", at: t(8), orderId: "O-1009", cylinderId: "TANK-312", kind: "created", detail: "配气单创建：高氧 目标 200bar · O₂ 36% · He 0% · 分压混气" },
    { id: "R-6", at: t(7), orderId: "O-1009", cylinderId: "TANK-312", kind: "started", detail: "开工锁定：气瓶 TANK-312 · 操作员 小林 · 批次 B-EAN-03" },
    { id: "R-7", at: t(6), orderId: "O-1009", cylinderId: "TANK-312", kind: "overlimit", measured: m(198, 38.1, 0, t(6)), detail: "超限留档转复核：氧含量超限(实测38.1%/目标36%)" },
    { id: "R-8", at: t(5), orderId: "O-1002", cylinderId: "TANK-219", kind: "created", detail: "配气单创建：高氧 目标 200bar · O₂ 32% · He 0% · 分压混气" },
    { id: "R-9", at: t(4), orderId: "O-1002", cylinderId: "TANK-219", kind: "started", detail: "开工锁定：气瓶 TANK-219 · 操作员 小林 · 批次 B-EAN-02" },
    { id: "R-10", at: t(3), orderId: "O-1002", cylinderId: "TANK-219", kind: "measured-ok", measured: m(200, 32.4, 0, t(3)), detail: "实测合格：200bar · O₂ 32.4% · He 0%" },
    { id: "R-11", at: t(2), orderId: "O-1007", cylinderId: "TANK-340", kind: "created", detail: "配气单创建：Trimix 目标 200bar · O₂ 18% · He 45% · 分压混气" },
    { id: "R-12", at: t(1), orderId: "O-1007", cylinderId: "TANK-340", kind: "started", detail: "开工锁定：气瓶 TANK-340 · 操作员 阿海 · 批次 B-TX-01" },
    { id: "R-13", at: t(1), orderId: "O-1001", cylinderId: "TANK-204", kind: "created", detail: "配气单创建：空气 目标 200bar · O₂ 21% · He 0% · 空气直充" },
    { id: "R-14", at: t(0.8), orderId: "O-1003", cylinderId: "TANK-231", kind: "created", detail: "配气单创建：Trimix 目标 200bar · O₂ 21% · He 35% · 连续流混气" },
    { id: "R-15", at: t(0.7), orderId: "O-1004", cylinderId: "TANK-118", kind: "created", detail: "配气单创建：空气 目标 200bar · O₂ 21% · He 0% · 空气直充" },
    { id: "R-16", at: t(0.6), orderId: "O-1005", cylinderId: "TANK-087", kind: "created", detail: "配气单创建：空气 目标 232bar · O₂ 21% · He 0% · 空气直充" },
    { id: "R-17", at: t(0.5), orderId: "O-1006", cylinderId: "TANK-156", kind: "created", detail: "配气单创建：空气 目标 200bar · O₂ 21% · He 0% · 空气直充" },
  ];

  return {
    version: 1,
    seq: 2000,
    cylinders: [
      { id: "TANK-204", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: iso(170), residualGas: "air", residualPressureBar: 55 },
      { id: "TANK-219", volumeL: 11, ratedPressureBar: 232, inspectionValidUntil: iso(60), residualGas: "none", residualPressureBar: 0 },
      { id: "TANK-231", volumeL: 24, ratedPressureBar: 232, inspectionValidUntil: iso(12), residualGas: "none", residualPressureBar: 0 },
      { id: "TANK-118", volumeL: 15, ratedPressureBar: 232, inspectionValidUntil: iso(-40), residualGas: "air", residualPressureBar: 20 },
      { id: "TANK-087", volumeL: 12, ratedPressureBar: 200, inspectionValidUntil: iso(220), residualGas: "none", residualPressureBar: 0 },
      { id: "TANK-156", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: iso(130), residualGas: "trimix", residualPressureBar: 30 },
      { id: "TANK-340", volumeL: 11, ratedPressureBar: 232, inspectionValidUntil: iso(320), residualGas: "none", residualPressureBar: 0 },
      { id: "TANK-095", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: iso(-10), residualGas: "eanx", residualPressureBar: 15 },
      { id: "TANK-277", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: iso(200), residualGas: "air", residualPressureBar: 201 },
      { id: "TANK-312", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: iso(150), residualGas: "none", residualPressureBar: 0 },
    ],
    batches: [
      { id: "B-AIR-01", label: "压缩空气·第12批", o2: 21, he: 0, status: "qualified" },
      { id: "B-EAN-02", label: "EAN32·第7批", o2: 32, he: 0, status: "qualified" },
      { id: "B-EAN-03", label: "EAN36·第3批", o2: 36, he: 0, status: "failed" },
      { id: "B-TX-01", label: "TX18/45·第2批", o2: 18, he: 45, status: "qualified" },
    ],
    stations: [
      { id: "ST-1", name: "一号工位", orderId: "O-1007" },
      { id: "ST-2", name: "二号工位", orderId: "O-1002" },
    ],
    orders: [
      { id: "O-1001", cylinderId: "TANK-204", targetPressureBar: 200, targetO2: 21, targetHe: 0, method: "空气直充", operator: null, batchId: null, stationId: null, status: "queued", createdAt: t(1), startedAt: null, measured: null },
      { id: "O-1002", cylinderId: "TANK-219", targetPressureBar: 200, targetO2: 32, targetHe: 0, method: "分压混气", operator: "小林", batchId: "B-EAN-02", stationId: "ST-2", status: "pendingSignoff", createdAt: t(5), startedAt: t(4), measured: m(200, 32.4, 0, t(3)) },
      { id: "O-1003", cylinderId: "TANK-231", targetPressureBar: 200, targetO2: 21, targetHe: 35, method: "连续流混气", operator: null, batchId: null, stationId: null, status: "queued", createdAt: t(0.8), startedAt: null, measured: null },
      { id: "O-1004", cylinderId: "TANK-118", targetPressureBar: 200, targetO2: 21, targetHe: 0, method: "空气直充", operator: null, batchId: null, stationId: null, status: "queued", createdAt: t(0.7), startedAt: null, measured: null },
      { id: "O-1005", cylinderId: "TANK-087", targetPressureBar: 232, targetO2: 21, targetHe: 0, method: "空气直充", operator: null, batchId: null, stationId: null, status: "queued", createdAt: t(0.6), startedAt: null, measured: null },
      { id: "O-1006", cylinderId: "TANK-156", targetPressureBar: 200, targetO2: 21, targetHe: 0, method: "空气直充", operator: null, batchId: null, stationId: null, status: "queued", createdAt: t(0.5), startedAt: null, measured: null },
      { id: "O-1007", cylinderId: "TANK-340", targetPressureBar: 200, targetO2: 18, targetHe: 45, method: "分压混气", operator: "阿海", batchId: "B-TX-01", stationId: "ST-1", status: "filling", createdAt: t(2), startedAt: t(1), measured: null },
      { id: "O-1008", cylinderId: "TANK-277", targetPressureBar: 200, targetO2: 21, targetHe: 0, method: "空气直充", operator: "阿海", batchId: "B-AIR-01", stationId: null, status: "signed", createdAt: t(26), startedAt: t(25), measured: m(201, 21, 0, t(24.5)) },
      { id: "O-1009", cylinderId: "TANK-312", targetPressureBar: 200, targetO2: 36, targetHe: 0, method: "分压混气", operator: "小林", batchId: "B-EAN-03", stationId: null, status: "review", createdAt: t(8), startedAt: t(7), measured: m(198, 38.1, 0, t(6)) },
    ],
    records,
  };
}
