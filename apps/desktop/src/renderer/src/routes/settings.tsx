import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type {
  GmailAuthorization,
  MailboxConnection,
  OrganizationUser,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { QueryError } from "../components/query-boundary.js";
import { useTheme } from "../hooks/use-theme.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { queryKeys, useApiMutation, useApiQuery } from "../lib/api.js";
import { useSession } from "../lib/session.js";

function SettingsNav(): React.JSX.Element {
  return (
    <nav aria-label="Personal settings" className="mb-4 flex gap-2 text-[12px]">
      <Link to="/settings/profile" className="text-accent hover:underline">
        Profile
      </Link>
      <Link to="/settings/appearance" className="text-accent hover:underline">
        Appearance
      </Link>
      <Link to="/settings/security" className="text-accent hover:underline">
        Security
      </Link>
      <Link to="/settings/mail" className="text-accent hover:underline">
        Mail
      </Link>
    </nav>
  );
}

function PersonalPage(props: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={props.title} />
      <PageBody>
        <SettingsNav />
        {props.children}
      </PageBody>
    </div>
  );
}

export function PersonalProfileRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const profile = useApiQuery<OrganizationUser>(
    ["organization", "users", user?.id],
    `/v1/organization/users/${user?.id ?? "00000000-0000-0000-0000-000000000000"}`,
    { enabled: user !== null },
  );
  const [draft, setDraft] = useState<string | null>(null);
  const displayName =
    draft ?? profile.data?.displayName ?? user?.displayName ?? "";
  const update = useApiMutation<{ displayName: string }>(
    () => ({
      path: "/v1/settings/profile",
      method: "PATCH",
      body: { displayName: displayName.trim() },
    }),
    () => [["organization", "users"]],
  );

  return (
    <PersonalPage title="Profile settings">
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
        </CardHeader>
        <CardBody className="max-w-lg space-y-4 text-[12px]">
          <Avatar
            avatarId={profile.data?.avatarId ?? null}
            label={displayName || "User"}
            target="USER"
          />
          <div>
            <Label htmlFor="personal-display-name">Display name</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="personal-display-name"
                value={displayName}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button
                variant="primary"
                disabled={displayName.trim().length < 2 || update.isPending}
                onClick={() => update.mutate()}
              >
                Save
              </Button>
            </div>
          </div>
          <p className="text-text-muted">
            {user?.email} · organization role: {user?.role}
          </p>
          {update.error ? (
            <p className="text-danger">{update.error.message}</p>
          ) : null}
        </CardBody>
      </Card>
    </PersonalPage>
  );
}

export function PersonalAppearanceRoute(): React.JSX.Element {
  const { preference, setPreference } = useTheme();
  return (
    <PersonalPage title="Appearance settings">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
        </CardHeader>
        <CardBody className="max-w-xs">
          <Label htmlFor="personal-theme">Theme</Label>
          <Select
            aria-label="Theme"
            value={preference}
            onValueChange={(value) =>
              setPreference(value as "dark" | "light" | "system")
            }
            className="mt-1"
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "Follow the system" },
            ]}
          />
        </CardBody>
      </Card>
    </PersonalPage>
  );
}

