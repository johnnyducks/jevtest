"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { type CatalogCard, type CatalogIssue, type Facing, newCardId } from "@/lib/catalog/catalog";
import type { CardDiagnosis } from "@/lib/cardsight/server";
import type { CardArt, CardArtBody } from "@/lib/cardsight/types";
import type { Units } from "@/lib/units";
import CardCheck from "./CardCheck";

interface CatalogState {
  cards: CatalogCard[];
  issues: CatalogIssue[];
  source: "custom" | "built-in";
  file: string;
  floors: { level: number; name: string }[];
  size: { width: number; height: number };
}

const IN = 0.0254;
const toUnit = (m: number, u: Units) => (u === "imperial" ? m / IN : m * 100);
const fromUnit = (v: number, u: Units) => (u === "imperial" ? v * IN : v / 100);
const unitLabel = (u: Units) => (u === "imperial" ? "in" : "cm");
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string; issues?: CatalogIssue[] }> {
  try {
    const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const j = (await r.json().catch(() => null)) as (T & { error?: { message?: string }; issues?: CatalogIssue[] }) | null;
    if (!r.ok || !j) return { ok: false, message: j?.error?.message ?? `HTTP ${r.status}`, issues: j?.issues };
    return { ok: true, data: j };
  } catch {
    return { ok: false, message: "Couldn't reach the app's server." };
  }
}

