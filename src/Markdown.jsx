import { Fragment } from "react";

/* Tiny markdown renderer for AI answers — headings (###/####), lists (-),
   **bold** and `code`. No dependencies, no dangerouslySetInnerHTML:
   everything is built as React elements so user-adjacent text stays
   escaped. User messages keep rendering as plain text. */

function inline(text, keyPrefix) {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={`${keyPrefix}-${i}`}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

function Markdown({ text }) {
  const lines = String(text ?? "").split("\n");
  const blocks = [];
  let seq = 0;
  const key = () => `md${seq++}`;
  let list = [];
  let listOrdered = false;

  const flushList = () => {
    if (list.length === 0) return;
    const Tag = listOrdered ? "ol" : "ul";
    const id = key();
    blocks.push(
      <Tag key={id} className="md-list">
        {list.map((item, i) => (
          <li key={`${id}-${i}`}>{inline(item, `${id}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = [];
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const stripped = line.trim();

    const heading = stripped.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 3);
      blocks.push(
        <div key={key()} className={`md-head md-h${level}`}>
          {inline(heading[2], key())}
        </div>
      );
      return;
    }

    const bullet = stripped.match(/^[-*]\s+(.*)$/);
    const ordered = stripped.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      if (list.length > 0 && isOrdered !== listOrdered) flushList();
      listOrdered = isOrdered;
      list.push((bullet || ordered)[1]);
      return;
    }

    if (/^(-{3,}|\*{3,})$/.test(stripped)) {
      flushList();
      blocks.push(<hr key={key()} className="md-hr" />);
      return;
    }

    if (stripped === "") {
      flushList();
      return;
    }

    flushList();
    blocks.push(<p key={key()}>{inline(line.trim(), key())}</p>);
  });
  flushList();

  return <div className="md">{blocks}</div>;
}

export default Markdown;
