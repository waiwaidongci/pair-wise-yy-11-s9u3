import type { ReactNode } from "react";
import { METHOD_LABEL, type FillMethod } from "../domain/types";

export function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {props.label}
        {props.hint ? <em>{props.hint}</em> : null}
      </span>
      {props.children}
    </label>
  );
}

export function NumberInput(props: {
  value: number;
  step?: number;
  min?: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={props.step ?? "any"}
      min={props.min}
      value={Number.isNaN(props.value) ? "" : props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(num(e.target.value))}
    />
  );
}

export function Badge(props: { tone?: "ok" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? "info"}`}>{props.children}</span>;
}

export function methodTag(m: FillMethod) {
  return METHOD_LABEL[m];
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
