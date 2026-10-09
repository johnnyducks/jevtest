"use client";

import { useRef, useState } from "react";
import { SAMPLE_QUESTIONS } from "@/lib/permits/kb";
import { OFFICE_PHONE } from "@/lib/permits/links";
import { Spinner } from "../ui";

export function Ask() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  async function run(question: string) {
    question = question.trim();
    if (!question) return;
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setAnswer("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: c.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setAnswer((data as { error?: string }).error || `Couldn't get an answer just now. Call the office at ${OFFICE_PHONE}.`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        setAnswer(text);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setAnswer(`Couldn't get an answer just now. Call the office at ${OFFICE_PHONE}.`);
    } finally {
      if (ctl.current === c) setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Can I draw my own deck plans?" aria-label="Your question" autoComplete="off" maxLength={500} />
        <button className="btn dark" type="submit">Ask</button>
      </form>
      <div className="chips">
        {SAMPLE_QUESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => { setQ(s); run(s); }}>{s}</button>
        ))}
      </div>
      <div className="answer" aria-live="polite">{busy && !answer ? <Spinner /> : answer}</div>
    </div>
  );
}
