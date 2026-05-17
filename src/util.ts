export function parseRepoRef(repo: string): { owner: string; name: string } {
  const m = repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`Invalid repo "${repo}". Expected "owner/name".`);
  return { owner: m[1], name: m[2] };
}

export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

export function parseCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/^([\d.]+)\s*([kmb]?)/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2];
  if (unit === 'k') n *= 1_000;
  else if (unit === 'm') n *= 1_000_000;
  else if (unit === 'b') n *= 1_000_000_000;
  return Math.round(n);
}
