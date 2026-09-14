/**
 * What each catalog racket looks like, rendered rather than photographed.
 *
 * One 3D model (Grant's, from the design project "Racket 3D" — see
 * `lib/racketModel.ts`) painted per model: frame, accent and grip colours from
 * each model's launch colourway, plus an optional paint pattern and head shape. It is a likeness, not
 * a product photo: colours were researched from maker and retailer pages on
 * 2026-09-14 (157 rackets after that day's catalog check), and a row marked `guessed` had no listing to read from.
 *
 * Kept OUT of `CatalogItem` on purpose. It is presentation, not a spec: the
 * recommender never reads it, and a colourway change must not refresh a
 * seeded Cosmos row. A racket with no catalog id (typed in by hand) or a
 * catalog row added later gets `DEFAULT_LOOK`, the app's own graphite and
 * green.
 */

export interface RacketLook {
  /** The name the maker or retailer lists the colourway under. */
  colourway: string;
  /** Head frame, throat and shaft. */
  frame: string;
  /** The band across the top of the head, the shaft flashes and the grip collar. */
  accent: string;
  grip: string;
  /** No listing was found; the colours follow the series family. */
  guessed?: boolean;
  /** Where the accent paint sits on the 3D frame (`PATTERNS` in
   *  lib/racketModel.ts). Absent = the shoulder band. */
  pattern?: 'shoulder' | 'tips' | 'chevron' | 'crown' | 'plain';
  /** The head silhouette (`SHAPES`). Absent = isometric, which every current
   *  catalog racket is. */
  shape?: 'isometric' | 'oval' | 'boxy';
}

/* eslint-disable no-restricted-syntax -- product data, not theme: these are the
   paint colours of physical rackets. A design token would change with the
   app's theme, and a racket does not. The block covers the table and the
   default look only. */
export const DEFAULT_LOOK: RacketLook = { colourway: 'BPM', frame: '#23282c', accent: '#16a34a', grip: '#16191c' };

