# Remove the Alpha 7 evaluation workspace

The removal command deletes the Docker volumes for the project named `codevault-alpha7-evaluation`. The deleted database and artifacts cannot be recovered unless you made a separate backup.

1. Stop `bun run evaluation:start` with `Ctrl+C`.
2. Confirm that you do not need the synthetic cases or exported reports.
3. Run:

   ```sh
   bun run evaluation:remove
   ```

4. Confirm that Docker no longer lists the evaluation project:

   ```sh
   docker compose ls
   ```

The command does not delete the repository, `.env`, dependency cache, or desktop preferences. Remove those files separately only if your local security policy requires it.

