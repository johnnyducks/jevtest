import type { Metadata } from "next";
import { Track } from "@/components/Track";

export const metadata: Metadata = { title: "My applications · Moorestown Permits" };

export default function TrackPage() {
  return <Track />;
}
