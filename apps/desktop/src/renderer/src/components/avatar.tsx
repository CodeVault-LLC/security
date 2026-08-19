import { useEffect, useState } from "react";
import { toSvg } from "jdenticon/browser";

import {
  Avatar as AvatarRoot,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
} from "@codevault/ui";

import { bridge } from "../lib/bridge.js";

export function Avatar(props: {
  avatarId: string | null;
  label: string;
  source?: string;
  seed?: string;
  userId?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
  target?: "USER" | "ORGANIZATION";
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ key: string; source: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const imageKey = props.avatarId
    ? `avatar:${props.avatarId}`
    : props.userId
      ? `user:${props.userId}`
      : null;

  useEffect(() => {
    let active = true;
    const request = props.source
      ? null
      : props.avatarId
        ? bridge().avatars.load(props.avatarId)
        : props.userId
          ? bridge().avatars.loadUser(props.userId)
          : null;

    if (request && imageKey)
      void request.then((outcome) => {
        if (active && outcome.ok)
          setLoaded({ key: imageKey, source: outcome.data });
      });
    return () => {
      active = false;
    };
  }, [imageKey, props.avatarId, props.source, props.userId]);

  const source =
    props.source ?? (loaded?.key === imageKey ? loaded.source : null);
  const size = props.size ?? "lg";
  const fallbackSource = identiconDataUrl(
    props.seed ?? props.userId ?? props.avatarId ?? props.label,
  );

  return (
    <span className={cn("flex items-center gap-3", props.className)}>
      <AvatarRoot
        {...(props.showLabel
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": props.label })}
        className={cn(
          "border border-border bg-surface-muted",
          size === "sm" ? "size-5" : size === "md" ? "size-8" : "size-14",
        )}
      >
        {source ? <AvatarImage src={source} alt="" /> : null}
        <AvatarFallback>
          <img
            src={fallbackSource}
            alt=""
            aria-hidden
            data-avatar-fallback
            className="size-full object-cover"
          />
        </AvatarFallback>
      </AvatarRoot>
      {props.showLabel ? (
        <span className="min-w-0 truncate">{props.label}</span>
      ) : null}
      <span>
        {props.target ? (
          <Button
            size="sm"
            onClick={() => {
              void bridge()
                .avatars.selectAndUpload(props.target!)
                .then((outcome) =>
                  setMessage(
                    outcome.ok && outcome.data
                      ? "Avatar is being security-checked."
                      : outcome.ok
                        ? null
                        : outcome.message,
                  ),
                );
            }}
          >
            Upload avatar
          </Button>
        ) : null}
        {message ? (
          <span className="mt-1 block text-[11px] text-text-muted">
            {message}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function identiconDataUrl(seed: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    toSvg(seed, 64, { padding: 0.08 }),
  )}`;
}
