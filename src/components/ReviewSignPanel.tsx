import { useState } from "react";
import type { State } from "../domain/types";
import { reviewSession, signOff } from "../store/store";
import { awaitingList } from "../store/selectors";
import { Badge, Field, fmtTime, methodTag } from "./ui";

export function ReviewSignPanel(props: { s: State; notify: (ok: boolean, msg: string) => void }) {
  const { review, signable } = awaitingList(props.s);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>复核与签收</p>
          <h2>待复核 {review.length} · 待签收 {signable.length}</h2>
        </div>
      </div>

      <div className="two-col">
        <div>
          <h3 className="col-title">留档转复核（实测冻结，复核不改实测）</h3>
          {review.length === 0 && <p className="empty">没有超限待复核记录。</p>}
          {review.map((r) => (
            <ReviewCard key={r.session.id} s={props.s} row={r} notify={props.notify} />
          ))}
        </div>

        <div>
          <h3 className="col-title">待客户签收</h3>
          {signable.length === 0 && <p className="empty">没有待签收气瓶。</p>}
          {signable.map((r) => (
            <SignCard key={r.session.id} s={props.s} row={r} notify={props.notify} />
          ))}
        </div>
      </div>
    </section>
  );
}

type Row = ReturnType<typeof awaitingList>["review"][number];

function MeasuredTable({ row, violations }: { row: Row; violations?: boolean }) {
  const { session: ses, order } = row;
  return (
    <table className="measured-table">
      <thead>
        <tr><th></th><th>O₂ %</th><th>He %</th><th>压力 bar</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>目标</td>
          <td>{order?.targetO2}</td>
          <td>{order?.targetHe}</td>
          <td>{order?.targetPressure}</td>
        </tr>
        <tr className={violations ? "measured-bad" : "measured-ok"}>
          <td>实测（冻结）</td>
          <td>{ses.measured!.o2}</td>
          <td>{ses.measured!.he}</td>
          <td>{ses.measured!.pressure}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ReviewCard({ s, row, notify }: { s: State; row: Row; notify: (ok: boolean, msg: string) => void }) {
  const { session: ses, cylinder } = row;
  const [reviewer, setReviewer] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(result: "CONFIRMED" | "REJECTED") {
    if (busy) return;
    setBusy(true);
    const r = await reviewSession(ses.id, reviewer, result, comment);
    setBusy(false);
    notify(r.ok, r.message);
  }

  return (
    <article className="work-card review">
      <header>
        <div>
          <h4>{cylinder?.code} <small>{ses.id} · {methodTag(row.order?.method ?? "AIR")}</small></h4>
          <p className="sub">实测时间 {fmtTime(ses.measured!.at)}</p>
        </div>
        <Badge tone="bad">超限</Badge>
      </header>
      <MeasuredTable row={row} violations />
      <ul className="rule-errors">
        {ses.events.filter((e) => e.type === "MEASURED").map((e, i) => (
          <li key={i}>{e.detail}</li>
        ))}
      </ul>
      <Field label="复核人">
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="复核员工号/姓名" />
      </Field>
      <Field label="复核意见（不影响实测值）">
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="如：确认放行 / 退回重充" />
      </Field>
      <div className="row-actions">
        <button disabled={busy || !reviewer.trim()} onClick={() => decide("REJECTED")}>驳回回队列</button>
        <button className="primary" disabled={busy || !reviewer.trim()} onClick={() => decide("CONFIRMED")}>
          复核通过放行
        </button>
      </div>
      <p className="frozen-note">复核仅追加结论与意见，实测值保持 {ses.measured!.o2}/{ses.measured!.he}/{ses.measured!.pressure} 不变。</p>
    </article>
  );
}

function SignCard({ row, notify }: { s: State; row: Row; notify: (ok: boolean, msg: string) => void }) {
  const { session: ses, cylinder } = row;
  const [signer, setSigner] = useState("");
  const wasReviewed = Boolean(ses.review);
  return (
    <article className="work-card sign">
      <header>
        <div>
          <h4>{cylinder?.code} <small>{ses.id}</small></h4>
          <p className="sub">操作员 {ses.operator} · {fmtTime(ses.measured!.at)}</p>
        </div>
        {wasReviewed ? <Badge tone="warn">复核通过</Badge> : <Badge tone="ok">公差内</Badge>}
      </header>
      <MeasuredTable row={row} />
      {wasReviewed && (
        <p className="frozen-note">复核结论：{ses.review?.result === "CONFIRMED" ? "通过" : "驳回"}（{ses.review?.reviewer}）— 实测未改动</p>
      )}
      <Field label="签收人">
        <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="客户或经手人" />
      </Field>
      <div className="row-actions">
        <button
          className="primary"
          disabled={!signer.trim()}
          onClick={() => signOff(ses.id, signer).then((r) => notify(r.ok, r.message))}
        >
          签收
        </button>
      </div>
    </article>
  );
}
