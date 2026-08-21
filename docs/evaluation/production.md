# Prepare a production deployment after evaluation

The Alpha 7 evaluation stack is not a production configuration. It uses known account credentials, loopback services, development storage keys, synthetic data, and unsigned desktop packages.

To prepare a production deployment:

1. Remove the evaluation workspace and its volumes.
2. Follow [Deploy CodeVault for production](../operations/self-hosted-production.md).
3. Generate every production secret with `bun run production:secrets`.
4. Create the first administrator with `bun run admin:create`.
5. Verify the release artifacts with [Release verification](../security/release-verification.md).
6. Record the server URL, desktop version, server version, API version, publisher, and build digests in the deployment change record.

Do not copy `.env`, evaluation credentials, database volumes, or object-storage volumes into the production deployment.

