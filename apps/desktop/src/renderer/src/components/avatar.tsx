import { useEffect, useState } from "react";

import { Button } from "@codevault/ui";

import { bridge } from "../lib/bridge.js";

export function Avatar(props: {
  avatarId: string | null;
  label: string;
  target?: "USER" | "ORGANIZATION";
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ id: string; source: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (props.avatarId)
      void bridge()
        .avatars.load(props.avatarId)
        .then((outcome) => {
          if (active && outcome.ok && props.avatarId)
            setLoaded({ id: props.avatarId, source: outcome.data });
        });
    return () => {
      active = false;
    };
  }, [props.avatarId]);
  const source = loaded?.id === props.avatarId ? loaded.source : null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-14 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted text-[16px] font-semibold">
        {source ? (
          <img src={source} alt="" className="size-full object-cover" />
        ) : (
          props.label.slice(0, 2).toUpperCase()
        )}
      </div>
      <div>
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
          <p className="mt-1 text-[11px] text-text-muted">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
