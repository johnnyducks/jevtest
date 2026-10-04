/**
 * Where the app keeps things it writes at runtime (your card catalog, CardSight
 * matches). SERVER ONLY. Outside the project folder by default, so replacing
 * the app with a new version doesn't lose them.
 *
 *   MARTY_DATA_DIR in .env.local overrides it; default ~/.marty-live
 */
import os from "node:os";
import path from "node:path";

export function dataDir(): string {
  return process.env.MARTY_DATA_DIR?.trim() || path.join(os.homedir(), ".marty-live");
}

export const dataFile = (name: string) => path.join(dataDir(), name);
