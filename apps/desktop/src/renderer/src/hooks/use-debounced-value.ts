import { useEffect, useState } from "react";

/**
 * Debounces a value.
 *
 * Search runs across five entity types with trigram and full-text ranking, so
 * issuing it on every keypress would keep the database busy answering queries
 * the researcher has already typed past.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
