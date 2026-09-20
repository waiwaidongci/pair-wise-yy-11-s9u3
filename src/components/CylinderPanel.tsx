import {
  ACTIVE_STATUSES,
  cylinderLocked,
  daysUntilInspection,
  EXPIRY_WARNING_DAYS,
  isInspectionExpired,
  residualLabel,
} from "../domain/rules";
import { sendInspection, ventCylinder } from "../domain/transitions";
import { Badge, ORDER_STATUS_LABEL, type PanelProps } from "./common";

export default function CylinderPanel({ state, run }: PanelProps) {
  const now = new Date();
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>气瓶档案</p>
          <h2>气瓶（{state.cylinders.length}）</h2>
        </div>
      </div>
      <div className="list">
        {state.cylinders.map((c) => {
          const locked = cylinderLocked(state, c.id);
          const expired = isInspectionExpired(c, now);
          const days = daysUntilInspection(c, now);
          const active = state.orders.find((o) => o.cylinderId === c.id && ACTIVE_STATUSES.includes(o.status));
          return (
            <div className="list-row" key={c.id}>
              <div>
                <b>{c.id}</b> {locked && <Badge tone="lock">🔒 锁定</Badge>}
                <div className="meta">
                  {c.volumeL}L · 耐压 {c.ratedPressureBar}bar · 检验至 {c.inspectionValidUntil} · 余气{" "}
                  {c.residualGas === "none" ? "无" : `${residualLabel(c.residualGas)} ${c.residualPressureBar}bar`}
                </div>
                <div className="badge-row">
                  {expired && <Badge tone="danger">检验过期</Badge>}
                  {!expired && days <= EXPIRY_WARNING_DAYS && <Badge tone="warn">临期 {days} 天</Badge>}
                  {active && (
                    <Badge tone="info">
                      {active.id} · {ORDER_STATUS_LABEL[active.status]}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="ghost"
                  disabled={locked || c.residualGas === "none"}
                  onClick={() => run(ventCylinder(c.id, Date.now()))}
                >
                  排空
                </button>
                <button className="ghost" disabled={locked} onClick={() => run(sendInspection(c.id, Date.now()))}>
                  送检
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">检验过期、耐压不足或余气冲突的气瓶禁止开工，仅可排空或送检。</p>
    </section>
  );
}