/** One line: is CardSight working at all? */
function cardsightSummary(art: CardArtBody | null): { tone: "ok" | "warn" | "bad" | "muted"; text: string } {
  if (!art) return { tone: "muted", text: "CardSight: checking…" };
  if (!art.configured) return { tone: "warn", text: "CardSight: no API key set on the server (CARDSIGHT_API_KEY in .env.local), so cards show placeholders." };
  const all = Object.values(art.cards);
  const keyProblem = all.find((a) => a.note && /rejected the API key/i.test(a.note));
  if (keyProblem) return { tone: "bad", text: `CardSight: ${keyProblem.note}` };
  const reach = all.find((a) => a.note && /couldn't reach/i.test(a.note));
  if (reach) return { tone: "bad", text: `CardSight: ${reach.note}` };
  const matched = all.filter((a) => a.status === "matched").length;
  const errors = all.filter((a) => a.status === "error").length;
  if (!matched && errors) return { tone: "bad", text: `CardSight: lookups are failing (${all.find((a) => a.status === "error")?.note ?? "unknown error"}).` };
  return {
    tone: matched === all.length ? "ok" : matched ? "warn" : "bad",
    text: `CardSight: connected. ${matched} of ${all.length} cards matched${errors ? `, ${errors} failed for now` : ""}.`,
  };
}

function Status({ art }: { art?: CardArt }) {
  if (!art) return <span className="m-chip muted">…</span>;
  const label =
    art.status === "matched"
      ? art.confidence === "exact"
        ? "matched"
        : "likely"
      : art.status === "not_configured"
        ? "no key"
        : art.status === "error"
          ? "error"
          : "not found";
  const tone = art.status === "matched" ? (art.confidence === "exact" ? "ok" : "live") : art.status === "error" ? "bad" : "warn";
  const cs = art.cardsight;
  return (
    <span className="cat-status">
      <span className={`m-chip ${tone}`} title={art.note ?? ""}>
        {label}
      </span>
      {cs && (
        <span className="cat-sub mono" title={cs.description ?? ""}>
          {cs.releaseName ?? cs.year} #{cs.number ?? "?"}
        </span>
      )}
      {!cs && art.note && <span className="cat-sub">{art.note}</span>}
    </span>
  );
}

type Draft = CatalogCard & { _new?: boolean };

export default function CatalogPanel({
  onClose,
  opKey,
  keyRequired,
  units,
  onGo,
}: {
  onClose: () => void;
  opKey: string;
  keyRequired: boolean;
  units: Units;
  onGo?: (name: string) => void;
}) {
  const [state, setState] = useState<CatalogState | null>(null);
  const [art, setArt] = useState<CardArtBody | null>(null);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [issues, setIssues] = useState<CatalogIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [floor, setFloor] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [checks, setChecks] = useState<Record<string, CardDiagnosis | "pending" | string>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const canEdit = !keyRequired || !!opKey;

  const loadArt = useCallback(() => {
    void fetch("/api/cards")
      .then((r) => (r.ok ? (r.json() as Promise<CardArtBody>) : null))
      .catch(() => null)
      .then((a) => a && setArt(a));
  }, []);

  const load = useCallback(async () => {
    const r = await call<CatalogState>("/api/catalog");
    if (r.ok) {
      setState(r.data);
      setIssues(r.data.issues);
    } else setMsg({ tone: "bad", text: r.message });
    loadArt();
  }, [loadArt]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !draft && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, draft]);

  const rows: Draft[] = draft ?? state?.cards ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (!floor || c.floor === floor) && (!q || `${c.name} ${c.team} ${c.set} ${c.manufacturer} ${c.year} ${c.number}`.toLowerCase().includes(q)));
  }, [rows, filter, floor]);

  const issuesFor = (id: string) => issues.filter((i) => i.id === id);
  const set = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => {
      if (!d) return d;
      return d.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        // A new card's ID follows its name and year ("piazza-92") until it's saved.
        if (c._new && ("name" in patch || "year" in patch) && !("id" in patch)) {
          next.id = newCardId(next.name || "card", Number.isFinite(next.year) ? next.year : 0, new Set(d.filter((_, k) => k !== i).map((x) => x.id)));
        }
        return next;
      });
    });
  const dirty = !!draft && JSON.stringify(draft.map(({ _new, ...c }) => c)) !== JSON.stringify(state?.cards);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    const r = await call<CatalogState>("/api/catalog", { method: "PUT", body: JSON.stringify({ key: opKey || undefined, cards: draft.map(({ _new, ...c }) => c) }) });
    setBusy(false);
    if (!r.ok) {
      setIssues(r.issues ?? []);
      setMsg({ tone: "bad", text: `Not saved: ${r.message}` });
      return;
    }
    setState(r.data);
    setIssues(r.data.issues);
    setDraft(null);
    setMsg({ tone: "ok", text: `Saved ${r.data.cards.length} cards to ${r.data.file}. Everyone watching sees the change now.` });
    loadArt();
  };

  const reset = async () => {
    if (!confirm("Go back to the built-in 35 cards? Your edits will be removed.")) return;
    setBusy(true);
    const r = await call<CatalogState>("/api/catalog/reset", { method: "POST", body: JSON.stringify({ key: opKey || undefined }) });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.message });
    setState(r.data);
    setIssues(r.data.issues);
    setDraft(null);
    setMsg({ tone: "ok", text: "Back to the built-in cards." });
    loadArt();
  };

  const addCard = () => {
    const d = draft ?? state?.cards ?? [];
    const taken = new Set(d.map((c) => c.id));
    const level = floor || 1;
    const fresh: Draft = {
      id: newCardId("New Card", new Date().getFullYear(), taken),
      name: "New Card",
      year: new Date().getFullYear(),
      team: "",
      manufacturer: "Topps",
      set: "",
      number: "",
      floor: level,
      x: (state?.size.width ?? 2.4) / 2,
      y: 0.33,
      facing: "N",
      points: 20,
      aliases: "",
      lahmanId: "",
      wikipediaTitle: "",
      cardsightId: "",
      note: "",
      _new: true,
    };
    setDraft([...d, fresh]);
    setFilter("");
    setOpen((o) => new Set(o).add(fresh.id));
  };

  const check = async (cardId: string) => {
    setChecks((c) => ({ ...c, [cardId]: "pending" }));
    const r = await call<CardDiagnosis>("/api/cards/check", { method: "POST", body: JSON.stringify({ key: opKey || undefined, cardId }) });
    setChecks((c) => ({ ...c, [cardId]: r.ok ? r.data : r.message }));
    loadArt();
  };

  const summary = cardsightSummary(art);
  const u = unitLabel(units);
  const editing = !!draft;
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  return (
    <div className="catalog-backdrop">
      <div className="catalog" role="dialog" aria-modal="true" aria-label="Card catalog">
        <header className="cat-head">
          <div>
            <div className="pop-title">Card catalog</div>
            <div className="cat-meta">
              {rows.length} cards · {state?.source === "custom" ? <>your edits, saved in <span className="mono">{state.file}</span></> : "the built-in cards"}
            </div>
          </div>
          <div className="cat-actions">
            {!editing && (
              <button className="btn" disabled={!canEdit || !state} onClick={() => setDraft(state!.cards.map((c) => ({ ...c })))} title={canEdit ? "Edit the table" : "Enter the operator key in the gear menu first"}>
                ✎ Edit
              </button>
            )}
            {editing && (
              <>
                <button className="btn" onClick={addCard}>
                  ＋ Add card
                </button>
                <button className="btn accent" disabled={busy || !dirty} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (!dirty || confirm("Discard your unsaved changes?")) {
                      setDraft(null);
                      setIssues(state?.issues ?? []);
                    }
                  }}
                >
                  Discard
                </button>
              </>
            )}
            <button className="btn" disabled={!canEdit} onClick={() => setCheckingAll(true)} title="Look every card up in CardSight again and show the details">
              Check all with CardSight
            </button>
            {state?.source === "custom" && !editing && (
              <button className="btn" disabled={!canEdit || busy} onClick={() => void reset()}>
                ↺ Built-in cards
              </button>
            )}
            <button className="card-modal-close static" onClick={() => (!dirty || confirm("Close without saving?")) && onClose()} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className={`cat-banner ${summary.tone}`}>{summary.text}</div>
        {msg && <div className={`cat-banner ${msg.tone === "ok" ? "ok" : "bad"}`}>{msg.text}</div>}
        {!canEdit && <div className="cat-banner muted">Viewing only. To edit, enter the operator key in the gear menu on the map.</div>}

        <div className="cat-tools">
          <input className="op-key" placeholder="Filter by name, team, set, year…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter cards" />
          <select className="op-key cat-select" value={floor} onChange={(e) => setFloor(Number(e.target.value))} aria-label="Floor">
            <option value={0}>All floors</option>
            {state?.floors.map((f) => (
              <option key={f.level} value={f.level}>
                Floor {f.level} · {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className="cat-scroll">
          <table className="cat-table">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Year</th>
                <th>Team</th>
                <th>Manufacturer</th>
                <th>Set</th>
                <th>#</th>
                <th>Floor</th>
                <th>
                  Position ({u})
                  <span className="cat-hint">from west, from south</span>
                </th>
                <th>Faces</th>
                <th>Pts</th>
                <th>CardSight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, i }) => {
                const a = art?.cards[c.id];
                const rowIssues = issuesFor(c.id);
                const err = rowIssues.some((x) => x.level === "error");
                const warn = rowIssues.some((x) => x.level === "warning");
                const ck = checks[c.id];
                const isOpen = open.has(c.id);
                const text = (field: keyof CatalogCard, w = 0) =>
                  editing ? (
                    <input className={`cat-in${w ? ` w${w}` : ""}${rowIssues.some((x) => x.field === field) ? " bad" : ""}`} value={String(c[field] ?? "")} onChange={(e) => set(i, { [field]: e.target.value } as Partial<Draft>)} aria-label={`${c.name} ${field}`} />
                  ) : (
                    String(c[field] ?? "") || <span className="dim">—</span>
                  );
                return (
                  <Fragment key={`${c.id}-${i}`}>
                    <tr className={`${err ? "err" : warn ? "warn" : ""}${c._new ? " new" : ""}`}>
                      <td className="cat-thumb">
                        {a?.front ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.front} alt="" loading="lazy" />
                        ) : (
                          <span className="cat-ph" />
                        )}
                      </td>
                      <td>{text("name", 10)}</td>
                      <td>
                        {editing ? (
                          <input className={`cat-in w4${rowIssues.some((x) => x.field === "year") ? " bad" : ""}`} inputMode="numeric" value={Number.isNaN(c.year) ? "" : c.year} onChange={(e) => set(i, { year: num(e.target.value) })} aria-label={`${c.name} year`} />
                        ) : (
                          c.year
                        )}
                      </td>
                      <td>{text("team", 7)}</td>
                      <td>{text("manufacturer", 8)}</td>
                      <td>{text("set", 9)}</td>
                      <td className="mono">{text("number", 4)}</td>
                      <td>
                        {editing ? (
                          <select className="cat-in" value={c.floor} onChange={(e) => set(i, { floor: Number(e.target.value) })} aria-label={`${c.name} floor`}>
                            {state?.floors.map((f) => (
                              <option key={f.level} value={f.level}>
                                {f.level}
                              </option>
                            ))}
                          </select>
                        ) : (
                          c.floor
                        )}
                      </td>
                      <td className="mono">
                        {editing ? (
                          <span className="cat-xy">
                            <input className={`cat-in w4${rowIssues.some((x) => x.field === "x") ? " bad" : ""}`} inputMode="decimal" value={Number.isNaN(c.x) ? "" : fmt1(toUnit(c.x, units))} onChange={(e) => set(i, { x: fromUnit(num(e.target.value), units) })} aria-label={`${c.name} position from west wall`} />
                            <input className={`cat-in w4${rowIssues.some((x) => x.field === "x") ? " bad" : ""}`} inputMode="decimal" value={Number.isNaN(c.y) ? "" : fmt1(toUnit(c.y, units))} onChange={(e) => set(i, { y: fromUnit(num(e.target.value), units) })} aria-label={`${c.name} position from south wall`} />
                          </span>
                        ) : (
                          `${fmt1(toUnit(c.x, units))}, ${fmt1(toUnit(c.y, units))}`
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <select className="cat-in" value={c.facing} onChange={(e) => set(i, { facing: e.target.value as Facing })} aria-label={`${c.name} faces`}>
                            {(["N", "E", "S", "W"] as const).map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                        ) : (
                          c.facing
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input className="cat-in w3" inputMode="numeric" value={Number.isNaN(c.points) ? "" : c.points} onChange={(e) => set(i, { points: num(e.target.value) })} aria-label={`${c.name} points`} />
                        ) : (
                          c.points
                        )}
                      </td>
                      <td>
                        <Status art={a} />
                      </td>
                      <td className="cat-row-actions">
                        <button className="btn tiny" onClick={() => setOpen((o) => (o.has(c.id) ? new Set([...o].filter((x) => x !== c.id)) : new Set(o).add(c.id)))} aria-expanded={isOpen}>
                          {isOpen ? "less" : "more"}
                        </button>
                        {!editing && canEdit && (
                          <button className="btn tiny" disabled={ck === "pending"} onClick={() => void check(c.id)} title="Look this card up in CardSight again">
                            {ck === "pending" ? "…" : "check"}
                          </button>
                        )}
                        {!editing && onGo && (
                          <button className="btn tiny" onClick={() => onGo(c.name)} title="Send Marty to this card">
                            go
                          </button>
                        )}
                        {editing && (
                          <button className="btn tiny danger" onClick={() => confirm(`Remove ${c.name} from the catalog?`) && setDraft((d) => d && d.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                    {(isOpen || rowIssues.length > 0 || (ck && ck !== "pending")) && (
                      <tr className="cat-detail">
                        <td />
                        <td colSpan={12}>
                          {rowIssues.map((x, k) => (
                            <div key={k} className={`cat-issue ${x.level}`}>
                              {x.level === "error" ? "✕" : "!"} {x.message}
                            </div>
                          ))}
                          {isOpen && (
                            <div className="cat-more">
                              <label>
                                ID <span className="mono">{editing && c._new ? <input className="cat-in w8" value={c.id} onChange={(e) => set(i, { id: e.target.value.toLowerCase() })} /> : c.id}</span>
                              </label>
                              <label>Other names {text("aliases", 14)}</label>
                              <label>Lahman ID {text("lahmanId", 7)}</label>
                              <label>Wikipedia title {text("wikipediaTitle", 10)}</label>
                              <label>CardSight ID (pin) {text("cardsightId", 14)}</label>
                              <label>Note {text("note", 14)}</label>
                              {editing && <p className="cat-hint">Leave the Lahman ID empty for a new card and it's filled in from the name when it's unambiguous. Pin a CardSight ID to skip the search.</p>}
                            </div>
                          )}
                          {ck && ck !== "pending" && (
                            <div className="cat-check">
                              {typeof ck === "string" ? (
                                <span className="cat-issue error">{ck}</span>
                              ) : (
                                <>
                                  <b>{ck.outcome}</b>
                                  {ck.image && <div className="cat-sub">image: {ck.image.detail}</div>}
                                  {ck.searches.length > 0 && <div className="cat-sub mono">searched: {ck.searches.map((s) => `"${s.q}" (${s.filters}) → ${s.error ? `error: ${s.error}` : `${s.results} results`}`).join(" · ")}</div>}
                                  {!ck.outcome.startsWith("Matched") && ck.candidates.length > 0 && (
                                    <ul className="cc-cands mono">
                                      {ck.candidates.map((h, k) => (
                                        <li key={k}>
                                          {h.name} · {h.year ?? "?"} · {h.release ?? "?"}
                                          {h.set ? ` / ${h.set}` : ""} · #{h.number ?? "?"} → <em>{h.verdict}</em>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!state && <p className="mono dim cat-loading">Loading…</p>}
        </div>
        <p className="card-meta-src mono cat-foot">
          Positions are measured from the floor&apos;s west wall and south wall ({state ? `${fmt1(toUnit(state.size.width, units))} × ${fmt1(toUnit(state.size.height, units))} ${u}` : ""}). &quot;Faces&quot; is the side Marty looks at it from. Cards Marty can&apos;t reach get a warning and stay on the wall.
        </p>
      </div>
      {checkingAll && (
        <CardCheck
          opKey={opKey}
          onClose={() => setCheckingAll(false)}
          onDone={() => {
            loadArt();
          }}
        />
      )}
    </div>
  );
}
