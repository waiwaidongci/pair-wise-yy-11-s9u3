// 冒烟测试：直接驱动领域迁移，验证闭环规则（不参与构建）
import { buildSeed } from "../src/domain/seed";
import { startBlockers } from "../src/domain/rules";
import {
  addCylinder,
  createOrder,
  reorder,
  resumeFill,
  reviewOrder,
  sendInspection,
  setBatchStatus,
  signoff,
  startFill,
  finishFilling,
  submitMeasured,
  ventCylinder,
} from "../src/domain/transitions";
import type { AppState } from "../src/domain/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log("  ✓", name);
  } else {
    failed++;
    console.error("  ✗", name);
  }
}

const now = Date.now();
let s: AppState = buildSeed(new Date(now));
const apply = (r: { ok: boolean; state?: AppState }) => {
  if (r.ok && r.state) s = r.state;
  return r;
};
const blockers = (orderId: string, stationId: string, batchId: string) =>
  startBlockers(s, orderId, stationId, "阿海", batchId, new Date(now));

console.log("0. 前置：签收 O-1002，腾出二号工位");
{
  const r = apply(signoff("O-1002", now)(s));
  check("签收成功并释放工位", r.ok && s.stations.find((x) => x.id === "ST-2")?.orderId === null);
}

console.log("1. 编号唯一");
{
  const dup = addCylinder({ id: "TANK-204", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: "2030-01-01" }, now)(s);
  check("重复编号被拒绝", !dup.ok);
  const okNew = apply(addCylinder({ id: "TANK-401", volumeL: 12, ratedPressureBar: 232, inspectionValidUntil: "2030-01-01" }, now)(s));
  check("新编号可登记", okNew.ok);
}

console.log("2. 禁区：检验过期/耐压不足/余气冲突 不得开工，只能排空或送检");
{
  const expired = startFill("O-1004", "ST-2", "阿海", "B-AIR-01", now)(s); // TANK-118 检验过期
  check("检验过期禁止开工", !expired.ok && expired.message.includes("检验过期"));
  const lowRated = startFill("O-1005", "ST-2", "阿海", "B-AIR-01", now)(s); // TANK-087 耐压200<232
  check("耐压不足禁止开工", !lowRated.ok && lowRated.message.includes("耐压不足"));
  const conflict = startFill("O-1006", "ST-2", "阿海", "B-AIR-01", now)(s); // TANK-156 余气trimix vs 空气
  check("余气冲突禁止开工", !conflict.ok && conflict.message.includes("余气冲突"));
  const vent = apply(ventCylinder("TANK-156", now)(s));
  check("冲突气瓶可排空", vent.ok);
  check("排空后无开工阻断", blockers("O-1006", "ST-2", "B-AIR-01").length === 0);
  const insp = apply(sendInspection("TANK-118", now)(s));
  check("过期气瓶可送检", insp.ok);
  check("送检后无开工阻断", blockers("O-1004", "ST-2", "B-AIR-01").length === 0);
}

console.log("3. 一工位一瓶 + 开工锁定 + 重复并发开工仅一次");
{
  const occupied = startFill("O-1001", "ST-1", "阿海", "B-AIR-01", now)(s); // ST-1 被 O-1007 占用
  check("工位被占用时拒绝开工", !occupied.ok && occupied.message.includes("一工位只接一瓶"));
  const started = apply(startFill("O-1006", "ST-2", "阿海", "B-AIR-01", now)(s));
  check("空闲工位可开工", started.ok);
  const dup = startFill("O-1006", "ST-2", "阿海", "B-AIR-01", now)(s);
  check("重复/并发开工仅生效一次", !dup.ok && dup.message.includes("仅生效一次"));
  const locked = ventCylinder("TANK-156", now)(s);
  check("锁定气瓶禁止排空", !locked.ok);
  const lockedInsp = sendInspection("TANK-156", now)(s);
  check("锁定气瓶禁止送检", !lockedInsp.ok);
}

console.log("4. 气源失效暂停 → 换合格批次重验后续充");
{
  const r1 = apply(setBatchStatus("B-TX-01", "failed", now)(s));
  check("批次失效标记成功", r1.ok);
  const paused = s.orders.find((o) => o.id === "O-1007");
  check("在充工单被暂停", paused?.status === "paused");
  const badResume = resumeFill("O-1007", "B-TX-01", now)(s);
  check("失效批次重验不通过", !badResume.ok);
  const mismatch = resumeFill("O-1007", "B-AIR-01", now)(s);
  check("气体不符重验不通过", !mismatch.ok);
  apply(setBatchStatus("B-TX-01", "qualified", now)(s));
  const good = apply(resumeFill("O-1007", "B-TX-01", now)(s));
  check("合格批次重验后续充", good.ok && s.orders.find((o) => o.id === "O-1007")?.status === "filling");
}

console.log("5. 实测超限只留档转复核，复核不改实测");
{
  apply(finishFilling("O-1007", now)(s));
  const over = apply(submitMeasured("O-1007", { pressureBar: 200, o2: 25, he: 45 }, now)(s)); // 氧目标18，实测25超限
  check("超限转复核", over.ok && s.orders.find((o) => o.id === "O-1007")?.status === "review");
  check("超限释放工位", s.stations.find((st) => st.id === "ST-1")?.orderId === null);
  const rec = s.records.filter((r) => r.orderId === "O-1007" && r.kind === "overlimit");
  check("留档含实测快照", rec.length === 1 && rec[0].measured?.o2 === 25);
  const reviewed = apply(reviewOrder("O-1007", "老周", now)(s));
  const after = s.records.filter((r) => r.orderId === "O-1007" && r.kind === "overlimit")[0]?.measured?.o2;
  check("复核后重新入队", reviewed.ok && s.orders.find((o) => o.id === "O-1007")?.status === "queued");
  check("复核不改实测", after === 25);
}

console.log("6. 实测合格 → 签收 → 换配气单失效回队列");
{
  apply(finishFilling("O-1006", now)(s));
  const okm = apply(submitMeasured("O-1006", { pressureBar: 200, o2: 21, he: 0 }, now)(s));
  check("合格实测转待签收", okm.ok && s.orders.find((o) => o.id === "O-1006")?.status === "pendingSignoff");
  const signed = apply(signoff("O-1006", now)(s));
  check("签收成功", signed.ok && s.orders.find((o) => o.id === "O-1006")?.status === "signed");
  check("签收释放工位", s.stations.find((st) => st.id === "ST-2")?.orderId === null);
  const re = apply(reorder("O-1006", now)(s));
  const old = s.orders.find((o) => o.id === "O-1006");
  const fresh = s.orders.find((o) => o.cylinderId === "TANK-156" && o.status === "queued");
  check("换单后原签收失效", re.ok && old?.status === "invalidated");
  check("新配气单回队列", !!fresh);
}

console.log("7. 新配气单 → 开工全链路");
{
  const c1 = createOrder({ cylinderId: "TANK-204", targetPressureBar: 200, targetO2: 21, targetHe: 0, method: "空气直充" }, now)(s);
  check("已有队列单的气瓶拒绝重复开单", !c1.ok); // TANK-204 已有 O-1001
  const st2 = apply(startFill("O-1001", "ST-2", "阿海", "B-AIR-01", now)(s));
  check("ST-2 空闲可开工", st2.ok);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
