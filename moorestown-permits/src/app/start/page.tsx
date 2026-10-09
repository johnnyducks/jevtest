import type { Metadata } from "next";
import { Wizard } from "@/components/wizard/Wizard";

export const metadata: Metadata = { title: "Plan my project · Moorestown Permits" };

export default function StartPage() {
  return <Wizard />;
}
