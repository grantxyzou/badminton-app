import { memo } from 'react';

/**
 * Brand shuttlecock glyph — matches the Material Symbols Rounded metrics
 * so it can sit inline with text-icons at 16/18/22/24 sizes.
 *
 * Per design spec (docs/design-system/README.md):
 *   "Brand shuttle is a first-class icon. assets/shuttlecock.svg sits at the
 *   same visual weight and metrics as the Rounded Material glyphs. Reach for
 *   it wherever the UI refers to the sport itself (loaders, empty states,
 *   brand chrome) instead of Material's `sports_tennis` racquet."
 *
 * Source: docs/design-system/assets/shuttlecock.svg (viewBox 0 0 48 48).
 * `color` defaults to `currentColor` so the consumer can theme it with the
 * same semantic color tokens as Material icons.
 */
function ShuttleIcon({
  size = 24,
  color = 'currentColor',
  ariaLabel,
}: {
  size?: number | string;
  color?: string;
  ariaLabel?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* cork: rounded pill */}
        <ellipse cx="24" cy="36" rx="5" ry="3" fill={color} fillOpacity="0.9" stroke="none" />
        {/* feathers */}
        <path d="M24 36 L14 10" />
        <path d="M24 36 L19 9" />
        <path d="M24 36 L24 8" />
        <path d="M24 36 L29 9" />
        <path d="M24 36 L34 10" />
        {/* connecting bands across the feathers */}
        <path d="M14 10 Q24 6 34 10" strokeOpacity="0.6" />
        <path d="M17 18 Q24 15 31 18" strokeOpacity="0.45" />
      </g>
    </svg>
  );
}

export default memo(ShuttleIcon);