export const RACKET_LOOKS: Record<string, RacketLook> = {
  "racket-yonex-astrox-88d-pro": { colourway: "Black/Silver", frame: "#212529", accent: "#b8bdc6", grip: "#d9d9d9" },
  "racket-yonex-astrox-88s-pro": { colourway: "Emerald Blue", frame: "#128182", accent: "#c3a45a", grip: "#1c1c1c" },
  "racket-yonex-astrox-99-pro": { colourway: "Cherry Sunburst", frame: "#1b1817", accent: "#b0303f", grip: "#221f24" },
  "racket-yonex-nanoflare-700": { colourway: "Cyan", frame: "#3a8fd8", accent: "#1f2024", grip: "#1c1c1c" },
  "racket-yonex-arcsaber-11-pro": { colourway: "Grayish Pearl", frame: "#74707a", accent: "#b0213c", grip: "#232328" },
  "racket-yonex-nanoflare-001-ability": { colourway: "Dark Purple", frame: "#5a3f9c", accent: "#141214", grip: "#1c1a1e" },
  "racket-yonex-astrox-100zz": { colourway: "Dark Navy", frame: "#1f3a5a", accent: "#3a7cc0", grip: "#101418" },
  "racket-yonex-astrox-100va-zz": { colourway: "Grayish Beige", frame: "#cfcdc6", accent: "#8fcf3c", grip: "#d6d7d9" },
  "racket-yonex-nanoflare-1000z": { colourway: "Lightning Yellow", frame: "#1f1a22", accent: "#f2c30f", grip: "#ecc20b" },
  "racket-yonex-nanoflare-700-pro": { colourway: "Midnight Purple", frame: "#352d34", accent: "#6fa1b2", grip: "#dcdfda" },
  "racket-yonex-nanoflare-800-pro": { colourway: "Deep Green", frame: "#2e3d46", accent: "#6fa0a6", grip: "#181a1d" },
  "racket-yonex-arcsaber-7-pro": { colourway: "Gray/Yellow", frame: "#4a524f", accent: "#c6d414", grip: "#2a2a2c" },
  "racket-yonex-astrox-99-play": { colourway: "White Tiger", frame: "#e8e8e6", accent: "#2f2c30", grip: "#2a2628" },
  "racket-yonex-astrox-77-play": { colourway: "High Orange", frame: "#1e1e2a", accent: "#d8342a", grip: "#0c0a12" },
  "racket-yonex-astrox-lite-43i": { colourway: "Dark Green", frame: "#2f4a42", accent: "#b09a60", grip: "#1c1c1c" },
  "racket-yonex-voltric-lite-35i": { colourway: "Blue", frame: "#3d4fc4", accent: "#c8405a", grip: "#1e1a24" },
  "racket-yonex-nanoflare-700-play": { colourway: "Midnight Purple", frame: "#322e34", accent: "#db7220", grip: "#d7d8d6" },
  "racket-yonex-astrox-99-pro-3rd-gen": { colourway: "Black/Green", frame: "#1a2a20", accent: "#2f9e5e", grip: "#2b2b2a" },
  "racket-yonex-astrox-88s-pro-3rd-gen": { colourway: "Silver/Black", frame: "#b7bbc6", accent: "#1c1f24", grip: "#0b0b0b" },
  "racket-yonex-astrox-nextage": { colourway: "Black/Green", frame: "#18211e", accent: "#1f7a64", grip: "#262c30" },
  "racket-yonex-nanoflare-nextage": { colourway: "White/Gray", frame: "#c7ccd0", accent: "#7f8388", grip: "#d0d4d7" },
  "racket-yonex-nanoflare-x5": { colourway: "Mist Purple", frame: "#d8d0cc", accent: "#9a2f78", grip: "#eeeeee" },
  "racket-yonex-nanoflare-x7": { colourway: "White", frame: "#eeedf0", accent: "#141315", grip: "#ececec" },
  "racket-yonex-astrox-77-pro": { colourway: "High Orange", frame: "#1e1e2a", accent: "#d8342a", grip: "#08060f" },
  "racket-yonex-arcsaber-71-light": { colourway: "Navy Blue", frame: "#2a3040", accent: "#c2a23a", grip: "#151619" },
  "racket-victor-thruster-ryuga-ii": { colourway: "J Dark Violet", frame: "#2a2630", accent: "#7b3fb5", grip: "#1a1a1a" },
  "racket-victor-thruster-falcon": { colourway: "Enhanced Edition, matt black with rose gold", frame: "#1c1c1e", accent: "#c9967a", grip: "#1a1a1a" },
  "racket-victor-auraspeed-90k": { colourway: "H Black/White", frame: "#1a1a1a", accent: "#f2f2f2", grip: "#1a1a1a" },
  "racket-victor-jetspeed-12": { colourway: "JS-12 II F Cloisonne Blue", frame: "#1f4e9c", accent: "#9aa4ad", grip: "#1a1a1a" },
  "racket-victor-drivex-9x": { colourway: "B Sapphire", frame: "#1b2a4a", accent: "#e85a9b", grip: "#1a1a1a" },
  "racket-victor-thruster-k-falcon": { colourway: "Original TK-F, matt black with blue, gold and red decals", frame: "#1c1c1e", accent: "#2f7fd6", grip: "#1a1a1a" },
  "racket-victor-thruster-f-claw": { colourway: "A Matt White with gold", frame: "#eeeeea", accent: "#c8a24a", grip: "#f2f2f2" },
  "racket-victor-auraspeed-fantome": { colourway: "F AC Black Rose", frame: "#1a1a1a", accent: "#c8375a", grip: "#1a1a1a" },
  "racket-victor-auraspeed-80x": { colourway: "C Olive/Black", frame: "#6b7a3a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-victor-hypernano-x-900x": { colourway: "G Yellow/Green", frame: "#8fbf3a", accent: "#f0e03a", grip: "#1a1a1a" },
  "racket-victor-drivex-10-metallic": { colourway: "B Limoges Blue with orange", frame: "#2a4f8f", accent: "#f07a2a", grip: "#1a1a1a" },
  "racket-victor-jetspeed-s-12": { colourway: "Dark purple and fluorescent yellow", frame: "#3a2a5a", accent: "#d9f02a", grip: "#1a1a1a" },
  "racket-victor-jetspeed-s-011": { colourway: "Rose Red", frame: "#c8285a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-victor-arrow-speed-88-as-88": { colourway: "Orange", frame: "#f07a1a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-victor-brave-sword-1500": { colourway: "1500P Green with black", frame: "#3fae4a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-victor-nitrolite-80x": { colourway: "unknown", frame: "#1a1a1a", accent: "#f2f2f2", grip: "#1a1a1a", guessed: true },
  "racket-victor-auraspeed-90k-ii": { colourway: "B Midnight Blue / Shock Blue", frame: "#1a2a5a", accent: "#3fb0f0", grip: "#1a1a1a" },
  "racket-victor-thruster-ryuga": { colourway: "D Flame Red", frame: "#b3201f", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-victor-auraspeed-hyper-sonic-hs": { colourway: "B Blue", frame: "#1e6fd0", accent: "#3ec46d", grip: "#e8e8e8" },
  "racket-victor-hypernano-x-800": { colourway: "Matt black with multi-coloured stripe decals", frame: "#1c1c1c", accent: "#e8c02a", grip: "#1a1a1a" },
  "racket-victor-brave-sword-12": { colourway: "Royal Blue with white and black decals", frame: "#1f4fb0", accent: "#f2f2f2", grip: "#1a1a1a" },
  "racket-li-ning-aeronaut-9000": { colourway: "White/Gold", frame: "#f2f0ea", accent: "#c9a24a", grip: "#ffffff" },
  "racket-li-ning-axforce-90-dragon": { colourway: "Navy/Blue", frame: "#1e2a4f", accent: "#3f7fd0", grip: "#1e2a4f" },
  "racket-li-ning-bladex-700": { colourway: "Black/Blue", frame: "#1a1c22", accent: "#2f7bd9", grip: "#1a1a1a" },
  "racket-li-ning-3d-calibar-900": { colourway: "Gold/Grey", frame: "#6e6f73", accent: "#c8a04a", grip: "#1a1a1a" },
  "racket-li-ning-n90-iv": { colourway: "Grey/Red", frame: "#7a7d82", accent: "#d12b2b", grip: "#1a1a1a" },
  "racket-li-ning-aeronaut-9000c": { colourway: "Navy/Red", frame: "#1f2a4a", accent: "#c8262e", grip: "#1a1a1a" },
  "racket-li-ning-turbo-charging-75": { colourway: "Black/Blue", frame: "#151515", accent: "#1e6fd9", grip: "#1a1a1a" },
  "racket-li-ning-axforce-100-qilin": { colourway: "Black/Gold", frame: "#141414", accent: "#c9a049", grip: "#1a1a1a" },
  "racket-li-ning-axforce-80": { colourway: "Black/Gold", frame: "#161616", accent: "#c8a24c", grip: "#1a1a1a" },
  "racket-li-ning-halbertec-9000": { colourway: "Green Crystal / Dragons Violet", frame: "#2e8f6e", accent: "#6b3fa0", grip: "#1a1a1a" },
  "racket-li-ning-bladex-900-sun-max": { colourway: "Black/Gold/Orange", frame: "#1a1a1a", accent: "#c79a5b", grip: "#1a1a1a" },
  "racket-li-ning-windstorm-72": { colourway: "Black/Gold", frame: "#151515", accent: "#c9a24a", grip: "#1a1a1a" },
  "racket-li-ning-axforce-cannon": { colourway: "Black", frame: "#141414", accent: "#d9d9d9", grip: "#1a1a1a" },
  "racket-li-ning-bladex-spiral": { colourway: "Neon Brilliant Yellow", frame: "#d9e021", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-li-ning-halberd-900": { colourway: "Unknown", frame: "#1a1a1a", accent: "#b8bcc2", grip: "#1a1a1a", guessed: true },
  "racket-li-ning-g-force-superlite": { colourway: "Unknown", frame: "#1e2a4f", accent: "#f2c230", grip: "#1a1a1a", guessed: true },
  "racket-li-ning-ignite-8": { colourway: "Black/Blue/Old Gold", frame: "#161616", accent: "#2b5fb8", grip: "#1a1a1a" },
  "racket-li-ning-axforce-90-dragon-max": { colourway: "Navy/Blue", frame: "#1e2a4f", accent: "#4a8fdb", grip: "#1e2a4f" },
  "racket-li-ning-axforce-90-tiger-max": { colourway: "Navy/Red", frame: "#25304f", accent: "#e8574a", grip: "#1a1a1a" },
  "racket-li-ning-halbertec-8000": { colourway: "Pink/Green", frame: "#e86fa6", accent: "#3cc7b8", grip: "#1a1a1a" },
  "racket-li-ning-bladex-800-speed": { colourway: "Storm Blue", frame: "#2c5c8a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-li-ning-axforce-100-ii": { colourway: "Storm Green", frame: "#2f5e4e", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-li-ning-halbertec-5000": { colourway: "White/Purple", frame: "#f2f0f5", accent: "#7b4fb8", grip: "#ffffff" },
  "racket-li-ning-aeronaut-7000i": { colourway: "Pink/Black", frame: "#e0559a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-li-ning-air-force-79": { colourway: "Black/Blue/Red", frame: "#161616", accent: "#2a62c9", grip: "#1a1a1a" },
  // Added with the catalog check of 2026-09-14 (current 2024–2026 lineups).
  "racket-yonex-astrox-100-tour": { colourway: "Kurenai", frame: "#9b1b30", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-100-game": { colourway: "Kurenai", frame: "#9b1b30", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-100va-tour": { colourway: "Dark Olive", frame: "#4a4f2a", accent: "#c9b458", grip: "#1a1a1a" },
  "racket-yonex-astrox-100va-game": { colourway: "Grayish Beige", frame: "#c9bfae", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-99-tour": { colourway: "Black / Green", frame: "#1a1a1a", accent: "#3fae49", grip: "#1a1a1a" },
  "racket-yonex-astrox-99-game": { colourway: "Black / Green", frame: "#1a1a1a", accent: "#3fae49", grip: "#1a1a1a" },
  "racket-yonex-astrox-88s-tour": { colourway: "Silver / Black", frame: "#c0c0c0", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-88s-game": { colourway: "Silver / Black", frame: "#c0c0c0", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-88d-tour": { colourway: "Black / Silver", frame: "#1a1a1a", accent: "#c0c0c0", grip: "#1a1a1a" },
  "racket-yonex-astrox-88d-game": { colourway: "Black / Silver", frame: "#1a1a1a", accent: "#c0c0c0", grip: "#1a1a1a" },
  "racket-yonex-astrox-88-play": { colourway: "Black / Silver", frame: "#1a1a1a", accent: "#c0c0c0", grip: "#1a1a1a" },
  "racket-yonex-astrox-77-tour": { colourway: "High Orange", frame: "#ff6a13", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-70": { colourway: "Saxe", frame: "#8fb8de", accent: "#ffffff", grip: "#1a1a1a" },
  "racket-yonex-astrox-01-feel": { colourway: "Lime", frame: "#b5d334", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-astrox-attack-9": { colourway: "Black", frame: "#1a1a1a", accent: "#9e9e9e", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-1000-tour": { colourway: "Lightning Yellow", frame: "#f2e600", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-1000-game": { colourway: "Lightning Yellow", frame: "#f2e600", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-1000-play": { colourway: "Lightning Yellow", frame: "#f2e600", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-800-tour": { colourway: "Deep Green", frame: "#0f5c3a", accent: "#b87333", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-800-game": { colourway: "Deep Green", frame: "#0f5c3a", accent: "#b87333", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-800-play": { colourway: "Deep Green", frame: "#0f5c3a", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-700-tour": { colourway: "Midnight Purple", frame: "#3b2a5c", accent: "#b8b8c8", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-700-game": { colourway: "Midnight Purple", frame: "#3b2a5c", accent: "#b8b8c8", grip: "#1a1a1a" },
  "racket-yonex-nanoflare-speed-7": { colourway: "Red", frame: "#c8102e", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-arcsaber-11-tour": { colourway: "Grayish Pearl", frame: "#d8d6d0", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-arcsaber-11-play": { colourway: "Grayish Pearl", frame: "#d8d6d0", accent: "#1a1a1a", grip: "#1a1a1a" },
  "racket-yonex-arcsaber-7-tour": { colourway: "Gray / Yellow", frame: "#6e6e6e", accent: "#f2d200", grip: "#1a1a1a" },
  "racket-yonex-arcsaber-7-play": { colourway: "Gray / Yellow", frame: "#6e6e6e", accent: "#f2d200", grip: "#1a1a1a" },
  "racket-yonex-arcsaber-2-clear": { colourway: "Black / Blue", frame: "#1a1a1a", accent: "#1f5fbf", grip: "#1a1a1a" },
  "racket-victor-auraspeed-100x-ultra": { colourway: "Black", frame: "#1a1a1a", accent: "#c9a227", grip: "#000000" },
  "racket-victor-auraspeed-90f": { colourway: "Purple", frame: "#6b3fa0", accent: "#e8e8e8", grip: "#000000" },
  "racket-victor-auraspeed-90k-metallic": { colourway: "Pastel Green", frame: "#a8d8b9", accent: "#b0b7bf", grip: "#000000" },
  "racket-victor-auraspeed-hs-plus": { colourway: "Black", frame: "#1a1a1a", accent: "#8a8f96", grip: "#000000" },
  "racket-victor-auraspeed-90s": { colourway: "Purple", frame: "#5b3a8c", accent: "#f2c230", grip: "#000000" },
  "racket-victor-auraspeed-99": { colourway: "Pink", frame: "#e88fb3", accent: "#ffffff", grip: "#000000" },
  "racket-victor-auraspeed-fantome-f-ac": { colourway: "Rose / Black", frame: "#1a1a1a", accent: "#d98a9c", grip: "#000000" },
  "racket-victor-thruster-f-c-ultra-cx": { colourway: "Black / Gold", frame: "#141414", accent: "#c9a227", grip: "#000000" },
  "racket-victor-drivex-12": { colourway: "Orange / Black", frame: "#e8742a", accent: "#1a1a1a", grip: "#000000" },
  "racket-victor-drivex-3h": { colourway: "Pastel Green", frame: "#9fd3b4", accent: "#ffffff", grip: "#000000" },
  "racket-victor-thruster-f-ultra": { colourway: "Black", frame: "#141414", accent: "#c9a227", grip: "#000000" },
  "racket-victor-thruster-f-enhanced-hs": { colourway: "Black", frame: "#141414", accent: "#c9a227", grip: "#000000" },
  "racket-victor-thruster-legend": { colourway: "Not stated", frame: "#1a1a1a", accent: "#c0392b", grip: "#000000" },
  "racket-victor-thruster-ryuga-ii-pro": { colourway: "Navy Blue", frame: "#1f2f5c", accent: "#c0392b", grip: "#000000" },
  "racket-victor-thruster-ryuga-metallic": { colourway: "Black", frame: "#141414", accent: "#b0b7bf", grip: "#000000" },
  "racket-victor-thruster-raptor": { colourway: "Black", frame: "#141414", accent: "#d35400", grip: "#000000" },
  "racket-victor-thruster-ryuga-muse": { colourway: "Blue", frame: "#3a6fc4", accent: "#ffffff", grip: "#000000" },
  "racket-victor-thruster-k-280-ex": { colourway: "Sparkling Green", frame: "#5fbf7f", accent: "#1a1a1a", grip: "#000000" },
  "racket-victor-thruster-k-100k": { colourway: "Light Blue", frame: "#7fb8e0", accent: "#ffffff", grip: "#000000" },
  "racket-victor-thruster-k-6": { colourway: "Black", frame: "#141414", accent: "#c0392b", grip: "#000000" },
  "racket-li-ning-axforce-90": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-axforce-80-ii": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-axforce-80-light": { colourway: "Pearl White / Flower Blue", frame: "#f2f2ee", accent: "#6f8fd8", grip: "#111111" },
  "racket-li-ning-axforce-70": { colourway: "Black / Silver", frame: "#111111", accent: "#b8b8b8", grip: "#111111" },
  "racket-li-ning-axforce-60": { colourway: "Pearl White", frame: "#f2f2ee", accent: "#9a9a9a", grip: "#111111" },
  "racket-li-ning-axforce-50": { colourway: "Dark Purple / Blue", frame: "#3b2a5c", accent: "#3a6fd8", grip: "#111111" },
  "racket-li-ning-axforce-40": { colourway: "Black / Red", frame: "#111111", accent: "#c8202c", grip: "#111111" },
  "racket-li-ning-axforce-30": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-axforce-20": { colourway: "Gulf Blue", frame: "#1f6fa8", accent: "#e8e8e8", grip: "#111111" },
  "racket-li-ning-axforce-10": { colourway: "Pearl White", frame: "#f2f2ee", accent: "#2b3a8c", grip: "#111111" },
  "racket-li-ning-axforce-cannon-pro": { colourway: "Dark Purple Blue", frame: "#2e2a6b", accent: "#4f7be0", grip: "#111111" },
  "racket-li-ning-axforce-big-bang": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-axforce-warrior": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-halbertec-7000": { colourway: "Green / Orange", frame: "#2f8f5b", accent: "#f28c28", grip: "#111111" },
  "racket-li-ning-halbertec-6000": { colourway: "White / Green", frame: "#f2f2ee", accent: "#2f9e5b", grip: "#111111" },
  "racket-li-ning-halbertec-motor-pro": { colourway: "Black / Pink", frame: "#111111", accent: "#e85a9a", grip: "#111111" },
  "racket-li-ning-halbertec-motor": { colourway: "Pearl White", frame: "#f2f2ee", accent: "#9a9a9a", grip: "#111111" },
  "racket-li-ning-halbertec-1000": { colourway: "Dragon Purple", frame: "#5b2d82", accent: "#c9a0e0", grip: "#111111" },
  "racket-li-ning-bladex-880-shida": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-bladex-800-power": { colourway: "Lava Red", frame: "#b3261e", accent: "#111111", grip: "#111111" },
  "racket-li-ning-bladex-800": { colourway: "Dark Green", frame: "#1f5e3a", accent: "#111111", grip: "#111111" },
  "racket-li-ning-bladex-600": { colourway: "White", frame: "#f2f2ee", accent: "#7a5bc7", grip: "#111111" },
  "racket-li-ning-bladex-500": { colourway: "Purple / Black", frame: "#5b2d82", accent: "#111111", grip: "#111111" },
  "racket-li-ning-bladex-sonar": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-bladex-assassin": { colourway: "Pearl White", frame: "#f2f2ee", accent: "#9a9a9a", grip: "#111111" },
  "racket-li-ning-bladex-200": { colourway: "Blue", frame: "#2a63c7", accent: "#e8e8e8", grip: "#111111" },
  "racket-li-ning-aeronaut-9000-instinct": { colourway: "Black / Gold", frame: "#111111", accent: "#c9a24a", grip: "#111111" },
  "racket-li-ning-turbo-charging-marshal": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-tectonic-1": { colourway: "Yellow", frame: "#f2c61f", accent: "#111111", grip: "#111111" },
  "racket-li-ning-tectonic-6": { colourway: "Orange", frame: "#f07a1a", accent: "#111111", grip: "#111111" },
  "racket-li-ning-windstorm-79s": { colourway: "White", frame: "#f2f2ee", accent: "#b87333", grip: "#111111" },
  "racket-li-ning-windstorm-79h": { colourway: "Black", frame: "#111111", accent: "#c8202c", grip: "#111111" },
  "racket-li-ning-3d-calibar-300": { colourway: "Yellow / Grey", frame: "#e8c21f", accent: "#6b6b6b", grip: "#111111" },
  "racket-li-ning-3d-calibar-300-boost": { colourway: "Black", frame: "#111111", accent: "#8c8c8c", grip: "#111111" },
  "racket-li-ning-3d-calibar-300-combat": { colourway: "Grey / Green", frame: "#6b6b6b", accent: "#3fa35b", grip: "#111111" },
  "racket-li-ning-3d-calibar-600-combat": { colourway: "Blue / Grey", frame: "#2a63c7", accent: "#6b6b6b", grip: "#111111" },
  "racket-li-ning-3d-calibar-900-instinct": { colourway: "Black / Gold", frame: "#111111", accent: "#c9a24a", grip: "#111111" },
};

/* eslint-enable no-restricted-syntax */

export function racketLook(catalogId: string | null | undefined): RacketLook {
  return (catalogId && RACKET_LOOKS[catalogId]) || DEFAULT_LOOK;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * An `<img src>` (and canvas `Image.src`) for a racket: the image pre-rendered
 * from the 3D model (`lib/racketModel.ts`) for that catalog id, or the default
 * look for a racket the table does not know. Same-origin files under
 * `public/rackets/`, written by `scripts/render-racket-images.mjs` — so a
 * canvas that draws one can still export.
 */
export function racketSrc(catalogId: string | null | undefined): string {
  const key = catalogId && RACKET_LOOKS[catalogId] ? catalogId : '_default';
  return `${BASE}/rackets/${key}.webp`;
}
