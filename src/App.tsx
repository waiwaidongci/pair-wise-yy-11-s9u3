import { useCallback, useEffect, useState } from "react";
import "./styles.css";
import { buildSeed } from "./domain/seed";
import { store } from "./store/appStore";
import { useStoreState, type Transition, type TransitionResult } from "./store/createStore";
import MetricsBar from "./components/MetricsBar";
import BatchPanel from "./components/BatchPanel";
import CylinderPanel from "./components/CylinderPanel";
import StationPanel from "./components/StationPanel";
import QueuePanel from "./components/QueuePanel";
import OrderForm from "./components/OrderForm";
import ReviewPanel from "./components/ReviewPanel";
import SignedPanel from "./components/SignedPanel";
import HistoryPanel from "./components/HistoryPanel";

export default function App() {
  const state = useStoreState(store);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const run = useCallback((t: Transition): TransitionResult => {
    const r = store.dispatch(t);
    setToast({ text: r.message, ok: r.ok });
    return r;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <main className="app">
      <section className="hero">
        <div className="hero-actions">
          <button
            className="ghost"
            onClick={() => {
              store.replace(buildSeed(new Date()));
              setToast({ text: "已重置为演示数据", ok: true });
            }}
          >
            重置演示数据
          </button>
        </div>
        <p>hxyfront-62010 · 潜水气瓶充填 · 工位闭环</p>
        <h1>潜水气瓶充填记录</h1>
        <span>
          编号唯一；检验过期、耐压不足或余气冲突禁止开工，仅可排空或送检；一工位一瓶，开工锁定气瓶、操作员与气源批次；气源失效即暂停，换合格批次重验后续充；实测超限只留档转复核且复核不改实测；签收后换配气单即失效回队列。队列、工位、历史同源持久化，刷新后一致。
        </span>
      </section>

      <MetricsBar state={state} />

      <section className="workspace">
        <aside className="side-col">
          <BatchPanel state={state} run={run} />
          <CylinderPanel state={state} run={run} />
        </aside>
        <div className="side-col">
          <StationPanel state={state} run={run} />
          <QueuePanel state={state} run={run} />
        </div>
      </section>

      <OrderForm state={state} run={run} />

      <section className="grid-2">
        <ReviewPanel state={state} run={run} />
        <SignedPanel state={state} run={run} />
      </section>

      <HistoryPanel state={state} run={run} />

      {toast && <div className={`toast ${toast.ok ? "toast-ok" : "toast-err"}`}>{toast.text}</div>}
    </main>
  );
}
