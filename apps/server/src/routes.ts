import type { AppInstance } from "./http/app-instance.js";

import { registerAiRoutes } from "./modules/ai/routes.js";
import { registerArchiveRoutes } from "./modules/archives/routes.js";
import { registerAssetRoutes } from "./modules/assets/routes.js";
import { registerAvatarRoutes } from "./modules/avatars/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerCaseRoutes } from "./modules/cases/routes.js";
import { registerDashboardRoutes } from "./modules/dashboard/routes.js";
import { registerDisclosureRoutes } from "./modules/disclosure/routes.js";
import { registerEventRoutes } from "./modules/events/routes.js";
import { registerEvidenceRoutes } from "./modules/evidence/routes.js";
import { registerPocRoutes } from "./modules/evidence/poc-routes.js";
import { registerFindingRoutes } from "./modules/findings/routes.js";
import { registerIntakeRoutes } from "./modules/intake/routes.js";
import { registerIntelligenceRoutes } from "./modules/intelligence/routes.js";
import { registerMetricsRoutes } from "./modules/metrics/routes.js";
import { registerNotificationRoutes } from "./modules/notifications/routes.js";
import { registerPriorArtRoutes } from "./modules/prior-art/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { registerRemediationRoutes } from "./modules/remediation/routes.js";
import { registerSearchRoutes } from "./modules/search/routes.js";
import { registerSubmissionRoutes } from "./modules/submissions/routes.js";
import { registerCorrespondenceRoutes } from "./modules/submissions/correspondence.js";
import { registerSubmissionLifecycleRoutes } from "./modules/submissions/lifecycle.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { registerOrganizationRoutes } from "./modules/organization/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerVendorRoutes } from "./modules/vendors/routes.js";
import { registerMailRoutes } from "./modules/mail/routes.js";
import { registerAssetRegistryRoutes } from "./modules/registries/routes.js";

/**
 * Route registration.
 *
 * One list, in one place. Anything not registered here does not exist, which
 * makes "what is the API surface?" a question with a short, checkable answer.
 *
 * There is deliberately no registration route. Accounts come from invitations.
 */

export async function registerRoutes(app: AppInstance): Promise<void> {
  await registerAuthRoutes(app);
  await registerUserRoutes(app);
  await app.register(registerAvatarRoutes);
  await registerOrganizationRoutes(app);
  await registerSettingsRoutes(app);
  await registerCaseRoutes(app);
  await registerArchiveRoutes(app);
  await registerAssetRoutes(app);
  await registerAssetRegistryRoutes(app);
  await registerVendorRoutes(app);
  await registerSubmissionRoutes(app);
  await registerCorrespondenceRoutes(app);
  await registerSubmissionLifecycleRoutes(app);
  await registerMailRoutes(app);
  await registerFindingRoutes(app);
  await registerIntakeRoutes(app);
  await registerIntelligenceRoutes(app);
  await registerRemediationRoutes(app);
  await registerEvidenceRoutes(app);
  await registerPocRoutes(app);
  await registerPriorArtRoutes(app);
  await registerReportRoutes(app);
  await registerDisclosureRoutes(app);
  await registerAiRoutes(app);
  await registerSearchRoutes(app);
  await registerDashboardRoutes(app);
  await registerMetricsRoutes(app);
  await registerNotificationRoutes(app);
  await registerEventRoutes(app);
}
