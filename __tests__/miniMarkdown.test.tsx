// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { renderMarkdown } from '@/lib/miniMarkdown';

afterEach(cleanup);

function html(node: ReturnType<typeof renderMarkdown>) {
  const { container } = render(<div>{node}</div>);
  return container.innerHTML;
}

describe('miniMarkdown', () => {
  it('renders null for empty input', () => {
    expect(renderMarkdown('')).toBeNull();
  });

  it('wraps plain text in a paragraph', () => {
    expect(html(renderMarkdown('hello world'))).toContain('<p>');
    expect(html(renderMarkdown('hello world'))).toContain('hello world');
  });

  it('renders bold with **text**', () => {
    expect(html(renderMarkdown('hi **world** ok'))).toContain('<strong>world</strong>');
  });

  it('renders italic with *text*', () => {
    expect(html(renderMarkdown('hi *world* ok'))).toContain('<em>world</em>');
  });

  it('renders bulleted list with -', () => {
    const out = html(renderMarkdown('- one\n- two'));
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('renders numbered list with 1.', () => {
    const out = html(renderMarkdown('1. first\n2. second'));
    expect(out).toContain('<ol>');
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('renders bold inside list items', () => {
    const out = html(renderMarkdown('- hi **there**'));
    expect(out).toContain('<strong>there</strong>');
  });

  it('escapes HTML in input (React JSX safety)', () => {
    const out = html(renderMarkdown('<script>alert(1)</script>'));
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('tolerates mismatched asterisks without creating bold', () => {
    const out = html(renderMarkdown('hi **there'));
    expect(out).not.toContain('<strong>');
    expect(out).toContain('there');
    expect(out).toContain('*');
  });

  it('splits paragraphs on blank lines', () => {
    const out = html(renderMarkdown('para one\n\npara two'));
    const paragraphs = out.match(/<p>/g);
    expect(paragraphs).not.toBeNull();
    expect(paragraphs!.length).toBe(2);
  });

  it('renders single newlines inside paragraph as <br>', () => {
    const out = html(renderMarkdown('line one\nline two'));
    expect(out).toContain('<br>');
  });
});
