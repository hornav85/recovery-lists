"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLeadSearch({
  query,
  baseParams,
  paramName = "q",
  label = "Search leads",
  placeholder = "Name, phone, address, status, project…",
}: {
  query: string;
  baseParams: Record<string, string | undefined>;
  paramName?: string;
  label?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  function hrefWith(q: string | undefined) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...baseParams, [paramName]: q })) {
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/lists?${s}` : "/lists";
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    const next = value.trim();
    router.push(hrefWith(next || undefined));
  }

  function clear() {
    setValue("");
    router.push(hrefWith(undefined));
  }

  return (
    <form
      className="row"
      style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginBottom: "0.75rem" }}
      onSubmit={apply}
    >
      <label className="field" style={{ flex: "1 1 18rem" }}>
        {label}
        <input
          type="text"
          name={paramName}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-label={label}
        />
      </label>
      <button className="btn" type="submit">
        Search
      </button>
      {query ? (
        <button className="btn secondary" type="button" onClick={clear}>
          Clear search
        </button>
      ) : null}
    </form>
  );
}
