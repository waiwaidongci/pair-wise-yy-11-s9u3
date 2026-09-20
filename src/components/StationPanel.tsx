import { useMemo, useState } from "react";
import type { State } from "../domain/types";
import { failBatch, resumeWithBatch, submitMeasured } from "../store/store";
import { stationViews } from "../store/selectors";
import { Badge, Field, NumberInput, fmtTime, methodTag } from "./ui";
import type { Measured } from "../domain/rules";

export function StationPanel(props: { s: State; now: Date; notify: (ok: boolean, msg: string) => void }) {
  const views = useMemo(() => stationViews(props.s, props.now), [props.s, props.now]);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>充填工位</p>
          <h2>工位状态（{views.length} 个工位）</h2>
        </div>
      </div>
      <div className="station-grid">
        {views.map((v) => (
          <article key={v.id} className={`station-card ${v.session ? "locked" : "free"}`}>
            <header>
              <h3>{v.name}</h3>
              {v.session ? <Badge tone="warn">已锁定</Badge> : <Badge tone="ok">空闲</Badge>}
            </header>

            {!v.session && <p className="empty">等待队列配气单开工，一工位只接一瓶。</p>}

            {v.session && v.order && v.cylinder && (
              <StationBody
                s={props.s}
                view={v}
                notify={props.notify}
              />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function StationBody(props: {
  s: State;
  view: ReturnType<typeof stationViews>[number];
  notify: (ok: boolean, msg: string) => void;
}) {
  const { s, view, notify } = props;
  const ses = view.session!;
  const order = view.order!;
  const cylinder = view.cylinder!;
  const batch = s.batches.find((b) => b.id === ses.batchId);
  const paused = ses.state === "PAUSED";
  const [newBatch, setNewBatch] = useState(
    s.batches.find((b) => b.status === "ACTIVE" && view.resumeErrors[b.id]?.length === 0)?.id ??
      s.batches[0]?.id ??
      "",
  );
  const [m, setM] = useState<Measured>({
    o2: order.targetO2,
    he: order.method === "TRIMIX" ? order.targetHe : 0,
    pressure: order.targetPressure,
  });

  const resumeErr = view.resumeErrors[newBatch] ?? [];

  return (
    <div className="station-body">
      <dl className="lock-grid">
        <div><dt>气瓶</dt><dd>{cylinder.code}</dd></div>
        <div><dt>操作员</dt><dd>{ses.operator}</dd></div>
        <div><dt>气源批次</dt><dd>{ses.batchId}</dd></div>
        <div><dt>充填方式</dt><dd>{methodTag(order.method)}</dd></div>
        <div><dt>目标</dt><dd>{order.targetPressure}bar · O₂ {order.targetO2}% · He {order.targetHe}%</dd></div>
        <div><dt>开工时间</dt><dd>{fmtTime(ses.startedAt)}</dd></div>
      </dl>

      {paused && (
        <div className="pause-box">
          <Badge tone="bad">已暂停</Badge>
          <p>{ses.pauseReason}。请更换合格批次并重验后继续充填。</p>
          <Field label="更换气源批次">
            <select value={newBatch} onChange={(e) => setNewBatch(e.target.value)}>
              {s.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id} · {methodTag(b.method)} O₂{b.o2}/He{b.he}
                  {b.status === "FAILED" ? " · 失效" : ""}
                </option>
              ))}
            </select>
          </Field>
          {resumeErr.length > 0 ? (
            <ul className="rule-errors">{resumeErr.map((e, i) => <li key={i}>{e}</li>)}</ul>
          ) : (
            <p className="precheck-line ok">该批次重验通过，可续充。</p>
          )}
          <div className="row-actions">
            <button
              className="primary"
              disabled={resumeErr.length > 0}
              onClick={() =>
                resumeWithBatch(ses.id, newBatch).then((r) => notify(r.ok, r.message))
              }
            >
              换批重验并续充
            </button>
          </div>
        </div>
      )}

      {!paused && ses.state === "RUNNING" && (
        <div className="measure-box">
          <div className="measure-grid">
            <Field label="实测氧 O₂ %"><NumberInput value={m.o2} onChange={(n) => setM({ ...m, o2: n })} /></Field>
            <Field label="实测氦 He %"><NumberInput value={m.he} onChange={(n) => setM({ ...m, he: n })} /></Field>
            <Field label="实测压力 bar"><NumberInput value={m.pressure} onChange={(n) => setM({ ...m, pressure: n })} /></Field>
          </div>
          <p className="hint">公差：压力不高于目标且不低于目标 −3%；O₂ ±1.5%；He ±2.0%。超限自动留档转复核，实测值提交后冻结。</p>
          <div className="row-actions">
            <button onClick={() => failBatch(ses.batchId, "充填中发现气源异常").then((r) => notify(r.ok, r.message))}>
              标记气源失效（暂停）
            </button>
            <button
              className="primary"
              onClick={() => submitMeasured(ses.id, m).then((r) => notify(r.ok, r.message))}
            >
              录入实测并释放工位
            </button>
          </div>
          {batch && (
            <button
              className="link-btn"
              onClick={() => navigator.clipboard?.writeText(`${cylinder.code} ${batch.id}`)}
              title="气源批次信息"
            >
              当前批次：{batch.label}（O₂ {batch.o2}% / He {batch.he}%）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
