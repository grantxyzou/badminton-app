// Pull the backlog items out of a saved copy of the BPM Backlog artifact.
//   node .claude/skills/backlog-audit/extract.mjs <artifact.html> [out.json]
// Prints (or writes) a JSON array of {id, s, g, t, a, r, c, d, w, v, stale}.
// The id is the same djb2 hash the page computes, so a result keyed by id
// matches what the page's Mark done / Drop buttons store under `marks`.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , file, out] = process.argv;
if (!file) { console.error('usage: extract.mjs <artifact.html> [out.json]'); process.exit(2); }
const html = readFileSync(file, 'utf8');
const m = html.match(/const I = \[([\s\S]*?)\];\n\nconst SECTIONS/);
if (!m) { console.error('no item array found — is this the backlog page?'); process.exit(1); }
const items = new Function('return [' + m[1] + ']')();
const hid = (t) => { let h = 5381; for (let k = 0; k < t.length; k++) h = ((h << 5) + h + t.charCodeAt(k)) | 0; return 'i' + (h >>> 0).toString(36); };
for (const i of items) i.id = hid(i.t);
const json = JSON.stringify(items, null, 1);
if (out) { writeFileSync(out, json); console.error(`${items.length} items → ${out}`); } else console.log(json);
