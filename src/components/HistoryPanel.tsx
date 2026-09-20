import { useState } from "react";
import type { FillRecord, RecordKind } from "../domain/types";
import { Badge, fmtTime, MeasuredChips, RECORD_KIND_LABEL, type PanelProps } from "./common";

const KIND_TONE: Record<RecordKind, string> = {
  created: "muted",
  started: "info",
  paused: "warn",
  resumed: "info",
  "measured-ok": "ok",
  overlimit: "danger",
  reviewed: "ok",
  signed: "ok",
  invalidated: "muted",
  vented: "warn",
  inspected: "warn",
  cancelled: "muted",
};

export default function HistoryPanel({ state }: PanelProps) {
  const [cyl, setCyl] = useState("all");
  const rows = state.records
    .filter((r) => cyl === "all" || r.cylinderId === cyl)
    .slice()
    .sort((a, b) => b.at - a.at);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>留档与历史</p>
          <h2>气瓶历史记录（{rows.length}）</h2>
        </div>
        <div className="row-actions">
          <select value={cyl} onChange={(e) => setCyl(e.target.value)}>
            <option value="all">全部气瓶</option>
            {state.cylinders.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => exportCsv(rows)}>
            导出CSV
          </button>
        </div>
      </div>
      {rows.length === 0 && <p className="empty">暂无记录。</p>}
      <div className="timeline">
        {rows.map((r) => (
          <div className="tl-item" key={r.id}>
            <div className="tl-time">{fmtTime(r.at)}</div>
            <div>
              <Badge tone={KIND_TONE[r.kind]}>{RECORD_KIND_LABEL[r.kind]}</Badge> <b>{r.cylinderId}</b>{" "}
              {r.orderId && <span className="muted">{r.orderId}</span>}
              <div className="meta">{r.detail}</div>
              {r.measured && (
                <div className="meta">
                  <MeasuredChips m={r.measured} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function exportCsv(records: FillRecord[]) {
  const head = "记录ID,时间,配气单,气瓶,类型,详情,实测压力bar,实测氧%,实测氦%";
  const lines = records.map((r) =>
    [
      r.id,
      new Date(r.at).toLocaleString("zh-CN", { hour12: false }),
      r.orderId ?? "",
      r.cylinderId,
      RECORD_KIND_LABEL[r.kind],
      `"${r.detail.replace(/"/g, '""')}"`,
      r.measured?.pressureBar ?? "",
      r.measured?.o2 ?? "",
      r.measured?.he ?? "",
    ].join(",")
  );
  const blob = new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "充填留档.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
