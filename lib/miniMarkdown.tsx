import type { ReactNode } from 'react';

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string };

function tokenizeInline(line: string): InlineToken[] {
  const out: InlineToken[] = [];
  let i = 0;
  while (i < line.length) {
    if (line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2);
      if (close > i + 2) {
        out.push({ kind: 'bold', value: line.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }
    if (line[i] === '*' && line[i + 1] !== '*') {
      const close = line.indexOf('*', i + 1);
      if (close > i + 1) {
        out.push({ kind: 'italic', value: line.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    const nextSpecial = findNextSpecial(line, i + 1);
    out.push({ kind: 'text', value: line.slice(i, nextSpecial) });
    i = nextSpecial;
  }
  return out;
}

function findNextSpecial(line: string, from: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '*') return i;
  }
  return line.length;
}

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(line).map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    if (tok.kind === 'bold') return <strong key={key}>{tok.value}</strong>;
    if (tok.kind === 'italic') return <em key={key}>{tok.value}</em>;
    return <span key={key}>{tok.value}</span>;
  });
}

type Block =
  | { kind: 'para'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const UL_PATTERN = /^\s*[-*]\s+(.+)$/;
const OL_PATTERN = /^\s*\d+\.\s+(.+)$/;

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const ulMatch = line.match(UL_PATTERN);
    const olMatch = line.match(OL_PATTERN);

    if (ulMatch) {
      if (current?.kind === 'ul') current.items.push(ulMatch[1]);
      else {
        if (current) blocks.push(current);
        current = { kind: 'ul', items: [ulMatch[1]] };
      }
    } else if (olMatch) {
      if (current?.kind === 'ol') current.items.push(olMatch[1]);
      else {
        if (current) blocks.push(current);
        current = { kind: 'ol', items: [olMatch[1]] };
      }
    } else if (line === '') {
      if (current) {
        blocks.push(current);
        current = null;
      }
    } else {
      if (current?.kind === 'para') current.lines.push(line);
      else {
        if (current) blocks.push(current);
        current = { kind: 'para', lines: [line] };
      }
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

export function renderMarkdown(text: string): ReactNode {
  if (!text) return null;
  const blocks = parseBlocks(text);
  return blocks.map((block, bi) => {
    if (block.kind === 'ul') {
      return (
        <ul key={`b-${bi}`}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `${bi}-${i}`)}</li>
          ))}
        </ul>
      );
    }
    if (block.kind === 'ol') {
      return (
        <ol key={`b-${bi}`}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `${bi}-${i}`)}</li>
          ))}
        </ol>
      );
    }
    return (
      <p key={`b-${bi}`}>
        {block.lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderInline(line, `${bi}-${li}`)}
          </span>
        ))}
      </p>
    );
  });
}
