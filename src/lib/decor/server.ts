/**
 * The succulent's 3D model: an optional .glb file in the data folder (so app
 * updates don't lose it). Without one, the 3D view draws a built-in stand-in.
 * SERVER ONLY.
 */
import fs from "node:fs";
import path from "node:path";
import { dataFile } from "../datadir.ts";

export const MAX_MODEL_BYTES = 60 * 1024 * 1024;

export const modelPath = () => dataFile(path.join("models", "succulent.glb"));

export interface ModelInfo {
  bytes: number;
  updatedAt: number;
}

export function modelInfo(): ModelInfo | null {
  try {
    const st = fs.statSync(modelPath());
    return st.isFile() ? { bytes: st.size, updatedAt: Math.round(st.mtimeMs) } : null;
  } catch {
    return null;
  }
}

export function readModel(): Buffer | null {
  try {
    return fs.readFileSync(modelPath());
  } catch {
    return null;
  }
}

/** Why a file can't be used as the plant model, in plain words; null when it's a usable GLB. */
export function checkModel(bytes: Uint8Array): string | null {
  if (bytes.length < 20) return "That file is empty or too small to be a 3D model.";
  if (bytes.length > MAX_MODEL_BYTES) return `That file is ${Math.round(bytes.length / 1048576)} MB; the limit is ${MAX_MODEL_BYTES / 1048576} MB. On Sketchfab, try a smaller download size.`;
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === "glTF") {
    const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    return version === 2 ? null : `That's a version ${version} GLB; only version 2 is supported.`;
  }
  if (head.startsWith("PK")) return "That's a ZIP file. Unzip it first and upload the .glb inside, or choose the GLB format when downloading from Sketchfab.";
  if (head.trimStart().startsWith("{")) return "That's a .gltf text file, which needs its separate texture files. Choose the GLB format when downloading from Sketchfab: it's a single file.";
  return "That doesn't look like a GLB 3D model. Choose the GLB format when downloading from Sketchfab.";
}

export function saveModel(bytes: Uint8Array): ModelInfo {
  const file = modelPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  return modelInfo()!;
}

export function removeModel() {
  fs.rmSync(modelPath(), { force: true });
}
