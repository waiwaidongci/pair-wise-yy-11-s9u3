import { useState } from "react";
import { HE_TOLERANCE, O2_TOLERANCE, PRESSURE_TOLERANCE, gasKindOf, gasKindLabel } from "../domain/rules";
import { finishFilling, resumeFill, signoff, startFill, submitMeasured } from "../domain/transitions";
import { Badge, MeasuredChips, ORDER_STATUS_LABEL, type PanelProps } from "./common";

export default function StationPanel(props: PanelProps) {
  const { state } = props;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>充填工位</p>
          <h2>工位闭环 · 一工位一瓶</h2>
        </div>
      </div>
      <div className="station-grid">
        {state.stations.map((st) => (
          <StationCard key={st.id} stationId={st.id} {...props} />
        ))}
      </div>
      <p className="hint">开工即锁定气瓶、操作员与气源批次；重复或并发开工仅生效一次，其余请求被拒绝。</p>
    </section>
  );
}

function StationCard({ stationId, state, run }: PanelProps & { stationId: string }) {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) return null;
  const order = state.orders.find((o) => o.id === station.orderId);
  return (
    <article className="station-card">
      <div className="station-head">
        <h3>{station.name}</h3>
        {order ? <Badge tone="info">{ORDER_STATUS_LABEL[order.status]}</Badge> : <Badge tone="muted">空闲</Badge>}
      </div>
      {order ? (
        <ActiveJob orderId={order.id} state={state} run={run} />
      ) : (
        <StartForm stationId={stationId} state={state} run={run} />
      )}
    </article>
  );
}

function StartForm({ stationId, state, run }: PanelProps & { stationId: string }) {
  const queued = state.orders.filter((o) => o.status === "queued");
  const qualified = state.batches.filter((b) => b.status === "qualified");
  const [orderId, setOrderId] = useState("");
  const [operator, setOperator] = useState("");
  const [batchId, setBatchId] = useState("");
  if (queued.length === 0) return <p className="empty">队列空闲，暂无待充填配气单。</p>;
  return (
    <div className="form-inline">
      <label>
        <span>配气单</span>
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">选择队列中的配气单</option>
          {queued.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id} · {o.cylinderId} · {gasKindLabel(gasKindOf(o.targetO2, o.targetHe))} {o.targetPressureBar}bar
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>操作员</span>
        <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="开工后锁定" />
      </label>
      <label>
        <span>气源批次</span>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">选择合格批次</option>
          {qualified.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · O₂ {b.o2}% · He {b.he}%
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button
          className="primary"
          onClick={() => {
            const r = run(startFill(orderId, stationId, operator, batchId, Date.now()));
            if (r.ok) {
              setOrderId("");
              setOperator("");
              setBatchId("");
            }
          }}
        >
          开工并锁定
        </button>
      </div>
    </div>
  );
}

function ActiveJob({ orderId, state, run }: PanelProps & { orderId: string }) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const c = state.cylinders.find((x) => x.id === order.cylinderId);
  return (
    <div className="job">
      <div className="lock-row">
        <span className="lock-chip">🔒 气瓶 {order.cylinderId}</span>
        <span className="lock-chip">🔒 操作员 {order.operator}</span>
        <span className="lock-chip">🔒 批次 {order.batchId}</span>
      </div>
      <p className="meta">
        {order.id} · 目标 {order.targetPressureBar}bar · O₂ {order.targetO2}% · He {order.targetHe}% · {order.method}
        {c ? ` · 耐压 ${c.ratedPressureBar}bar` : ""}
      </p>
      {order.status === "filling" && (
        <div className="actions">
          <button className="primary" onClick={() => run(finishFilling(order.id, Date.now()))}>
            完成充填
          </button>
        </div>
      )}
      {order.status === "paused" && <ResumeForm orderId={order.id} state={state} run={run} />}
      {order.status === "measuring" && <MeasureForm orderId={order.id} state={state} run={run} />}
      {order.status === "pendingSignoff" && order.measured && (
        <>
          <p className="meta">
            实测：
            <MeasuredChips m={order.measured} />
          </p>
          <div className="actions">
            <button className="primary" onClick={() => run(signoff(order.id, Date.now()))}>
              签收
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResumeForm({ orderId, state, run }: PanelProps & { orderId: string }) {
  const qualified = state.batches.filter((b) => b.status === "qualified");
  const [batchId, setBatchId] = useState("");
  return (
    <div className="form-inline">
      <p className="warn-banner">气源批次已失效，充填暂停。请更换合格批次并重验。</p>
      <label>
        <span>新气源批次</span>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">选择合格批次</option>
          {qualified.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · O₂ {b.o2}% · He {b.he}%
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="primary" onClick={() => run(resumeFill(orderId, batchId, Date.now()))}>
          重验后续充
        </button>
      </div>
    </div>
  );
}

function MeasureForm({ orderId, state, run }: PanelProps & { orderId: string }) {
  const order = state.orders.find((o) => o.id === orderId);
  const [p, setP] = useState(String(order?.targetPressureBar ?? 200));
  const [o2, setO2] = useState(String(order?.targetO2 ?? 21));
  const [he, setHe] = useState(String(order?.targetHe ?? 0));
  if (!order) return null;
  return (
    <div className="form-inline">
      <label>
        <span>实测压力 bar</span>
        <input type="number" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      <label>
        <span>实测氧 %</span>
        <input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} />
      </label>
      <label>
        <span>实测氦 %</span>
        <input type="number" step="0.1" value={he} onChange={(e) => setHe(e.target.value)} />
      </label>
      <div className="actions">
        <button
          className="primary"
          onClick={() =>
            run(submitMeasured(orderId, { pressureBar: Number(p), o2: Number(o2), he: Number(he) }, Date.now()))
          }
        >
          提交实测
        </button>
      </div>
      <p className="hint">
        允差：O₂ ±{O2_TOLERANCE}% · He ±{HE_TOLERANCE}% · 压力 ±{PRESSURE_TOLERANCE}bar；超限只留档转复核，复核不改实测。
      </p>
    </div>
  );
}
