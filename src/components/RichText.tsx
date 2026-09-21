import { Fragment, type ReactNode } from "react";

/** Tiny, safe formatter for AI answers: **bold**, `code`, lists and paragraphs. Never injects HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code>
    : <Fragment key={i}>{part}</Fragment>);
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line), num = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
    } else {
      flush();
      const h = /^#{1,4}\s+(.*)/.exec(line);
      if (h) blocks.push(<p key={blocks.length}><strong>{inline(h[1])}</strong></p>);
      else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="rich">{blocks}</div>;
}

export function AiBadge() {
  return <p className="ai-note small muted">AI-generated help. It can make mistakes, and it is not official teacher instruction. Check important answers with your class notes or teacher.</p>;
}
