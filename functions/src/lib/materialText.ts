/** Flattens a class material's structured fields into plain text for AI context. */
export function materialText(m: FirebaseFirestore.DocumentData, cap = 12000): string {
  const part = (t: string, xs: string[]) => (xs.length ? `${t}:\n${xs.map((x) => `- ${x}`).join("\n")}\n` : "");
  const head = `${m.subjectName ?? ""} · ${m.chapter ?? ""}${m.topic ? ` · ${m.topic}` : ""} · ${m.classDate ?? ""}\n`;
  const body = [
    m.summary ? `What was taught:\n${m.summary}\n` : "",
    part("Important points", m.keyPoints ?? []),
    part("Formulas", m.formulas ?? []),
    part("Definitions", (m.definitions ?? []).map((d: { term: string; meaning: string }) => `${d.term}: ${d.meaning}`)),
    part("Examples", m.examples ?? []),
    m.homework ? `Homework:\n${m.homework}\n` : "",
  ].join("\n");
  return (head + body).slice(0, cap);
}
