import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
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
import {
  ActivityRoute,
  DisclosureIndexRoute,
  ReportsRoute,
  SettingsRoute,
} from "./routes/misc.js";
import { ReportDetailRoute } from "./routes/report-detail.js";

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

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/account",
  component: SettingsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  casesRoute,
  caseDetailRoute,
  findingsRoute,
  findingDetailRoute,
  assetsRoute,
  assetDetailRoute,
  reportsRoute,
  reportDetailRoute,
  disclosureRoute,
  activityRoute,
  metricsRoute,
  settingsRoute,
  accountRoute,
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
