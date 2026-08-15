import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class name composition.
 *
 * `clsx` handles conditionals; `twMerge` resolves Tailwind conflicts so a
 * caller's `px-4` reliably beats a component's default `px-2` instead of the
 * result depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
