import { useMemo, useState } from "react";
import type { State } from "../domain/types";
import { cylinderHistory } from "../store/selectors";
import { inspectStatus, mixSuggestion } from "../domain/rules";
import { Badge, fmtTime, methodTag } from "./ui";

export function HistoryPanel(props: { s: State; now: Date }) {
  const { s, now } = props;
  const [code, setCode] = useState(s.cylinders[0]?.code ?? "");
  const cylinder = s.cylinders.find((c) => c.code === code);
  const history = useMemo(() => (code ? cylinderHistory(s, code) : []), [s, code]);
  const events = code ? s.cylinderEvents[code] ?? [] : [];
  const insp = cylinder ? inspectStatus(cylinder.testExpiry, now) : "OK";

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>单瓶档案</p>
          <h2>单个气瓶历史记录</h2>
        </div>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {s.cylinders.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>

      {cylinder && (
        <div className="cyl-master">
          <div>
            <h3>
              {cylinder.code}
              {insp === "EXPIRED" && <Badge tone="bad">检验过期</Badge>}
              {insp === "WARNING" && <Badge tone="warn">临期</Badge>}
              {insp === "OK" && <Badge tone="ok">检验有效</Badge>}
              {cylinder.inspecting && <Badge tone="warn">送检中</Badge>}
            </h3>
            <p className="sub">
              {cylinder.volumeL}L · 公称耐压 {cylinder.workingPressure}bar ·
              检验有效期至 {cylinder.testExpiry}
            </p>
          </div>
        </div>
      )}

      <h4 className="col-title">充填会话（{history.length}）</h4>
      {history.length === 0 && <p className="empty">该瓶尚无充填记录。</p>}
      <div className="history-list">
        {history.map(({ session: ses, order }) => {
          const sug = order
            ? mixSuggestion(order.method, order.targetO2, order.targetHe)
            : null;
          return (
            <article key={ses.id} className="history-card">
              <header>
                <div>
                  <b>{ses.id}</b>
                  <span className="sub">
                    {order ? methodTag(order.method) : ""} · {fmtTime(ses.startedAt)}
                  </span>
                </div>
                <SessionBadge state={ses.state} reviewed={Boolean(ses.review)} />
              </header>
              <p className="sub">
                操作员 {ses.operator} · 工位 {ses.stationId}
                {order ? ` · 目标 ${order.targetPressure}bar O₂${sug?.o2} He${sug?.he}` : ""}
              </p>
              {ses.measured && (
                <p className={ses.review || (order && order.status === "REVIEW") ? "measured-line bad" : "measured-line"}>
                  实测（留档冻结）：O₂ {ses.measured.o2}% / He {ses.measured.he}% / {ses.measured.pressure}bar
                </p>
              )}
              {ses.review && (
                <p className="sub review-line">
                  复核 {ses.review.result === "CONFIRMED" ? "通过" : "驳回"} · {ses.review.reviewer}
                  {ses.review.comment ? `：${ses.review.comment}` : ""}
                </p>
              )}
              {ses.signOff && (
                <p className="sub sign-line">签收人 {ses.signOff.signer} · {fmtTime(ses.signOff.at)}</p>
              )}
            </article>
          );
        })}
      </div>

      <h4 className="col-title">气瓶事件流水</h4>
      <ul className="event-log">
        {events.map((e, i) => (
          <li key={i}><time>{fmtTime(e.at)}</time><b>{e.type}</b><span>{e.detail}</span></li>
        ))}
        {events.length === 0 && <li className="empty">暂无事件。</li>}
      </ul>
    </section>
  );
}

function SessionBadge({ state, reviewed }: { state: string; reviewed: boolean }) {
  if (state === "SIGNED") return <Badge tone="ok">已签收</Badge>;
  if (state === "PAUSED") return <Badge tone="bad">已暂停</Badge>;
  if (state === "RUNNING") return <Badge tone="warn">充填中</Badge>;
  return reviewed ? <Badge tone="warn">已复核</Badge> : <Badge tone="info">已测待签收</Badge>;
}
