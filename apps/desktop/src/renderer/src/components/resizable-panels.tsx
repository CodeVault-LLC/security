import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

interface ResizablePanelsProps {
  primary: ReactNode;
  secondary: ReactNode;
  primaryLabel: string;
  secondaryLabel: string;
  resizeLabel: string;
  storageKey: string;
  initialPrimarySize?: number;
  minPrimarySize?: number;
  minSecondarySize?: number;
  maxPrimarySize?: number;
  className?: string;
}

interface SplitBounds {
  min: number;
  max: number;
}

const DEFAULT_SPLIT = 0.5;
const KEYBOARD_STEP = 0.025;

function storedSplit(storageKey: string, fallback: number): number {
  try {
    const value = Number.parseFloat(localStorage.getItem(storageKey) ?? "");

    return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Two content panels separated by a keyboard-accessible, persistent splitter.
 *
 * The component owns only local layout. Dragging never changes report data,
 * and double-clicking the divider always returns to the product default.
 */
export function ResizablePanels({
  primary,
  secondary,
  primaryLabel,
  secondaryLabel,
  resizeLabel,
  storageKey,
  initialPrimarySize = DEFAULT_SPLIT,
  minPrimarySize = 280,
  minSecondarySize = 280,
  maxPrimarySize,
  className = "",
}: ResizablePanelsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const [split, setSplit] = useState(() =>
    storedSplit(storageKey, initialPrimarySize),
  );
  const [ariaBounds, setAriaBounds] = useState<SplitBounds>({
    min: 0.1,
    max: 0.9,
  });
  const [dragging, setDragging] = useState(false);

  const getBounds = useCallback((): SplitBounds => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;

    if (width <= 0) {
      return { min: 0.1, max: 0.9 };
    }

    const min = Math.min(minPrimarySize / width, 0.9);
    const spaceForSecondary = 1 - minSecondarySize / width;
    const configuredMaximum =
      maxPrimarySize === undefined ? 0.9 : maxPrimarySize / width;
    const max = Math.max(
      min,
      Math.min(spaceForSecondary, configuredMaximum, 0.9),
    );

    return { min, max };
  }, [maxPrimarySize, minPrimarySize, minSecondarySize]);

  const clamp = useCallback(
    (next: number): number => {
      const { min, max } = getBounds();

      return Math.min(Math.max(next, min), max);
    },
    [getBounds],
  );

  const resizeFromClientX = (clientX: number): void => {
    const bounds = containerRef.current?.getBoundingClientRect();

    if (bounds === undefined || bounds.width === 0) return;

    setSplit(clamp((clientX - bounds.left) / bounds.width));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    activePointerRef.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEYBOARD_STEP * 4 : KEYBOARD_STEP;
    const { min, max } = getBounds();
    let next: number | null = null;

    if (event.key === "ArrowLeft") next = split - step;
    if (event.key === "ArrowRight") next = split + step;
    if (event.key === "Home") next = min;
    if (event.key === "End") next = max;

    if (next === null) return;

    event.preventDefault();
    setSplit(clamp(next));
  };

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(split));
    } catch {
      // Persisting the preference is helpful, not required for resizing.
    }
  }, [split, storageKey]);

  useEffect(() => {
    const container = containerRef.current;

    if (container === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const nextBounds = getBounds();

      setAriaBounds(nextBounds);
      setSplit((current) =>
        Math.min(Math.max(current, nextBounds.min), nextBounds.max),
      );
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [getBounds]);

  useEffect(() => {
    if (!dragging) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const style = {
    "--cv-primary-panel": `${split * 100}%`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={`cv-resizable-panels ${className}`}
      style={style}
    >
      <div className="min-w-0 overflow-hidden" aria-label={primaryLabel}>
        {primary}
      </div>

      <div
        role="separator"
        aria-label={resizeLabel}
        aria-orientation="vertical"
        aria-valuemin={Math.round(ariaBounds.min * 100)}
        aria-valuemax={Math.round(ariaBounds.max * 100)}
        aria-valuenow={Math.round(split * 100)}
        aria-valuetext={`${Math.round(split * 100)}% ${primaryLabel.toLowerCase()}`}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        className="cv-resizable-handle"
        onDoubleClick={() => setSplit(clamp(initialPrimarySize))}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          activePointerRef.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
          resizeFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (activePointerRef.current === event.pointerId) {
            resizeFromClientX(event.clientX);
          }
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span aria-hidden className="cv-resizable-handle-line" />
      </div>

      <div className="min-w-0 overflow-hidden" aria-label={secondaryLabel}>
        {secondary}
      </div>
    </div>
  );
}
