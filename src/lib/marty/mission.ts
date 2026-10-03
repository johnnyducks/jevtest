/**
 * Deterministic mission-state transition: what Marty's simulated world looks
 * like after a selected action. No model involvement; nothing is sent to a robot.
 */
import type { Candidate, Effect } from "../decision/contracts";
import type { World } from "./world";

const excerpt = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function nextWorld(world: World, effect: Effect, candidates: Candidate[], message: string): World {
  const w: World = structuredClone(world);
  const current = w.mission;
  const replace = (name: string) => {
    if (current && current.status !== "idle" && current.name !== name) w.pausedMission = current.name;
    w.mission = { name, status: "active", progress: 0 };
  };

  switch (effect.action) {
    case "continue_mission":
      if (w.mission) w.mission.status = "active";
      break;
    case "return_to_dock":
      if (current && current.status !== "docking") w.pausedMission = current.name;
      w.mission = { name: "Return to dock & recharge", status: "docking", progress: 0 };
      break;
    case "viewer_request": {
      const cand = candidates.find((c) => c.key === effect.candidateKey);
      const v = w.viewers.find((x) => x.handle === cand?.viewer);
      if (v) {
        v.accepted = true;
        replace(`@${v.handle}: ${v.request}`);
      }
      break;
    }
    case "explore_new_area":
      replace("Explore an unmapped area");
      break;
    case "revisit_popular_area":
      replace("Revisit a popular area");
      break;
    case "navigate":
      replace(`Navigate: ${excerpt(message)}`);
      break;
    case "inspect_object":
      replace(`Search: ${excerpt(message)}`);
      break;
    case "hold_and_ask":
    case "request_human":
      if (w.mission) w.mission.status = "holding";
      break;
    case "converse":
    case "reject":
      break;
  }
  return w;
}
