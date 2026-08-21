# Evaluate Alpha 7

This tutorial starts a disposable CodeVault workspace, signs you in with local credentials, and produces a PDF from synthetic research data.

## Before you start

Install Bun 1.3, Node.js 24, Docker, and the project dependencies. Keep the evaluation stack on one workstation. The setup command refuses a remote database and production mode.

The evaluation account is public test data:

- Email: `evaluator@codevault.local`
- Password: `CodeVault-Evaluation-2026!`
- Authenticator secret: `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`

Never use these values outside the disposable evaluation stack.

## Start the workspace

1. Copy `.env.example` to `.env` if `.env` does not exist.
2. Set `MFA_ENCRYPTION_KEYS` in `.env` to a local development key.
3. Run the evaluation bundle:

   ```sh
   bun run evaluation:start
   ```

The command starts PostgreSQL and object storage, applies migrations, creates the evaluator account, loads the synthetic case, and opens the desktop application. The terminal prints the current six-digit MFA code.

## Sign in

1. Keep **Server** set to `http://127.0.0.1:4310`.
2. Wait for the compatibility check to show Server `0.1.0-alpha.7` and API `v1`.
3. Enter the evaluation email and password.
4. Click **Continue**.
5. Enter the current MFA code.

If the code expires, run:

```sh
bun run evaluation:code
```

## Export the sample report

Home shows the five-step **Alpha 7 evaluation** checklist. Open each linked record and mark the step complete after you inspect it. The last two steps open the approved internal report.

Click **Export PDF**. The export appears in the report header while the worker renders it. When the status changes to **Completed**, click **Download** and compare the displayed SHA-256 prefix with the downloaded artifact.

The sample data names invalid domains and synthetic parties. Do not send a disclosure from this workspace.

## Stop or remove the workspace

Press `Ctrl+C` to stop the application processes. The Docker volumes remain so you can continue later.

To delete the evaluation data, follow [Remove the Alpha 7 evaluation workspace](removal.md).

