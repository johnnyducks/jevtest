/** Card artwork as sent to the browser. No secrets: images are served through this app's own routes. */
export interface CardArt {
  cardId: string;
  /** matched: linked to a CardSight catalog card. */
  status: "matched" | "not_found" | "error" | "not_configured";
  confidence?: "exact" | "likely";
  cardsight?: { id: string; name: string; number?: string; setName?: string; releaseName?: string; year?: string; description?: string };
  /** Image URLs on this app (null when there is no image). */
  front: string | null;
  back: string | null;
  frontSource?: "cardsight" | "local";
  backSource?: "local";
  /** Why there's no match or image, in plain words. */
  note?: string;
}

export interface CardArtBody {
  configured: boolean;
  cards: Record<string, CardArt>;
}
