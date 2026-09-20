import { reorder } from "../domain/transitions";
import { Badge, MeasuredChips, type PanelProps } from "./common";

export default function SignedPanel({ state, run }: PanelProps) {
  const signed = state.orders.filter((o) => o.status === "signed");
  const invalid = state.orders.filter((o) => o.status === "invalidated").slice(-3);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>签收单</p>
          <h2>已签收（{signed.length}）</h2>
        </div>
      </div>
      {signed.length === 0 && invalid.length === 0 && <p className="empty">暂无签收单。</p>}
      <div className="list">
        {signed.map((o) => (
          <div className="list-row" key={o.id}>
            <div>
              <b>{o.id}</b> <span className="muted">{o.cylinderId}</span> <Badge tone="ok">已签收</Badge>
              {o.measured && (
                <div className="meta">
                  <MeasuredChips m={o.measured} />
                </div>
              )}
            </div>
            <div className="row-actions">
              <button className="ghost" onClick={() => run(reorder(o.id, Date.now()))}>
                换配气单
              </button>
            </div>
          </div>
        ))}
        {invalid.map((o) => (
          <div className="list-row faded" key={o.id}>
            <div>
              <b>{o.id}</b> <span className="muted">{o.cylinderId}</span> <Badge tone="muted">已失效</Badge>
              <div className="meta">签收后换单，原签收失效</div>
            </div>
          </div>
        ))}
      </div>
      <p className="hint">签收后换配气单：原签收立即失效，新配气单回到待充填队列。</p>
    </section>
  );
}
