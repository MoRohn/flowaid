# Changesets

Every pull request that changes what users run adds a changeset: `pnpm changeset`, pick the
packages, the bump (patch for fixes, minor for features while FlowAId is 0.x) and one or two
sentences written for the release notes.

The `@flowaid/*` packages form one fixed group, so the platform has a single version. Merging to
`main` opens (or updates) a "Version packages" pull request; merging that one tags `v<version>`,
publishes the images and creates the GitHub release. See [docs/operations/RELEASING.md](../docs/operations/RELEASING.md).
