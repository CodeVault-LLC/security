import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  SUBMISSION_FIELD_KEYS,
  type ManualFieldMapping,
  type SubmissionFieldKey,
  type VendorDetail,
  type VendorRoute,
} from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
  Textarea,
} from "@codevault/ui";

import { humanise } from "../../lib/format.js";
import { queryKeys, useApiMutation } from "../../lib/api.js";

const DEFAULT_MANUAL_FIELD: ManualFieldMapping = {
  key: "description",
  label: "Description",
  required: true,
  format: "MULTILINE_TEXT",
  submissionField: "reproduction",
  helpText: null,
};

export function RouteEditor({
  vendor,
  route,
  open,
  onOpenChange,
}: {
  vendor: VendorDetail;
  route?: VendorRoute;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const initialType = route?.type ?? "EMAIL";
  const [type, setType] = useState<"EMAIL" | "MANUAL">(initialType);
  const [name, setName] = useState(route?.name ?? "");
  const [ackDays, setAckDays] = useState(
    String(route?.acknowledgementBusinessDays ?? 5),
  );
  const [cadenceDays, setCadenceDays] = useState(
    route?.updateCadenceDays === null || route === undefined
      ? ""
      : String(route.updateCadenceDays),
  );
  const [sourceUrl, setSourceUrl] = useState(route?.sourceUrl ?? "");
  const [to, setTo] = useState(
    route?.type === "EMAIL" ? route.to.join(", ") : "",
  );
  const [cc, setCc] = useState(
    route?.type === "EMAIL" ? route.cc.join(", ") : "",
  );
  const [subject, setSubject] = useState(
    route?.type === "EMAIL"
      ? route.subjectTemplate
      : "Security report: {caseRef}",
  );
  const [encryptionPolicy, setEncryptionPolicy] = useState<
    "FORBIDDEN" | "OPTIONAL" | "REQUIRED"
  >(route?.type === "EMAIL" ? route.encryptionPolicy : "OPTIONAL");
  const [publicKeyId, setPublicKeyId] = useState(
    route?.type === "EMAIL" ? (route.publicKeyId ?? "") : "",
  );
  const [attachmentMb, setAttachmentMb] = useState(
    String(
      route?.type === "EMAIL"
        ? Math.floor(route.maximumAttachmentBytes / 1024 / 1024)
        : 20,
    ),
  );
  const [requiredFields, setRequiredFields] = useState<SubmissionFieldKey[]>(
    route?.type === "EMAIL" ? route.requiredFields : [],
  );
  const [destinationUrl, setDestinationUrl] = useState(
    route?.type === "MANUAL" ? route.destinationUrl : "",
  );
  const [manualFields, setManualFields] = useState<ManualFieldMapping[]>(
    route?.type === "MANUAL" ? route.fieldMappings : [DEFAULT_MANUAL_FIELD],
  );
  const [extensions, setExtensions] = useState(
    route?.type === "MANUAL"
      ? route.acceptedExtensions.join(", ")
      : ".txt, .md, .pdf, .png, .zip",
  );
  const [maximumFileMb, setMaximumFileMb] = useState(
    String(
      route?.type === "MANUAL"
        ? Math.floor(route.maximumFileBytes / 1024 / 1024)
        : 100,
    ),
  );
  const [maximumFileCount, setMaximumFileCount] = useState(
    String(route?.type === "MANUAL" ? route.maximumFileCount : 20),
  );
  const [instructions, setInstructions] = useState(
    route?.type === "MANUAL" ? (route.instructions ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [renderedAt] = useState(Date.now);

  const save = useApiMutation<VendorRoute>(
    () => {
      const common = {
        name: name.trim(),
        acknowledgementBusinessDays: Number(ackDays),
        updateCadenceDays:
          cadenceDays.trim().length === 0 ? null : Number(cadenceDays),
        sourceUrl: sourceUrl.trim().length === 0 ? null : sourceUrl.trim(),
        sourceReviewedAt:
          sourceUrl.trim().length === 0 ? null : new Date().toISOString(),
      };
      const body =
        type === "EMAIL"
          ? {
              ...common,
              ...(route === undefined ? { type: "EMAIL" as const } : {}),
              to: splitList(to),
              cc: splitList(cc),
              subjectTemplate: subject,
              encryptionPolicy,
              publicKeyId: publicKeyId.length === 0 ? null : publicKeyId,
              maximumAttachmentBytes: Number(attachmentMb) * 1024 * 1024,
              requiredFields,
            }
          : {
              ...common,
              ...(route === undefined ? { type: "MANUAL" as const } : {}),
              destinationUrl: destinationUrl.trim(),
              fieldMappings: manualFields,
              acceptedExtensions: splitList(extensions).map((value) =>
                value.startsWith(".")
                  ? value.toLowerCase()
                  : `.${value.toLowerCase()}`,
              ),
              maximumFileBytes: Number(maximumFileMb) * 1024 * 1024,
              maximumFileCount: Number(maximumFileCount),
              instructions:
                instructions.trim().length === 0 ? null : instructions.trim(),
            };

      return route === undefined
        ? {
            path: `/v1/vendors/${vendor.id}/routes`,
            body,
          }
        : {
            path: `/v1/vendor-routes/${route.id}`,
            method: "PATCH" as const,
            body: { ...body, expectedRevision: route.revision },
          };
    },
    () => [queryKeys.vendor(vendor.id), queryKeys.vendors()],
  );

  const verifiedKeys = vendor.publicKeys.filter(
    (key) =>
      key.verifiedAt !== null &&
      key.revokedAt === null &&
      key.supersededById === null &&
      (key.expiresAt === null || Date.parse(key.expiresAt) > renderedAt),
  );
  const valid =
    name.trim().length > 0 &&
    Number(ackDays) >= 1 &&
    (type === "EMAIL"
      ? splitList(to).length > 0 &&
        !/[\r\n]/.test(subject) &&
        (encryptionPolicy !== "REQUIRED" || publicKeyId.length > 0)
      : destinationUrl.startsWith("https://") && manualFields.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          route === undefined ? "New disclosure route" : "Edit disclosure route"
        }
        description="Store instructions and provenance. Manual routes prepare a package; they never automate a third-party portal."
        className="max-w-3xl"
      >
        <DialogBody className="max-h-[70vh] space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
            <div>
              <Label htmlFor="route-name">Route name</Label>
              <Input
                id="route-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Type</Label>
              <div
                role="group"
                aria-label="Disclosure route type"
                className="mt-1 grid grid-cols-2 rounded-(--cv-radius) border border-border bg-surface-raised p-0.5"
              >
                <Button
                  type="button"
                  variant={type === "EMAIL" ? "primary" : "ghost"}
                  disabled={route !== undefined}
                  aria-pressed={type === "EMAIL"}
                  onClick={() => setType("EMAIL")}
                >
                  Email
                </Button>
                <Button
                  type="button"
                  variant={type === "MANUAL" ? "primary" : "ghost"}
                  disabled={route !== undefined}
                  aria-pressed={type === "MANUAL"}
                  onClick={() => setType("MANUAL")}
                >
                  Manual portal
                </Button>
              </div>
            </div>
          </div>

          {type === "EMAIL" ? (
            <EmailFields
              to={to}
              setTo={setTo}
              cc={cc}
              setCc={setCc}
              subject={subject}
              setSubject={setSubject}
              encryptionPolicy={encryptionPolicy}
              setEncryptionPolicy={setEncryptionPolicy}
              publicKeyId={publicKeyId}
              setPublicKeyId={setPublicKeyId}
              attachmentMb={attachmentMb}
              setAttachmentMb={setAttachmentMb}
              requiredFields={requiredFields}
              setRequiredFields={setRequiredFields}
              verifiedKeys={verifiedKeys}
            />
          ) : (
            <ManualFields
              destinationUrl={destinationUrl}
              setDestinationUrl={setDestinationUrl}
              fields={manualFields}
              setFields={setManualFields}
              extensions={extensions}
              setExtensions={setExtensions}
              maximumFileMb={maximumFileMb}
              setMaximumFileMb={setMaximumFileMb}
              maximumFileCount={maximumFileCount}
              setMaximumFileCount={setMaximumFileCount}
              instructions={instructions}
              setInstructions={setInstructions}
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="route-ack">Acknowledgement (business days)</Label>
              <Input
                id="route-ack"
                type="number"
                min={1}
                max={90}
                value={ackDays}
                onChange={(event) => setAckDays(event.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="route-cadence">Update cadence (days)</Label>
              <Input
                id="route-cadence"
                type="number"
                min={1}
                max={365}
                value={cadenceDays}
                onChange={(event) => setCadenceDays(event.target.value)}
                placeholder="No fixed cadence"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="route-source">Official HTTPS source</Label>
              <Input
                id="route-source"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => onOpenChange(false),
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Save route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

interface EmailFieldsProps {
  to: string;
  setTo: (value: string) => void;
  cc: string;
  setCc: (value: string) => void;
  subject: string;
  setSubject: (value: string) => void;
  encryptionPolicy: "FORBIDDEN" | "OPTIONAL" | "REQUIRED";
  setEncryptionPolicy: (value: "FORBIDDEN" | "OPTIONAL" | "REQUIRED") => void;
  publicKeyId: string;
  setPublicKeyId: (value: string) => void;
  attachmentMb: string;
  setAttachmentMb: (value: string) => void;
  requiredFields: SubmissionFieldKey[];
  setRequiredFields: (value: SubmissionFieldKey[]) => void;
  verifiedKeys: VendorDetail["publicKeys"];
}

function EmailFields(props: EmailFieldsProps): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-(--cv-radius) border border-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="route-to">To (comma-separated)</Label>
          <Input
            id="route-to"
            value={props.to}
            onChange={(event) => props.setTo(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="route-cc">CC (comma-separated)</Label>
          <Input
            id="route-cc"
            value={props.cc}
            onChange={(event) => props.setCc(event.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="route-subject">Subject pattern</Label>
        <Input
          id="route-subject"
          value={props.subject}
          onChange={(event) => props.setSubject(event.target.value)}
          className="mt-1"
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Email subjects are never encrypted. Avoid vulnerability details; use a
          case reference.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="route-encryption">Encryption policy</Label>
          <select
            id="route-encryption"
            className="mt-1 h-10 w-full rounded-(--cv-radius) border border-border bg-surface px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            value={props.encryptionPolicy}
            onChange={(event) =>
              props.setEncryptionPolicy(
                event.target.value as EmailFieldsProps["encryptionPolicy"],
              )
            }
          >
            <option value="FORBIDDEN">Forbidden</option>
            <option value="OPTIONAL">Optional</option>
            <option value="REQUIRED">Required</option>
          </select>
        </div>
        <div>
          <Label htmlFor="route-key">Verified public key</Label>
          <select
            id="route-key"
            className="mt-1 h-10 w-full rounded-(--cv-radius) border border-border bg-surface px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            value={props.publicKeyId}
            onChange={(event) => props.setPublicKeyId(event.target.value)}
          >
            <option value="">No key selected</option>
            {props.verifiedKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.fingerprint.slice(-16)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="route-attachment-size">Attachment limit (MiB)</Label>
          <Input
            id="route-attachment-size"
            type="number"
            min={0}
            max={25}
            value={props.attachmentMb}
            onChange={(event) => props.setAttachmentMb(event.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <fieldset>
        <legend className="text-[12px] font-medium">
          Required report fields
        </legend>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
          {SUBMISSION_FIELD_KEYS.map((field) => (
            <label
              key={field}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <input
                type="checkbox"
                checked={props.requiredFields.includes(field)}
                onChange={(event) =>
                  props.setRequiredFields(
                    event.target.checked
                      ? [...props.requiredFields, field]
                      : props.requiredFields.filter((value) => value !== field),
                  )
                }
              />
              {humanise(field)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

interface ManualFieldsProps {
  destinationUrl: string;
  setDestinationUrl: (value: string) => void;
  fields: ManualFieldMapping[];
  setFields: (value: ManualFieldMapping[]) => void;
  extensions: string;
  setExtensions: (value: string) => void;
  maximumFileMb: string;
  setMaximumFileMb: (value: string) => void;
  maximumFileCount: string;
  setMaximumFileCount: (value: string) => void;
  instructions: string;
  setInstructions: (value: string) => void;
}

function ManualFields(props: ManualFieldsProps): React.JSX.Element {
  const update = (index: number, patch: Partial<ManualFieldMapping>): void =>
    props.setFields(
      props.fields.map((field, current) =>
        current === index ? { ...field, ...patch } : field,
      ),
    );
  const move = (index: number, offset: -1 | 1): void => {
    const next = [...props.fields];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    props.setFields(next);
  };
  return (
    <div className="space-y-3 rounded-(--cv-radius) border border-border p-3">
      <div>
        <Label htmlFor="route-destination">Official portal URL</Label>
        <Input
          id="route-destination"
          type="url"
          value={props.destinationUrl}
          onChange={(event) => props.setDestinationUrl(event.target.value)}
          className="mt-1"
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>Ordered portal fields</Label>
          <Button
            size="sm"
            onClick={() =>
              props.setFields([
                ...props.fields,
                {
                  ...DEFAULT_MANUAL_FIELD,
                  key: `field_${props.fields.length + 1}`,
                  label: `Field ${props.fields.length + 1}`,
                },
              ])
            }
          >
            <Plus aria-hidden className="size-3" />
            Add field
          </Button>
        </div>
        {props.fields.map((field, index) => (
          <div
            key={`${field.key}-${index}`}
            className="grid grid-cols-1 gap-2 border-b border-border pb-3 sm:grid-cols-[1fr_1fr_130px_auto] sm:border-0 sm:pb-0"
          >
            <Input
              aria-label={`Field ${index + 1} key`}
              value={field.key}
              onChange={(event) =>
                update(index, {
                  key: event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "_"),
                })
              }
            />
            <Input
              aria-label={`Field ${index + 1} label`}
              value={field.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <select
              aria-label={`Field ${index + 1} source`}
              className="h-10 rounded-(--cv-radius) border border-border bg-surface px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              value={field.submissionField ?? ""}
              onChange={(event) =>
                update(index, {
                  submissionField:
                    event.target.value.length === 0
                      ? null
                      : (event.target.value as SubmissionFieldKey),
                })
              }
            >
              <option value="">No mapping</option>
              {SUBMISSION_FIELD_KEYS.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </select>
            <div className="flex">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move field ${index + 1} up`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Move field ${index + 1} down`}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove field ${index + 1}`}
                onClick={() =>
                  props.setFields(
                    props.fields.filter((_, current) => current !== index),
                  )
                }
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="route-extensions">Accepted extensions</Label>
          <Input
            id="route-extensions"
            value={props.extensions}
            onChange={(event) => props.setExtensions(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="route-file-size">File limit (MiB)</Label>
          <Input
            id="route-file-size"
            type="number"
            min={0}
            max={250}
            value={props.maximumFileMb}
            onChange={(event) => props.setMaximumFileMb(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="route-file-count">Maximum file count</Label>
          <Input
            id="route-file-count"
            type="number"
            min={0}
            max={100}
            value={props.maximumFileCount}
            onChange={(event) => props.setMaximumFileCount(event.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="route-instructions">
          Copy, upload, and download instructions
        </Label>
        <Textarea
          id="route-instructions"
          rows={3}
          value={props.instructions}
          onChange={(event) => props.setInstructions(event.target.value)}
          className="mt-1"
        />
      </div>
    </div>
  );
}
