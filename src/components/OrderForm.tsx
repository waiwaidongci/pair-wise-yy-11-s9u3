import { useState } from "react";
import { ACTIVE_STATUSES, gasKindOf, gasKindLabel } from "../domain/rules";
import { addCylinder, createOrder } from "../domain/transitions";
import { toISODate } from "../domain/rules";
import type { PanelProps } from "./common";

const METHODS = ["空气直充", "分压混气", "连续流混气", "膜分离"];

export default function OrderForm(props: PanelProps) {
  return (
    <section className="grid-2">
      <NewOrderForm {...props} />
      <NewCylinderForm {...props} />
    </section>
  );
}

function NewOrderForm({ state, run }: PanelProps) {
  const available = state.cylinders.filter(
    (c) => !state.orders.some((o) => o.cylinderId === c.id && ACTIVE_STATUSES.includes(o.status))
  );
  const [cylinderId, setCylinderId] = useState("");
  const [pressure, setPressure] = useState("200");
  const [o2, setO2] = useState("21");
  const [he, setHe] = useState("0");
  const [method, setMethod] = useState(METHODS[0]);
  const kind = gasKindOf(Number(o2) || 0, Number(he) || 0);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>配气单</p>
          <h2>新配气单</h2>
        </div>
        <span className="badge badge-info">{gasKindLabel(kind)}</span>
      </div>
      <div className="form-inline">
        <label>
          <span>气瓶（无进行中工单）</span>
          <select value={cylinderId} onChange={(e) => setCylinderId(e.target.value)}>
            <option value="">选择气瓶</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.volumeL}L · 耐压{c.ratedPressureBar}bar
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>目标压力 bar</span>
          <input type="number" value={pressure} onChange={(e) => setPressure(e.target.value)} />
        </label>
        <label>
          <span>氧含量 %</span>
          <input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} />
        </label>
        <label>
          <span>氦含量 %</span>
          <input type="number" step="0.1" value={he} onChange={(e) => setHe(e.target.value)} />
        </label>
        <label>
          <span>充填方式</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              const r = run(
                createOrder(
                  {
                    cylinderId,
                    targetPressureBar: Number(pressure),
                    targetO2: Number(o2),
                    targetHe: Number(he),
                    method,
                  },
                  Date.now()
                )
              );
              if (r.ok) setCylinderId("");
            }}
          >
            加入队列
          </button>
        </div>
      </div>
    </section>
  );
}

function NewCylinderForm({ run }: PanelProps) {
  const [id, setId] = useState("");
  const [vol, setVol] = useState("12");
  const [rated, setRated] = useState("232");
  const [until, setUntil] = useState(toISODate(new Date(Date.now() + 365 * 86400000)));
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>气瓶档案</p>
          <h2>登记气瓶</h2>
        </div>
      </div>
      <div className="form-inline">
        <label>
          <span>气瓶编号（唯一）</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="如 TANK-401" />
        </label>
        <label>
          <span>容积 L</span>
          <input type="number" value={vol} onChange={(e) => setVol(e.target.value)} />
        </label>
        <label>
          <span>耐压 bar</span>
          <input type="number" value={rated} onChange={(e) => setRated(e.target.value)} />
        </label>
        <label>
          <span>检验有效期</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              const r = run(
                addCylinder(
                  { id, volumeL: Number(vol), ratedPressureBar: Number(rated), inspectionValidUntil: until },
                  Date.now()
                )
              );
              if (r.ok) setId("");
            }}
          >
            登记
          </button>
        </div>
      </div>
      <p className="hint">编号唯一：重复编号将被拒绝。</p>
    </section>
  );
}
