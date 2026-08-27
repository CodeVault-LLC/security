import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
} from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/react-router";

import { AppShell } from "./components/app-shell.js";
import { AssetDetailRoute, AssetsRoute } from "./routes/assets.js";
import { CaseDetailRoute } from "./routes/case-detail.js";
import { CasesRoute } from "./routes/cases.js";
import { DashboardRoute } from "./routes/dashboard.js";
import { FindingDetailRoute } from "./routes/finding-detail.js";
import { FindingsRoute } from "./routes/findings.js";
import { MetricsRoute } from "./routes/metrics.js";
import { MailRoute } from "./routes/mail.js";
import { NotificationsRoute } from "./routes/notifications.js";
import {
  ActivityRoute,
  DisclosureIndexRoute,
  ReportsRoute,
} from "./routes/misc.js";
import { ReportDetailRoute } from "./routes/report-detail.js";
import {
  OrganizationSecurityRoute,
  OrganizationSettingsRoute,
  OrganizationUserDetailRoute,
  OrganizationUsersRoute,
} from "./routes/organization.js";
import {
  PersonalAiRoute,
  PersonalAppearanceRoute,
  PersonalMailRoute,
  PersonalProfileRoute,
  PersonalSecurityRoute,
} from "./routes/settings.js";
import { SubmissionDetailRoute } from "./routes/submission-detail.js";
import { VendorDetailRoute, VendorsRoute } from "./routes/vendors.js";

/**
 * Routing.
 *
 * A memory history rather than a browser history: the renderer is a window, not
 * a document, and there is no address bar for a URL to appear in. It also means
 * no navigation can be triggered by a link inside research content — the only
 * way to move is through the router.
 */

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardRoute,
});

const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cases",
  component: CasesRoute,
});

const caseDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cases/$caseId",
  component: function CaseDetailPage() {
    const { caseId } = useParams({ from: "/cases/$caseId" });

    return <CaseDetailRoute caseId={caseId} />;
  },
});

const findingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/findings",
  validateSearch: (search: Record<string, unknown>) => ({
    assetId: typeof search.assetId === "string" ? search.assetId : undefined,
    assetName:
      typeof search.assetName === "string" ? search.assetName : undefined,
  }),
  component: FindingsRoute,
});

const findingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/findings/$findingId",
  component: function FindingDetailPage() {
    const { findingId } = useParams({ from: "/findings/$findingId" });

    return <FindingDetailRoute findingId={findingId} />;
  },
});

const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets",
  validateSearch: (search: Record<string, unknown>) => ({
    vendorId: typeof search.vendorId === "string" ? search.vendorId : undefined,
    vendorName:
      typeof search.vendorName === "string" ? search.vendorName : undefined,
    create: search.create === true || search.create === "true",
  }),
  component: AssetsRoute,
});

const assetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/$assetId",
  component: function AssetDetailPage() {
    const { assetId } = useParams({ from: "/assets/$assetId" });

    return <AssetDetailRoute assetId={assetId} />;
  },
});

const vendorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vendors",
  component: VendorsRoute,
});

const vendorDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vendors/$vendorId",
  component: function VendorDetailPage() {
    const { vendorId } = useParams({ from: "/vendors/$vendorId" });

    return <VendorDetailRoute vendorId={vendorId} />;
  },
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsRoute,
});

const reportDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/$reportId",
  component: function ReportDetailPage() {
    const { reportId } = useParams({ from: "/reports/$reportId" });

    return <ReportDetailRoute reportId={reportId} />;
  },
});

const submissionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/submissions/$submissionId",
  validateSearch: (search: Record<string, unknown>) => ({
    messageId:
      typeof search.messageId === "string" ? search.messageId : undefined,
  }),
  component: function SubmissionDetailPage() {
    const { submissionId } = useParams({ from: "/submissions/$submissionId" });
    const { messageId } = submissionDetailRoute.useSearch();
    return (
      <SubmissionDetailRoute
        submissionId={submissionId}
        {...(messageId === undefined ? {} : { focusMessageId: messageId })}
      />
    );
  },
});

const disclosureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/disclosure",
  component: DisclosureIndexRoute,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityRoute,
});

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics",
  component: MetricsRoute,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationsRoute,
});

const mailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mail",
  validateSearch: (search: Record<string, unknown>) => ({
    folder:
      search.folder === "SENT" || search.folder === "TRACKED"
        ? search.folder
        : ("INBOX" as const),
    connectionId:
      typeof search.connectionId === "string" ? search.connectionId : undefined,
    threadId: typeof search.threadId === "string" ? search.threadId : undefined,
    submissionId:
      typeof search.submissionId === "string" ? search.submissionId : undefined,
  }),
  component: function MailPage() {
    return <MailRoute search={mailRoute.useSearch()} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});

const profileSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/profile",
  component: PersonalProfileRoute,
});

const appearanceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/appearance",
  component: PersonalAppearanceRoute,
});

const aiSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/ai",
  component: PersonalAiRoute,
});

const securitySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/security",
  component: PersonalSecurityRoute,
});

const mailSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/mail",
  component: PersonalMailRoute,
});

const organizationUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organization/users",
  component: OrganizationUsersRoute,
});
const organizationUserDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organization/users/$userId",
  component: function OrganizationUserDetailPage() {
    const { userId } = useParams({ from: "/organization/users/$userId" });
    return <OrganizationUserDetailRoute userId={userId} />;
  },
});
const organizationSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organization/settings",
  component: OrganizationSettingsRoute,
});
const organizationSecurityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organization/security",
  component: OrganizationSecurityRoute,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/account",
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  casesRoute,
  caseDetailRoute,
  findingsRoute,
  findingDetailRoute,
  assetsRoute,
  assetDetailRoute,
  vendorsRoute,
  vendorDetailRoute,
  reportsRoute,
  reportDetailRoute,
  submissionDetailRoute,
  disclosureRoute,
  activityRoute,
  metricsRoute,
  notificationsRoute,
  mailRoute,
  settingsRoute,
  profileSettingsRoute,
  appearanceSettingsRoute,
  aiSettingsRoute,
  securitySettingsRoute,
  mailSettingsRoute,
  accountRoute,
  organizationUsersRoute,
  organizationUserDetailRoute,
  organizationSettingsRoute,
  organizationSecurityRoute,
]);

export function createAppRouter(): ReturnType<typeof createRouter> {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    defaultPreload: "intent",
    // Cached routes render immediately; a spinner on a warm cache is a spinner
    // that costs a researcher a moment for nothing.
    defaultPendingMs: 250,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
