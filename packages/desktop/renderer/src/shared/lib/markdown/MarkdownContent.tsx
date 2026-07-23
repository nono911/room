import React from 'react';
import { normalizeSafeMarkdownHref } from './markdownLinks.js';

const decodeHtmlEntities = (value: string) => {
  if (!/[&]/.test(value) || typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
};

const normalizeMarkupForMarkdown = (value: string) => {
  return decodeHtmlEntities(value)
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => `${'#'.repeat(Math.min(Number(level), 3))} ${body.trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
};

const formatMathForDisplay = (value: string) => {
  let output = value
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\times/g, 'x')
    .replace(/\\%/g, '%')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let previous = '';
  while (previous !== output) {
    previous = output;
    output = output.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) / ($2)');
  }

  return output.replace(/[{}]/g, '').trim() || value.trim();
};

export const renderMathInline = (value: string, key: string) => (
  <code
    key={key}
    style={{
      padding: '1px 5px',
      borderRadius: '6px',
      border: '1px solid hsl(var(--border-dim))',
      background: 'hsl(var(--bg-input))',
      color: 'hsl(var(--text-primary))',
      fontSize: '0.95em',
      whiteSpace: 'normal'
    }}
  >
    {formatMathForDisplay(value)}
  </code>
);

export const renderMathBlock = (value: string, key: string) => (
  <pre
    key={key}
    style={{
      margin: '0 0 0.75em 0',
      padding: '10px 12px',
      borderRadius: '8px',
      border: '1px solid hsl(var(--border-dim))',
      background: 'hsl(var(--bg-input))',
      color: 'hsl(var(--text-primary))',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      lineHeight: 1.55
    }}
  >
    <code>{formatMathForDisplay(value)}</code>
  </pre>
);

const splitMarkdownTableRow = (line: string) => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
};

const isMarkdownTableSeparator = (line: string) => {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
};

const looksLikeMarkdownTableRow = (line: string) => {
  return line.includes('|') && splitMarkdownTableRow(line).length > 1;
};

export const renderMarkdownTable = (tableLines: string[], key: string, onScrollToMessage?: (messageNumber: number) => void) => {
  const header = splitMarkdownTableRow(tableLines[0] || '');
  const rows = tableLines.slice(2)
    .map(splitMarkdownTableRow)
    .filter(row => row.some(cell => cell.length > 0));

  return (
    <div key={key} style={{ margin: '0 0 0.8em 0', overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        overflow: 'hidden',
        fontSize: '0.92em'
      }}>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th
                key={`th-${index}`}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid hsl(var(--border-dim))',
                  background: 'hsl(var(--bg-input))',
                  color: 'hsl(var(--text-primary))',
                  textAlign: 'left',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}
              >
                {renderInlineMarkdown(cell, onScrollToMessage)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`tr-${rowIndex}`}>
              {header.map((_, cellIndex) => (
                <td
                  key={`td-${rowIndex}-${cellIndex}`}
                  style={{
                    padding: '8px 10px',
                    borderTop: rowIndex === 0 ? 0 : '1px solid hsl(var(--border-dim) / 0.65)',
                    color: 'hsl(var(--text-secondary))',
                    verticalAlign: 'top'
                  }}
                >
                  {renderInlineMarkdown(row[cellIndex] || '', onScrollToMessage)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const cleanGraphNodeLabel = (value: string) => {
  const withoutEdgeLabel = value.replace(/\|[^|]*\|/g, '').trim();
  const labelMatch = withoutEdgeLabel.match(/(?:\["?([^"\]]+)"?\]|\("?(.*?)"?\)|\{"?([^"}]+)"?\})/);
  if (labelMatch) return (labelMatch[1] || labelMatch[2] || labelMatch[3] || '').trim();
  return withoutEdgeLabel
    .replace(/^[A-Za-z0-9_.:-]+\s*/, '')
    .replace(/[";]/g, '')
    .trim() || withoutEdgeLabel.replace(/[";]/g, '').trim();
};

const parseGraphEdges = (value: string) => {
  return value.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('%%') && !/^(graph|flowchart|sequenceDiagram|stateDiagram|mindmap|timeline|gantt|pie)\b/i.test(line))
    .map(line => {
      const match = line.match(/^(.+?)\s*(-->|---|->|=>|--)\s*(.+)$/);
      if (!match) return null;
      return {
        from: cleanGraphNodeLabel(match[1]),
        arrow: match[2],
        to: cleanGraphNodeLabel(match[3])
      };
    })
    .filter((edge): edge is { from: string; arrow: string; to: string } => Boolean(edge));
};

const isGraphCodeBlock = (language: string, value: string) => {
  const normalizedLanguage = language.trim().toLowerCase();
  return ['mermaid', 'graph', 'flowchart', 'dot'].includes(normalizedLanguage)
    || /^(graph|flowchart|sequenceDiagram|stateDiagram|mindmap|timeline|gantt|pie)\b/i.test(value.trim());
};

export const renderGraphBlock = (value: string, key: string) => {
  const edges = parseGraphEdges(value);
  return (
    <div
      key={key}
      style={{
        margin: '0 0 0.8em 0',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid hsl(var(--border-dim))',
        background: 'hsl(var(--bg-input))',
        overflowX: 'auto'
      }}
    >
      <div style={{ marginBottom: '8px', color: 'hsl(var(--text-primary))', fontWeight: 700, fontSize: '0.9em' }}>
        Graph
      </div>
      {edges.length > 0 ? (
        <div style={{ display: 'grid', gap: '7px', minWidth: '260px' }}>
          {edges.map((edge, index) => (
            <div
              key={`${edge.from}-${edge.to}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(80px, max-content) max-content minmax(80px, max-content)',
                gap: '8px',
                alignItems: 'center',
                color: 'hsl(var(--text-secondary))'
              }}
            >
              <span style={{ padding: '5px 8px', borderRadius: '7px', border: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-panel))' }}>{edge.from}</span>
              <span style={{ color: 'hsl(var(--text-muted))' }}>{edge.arrow.includes('>') ? '->' : '--'}</span>
              <span style={{ padding: '5px 8px', borderRadius: '7px', border: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-panel))' }}>{edge.to}</span>
            </div>
          ))}
        </div>
      ) : (
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'hsl(var(--text-secondary))' }}>{value}</pre>
      )}
    </div>
  );
};

