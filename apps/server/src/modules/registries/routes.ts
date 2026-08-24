import {
  AssetRegistrySearchQuery,
  AssetRegistrySearchResponse,
} from "@codevault/contracts";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser } from "../../http/guards.js";

export async function registerAssetRegistryRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/asset-registries/search",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        querystring: AssetRegistrySearchQuery,
        response: { 200: AssetRegistrySearchResponse },
      },
    },
    async (request) => {
      actingUser(request);

      return app.assetRegistry.search({
        query: request.query.query.trim(),
        ...(request.query.source === undefined
          ? {}
          : { source: request.query.source }),
        limit: request.query.limit ?? 30,
      });
    },
  );
}
