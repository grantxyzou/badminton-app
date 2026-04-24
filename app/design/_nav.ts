export type DesignSubpage = { href: string; label: string; blurb: string };

export const SUBPAGES: DesignSubpage[] = [
  { href: '/design/tokens',      label: 'Tokens',      blurb: 'Color · motion · radius · spacing · type' },
  { href: '/design/components',  label: 'Components',  blurb: 'Glass card · buttons · banners · pills · inputs' },
  { href: '/design/logo',        label: 'Logo',        blurb: '3 wordmark candidates × 4 contexts' },
  { href: '/design/fonts',       label: 'Type system', blurb: 'Locked pairing — Space Grotesk + JetBrains Mono' },
  { href: '/design/backgrounds', label: 'Backgrounds', blurb: '6 background directions — solid → contrail' },
  { href: '/design/perf',        label: 'Perf audit',  blurb: 'Findings re-tiered for iPhone 15 / Pixel 8 floor' },
];
