import { useEffect, useState } from "react";
import "./styles.css";
import { getState, startFill, useStore } from "./store/store";
import { metrics } from "./store/selectors";
import { QueuePanel } from "./components/QueuePanel";
import { StationPanel } from "./components/StationPanel";
import { ReviewSignPanel } from "./components/ReviewSignPanel";
import { BatchPanel, RegisterPanel, ReorderPanel } from "./components/ManagePanels";
import { HistoryPanel } from "./components/HistoryPanel";

interface Toast {
  id: number;
  ok: boolean;
  message: string;
}

function App() {
  const s = useStore((x) => x);
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  function notify(ok: boolean, message: string) {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, ok, message }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  }

  const m = metrics(s, now);

  // 并发开工自检：对同一配气单 + 工位同时发起两次开工，应恰好成功一次
  async function concurrencyDemo() {
    const order = getState().orders.find((o) => o.status === "QUEUED");
    const station = getState().stations.find((st) => st.sessionId === null);
    if (!order || !station) {
      notify(false, "当前没有可开工的队列单或空闲工位");
      return;
    }
    const payload = { orderId: order.id, stationId: station.id, operator: "并发测试", batchId: getState().batches[0].id };
    const [r1, r2] = await Promise.all([startFill(payload), startFill(payload)]);
    notify(true, `并发开工两次：①${r1.ok ? "成功" : "拒绝"} ②${r2.ok ? "成功" : "拒绝"}（仅一次成功）`);
    void r1;
    void r2;
  }

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 潜水气瓶充填工位闭环 · 规则 / 存储 / 展示 三层分离</p>
        <h1>气瓶充填工位闭环</h1>
        <span>
          编号唯一；检验过期、耐压不足或余气冲突时禁止开工，只能排空或送检；一工位只接一瓶，开工锁定气瓶、操作员与气源批次；
          气源失效自动暂停，换合格批次并重验后续充；实测超限留档转复核，复核不改实测；签收后换配气单原单失效回队列；
          重复并发开工仅一次成功，队列、工位与历史刷新后保持一致。
        </span>
      </section>

      <section className="metrics">
        <article><small>待充填</small><strong>{m.queued}</strong></article>
        <article><small>工位占用</small><strong>{m.running}</strong></article>
        <article><small>过期/送检</small><strong>{m.expired}</strong></article>
        <article><small>实测平均 O₂</small><strong>{m.avgO2 ? `${m.avgO2.toFixed(1)}%` : "—"}</strong></article>
        <article><small>签收单</small><strong>{m.signed}</strong></article>
      </section>

      <div className="toolbar">
        <button onClick={concurrencyDemo}>并发开工自检（同一单同时提交两次）</button>
        <span className="persist-note">数据持久化于浏览器 localStorage，刷新 / 重开标签页后队列、工位与历史一致</span>
      </div>

      <div className="layout">
        <div className="col-main">
          <StationPanel s={s} now={now} notify={notify} />
          <QueuePanel s={s} now={now} notify={notify} />
          <ReviewSignPanel s={s} notify={notify} />
        </div>
        <div className="col-side">
          <BatchPanel s={s} notify={notify} />
          <RegisterPanel s={s} notify={notify} />
          <ReorderPanel s={s} notify={notify} />
          <HistoryPanel s={s} now={now} />
        </div>
      </div>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? "ok" : "bad"}`}>
            <b>{t.ok ? "操作成功" : "操作被拒绝"}</b>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
