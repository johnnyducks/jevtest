/**
 * Where applications live. The app talks to the ApplicationStore interface
 * only, so a database (Supabase/Postgres) can replace the file store without
 * touching routes or UI.
 *
 * FileStore keeps every application in one JSON file. It suits a demo on one
 * server, not production: there's no locking across processes.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Application } from "../permits/application.ts";

export interface ApplicationStore {
  listByOwner(ownerId: string): Promise<Application[]>;
  listAll(): Promise<Application[]>;
  get(ref: string): Promise<Application | null>;
  put(app: Application): Promise<void>;
  remove(ref: string): Promise<void>;
}

export const dataDir = () => process.env.PERMITS_DATA_DIR || path.join(process.cwd(), ".data");

const newestFirst = (a: Application, b: Application) => b.createdAt - a.createdAt;

export class FileStore implements ApplicationStore {
  private cache: Map<string, Application> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {}

  private async load(): Promise<Map<string, Application>> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as { applications?: Application[] };
      this.cache = new Map((raw.applications ?? []).map((a) => [a.ref, a]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.cache = new Map();
    }
    return this.cache;
  }

  /** Runs mutations one at a time and writes the file atomically. */
  private mutate(fn: (m: Map<string, Application>) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const m = await this.load();
      fn(m);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ applications: [...m.values()] }, null, 1));
      await fs.rename(tmp, this.file);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async listByOwner(ownerId: string) {
    return [...(await this.load()).values()].filter((a) => a.ownerId === ownerId).sort(newestFirst);
  }
  async listAll() {
    return [...(await this.load()).values()].sort(newestFirst);
  }
  async get(ref: string) {
    return (await this.load()).get(ref) ?? null;
  }
  put(app: Application) {
    return this.mutate((m) => void m.set(app.ref, app));
  }
  remove(ref: string) {
    return this.mutate((m) => void m.delete(ref));
  }
}

// One store per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __permitsStore?: ApplicationStore };
export function getStore(): ApplicationStore {
  return (g.__permitsStore ??= new FileStore(path.join(dataDir(), "applications.json")));
}
