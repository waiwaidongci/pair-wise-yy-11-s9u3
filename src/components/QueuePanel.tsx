import { useState } from "react";
import {
  blockReasons,
  daysUntilInspection,
  EXPIRY_WARNING_DAYS,
  gasKindOf,
  gasKindLabel,
  isInspectionExpired,
} from "../domain/rules";
import { cancelOrder } from "../domain/transitions";
import { Badge, fmtTime, type PanelProps } from "./common";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "air", label: "空气" },
  { key: "eanx", label: "高氧" },
  { key: "trimix", label: "Trimix" },
  { key: "blocked", label: "待检验" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function QueuePanel({ state, run }: PanelProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const now = new Date();
  const queued = state.orders.filter((o) => o.status === "queued");
  const rows = queued.filter((o) => {
    if (filter === "all") return true;
    const c = state.cylinders.find((x) => x.id === o.cylinderId);
    if (filter === "blocked") return c ? blockReasons(c, o, now).length > 0 : false;
    return gasKindOf(o.targetO2, o.targetHe) === filter;
  });
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>待充填队列</p>
          <h2>队列（{queued.length}）</h2>
        </div>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="list">
        {rows.length === 0 && <p className="empty">该分类下暂无配气单。</p>}
        {rows.map((o) => {
          const c = state.cylinders.find((x) => x.id === o.cylinderId);
          const blocks = c ? blockReasons(c, o, now) : [];
          const days = c ? daysUntilInspection(c, now) : 0;
          const nearExpiry = c && !isInspectionExpired(c, now) && days <= EXPIRY_WARNING_DAYS;
          return (
            <div className="list-row" key={o.id}>
              <div>
                <b>{o.id}</b> <span className="muted">{o.cylinderId}</span>{" "}
                <Badge tone="info">{gasKindLabel(gasKindOf(o.targetO2, o.targetHe))}</Badge>
                <div className="meta">
                  目标 {o.targetPressureBar}bar · O₂ {o.targetO2}% · He {o.targetHe}% · {o.method} · 入队{" "}
                  {fmtTime(o.createdAt)}
                </div>
                <div className="badge-row">
                  {blocks.length === 0 ? (
                    <Badge tone="ok">可开工</Badge>
                  ) : (
                    <>
                      {blocks.map((b) => (
                        <Badge key={b.code} tone="danger">
                          {b.label}
                        </Badge>
                      ))}
                      <span className="hint-inline">仅可排空或送检</span>
                    </>
                  )}
                  {nearExpiry && <Badge tone="warn">检验临期 {days} 天</Badge>}
                </div>
              </div>
              <div className="row-actions">
                <button className="ghost" onClick={() => run(cancelOrder(o.id, Date.now()))}>
                  撤单
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
