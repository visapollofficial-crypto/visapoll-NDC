export const normalizeStudentId = (raw: string) => raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizeName = (raw: string) => raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export const toLines = (t: string): string[] => t.split("\n").map((l) => l.trim()).filter(Boolean);

export const parseDefinitions = (t: string) =>
  toLines(t).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? { term: l.slice(0, i).trim(), meaning: l.slice(i + 1).trim() } : { term: l, meaning: l };
  });
export const showDefinitions = (d: { term: string; meaning: string }[]) => d.map((x) => `${x.term}: ${x.meaning}`).join("\n");

export const parseLinks = (t: string) =>
  toLines(t).map((l) => {
    const [a, b] = l.split("|").map((x) => x.trim());
    return b ? { title: a, url: b } : { title: a, url: a };
  });
export const showLinks = (d: { title: string; url: string }[]) => d.map((x) => `${x.title} | ${x.url}`).join("\n");
