import { KeyRound, Plus, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";

import type { VendorDetail, VendorPublicKey } from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  Input,
  Label,
  LoadingState,
  Mono,
  Textarea,
} from "@codevault/ui";

import { formatDate } from "../../lib/dates.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";

function groupedFingerprint(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.join(" ") ?? fingerprint;
}

function usable(key: VendorPublicKey, renderedAt: number): boolean {
  return (
    key.verifiedAt !== null &&
    key.revokedAt === null &&
    key.supersededById === null &&
    (key.expiresAt === null || Date.parse(key.expiresAt) > renderedAt)
  );
}

export function PublicKeyPanel({
  vendorId,
  onUseKey,
  canEdit = true,
}: {
  vendorId: string;
  onUseKey?: (keyId: string) => void;
  canEdit?: boolean;
}): React.JSX.Element {
  const vendor = useApiQuery<VendorDetail>(
    queryKeys.vendor(vendorId),
    `/v1/vendors/${vendorId}`,
  );
  const [showAdd, setShowAdd] = useState(false);
  const [armoredKey, setArmoredKey] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renderedAt] = useState(Date.now);
  const addKey = useApiMutation<VendorPublicKey>(
    () => ({
      path: `/v1/vendors/${vendorId}/public-keys`,
      body: {
        armoredKey,
        expectedFingerprint: fingerprint.replace(/[\s:]/g, ""),
        sourceUrl: sourceUrl.trim(),
      },
    }),
    () => [queryKeys.vendor(vendorId)],
  );

  if (vendor.isLoading) {
    return <LoadingState label="Loading public keys…" />;
  }

  const keys = vendor.data?.publicKeys ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-[11px] text-text-muted">
          A downloaded key is not trusted by itself. Compare its complete
          fingerprint through an independent channel before verification; this
          blocks a compromised website or network path from silently replacing
          the disclosure key.
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setShowAdd((current) => !current)}>
            <Plus aria-hidden className="size-3.5" />
            Add public key
          </Button>
        ) : null}
      </div>

      {showAdd ? (
        <Card>
          <CardBody className="space-y-2">
            <div>
              <Label htmlFor="vendor-armored-key">Armored public key</Label>
              <Textarea
                id="vendor-armored-key"
                rows={6}
                value={armoredKey}
                onChange={(event) => setArmoredKey(event.target.value)}
                className="mt-1 font-mono text-[11px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="vendor-key-fingerprint">
                  Expected fingerprint
                </Label>
                <Input
                  id="vendor-key-fingerprint"
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="vendor-key-source">Official HTTPS source</Label>
                <Input
                  id="vendor-key-source"
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                loading={addKey.isPending}
                disabled={
                  armoredKey.trim().length === 0 ||
                  !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(
                    fingerprint.replace(/[\s:]/g, ""),
                  ) ||
                  !sourceUrl.startsWith("https://")
                }
                onClick={() =>
                  addKey.mutate(undefined, {
                    onSuccess: () => {
                      setShowAdd(false);
                      setArmoredKey("");
                      setFingerprint("");
                      setSourceUrl("");
                      setError(null);
                    },
                    onError: (mutationError) => setError(mutationError.message),
                  })
                }
              >
                Parse and store key
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {error === null ? null : (
        <p className="text-[12px] text-danger">{error}</p>
      )}

      {keys.length === 0 ? (
        <div className="rounded-(--cv-radius) border border-dashed border-border p-3 text-[12px] text-text-muted">
          No public keys recorded. Required encryption remains unavailable.
        </div>
      ) : (
        keys.map((key) => (
          <PublicKeyRecord
            key={key.id}
            value={key}
            canEdit={canEdit}
            renderedAt={renderedAt}
            {...(onUseKey === undefined ? {} : { onUseKey })}
          />
        ))
      )}
    </div>
  );
}

function PublicKeyRecord({
  value: key,
  canEdit,
  renderedAt,
  onUseKey,
}: {
  value: VendorPublicKey;
  canEdit: boolean;
  renderedAt: number;
  onUseKey?: (keyId: string) => void;
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState("");
  const [verificationSource, setVerificationSource] = useState(key.sourceUrl);
  const [error, setError] = useState<string | null>(null);
  const expectedSuffix = key.fingerprint.slice(-8);
  const verify = useApiMutation<VendorPublicKey>(
    () => ({
      path: `/v1/vendors/${key.vendorId}/public-keys/${key.id}/verify`,
      body: {
        expectedFingerprint: key.fingerprint,
        sourceUrl: verificationSource.trim(),
        expectedRevision: key.revision,
      },
    }),
    () => [queryKeys.vendor(key.vendorId)],
  );
  const isUsable = usable(key, renderedAt);

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-center gap-2">
          {isUsable ? (
            <ShieldCheck aria-hidden className="size-4 text-success" />
          ) : (
            <ShieldX aria-hidden className="size-4 text-warning" />
          )}
          <span
            className={
              isUsable ? "text-[12px] text-success" : "text-[12px] text-warning"
            }
          >
            {key.verifiedAt === null ? "Not verified" : "Verified"}
          </span>
          <span className="text-[11px] text-text-muted">{key.algorithm}</span>
          {key.supersededById === null ? null : (
            <span className="text-[11px] text-danger">Superseded</span>
          )}
        </div>
        <Mono className="block break-all text-[12px] tracking-wide">
          {groupedFingerprint(key.fingerprint)}
        </Mono>
        <p className="text-[11px] text-text-muted">
          {key.userIds.join(" · ") || "No identity recorded"} · created{" "}
          {formatDate(key.createdAt)}
          {key.expiresAt === null
            ? ""
            : ` · expires ${formatDate(key.expiresAt)}`}
        </p>

        {key.verifiedAt === null && canEdit ? (
          <div className="grid grid-cols-[1fr_230px_auto] items-end gap-2 rounded-(--cv-radius) bg-surface-raised p-2">
            <div>
              <Label htmlFor={`key-source-${key.id}`}>
                Independent verification source
              </Label>
              <Input
                id={`key-source-${key.id}`}
                type="url"
                value={verificationSource}
                onChange={(event) => setVerificationSource(event.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`key-confirm-${key.id}`}>
                Last eight fingerprint characters
              </Label>
              <Input
                id={`key-confirm-${key.id}`}
                value={confirmation}
                maxLength={8}
                onChange={(event) =>
                  setConfirmation(event.target.value.toUpperCase())
                }
                className="mt-1 font-mono uppercase"
              />
            </div>
            <Button
              size="sm"
              loading={verify.isPending}
              disabled={
                confirmation !== expectedSuffix ||
                !verificationSource.startsWith("https://")
              }
              onClick={() =>
                verify.mutate(undefined, {
                  onError: (mutationError) => setError(mutationError.message),
                })
              }
            >
              Verify fingerprint
            </Button>
          </div>
        ) : null}

        {error === null ? null : (
          <p className="text-[11px] text-danger">{error}</p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!isUsable}
            onClick={() => onUseKey?.(key.id)}
          >
            <KeyRound aria-hidden className="size-3.5" />
            Use for encryption
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
