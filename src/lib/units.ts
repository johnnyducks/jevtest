/**
 * Units. The simulation is metric internally; viewers pick metric or imperial.
 *
 * Text shared with every viewer (Marty's chat lines) writes distances as
 * {{m:0.762}} markers, and each browser renders them in its own units.
 */
export type Units = "imperial" | "metric";

const IN = 0.0254;

/** A distance inside shared text, rendered per viewer. */
export const dist = (meters: number) => `{{m:${Math.round(meters * 1000) / 1000}}}`;

const MARKER = /\{\{m:(-?[\d.]+)\}\}/g;

/** Human length: inches/feet or cm/m, sized to the value. */
export function formatLength(meters: number, units: Units): string {
  if (units === "metric") {
    if (Math.abs(meters) < 1) return `${Math.round(meters * 100)} cm`;
    if (Math.abs(meters) >= 100) return `${Math.round(meters).toLocaleString("en-US")} m`;
    return `${(Math.round(meters * 100) / 100).toFixed(2)} m`;
  }
  const inches = meters / IN;
  if (Math.abs(inches) >= 1200) return `${Math.round(inches / 12).toLocaleString("en-US")} ft`;
  if (Math.abs(inches) < 24) return `${Math.round(inches * 10) / 10} in`.replace(".0 in", " in");
  const ft = Math.floor(inches / 12);
  const rest = Math.round(inches - ft * 12);
  return rest === 12 ? `${ft + 1} ft` : rest ? `${ft} ft ${rest} in` : `${ft} ft`;
}

/** Short form for tight spaces (HUD, coordinates): 14.2" / 36 cm. */
export function formatShort(meters: number, units: Units, digits = 1): string {
  if (units === "metric") return `${(meters * 100).toFixed(digits === 0 ? 0 : 1)} cm`;
  return `${(meters / IN).toFixed(digits)}″`;
}

/** Replace {{m:…}} markers with lengths in the viewer's units. */
export function renderUnits(text: string, units: Units): string {
  return text.replace(MARKER, (_, m) => formatLength(Number(m), units));
}

/** Plain-meters version for models and logs that don't render markers. */
export const stripUnits = (text: string) => renderUnits(text, "metric");

const SPOKEN: Record<string, [string, string]> = { ft: ["foot", "feet"], in: ["inch", "inches"], cm: ["centimeter", "centimeters"], m: ["meter", "meters"] };

/** Replace {{m:…}} markers with lengths read aloud: "3 feet 4 inches", "36 centimeters". */
export function speakUnits(text: string, units: Units): string {
  return text.replace(MARKER, (_, m) =>
    formatLength(Number(m), units).replace(/([\d.,]+) (ft|in|cm|m)\b/g, (_s, n: string, u: string) => `${n} ${SPOKEN[u][n === "1" ? 0 : 1]}`),
  );
}
