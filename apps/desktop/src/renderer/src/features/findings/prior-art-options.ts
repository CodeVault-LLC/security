const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 100;

export interface ParsedPriorArtKeywords {
  keywords: string[];
  error: string | null;
}

/** Normalize the human-friendly comma/newline input used by the check dialog. */
export function parsePriorArtKeywords(input: string): ParsedPriorArtKeywords {
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/[,\n]/u)) {
    const keyword = raw.trim();
    if (keyword.length === 0) continue;
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      return {
        keywords: [],
        error: `Each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer.`,
      };
    }
    const normalized = keyword.toLocaleLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(keyword);
    }
  }

  if (keywords.length > MAX_KEYWORDS) {
    return {
      keywords: [],
      error: `Use no more than ${MAX_KEYWORDS} keywords per check.`,
    };
  }

  return { keywords, error: null };
}
