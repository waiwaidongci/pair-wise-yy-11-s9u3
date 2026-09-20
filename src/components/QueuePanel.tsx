import { useMemo, useState } from "react";
import type { State } from "../domain/types";
import {
  checkInspection,
  checkPressureRating,
  checkResidualConflict,
  inspectStatus,
  mixSuggestion,
} from "../domain/rules";
import { sendToInspection, startFill, ventOrder } from "../store/store";
import { queueRows } from "../store/selectors";
import { Badge, Field, NumberInput, methodTag } from "./ui";

export function QueuePanel(props: { s: State; now: Date; notify: (ok: boolean, msg: string) => void }) {
  const { s, now } = props;
  const rows = useMemo(() => queueRows(s, now), [s, now]);
  const [filter, setFilter] = useState<string>("ALL");
  const [startFor, setStartFor] = useState<string | null>(null);

  const visible = rows.filter((r) => {
    if (filter === "ALL") return true;
    if (filter === "EXPIRED")
      return r.inspect === "EXPIRED" || (r.cylinder?.inspecting ?? false);
    return r.order.method === filter;
  });

  return (
    <section className="panel queue-panel">
      <div className="heading">
        <div>
          <p>待充填队列</p>
          <h2>排队中的配气单（{rows.length}）</h2>
        </div>
        <div className="chips">
          {[
            ["ALL", "全部"],
            ["AIR", "空气"],
            ["NITROX", "高氧"],
            ["TRIMIX", "Trimix"],
            ["EXPIRED", "检验异常"],
          ].map(([k, label]) => (
            <button
              key={k}
              className={filter === k ? "chip-on" : ""}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && <p className="empty">队列为空，所有气瓶均已安排。</p>}

      <div className="queue-list">
        {visible.map(({ order, cylinder, inspect }) => {
          if (!cylinder) return null;
          const inspErr = checkInspection(cylinder, now);
          const pressErr = checkPressureRating(cylinder, order.targetPressure);
          const residErr = checkResidualConflict({
            residualPressure: order.residualPressure,
            residualO2: order.residualO2,
            residualHe: order.residualHe,
            method: order.method,
            targetO2: order.targetO2,
            targetHe: order.targetHe,
          });
          const blocked = Boolean(inspErr || pressErr || residErr);
          const sug = mixSuggestion(order.method, order.targetO2, order.targetHe);

          return (
            <article key={order.id} className="queue-card">
              <div className="queue-head">
                <div>
                  <h3>{cylinder.code}</h3>
                  <p className="sub">
                    {order.id} · {cylinder.volumeL}L · 耐压 {cylinder.workingPressure}bar
                  </p>
                </div>
                <div className="badges">
                  <Badge tone="info">{methodTag(order.method)}</Badge>
                  {inspect === "EXPIRED" && <Badge tone="bad">检验过期</Badge>}
                  {inspect === "WARNING" && <Badge tone="warn">临期</Badge>}
                  {cylinder.inspecting && <Badge tone="warn">送检中</Badge>}
                  {blocked && <Badge tone="bad">禁止开工</Badge>}
                </div>
              </div>

              <div className="mix-grid">
                <div><small>目标配比</small><b>O₂ {sug.o2} / He {sug.he}</b><em>{sug.balance}</em></div>
                <div><small>目标压力</small><b>{order.targetPressure} bar</b></div>
                <div><small>残压 / 余气</small><b>{order.residualPressure} bar</b><em>O₂ {order.residualO2}% · He {order.residualHe}%</em></div>
                <div><small>检验有效期</small><b>{cylinder.testExpiry}</b></div>
              </div>

              {blocked && (
                <ul className="rule-errors">
                  {inspErr && <li>{inspErr}</li>}
                  {pressErr && <li>{pressErr}</li>}
                  {residErr && <li>{residErr}</li>}
                  <li className="outlet">不可开工 —— 只能<b>排空</b>或<b>送检</b></li>
                </ul>
              )}

              <div className="queue-actions">
                <button className="primary" disabled={blocked} onClick={() => setStartFor(order.id)}>
                  开工
                </button>
                <button onClick={() => ventOrder(order.id).then((r) => props.notify(r.ok, r.message))}>
                  排空
                </button>
                <button onClick={() => sendToInspection(cylinder.code, order.id).then((r) => props.notify(r.ok, r.message))}>
                  送检
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {startFor && (
        <StartDialog
          s={s}
          orderId={startFor}
          now={now}
          onClose={() => setStartFor(null)}
          notify={props.notify}
        />
      )}
    </section>
  );
}

function StartDialog(props: {
  s: State;
  orderId: string;
  now: Date;
  onClose: () => void;
  notify: (ok: boolean, msg: string) => void;
}) {
  const { s } = props;
  const order = s.orders.find((o) => o.id === props.orderId)!;
  const cylinder = s.cylinders.find((c) => c.code === order.cylinderCode)!;
  const [stationId, setStationId] = useState(s.stations[0]?.id ?? "");
  const [operator, setOperator] = useState("");
  const [batchId, setBatchId] = useState(
    s.batches.find((b) => b.status === "ACTIVE" && b.method === order.method)?.id ??
      s.batches[0]?.id ??
      "",
  );
  const [busy, setBusy] = useState(false);

  const batch = s.batches.find((b) => b.id === batchId);
  const station = s.stations.find((st) => st.id === stationId);
  const errors: string[] = [];
  if (station?.sessionId) errors.push(`工位 ${station.name} 已锁定气瓶`);
  if (batch) {
    const e = checkInspection(cylinder, props.now);
    if (e) errors.push(e);
    const p = checkPressureRating(cylinder, order.targetPressure);
    if (p) errors.push(p);
    const r = checkResidualConflict({
      residualPressure: order.residualPressure,
      residualO2: order.residualO2,
      residualHe: order.residualHe,
      method: order.method,
      targetO2: order.targetO2,
      targetHe: order.targetHe,
    });
    if (r) errors.push(r);
    if (batch.status !== "ACTIVE") errors.push("气源：批次已失效");
    if (batch.method === "AIR" && order.method !== "AIR") errors.push("气源：类型不匹配");
    if (batch.method === "NITROX") {
      if (order.method === "AIR") errors.push("气源：空气单不能用高氧批次");
      if (batch.o2 + 1 < order.targetO2) errors.push(`气源：批次氧 ${batch.o2}% 低于目标`);
    }
    if (batch.method === "TRIMIX") {
      if (order.method !== "TRIMIX") errors.push("气源：仅 Trimix 单可用");
      if (batch.o2 + 1 < order.targetO2) errors.push("气源：批次氧低于目标");
      if (batch.he + 1 < order.targetHe) errors.push("气源：批次氦低于目标");
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    const r = await startFill({ orderId: order.id, stationId, operator, batchId });
    setBusy(false);
    props.notify(r.ok, r.message);
    if (r.ok) props.onClose();
  }

  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>开工锁定 · {cylinder.code}</h3>
        <p className="sub">开工后气瓶、操作员、气源批次同时锁定，直到录入实测释放工位。</p>

        <Field label="工位（一工位一瓶）">
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {s.stations.map((st) => (
              <option key={st.id} value={st.id} disabled={st.sessionId !== null}>
                {st.name}
                {st.sessionId !== null ? "（占用中）" : "（空闲）"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="操作员（锁定）">
          <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="工号或姓名" />
        </Field>
        <Field label="气源批次（锁定）">
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {s.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {b.label}（{methodTag(b.method)} O₂{b.o2}/He{b.he}）
                {b.status === "FAILED" ? " · 已失效" : ""}
              </option>
            ))}
          </select>
        </Field>

        <div className={errors.length ? "precheck bad" : "precheck ok"}>
          {errors.length ? (
            <>
              <b>预检不通过：</b>
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </>
          ) : (
            <b>预检通过，可以开工</b>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={props.onClose}>取消</button>
          <button className="primary" disabled={busy || errors.length > 0 || !operator.trim()} onClick={submit}>
            {busy ? "提交中…" : "确认开工（仅一次）"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 供登记表单复用
export function TargetFields(props: {
  method: "AIR" | "NITROX" | "TRIMIX";
  setMethod: (m: "AIR" | "NITROX" | "TRIMIX") => void;
  targetO2: number; setTargetO2: (n: number) => void;
  targetHe: number; setTargetHe: (n: number) => void;
  targetPressure: number; setTargetPressure: (n: number) => void;
  residualPressure: number; setResidualPressure: (n: number) => void;
  residualO2: number; setResidualO2: (n: number) => void;
  residualHe: number; setResidualHe: (n: number) => void;
}) {
  const p = props;
  return (
    <>
      <Field label="充填方式">
        <select value={p.method} onChange={(e) => p.setMethod(e.target.value as typeof p.method)}>
          <option value="AIR">空气</option>
          <option value="NITROX">高氧 EAN</option>
          <option value="TRIMIX">Trimix</option>
        </select>
      </Field>
      <Field label="目标压力 bar"><NumberInput value={p.targetPressure} min={0} onChange={p.setTargetPressure} /></Field>
      <Field label="目标氧 O₂ %"><NumberInput value={p.targetO2} onChange={p.setTargetO2} /></Field>
      <Field label="目标氦 He %"><NumberInput value={p.targetHe} onChange={p.setTargetHe} /></Field>
      <Field label="残压 bar"><NumberInput value={p.residualPressure} min={0} onChange={p.setResidualPressure} /></Field>
      <Field label="余气氧 O₂ %"><NumberInput value={p.residualO2} onChange={p.setResidualO2} /></Field>
      <Field label="余气氦 He %"><NumberInput value={p.residualHe} onChange={p.setResidualHe} /></Field>
    </>
  );
}
