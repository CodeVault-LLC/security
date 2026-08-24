import type {
  AssetRegistryResult,
  AssetRegistrySource,
} from "@codevault/contracts";

export interface AssetRegistryProvider {
  readonly source: AssetRegistrySource;
  readonly label: string;
  search(query: string, limit: number): Promise<AssetRegistryResult[]>;
}

export interface RegistryHttpClient {
  getJson(url: URL): Promise<unknown>;
}

export class RegistryProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryProviderError";
  }
}
