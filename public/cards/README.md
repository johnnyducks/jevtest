# Your own card images (optional)

Put image files here to show them for a card in the room. They take priority over CardSight AI, and they are the only way to show card **backs** (CardSight provides fronts only).

Name each file `<card id>-front.<ext>` or `<card id>-back.<ext>`, where `<ext>` is `jpg`, `jpeg`, `png` or `webp`. For example:

- `mantle-52-back.jpg`
- `griffey-89-front.png`

Card ids are in `src/lib/twin/environment.ts`, for example `griffey-89`, `mantle-52`, `ruth-33`, `trout-11`, `wagner-t206`.

Restart the app after adding files.
