import { useState } from "react";
import type { State } from "../domain/types";
import {
  addCylinderWithOrder,
  failBatch,
  reactivateBatch,
  reorderAfterSign,
  resetDemo,
  returnFromInspection,
} from "../store/store";
import { signedCylinders } from "../store/selectors";
import { Badge, Field, methodTag } from "./ui";
import { TargetFields } from "./QueuePanel";

type Method = "AIR" | "NITROX" | "TRIMIX";

function defaults(method: Method) {
  if (method === "AIR") return { o2: 20.9, he: 0 };
  if (method === "NITROX") return { o2: 32, he: 0 };
  return { o2: 21, he: 35 };
}

export function RegisterPanel(props: { s: State; notify: (ok: boolean, msg: string) => void }) {
  const { s } = props;
  const [code, setCode] = useState("");
  const [volumeL, setVolumeL] = useState(12);
  const [wp, setWp] = useState(230);
  const [expiry, setExpiry] = useState("");
  const [method, setMethod] = useState<Method>("AIR");
  const [targetO2, setTargetO2] = useState(20.9);
  const [targetHe, setTargetHe] = useState(0);
  const [targetPressure, setTargetPressure] = useState(200);
  const [residualPressure, setResidualPressure] = useState(0);
  const [residualO2, setResidualO2] = useState(20.9);
  const [residualHe, setResidualHe] = useState(0);

  function changeMethod(m: Method) {
    setMethod(m);
    const d = defaults(m);
    setTargetO2(d.o2);
    setTargetHe(d.he);
    setResidualO2(d.o2);
    setResidualHe(d.he);
  }

  async function submit() {
    const r = await addCylinderWithOrder({
      code, volumeL, workingPressure: wp, testExpiry: expiry,
      method, targetO2, targetHe, targetPressure,
      residualPressure, residualO2, residualHe,
    });
    props.notify(r.ok, r.message);
    if (r.ok) setCode("");
  }

  const inspecting = s.cylinders.filter((c) => c.inspecting);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>主数据与登记</p>
          <h2>新气瓶登记 + 配气单</h2>
        </div>
        <button onClick={() => resetDemo().then((r) => props.notify(r.ok, r.message))}>重置演示数据</button>
      </div>

      <div className="field-grid">
        <Field label="气瓶编号" hint="全局唯一，重复编号被拒">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 TANK-305" />
        </Field>
        <Field label="容积 L">
          <input type="number" value={volumeL} onChange={(e) => setVolumeL(Number(e.target.value))} />
        </Field>
        <Field label="公称耐压 bar">
          <input type="number" value={wp} onChange={(e) => setWp(Number(e.target.value))} />
        </Field>
        <Field label="检验有效期至">
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <TargetFields
          method={method} setMethod={changeMethod}
          targetO2={targetO2} setTargetO2={setTargetO2}
          targetHe={targetHe} setTargetHe={setTargetHe}
          targetPressure={targetPressure} setTargetPressure={setTargetPressure}
          residualPressure={residualPressure} setResidualPressure={setResidualPressure}
          residualO2={residualO2} setResidualO2={setResidualO2}
          residualHe={residualHe} setResidualHe={setResidualHe}
        />
      </div>
      <div className="row-actions">
        <button className="primary" onClick={submit}>登记并进入队列</button>
      </div>

      {inspecting.length > 0 && (
        <div className="inspect-back">
          <h4>送检回归登记</h4>
          {inspecting.map((c) => (
            <InspectReturn key={c.code} code={c.code} notify={props.notify} />
          ))}
        </div>
      )}
    </section>
  );
}

function InspectReturn({ code, notify }: { code: string; notify: (ok: boolean, msg: string) => void }) {
  const [expiry, setExpiry] = useState("");
  return (
    <div className="inspect-row">
      <Badge tone="warn">{code} 送检中</Badge>
      <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <button
        className="primary"
        disabled={!expiry}
        onClick={() => returnFromInspection(code, expiry).then((r) => notify(r.ok, r.message))}
      >
        检验合格回归
      </button>
    </div>
  );
}

/** 签收后换配气单 */
export function ReorderPanel(props: { s: State; notify: (ok: boolean, msg: string) => void }) {
  const signed = signedCylinders(props.s);
  const [code, setCode] = useState(signed[0]?.code ?? "");
  const [method, setMethod] = useState<Method>("AIR");
  const [targetO2, setTargetO2] = useState(20.9);
  const [targetHe, setTargetHe] = useState(0);
  const [targetPressure, setTargetPressure] = useState(200);
  const [residualPressure, setResidualPressure] = useState(200);
  const [residualO2, setResidualO2] = useState(20.9);
  const [residualHe, setResidualHe] = useState(0);

  function changeMethod(m: Method) {
    setMethod(m);
    const d = defaults(m);
    setTargetO2(d.o2);
    setTargetHe(d.he);
    setResidualO2(d.o2);
    setResidualHe(d.he);
  }

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>签收后变更</p>
          <h2>换配气单（原单失效，气瓶回队列）</h2>
        </div>
      </div>
      {signed.length === 0 ? (
        <p className="empty">暂无已签收气瓶。签收后可在此申请新配气单。</p>
      ) : (
        <>
          <div className="field-grid">
            <Field label="已签收气瓶">
              <select value={code} onChange={(e) => setCode(e.target.value)}>
                {signed.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </Field>
            <TargetFields
              method={method} setMethod={changeMethod}
              targetO2={targetO2} setTargetO2={setTargetO2}
              targetHe={targetHe} setTargetHe={setTargetHe}
              targetPressure={targetPressure} setTargetPressure={setTargetPressure}
              residualPressure={residualPressure} setResidualPressure={setResidualPressure}
              residualO2={residualO2} setResidualO2={setResidualO2}
              residualHe={residualHe} setResidualHe={setResidualHe}
            />
          </div>
          <div className="row-actions">
            <button
              className="primary"
              onClick={() =>
                reorderAfterSign({
                  cylinderCode: code, method, targetO2, targetHe, targetPressure,
                  residualPressure, residualO2, residualHe,
                }).then((r) => props.notify(r.ok, r.message))
              }
            >
              作废原单并回队列
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** 气源批次管理 */
export function BatchPanel(props: { s: State; notify: (ok: boolean, msg: string) => void }) {
  const { s } = props;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>气源批次</p>
          <h2>批次合格状态（失效将自动暂停充填）</h2>
        </div>
      </div>
      <div className="batch-list">
        {s.batches.map((b) => (
          <article key={b.id} className={`batch-card ${b.status === "FAILED" ? "failed" : ""}`}>
            <div>
              <h4>{b.id} <small>{b.label}</small></h4>
              <p className="sub">
                {methodTag(b.method)} · O₂ {b.o2}% · He {b.he}%
                {b.note ? ` · ${b.note}` : ""}
              </p>
            </div>
            {b.status === "ACTIVE" ? <Badge tone="ok">合格</Badge> : <Badge tone="bad">失效</Badge>}
            {b.status === "ACTIVE" && (
              <button onClick={() => failBatch(b.id, "现场判定气源失效").then((r) => props.notify(r.ok, r.message))}>
                标记失效
              </button>
            )}
            {b.status === "FAILED" && (
              <button onClick={() => reactivateBatch(b.id).then((r) => props.notify(r.ok, r.message))}>
                恢复合格
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="hint">失效后进行中的相关充填自动暂停，需在工位上选择其他合格批次并重验后续充。</p>
    </section>
  );
}