export const renderInlineMarkdown = (value: string, onScrollToMessage?: (messageNumber: number) => void) => {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`[^`]+`|\$(?!\$)[^$\n]+\$|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('[')) {
      const label = match[2];
      const href = match[3];
      const messageMatch = label.match(/^Message\s+(\d+)$/i);
      if (messageMatch) {
        const messageNumber = Number(messageMatch[1]);
        nodes.push(
          <button
            key={`inline-message-ref-${nodes.length}`}
            type="button"
            onClick={() => onScrollToMessage?.(messageNumber)}
            style={{ padding: 0, border: 0, background: 'none', color: 'hsl(var(--accent-blue))', cursor: 'pointer', font: 'inherit', fontWeight: 650, textDecoration: 'underline', textUnderlineOffset: '2px' }}
            title={`Jump to ${label}`}
          >
            {label}
          </button>
        );
      } else if (href.startsWith('file://')) {
        nodes.push(<span key={`inline-file-link-${nodes.length}`} style={{ color: 'hsl(var(--accent-blue))', fontWeight: 650 }}>{label}</span>);
      } else {
        const safeHref = normalizeSafeMarkdownHref(href);
        nodes.push(safeHref ? (
          <a key={`inline-link-${nodes.length}`} href={safeHref} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          <span key={`inline-blocked-link-${nodes.length}`} title="Unsafe link blocked">
            {label}
          </span>
        ));
      }
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`inline-code-${nodes.length}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('$')) {
      nodes.push(renderMathInline(token.slice(1, -1), `inline-math-${nodes.length}`));
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`inline-strong-${nodes.length}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={`inline-em-${nodes.length}`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }
  return nodes.length > 0 ? nodes : value;
};

export const renderMarkdownContent = (
  text: string,
  streaming?: boolean,
  className = 'message-markdown',
  onScrollToMessage?: (messageNumber: number) => void
) => {
  const content = normalizeMarkupForMarkdown(text || (streaming ? 'Waiting for output...' : ''));
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let mathLines: string[] = [];
  let inCode = false;
  let inMath = false;
  let codeLanguage = '';
  let codeIndex = 0;
  let mathIndex = 0;
  let tableIndex = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const value = paragraph.join('\n');
    blocks.push(
      <p key={`p-${blocks.length}`} style={{ margin: '0 0 0.65em 0', whiteSpace: 'pre-wrap' }}>
        {renderInlineMarkdown(value, onScrollToMessage)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: '0 0 0.75em 1.15em', padding: 0 }}>
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`} style={{ marginBottom: '0.25em' }}>{renderInlineMarkdown(item, onScrollToMessage)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCode = () => {
    const value = codeLines.join('\n');
    if (isGraphCodeBlock(codeLanguage, value)) {
      blocks.push(renderGraphBlock(value, `graph-${codeIndex++}`));
    } else {
      blocks.push(
        <pre key={`code-${codeIndex++}`} style={{
          margin: '0 0 0.75em 0',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid hsl(var(--border-dim))',
          background: 'hsl(var(--bg-input))',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap'
        }}>
          <code>{value}</code>
        </pre>
      );
    }
    codeLines = [];
    codeLanguage = '';
  };

  const flushMath = () => {
    if (mathLines.length === 0) return;
    blocks.push(renderMathBlock(mathLines.join('\n'), `math-${mathIndex++}`));
    mathLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
      } else {
        codeLanguage = line.trim().slice(3).trim().split(/\s+/)[0] || '';
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (inMath) {
      const closeIndex = line.indexOf('$$');
      if (closeIndex >= 0) {
        const beforeClose = line.slice(0, closeIndex).trim();
        if (beforeClose) mathLines.push(beforeClose);
        flushMath();
        inMath = false;
        const remainder = line.slice(closeIndex + 2).trim();
        if (remainder) paragraph.push(remainder);
      } else {
        mathLines.push(line);
      }
      continue;
    }

    const mathStart = line.trim();
    if (mathStart.startsWith('$$')) {
      flushParagraph();
      flushList();
      const afterOpen = mathStart.slice(2);
      const closeIndex = afterOpen.indexOf('$$');
      if (closeIndex >= 0) {
        const inlineMath = afterOpen.slice(0, closeIndex).trim();
        if (inlineMath) {
          mathLines.push(inlineMath);
          flushMath();
        }
        const remainder = afterOpen.slice(closeIndex + 2).trim();
        if (remainder) paragraph.push(remainder);
      } else {
        const initialMath = afterOpen.trim();
        if (initialMath) mathLines.push(initialMath);
        inMath = true;
      }
      continue;
    }

    if (
      looksLikeMarkdownTableRow(line)
      && index + 1 < lines.length
      && isMarkdownTableSeparator(lines[index + 1])
    ) {
      flushParagraph();
      flushList();
      const tableLines = [line, lines[index + 1]];
      index += 1;
      while (index + 1 < lines.length && looksLikeMarkdownTableRow(lines[index + 1])) {
        tableLines.push(lines[index + 1]);
        index += 1;
      }
      blocks.push(renderMarkdownTable(tableLines, `table-${tableIndex++}`, onScrollToMessage));
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(
        <div key={`h-${blocks.length}`} style={{
          margin: blocks.length === 0 ? '0 0 0.5em 0' : '0.85em 0 0.5em 0',
          color: 'white',
          fontWeight: 700,
          fontSize: level === 1 ? '1.04em' : level === 2 ? '0.98em' : '0.92em'
        }}>
          {renderInlineMarkdown(headingMatch[2], onScrollToMessage)}
        </div>
      );
      continue;
    }

    const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode || codeLines.length > 0) flushCode();
  if (inMath || mathLines.length > 0) flushMath();
  flushParagraph();
  flushList();

  return <div className={className}>{blocks.length > 0 ? blocks : content}</div>;
};
