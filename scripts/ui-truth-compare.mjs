#!/usr/bin/env node
// Wrong-vs-right image for a `ui-truth` proposal.
//
//   node scripts/ui-truth-compare.mjs \
//     --wrong shots/wrong.png --right shots/right.png \
//     --title "Payments card — outer stroke on a container" \
//     --rule  "Containers are FILL-ONLY — no outer stroke (CLAUDE.md, Design System)" \
//     --right-label "Proposed fix (preview)" \
//     --out shots/payments-stroke.png
//
// Puts the two screenshots side by side under red "Wrong" and green "Right"
// headers, with the title and the rule it breaks above them. The image is the
// whole argument of the issue: someone who reads only the picture should know
// what is wrong and what right looks like.
//
// Uses `sharp` (already in the tree through Next). Without it, writes an HTML
// page of the same layout next to --out; open it and screenshot it instead.

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      a[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return a;
}

/**
 * `--crop x,y,w,h` (CSS px of the screenshots): the same region is cut from
 * BOTH shots and enlarged to the panel width, for a defect a few pixels wide
 * that a full phone screen would hide.
 */
export function parseCrop(value) {
  if (!value) return null;
  const n = String(value).split(',').map((v) => Number(v.trim()));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`--crop wants x,y,w,h with w and h > 0, got "${value}"`);
  }
  // Check after rounding: a width of 0.3 rounds to 0, which sharp refuses.
  const [left, top, width, height] = n.map(Math.round);
  if (width === 0 || height === 0) throw new Error(`--crop wants x,y,w,h with w and h > 0, got "${value}"`);
  return { left, top, width, height };
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

/** Greedy word wrap to roughly `max` characters per line. */
export function wrap(text, max) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// Fixed report palette: these are image pixels, not app UI, so tokens do not apply.
const PALETTE = { bg: '#0b0f0d', text: '#e5e7eb', muted: '#9ca3af', wrong: '#ef4444', right: '#22c55e' };

async function main() {
  const a = parseArgs(process.argv.slice(2));
  for (const k of ['wrong', 'right', 'out']) {
    if (!a[k]) throw new Error(`missing --${k}`);
  }
  for (const k of ['wrong', 'right']) if (!existsSync(a[k])) throw new Error(`no such file: ${a[k]}`);
  const title = a.title ?? 'UI truth';
  const rule = a.rule ?? '';
  const wrongLabel = a['wrong-label'] ?? 'Wrong — as it ships today';
  const rightLabel = a['right-label'] ?? 'Right — what the system says';

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // The page sits next to --out, not in the working directory, so the
    // images are linked by absolute file URL or they would not load.
    const src = (p) => escapeXml(pathToFileURL(resolve(p)).href);
    const html = `<!doctype html><meta charset="utf-8"><body style="background:${PALETTE.bg};color:${PALETTE.text};font:16px system-ui;padding:24px">
<h2>${escapeXml(title)}</h2><p style="color:${PALETTE.muted}">${escapeXml(rule)}</p>
<div style="display:flex;gap:24px">
<figure><figcaption style="color:${PALETTE.wrong};font-weight:700">✗ ${escapeXml(wrongLabel)}</figcaption><img src="${src(a.wrong)}" style="max-width:430px;outline:3px solid ${PALETTE.wrong}"></figure>
<figure><figcaption style="color:${PALETTE.right};font-weight:700">✓ ${escapeXml(rightLabel)}</figcaption><img src="${src(a.right)}" style="max-width:430px;outline:3px solid ${PALETTE.right}"></figure>
</div></body>`;
    const htmlOut = a.out.replace(/\.png$/, '.html');
    writeFileSync(htmlOut, html);
    console.log(`sharp unavailable — wrote ${htmlOut}; screenshot it to get the PNG.`);
    if (a.crop) console.log('--crop is NOT applied on this page: crop the screenshot of it by hand.');
    return;
  }

  const W = 430; // each panel at the phone viewport the shots are taken at
  const GAP = 24;
  const PAD = 24;
  const load = async (p) => {
    const crop = parseCrop(a.crop);
    const img = (crop ? sharp(p).extract(crop) : sharp(p)).resize({ width: W, kernel: crop ? 'nearest' : 'lanczos3' });
    const buf = await img.png().toBuffer();
    const { height } = await sharp(buf).metadata();
    return { buf, height };
  };
  const [wrong, right] = await Promise.all([load(a.wrong), load(a.right)]);

  const titleLines = wrap(title, 60);
  const ruleLines = rule ? wrap(rule, 90) : [];
  const headH = PAD + titleLines.length * 30 + (ruleLines.length ? 8 + ruleLines.length * 22 : 0) + 16;
  const labelH = 34;
  const BORDER = 4;
  const width = PAD * 2 + W * 2 + GAP + BORDER * 4;
  const height = headH + labelH + Math.max(wrong.height, right.height) + BORDER * 2 + PAD;
  const xWrong = PAD;
  const xRight = PAD + W + BORDER * 2 + GAP;
  const yImg = headH + labelH;

  let y = PAD + 22;
  const text = [];
  for (const l of titleLines) {
    text.push(`<text x="${PAD}" y="${y}" font-size="24" font-weight="700" fill="${PALETTE.text}">${escapeXml(l)}</text>`);
    y += 30;
  }
  y += 8;
  for (const l of ruleLines) {
    text.push(`<text x="${PAD}" y="${y - 8}" font-size="16" fill="${PALETTE.muted}">${escapeXml(l)}</text>`);
    y += 22;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif">
  <rect width="100%" height="100%" fill="${PALETTE.bg}"/>
  ${text.join('\n  ')}
  <text x="${xWrong}" y="${headH + 22}" font-size="18" font-weight="700" fill="${PALETTE.wrong}">✗ ${escapeXml(wrongLabel)}</text>
  <text x="${xRight}" y="${headH + 22}" font-size="18" font-weight="700" fill="${PALETTE.right}">✓ ${escapeXml(rightLabel)}</text>
  <rect x="${xWrong}" y="${yImg}" width="${W + BORDER * 2}" height="${wrong.height + BORDER * 2}" fill="${PALETTE.wrong}"/>
  <rect x="${xRight}" y="${yImg}" width="${W + BORDER * 2}" height="${right.height + BORDER * 2}" fill="${PALETTE.right}"/>
</svg>`;

  await sharp(Buffer.from(svg))
    .composite([
      { input: wrong.buf, left: xWrong + BORDER, top: yImg + BORDER },
      { input: right.buf, left: xRight + BORDER, top: yImg + BORDER },
    ])
    .png()
    .toFile(a.out);
  console.log(`wrote ${a.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
