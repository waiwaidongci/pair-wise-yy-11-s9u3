import { useState } from "react";
import { measuredIssues } from "../domain/rules";
import { reviewOrder } from "../domain/transitions";
import { Badge, MeasuredChips, type PanelProps } from "./common";

export default function ReviewPanel({ state, run }: PanelProps) {
  const rows = state.orders.filter((o) => o.status === "review");
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>超限留档</p>
          <h2>复核（{rows.length}）</h2>
        </div>
      </div>
      {rows.length === 0 && <p className="empty">暂无待复核工单。</p>}
      <div className="list">
        {rows.map((o) => (
          <ReviewRow key={o.id} orderId={o.id} state={state} run={run} />
        ))}
      </div>
      <p className="hint">复核仅确认留档结论，实测值不可修改；确认后气瓶重新入队充填。</p>
    </section>
  );
}

function ReviewRow({ orderId, state, run }: PanelProps & { orderId: string }) {
  const o = state.orders.find((x) => x.id === orderId);
  const [reviewer, setReviewer] = useState("");
  if (!o) return null;
  const c = state.cylinders.find((x) => x.id === o.cylinderId);
  const issues = o.measured ? measuredIssues(o, c, o.measured) : [];
  return (
    <div className="list-row">
      <div>
        <b>{o.id}</b> <span className="muted">{o.cylinderId}</span> <Badge tone="danger">超限留档</Badge>
        <div className="meta">
          目标 {o.targetPressureBar}bar · O₂ {o.targetO2}% · He {o.targetHe}%
        </div>
        {o.measured && (
          <div className="meta">
            实测（只读）：
            <MeasuredChips m={o.measured} />
          </div>
        )}
        <div className="badge-row">
          {issues.map((i) => (
            <Badge key={i} tone="warn">
              {i}
            </Badge>
          ))}
        </div>
      </div>
      <div className="row-actions">
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="复核人" />
        <button className="primary" onClick={() => run(reviewOrder(o.id, reviewer, Date.now()))}>
          复核确认
        </button>
      </div>
    </div>
  );
}
