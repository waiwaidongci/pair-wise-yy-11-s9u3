import { isInspectionExpired } from "../domain/rules";
import type { AppState } from "../domain/types";

export default function MetricsBar({ state }: { state: AppState }) {
  const now = new Date();
  const queued = state.orders.filter((o) => o.status === "queued").length;
  const expired = state.cylinders.filter((c) => isInspectionExpired(c, now)).length;
  const signed = state.orders.filter((o) => o.status === "signed");
  const withMeasured = signed.filter((o) => o.measured);
  const avgO2 = withMeasured.length
    ? `${(withMeasured.reduce((a, o) => a + (o.measured?.o2 ?? 0), 0) / withMeasured.length).toFixed(1)}%`
    : "—";
  const items: Array<[string, string]> = [
    ["待充填", String(queued)],
    ["过期提醒", String(expired)],
    ["平均氧含量", avgO2],
    ["签收单", String(signed.length)],
  ];
  return (
    <section className="metrics">
      {items.map(([label, value]) => (
        <article key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}
