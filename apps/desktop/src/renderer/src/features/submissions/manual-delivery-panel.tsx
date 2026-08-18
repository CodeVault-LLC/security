import { useState } from "react";

import type { SubmissionDetail } from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@codevault/ui";

export function ManualDeliveryPanel({
  submission,
  busy,
  onRecord,
}: {
  submission: SubmissionDetail;
  busy: boolean;
  onRecord: (input: {
    packageId: string;
    deliveredAt: string;
    destinationUrl: string;
    externalReference?: string;
  }) => void;
}): React.JSX.Element | null {
  const [externalReference, setExternalReference] = useState("");
  const route = submission.routeSnapshot.route;
  if (route.type !== "MANUAL") return null;

  const packageId = submission.latestPackage?.id ?? null;
  const eligible = submission.status === "SEALED" && packageId !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record portal delivery</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="break-all text-[12px] text-text-muted">
          CodeVault does not contact this portal. Upload the saved bundle
          yourself at {route.destinationUrl}, then record what happened.
        </p>
        <div>
          <Label htmlFor="vendor-reference">Vendor reference (optional)</Label>
          <Input
            id="vendor-reference"
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
            className="mt-1"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!eligible}
          loading={busy}
          onClick={() => {
            if (packageId === null) return;
            onRecord({
              packageId,
              deliveredAt: new Date().toISOString(),
              destinationUrl: route.destinationUrl,
              ...(externalReference.trim().length === 0
                ? {}
                : { externalReference: externalReference.trim() }),
            });
          }}
        >
          Record as submitted
        </Button>
      </CardBody>
    </Card>
  );
}
