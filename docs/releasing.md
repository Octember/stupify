# Releasing

Stupify publishes the CLI package from GitHub Releases with npm Trusted
Publishing. The release workflow does not use a long-lived npm token.

## One-time npm setup

Configure `@stupify/cli` on npm with a trusted publisher:

```text
Publisher: GitHub Actions
Organization or user: Octember
Repository: stupif.ai
Workflow filename: release.yml
Environment: npm
```

Keep token publishing disabled for the package unless a break-glass manual
release is needed.

## Cut a release

1. Update `packages/cli/package.json` and `packages/cli/src/constants.ts` to the
   same version.
2. Run the local checks:

   ```sh
   bun install --frozen-lockfile
   bun run typecheck:cli
   bun test packages/cli/test
   bun run smoke:cli
   npm pack --dry-run --json --workspace @stupify/cli
   ```

3. Commit the version bump.
4. Create and publish a GitHub Release tagged `@stupify/cli@<version>`.
5. Approve the `npm` deployment environment if GitHub requests it.

The workflow verifies the GitHub Release tag matches the package version,
checks that the version does not already exist on npm, runs the CLI checks,
performs a dry-run pack, and publishes `@stupify/cli` with npm provenance.

## Failed releases

If the workflow fails before `npm publish`, fix the issue and rerun it. If npm
publish succeeds but a later step fails, do not overwrite the version. Cut a new
patch version instead.
