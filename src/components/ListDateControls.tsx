"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { QueueSort } from "@/lib/queue-filters";

export function ListDateControls({
  baseParams,
  sort,
  fromYmd,
  toYmd,
}: {
  baseParams: Record<string, string | undefined>;
  sort: QueueSort;
  fromYmd: string;
  toYmd: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);

  function hrefWith(extra: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { ...baseParams, ...extra };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    const q = p.toString();
    return q ? `/lists?${q}` : "/lists";
  }

  function goSort(next: QueueSort) {
    router.push(
      hrefWith({
        sort: next === "attempts" ? undefined : next,
        from: from || undefined,
        to: to || undefined,
      }),
    );
  }

  function applyDates(e: FormEvent) {
    e.preventDefault();
    router.push(
      hrefWith({
        sort: sort === "attempts" ? undefined : sort,
        from: from || undefined,
        to: to || undefined,
      }),
    );
  }

  function clearDates() {
    setFrom("");
    setTo("");
    router.push(
      hrefWith({
        sort: sort === "attempts" ? undefined : sort,
        from: undefined,
        to: undefined,
      }),
    );
  }

  return (
    <div className="stack" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button
          type="button"
          className={`tab ${sort === "attempts" ? "active" : ""}`}
          onClick={() => goSort("attempts")}
        >
          Fewest attempts
        </button>
        <button
          type="button"
          className={`tab ${sort === "appt-desc" ? "active" : ""}`}
          onClick={() => goSort("appt-desc")}
        >
          Newest appt
        </button>
        <button
          type="button"
          className={`tab ${sort === "appt-asc" ? "active" : ""}`}
          onClick={() => goSort("appt-asc")}
        >
          Oldest appt
        </button>
      </div>

      <form className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }} onSubmit={applyDates}>
        <label className="field">
          Appt from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Appt to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn" type="submit">
          Filter dates
        </button>
        {(fromYmd || toYmd) && (
          <button className="btn secondary" type="button" onClick={clearDates}>
            Clear dates
          </button>
        )}
      </form>
    </div>
  );
}
