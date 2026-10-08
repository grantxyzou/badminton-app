// Apply verification results to the backlog page and print what changed.
//   node .claude/skills/backlog-audit/apply.mjs <in.html> <results.json> <out.html> <stamp>
// results.json: [{id, verdict: open|done|stale|cannot, note}]. Every note
// should start with the audit date ("7 Oct: ..."). A result REPLACES the
// item's previous note; verdict done/cannot moves the dot; stale adds the
// "Facts changed" tag; open clears it. <stamp> replaces the header line.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inFile, resFile, outFile, stamp] = process.argv;
if (!outFile) { console.error('usage: apply.mjs <in.html> <results.json> <out.html> [stamp]'); process.exit(2); }
let html = readFileSync(inFile, 'utf8');
const results = Object.fromEntries(JSON.parse(readFileSync(resFile, 'utf8')).map((r) => [r.id, r]));
const hid = (t) => { let h = 5381; for (let k = 0; k < t.length; k++) h = ((h << 5) + h + t.charCodeAt(k)) | 0; return 'i' + (h >>> 0).toString(36); };
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const changes = { done: [], stale: [], reopened: [], unknown: [] };
const seen = new Set();

html = html.replace(/^\{s:"[a-z]+",.*\},?$/gm, (line) => {
  const t = line.match(/,t:"((?:[^"\\]|\\.)*)"/);
  if (!t) return line;
  const id = hid(t[1].replace(/\\"/g, '"'));
  const r = results[id];
  if (!r) return line;
  seen.add(id);
  const wasDone = /c:"done"/.test(line), wasStale = /stale:true/.test(line);
  let next = line.replace(/,stale:true/, '').replace(/,v:"(?:[^"\\]|\\.)*"/, '');
  next = next.replace(/",a:"/, `",v:"${esc(r.note)}",a:"`);
  if (r.verdict === 'done') next = next.replace(/c:"(open|unk)"/, 'c:"done"');
  else if (r.verdict === 'cannot') next = next.replace(/c:"(open|done)"/, 'c:"unk"');
  else if (r.verdict === 'open' || r.verdict === 'stale') next = next.replace(/c:"(done|unk)"/, 'c:"open"');
  if (r.verdict === 'stale') next = next.replace(/",v:"/, '",stale:true,v:"');
  const text = t[1].slice(0, 90);
  if (r.verdict === 'done' && !wasDone) changes.done.push(text);
  if (r.verdict === 'stale' && !wasStale) changes.stale.push(text);
  if (wasDone && (r.verdict === 'open' || r.verdict === 'stale')) changes.reopened.push(text);
  return next;
});
for (const id of Object.keys(results)) if (!seen.has(id)) changes.unknown.push(id);
if (stamp) html = html.replace(/<p class="stamp">[^<]*<\/p>/, `<p class="stamp">${stamp}</p>`);
writeFileSync(outFile, html);
console.log(JSON.stringify(changes, null, 1));
