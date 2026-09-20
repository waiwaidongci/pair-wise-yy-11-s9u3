import { gasKindLabel, gasKindOf } from "../domain/rules";
import { setBatchStatus } from "../domain/transitions";
import { Badge, type PanelProps } from "./common";

export default function BatchPanel({ state, run }: PanelProps) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>气源管理</p>
          <h2>气源批次</h2>
        </div>
      </div>
      <div className="list">
        {state.batches.map((b) => {
          const paused = state.orders.filter((o) => o.batchId === b.id && o.status === "paused").length;
          return (
            <div className="list-row" key={b.id}>
              <div>
                <b>{b.id}</b> <span className="muted">{b.label}</span>
                <div className="meta">
                  {gasKindLabel(gasKindOf(b.o2, b.he))} · O₂ {b.o2}% · He {b.he}%
                  {paused > 0 ? ` · ${paused} 单暂停中` : ""}
                </div>
              </div>
              <div className="row-actions">
                {b.status === "qualified" ? <Badge tone="ok">合格</Badge> : <Badge tone="danger">失效</Badge>}
                {b.status === "qualified" ? (
                  <button className="ghost" onClick={() => run(setBatchStatus(b.id, "failed", Date.now()))}>
                    标记失效
                  </button>
                ) : (
                  <button className="ghost" onClick={() => run(setBatchStatus(b.id, "qualified", Date.now()))}>
                    恢复合格
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">批次失效会立即暂停使用它的在充工单；须换合格批次并重验后方可续充。</p>
    </section>
  );
}
