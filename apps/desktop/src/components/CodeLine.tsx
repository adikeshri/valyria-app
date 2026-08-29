const PY_KEYWORDS = new Set([
  "def", "class", "return", "if", "elif", "else", "for", "while", "import", "from",
  "as", "with", "try", "except", "finally", "raise", "pass", "None", "True", "False",
  "and", "or", "not", "in", "is", "lambda", "yield", "async", "await", "self", "assert",
  "break", "continue", "global", "nonlocal", "del",
]);

type Token = { text: string; cls?: string };

/** A small, dependency-free approximation of syntax highlighting — good
 * enough to make code legible in the preview without pulling a full
 * grammar engine for a viewer that doesn't edit anything. */
export function tokenizeLine(line: string, language: string): Token[] {
  if (language === "markdown") {
    if (/^#{1,6}\s/.test(line)) return [{ text: line, cls: "tok-kw" }];
    if (/^\s*[-*]\s/.test(line)) return [{ text: line, cls: "tok-str" }];
    return [{ text: line }];
  }
  if (language !== "python") return [{ text: line }];

  const tokens: Token[] = [];
  let i = 0;
  const commentIdx = line.indexOf("#");
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";

  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\w+\b|\s+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codePart))) {
    const t = m[0];
    if (/^["']/.test(t)) tokens.push({ text: t, cls: "tok-str" });
    else if (PY_KEYWORDS.has(t)) tokens.push({ text: t, cls: "tok-kw" });
    else if (/^\d+$/.test(t)) tokens.push({ text: t, cls: "tok-num" });
    else if (i > 0 && /def\s*$/.test(codePart.slice(0, m.index))) tokens.push({ text: t, cls: "tok-fn" });
    else tokens.push({ text: t });
    i++;
  }
  if (commentPart) tokens.push({ text: commentPart, cls: "tok-comment" });
  return tokens;
}

export function CodeLine({ line, language }: { line: string; language: string }) {
  const tokens = tokenizeLine(line, language);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={t.cls}>{t.text}</span>
      ))}
    </>
  );
}
