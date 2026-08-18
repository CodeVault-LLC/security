import type { MailProvider } from "./provider.js";

export class MailProviderRegistry {
  readonly #providers = new Map<string, MailProvider>();

  register(provider: MailProvider): void {
    if (this.#providers.has(provider.id)) {
      throw new Error(`Mail provider ${provider.id} is already registered.`);
    }
    this.#providers.set(provider.id, provider);
  }

  get(id: string): MailProvider | null {
    return this.#providers.get(id) ?? null;
  }

  require(id: string): MailProvider {
    const provider = this.get(id);
    if (provider === null) {
      throw new Error(`Mail provider ${id} is disabled or unavailable.`);
    }
    return provider;
  }
}
