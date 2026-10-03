"use client";

import { useEffect, useState } from "react";
import type { StatusBody } from "@/lib/decision/contracts";
import { Bot, Logo } from "./icons";
import Popover from "./Popover";
import LiveView from "./live/LiveView";

/** App shell: brand, a bot icon listing the models in use, and the map workspace. */
export default function Studio() {
  const [status, setStatus] = useState<StatusBody | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? (r.json() as Promise<StatusBody>) : null))
      .catch(() => null)
      .then(setStatus);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-name">MARTY.LIVE</span>
        </div>
        <div className="topbar-spacer" />
        <Popover
          label="Models in use"
          align="right"
          trigger={
            <>
              <Bot width={18} height={18} />
              <span className={`dot ${status?.jev.configured ? "on" : ""}`} />
            </>
          }
        >
          <div className="pop-title">Models in use</div>
          <div className="pop-row">
            <span className={`dot ${status?.jev.configured ? "on" : ""}`} />
            <span>
              <b>Jev</b> · {status ? status.jev.model : "…"}
              <span className="pop-sub">Reads viewers&apos; messages in batches and chooses what Marty does next.</span>
              {status && !status.jev.configured && <span className="pop-warn">Not configured: set JEV_API_KEY on the server.</span>}
            </span>
          </div>
          <div className="pop-row" style={{ marginTop: 10 }}>
            <span className={`dot ${status?.voice.configured ? "on" : ""}`} />
            <span>
              <b>Voice</b> · {status ? (status.voice.configured ? `OpenAI ${status.voice.model}` : "built-in lines") : "…"}
              <span className="pop-sub">Writes Marty&apos;s chat replies, in character, from the facts above.</span>
              {status && !status.voice.configured && <span className="pop-warn">Set OPENAI_API_KEY for freshly written replies.</span>}
            </span>
          </div>
          <div className="pop-row" style={{ marginTop: 10 }}>
            <span className={`dot ${status?.knowledge.available ? "on" : ""}`} />
            <span>
              <b>Baseball knowledge</b>
              <span className="pop-sub">
                {status?.knowledge.available
                  ? `Lahman Baseball Database, seasons through ${status.knowledge.seasonsThrough}${status.knowledge.wikipedia ? ", plus Wikipedia summaries" : ""}. CC BY-SA.`
                  : "Not loaded: run npm run import:lahman."}
              </span>
            </span>
          </div>
        </Popover>
      </header>

      <main className="main-twin">
        <LiveView keyRequired={status?.operator?.keyRequired ?? false} />
      </main>
    </div>
  );
}
