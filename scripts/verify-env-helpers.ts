/** Returns a diagnostic value without ever echoing credentials or URL tokens. */
export function environmentValueDetail(name: string, value: string): string {
  const normalized = name.toUpperCase();
  if (
    normalized.includes("SECRET") ||
    normalized.includes("KEY") ||
    normalized.includes("PASSWORD") ||
    normalized.endsWith("_URL")
  ) {
    return "set";
  }
  return value;
}
