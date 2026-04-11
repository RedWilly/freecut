export interface NamedProvider {
  id: string;
}

export class ProviderRegistry<TProvider extends NamedProvider> {
  private readonly providers = new Map<string, TProvider>();

  constructor(
    providers: readonly TProvider[],
    private readonly defaultProviderId: string,
  ) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  get(id: string): TProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Unknown provider: ${id}`);
    }

    return provider;
  }

  getDefault(): TProvider {
    return this.get(this.defaultProviderId);
  }

  list(): readonly TProvider[] {
    return [...this.providers.values()];
  }
}
