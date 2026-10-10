import codes from "../data/icd10-common.json";

export interface Icd10Code {
  code: string;
  description: string;
}

export function searchIcd10(query: string, limit = 10): Icd10Code[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];
  const safeLimit = Math.min(20, Math.max(1, limit));
  return codes
    .filter(({ code, description }) => `${code} ${description}`.toLowerCase().includes(normalizedQuery))
    .slice(0, safeLimit);
}