interface SessionItem {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

export function PersonalSecurityRoute(): React.JSX.Element {
  const signOut = useSession((state) => state.signOut);
  const sessions = useApiQuery<{ items: SessionItem[] }>(
    ["settings", "sessions"],
    "/v1/settings/sessions",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const changePassword = useApiMutation<{ ok: true }>(
    () => ({
      path: "/v1/settings/password",
      method: "POST",
      body: { currentPassword, newPassword },
    }),
    () => [["settings", "sessions"]],
  );
  const revoke = useApiMutation<{ ok: true }, string>(
    (id) => ({ path: `/v1/settings/sessions/${id}`, method: "DELETE" }),
    () => [["settings", "sessions"]],
  );

  return (
    <PersonalPage title="Security settings">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Multi-factor authentication</CardTitle>
          </CardHeader>
          <CardBody className="text-[12px]">
            <strong className="text-success">TOTP is required</strong>
            <p className="mt-1 text-text-muted">
              Authenticator codes protect every sign-in. TOTP is not
              phishing-resistant; verify the server address before entering a
              code and keep recovery codes offline.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardBody className="max-w-lg space-y-3 text-[12px]">
            <div>
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <Button
              variant="primary"
              disabled={currentPassword.length === 0 || newPassword.length < 12}
              onClick={() => changePassword.mutate()}
            >
              Change password
            </Button>
            <p className="text-text-muted">
              This sensitive action requires a recent authenticator verification
              and revokes every other session.
            </p>
            {changePassword.error ? (
              <p className="text-danger">{changePassword.error.message}</p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[12px]">
            {sessions.data?.items.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded border border-border p-2"
              >
                <div className="min-w-0 flex-1">
                  <strong>
                    {session.current ? "Current session" : "Session"}
                  </strong>
                  <p className="truncate text-text-muted">
                    {session.userAgent ?? "Unknown client"} · created{" "}
                    {formatDateTime(session.createdAt)}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => revoke.mutate(session.id)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              variant="danger"
              onClick={() => {
                void bridge()
                  .auth.logout()
                  .then(() => signOut());
              }}
            >
              Sign out
            </Button>
          </CardBody>
        </Card>
      </div>
    </PersonalPage>
  );
}

export function PersonalMailRoute(): React.JSX.Element {
  const [trackReplies, setTrackReplies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mailConnections = useApiQuery<{ items: MailboxConnection[] }>(
    queryKeys.mailConnections,
    "/v1/mail/connections",
  );
  const connectGmail = useApiMutation<
    GmailAuthorization,
    { enableReplyTracking: boolean }
  >(
    (body) => ({ path: "/v1/mail/gmail/connect", method: "POST", body }),
    () => [queryKeys.mailConnections],
  );
  const disconnectMailbox = useApiMutation<null, { id: string }>(
    ({ id }) => ({ path: `/v1/mail/connections/${id}`, method: "DELETE" }),
    () => [queryKeys.mailConnections],
  );

  return (
    <PersonalPage title="Mail settings">
      <Card>
        <CardHeader>
          <CardTitle>Gmail delivery</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <p className="text-text-muted">
            Connect your own mailbox for reviewed vendor submissions. CodeVault
            never receives your Google password. Reply tracking is optional and
            requests broader read-only mailbox permission; unrelated message
            bodies are never fetched.
          </p>
          <QueryError query={mailConnections} />
          {mailConnections.data?.items.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center gap-3 rounded-(--cv-radius) border border-border p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{connection.emailAddress}</p>
                <p className="text-text-muted">
                  {connection.capabilities.includes("TRACK_REPLIES")
                    ? "Send · Track replies"
                    : "Send only"}
                  {` · ${connection.status.toLowerCase().replaceAll("_", " ")}`}
                </p>
                {connection.lastSuccessfulSyncAt === null ? null : (
                  <p className="text-text-muted">
                    Last sync {formatDateTime(connection.lastSuccessfulSyncAt)}
                  </p>
                )}
                {connection.watchExpiresAt === null ? null : (
                  <p className="text-text-muted">
                    Watch expires {formatDateTime(connection.watchExpiresAt)}
                  </p>
                )}
                {connection.errorCategory === null ? null : (
                  <p className="text-warning">
                    Needs attention: {connection.errorCategory}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                disabled={disconnectMailbox.isPending}
                onClick={() =>
                  disconnectMailbox.mutate(
                    { id: connection.id },
                    {
                      onError: (mutationError) =>
                        setError(mutationError.message),
                    },
                  )
                }
              >
                Disconnect
              </Button>
            </div>
          ))}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={trackReplies}
              onChange={(event) => setTrackReplies(event.target.checked)}
            />
            <span>
              Track replies to CodeVault-created threads
              <span className="block text-text-muted">
                Requests Google&rsquo;s restricted Gmail read-only scope. Enable
                only when your organization has approved it.
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={connectGmail.isPending}
              onClick={() =>
                connectGmail.mutate(
                  { enableReplyTracking: trackReplies },
                  {
                    onSuccess: (authorization) =>
                      void bridge().app.openExternal(
                        authorization.authorizationUrl,
                      ),
                    onError: (mutationError) => setError(mutationError.message),
                  },
                )
              }
            >
              Connect Gmail
            </Button>
            <Button
              variant="secondary"
              onClick={() => void mailConnections.refetch()}
            >
              Refresh status
            </Button>
          </div>
          {error === null ? null : <p className="text-danger">{error}</p>}
        </CardBody>
      </Card>
    </PersonalPage>
  );
}
