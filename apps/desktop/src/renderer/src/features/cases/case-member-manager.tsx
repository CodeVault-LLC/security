import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";

import type {
  CaseCapability,
  CaseDetail,
  CaseMember,
  UserSummary,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Label,
} from "@codevault/ui";

import { Avatar } from "../../components/avatar.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../../lib/api.js";

const ACTION_CAPABILITIES = ["WRITE", "APPROVAL", "DISCLOSURE"] as const;

export function CaseMemberManager({
  researchCase,
  canManage,
}: {
  researchCase: CaseDetail;
  canManage: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState<CaseMember | null>(null);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [capabilities, setCapabilities] = useState<Set<CaseCapability>>(
    new Set(["READ"]),
  );
  const users = useApiQuery<{ items: UserSummary[] }>(
    queryKeys.users,
    "/v1/users",
    { enabled: canManage },
  );
  const save = useApiMutation<CaseDetail, void>(
    () => ({
      path: `/v1/cases/${researchCase.id}/members`,
      method: "POST",
      body: { userId, capabilities: [...capabilities] },
    }),
    () => [queryKeys.case(researchCase.id), queryKeys.cases()],
  );
  const remove = useApiMutation<{ ok: true }, string>(
    (memberUserId) => ({
      path: `/v1/cases/${researchCase.id}/members/${memberUserId}`,
      method: "DELETE",
    }),
    () => [queryKeys.case(researchCase.id), queryKeys.cases()],
  );
  const existing = new Set(
    researchCase.members.map((member) => member.user.id),
  );
  const availableUsers = (users.data?.items ?? []).filter(
    (candidate) =>
      !candidate.disabled &&
      candidate.id !== researchCase.owner.id &&
      (candidate.id === editing?.user.id || !existing.has(candidate.id)),
  );

  const beginAdd = (): void => {
    setEditing(null);
    setUserId("");
    setCapabilities(new Set(["READ"]));
    save.reset();
    setOpen(true);
  };
  const beginEdit = (member: CaseMember): void => {
    setEditing(member);
    setUserId(member.user.id);
    setCapabilities(new Set(member.capabilities));
    save.reset();
    setOpen(true);
  };
  const toggle = (capability: CaseCapability, checked: boolean): void => {
    setCapabilities((current) => {
      const next = new Set(current);
      if (checked) next.add(capability);
      else next.delete(capability);
      return next;
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={beginAdd}>
              <UserPlus aria-hidden className="size-3.5" />
              Add member
            </Button>
          ) : null}
        </CardHeader>
        <CardBody className="border-b border-border text-[11px] text-text-muted">
          Owner: {researchCase.owner.displayName}. Every other person needs an
          explicit read grant; action capabilities are independent.
        </CardBody>
        {researchCase.members.length === 0 ? (
          <CardBody className="text-[12px] text-text-muted">
            Only the owner can see this case.
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {researchCase.members.map((member) => (
              <li
                key={member.user.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
              >
                <Avatar
                  avatarId={null}
                  userId={member.user.id}
                  label={member.user.displayName}
                  size="sm"
                  showLabel
                  className="min-w-0 flex-1 gap-1.5"
                />
                <span className="text-[10px] uppercase text-text-muted">
                  {member.capabilities
                    .map((capability) => capability.toLowerCase())
                    .join(" · ")}
                </span>
                {canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit access for ${member.user.displayName}`}
                      onClick={() => beginEdit(member)}
                    >
                      <Pencil aria-hidden className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${member.user.displayName}`}
                      loading={remove.isPending}
                      onClick={() => remove.mutate(member.user.id)}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={editing === null ? "Add case member" : "Edit case access"}
          description="Read is required. Write, approval, and disclosure can be granted independently."
        >
          <DialogBody className="space-y-3">
            <div>
              <Label htmlFor="case-member-user">Member</Label>
              <select
                id="case-member-user"
                value={userId}
                disabled={editing !== null}
                className="mt-1 h-9 w-full rounded-(--cv-radius) border border-border bg-surface px-2 text-[12px]"
                onChange={(event) => setUserId(event.target.value)}
              >
                <option value="">Select a member</option>
                {availableUsers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName} ({candidate.email})
                  </option>
                ))}
              </select>
            </div>

            <CapabilityOption capability="READ" checked disabled />
            {ACTION_CAPABILITIES.map((capability) => (
              <CapabilityOption
                key={capability}
                capability={capability}
                checked={capabilities.has(capability)}
                onChange={(checked) => toggle(capability, checked)}
              />
            ))}

            {save.error === null ? null : (
              <p className="rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                {errorHeading(save.error)}. {save.error.message}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={userId.length === 0}
              loading={save.isPending}
              onClick={() =>
                save.mutate(undefined, { onSuccess: () => setOpen(false) })
              }
            >
              Save access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CapabilityOption({
  capability,
  checked,
  disabled = false,
  onChange,
}: {
  capability: CaseCapability;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 rounded-(--cv-radius) border border-border px-2.5 py-2 text-[12px]">
      <input
        type="checkbox"
        aria-label={capability[0] + capability.slice(1).toLowerCase()}
        checked={checked}
        disabled={disabled}
        className="mt-0.5 size-3.5 accent-accent"
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span>
        <span className="block font-medium capitalize">
          {capability.toLowerCase()}
        </span>
        <span className="block text-text-muted">
          {capability === "READ"
            ? "See the case and its research records."
            : capability === "WRITE"
              ? "Create and edit research content."
              : capability === "APPROVAL"
                ? "Approve scores, reports, and submissions."
                : "Change disclosure commitments and deliver submissions."}
        </span>
      </span>
    </label>
  );
}
