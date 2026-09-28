# Releasing FlowAId

A release is a version of the platform (every `@flowaid/*` package shares it), a `v<version>` tag,
three container images and a GitHub release. It is automated by
[`.github/workflows/release.yml`](../.github/workflows/release.yml) and
[changesets](https://github.com/changesets/changesets); nothing is published to npm (the packages
are private).

## Day to day: add a changeset

Every pull request that changes what users run carries a changeset:

```sh
pnpm changeset
```

Pick the packages you changed, the bump, and write one or two sentences for the release notes
(they are read by operators, so say what changed for them). While FlowAId is 0.x, features are
`minor` and fixes are `patch`; a breaking change is `minor` and says so in its first words.

The `@flowaid/*` packages are one fixed group, so any bump moves them all to the same version.
Contract changes follow [RFCS.md](design/RFCS.md) and add a `minor` changeset for
`@flowaid/workflow-core` instead of editing its version by hand.

## Cutting a release

1. Merging to `main` runs the **Release** workflow. While changesets are pending it opens (or
   updates) the **Version packages** pull request, created by `pnpm version-packages`:
   - `changeset version` bumps every package and writes each package's `CHANGELOG.md`;
   - `scripts/release-version.ts` keeps the versions that code pins in step (codegen's
     `PACKAGE_VERSIONS`, the node SDK version plugins are checked against, the bundled node
     packages' own versions, `CLI_VERSION`) and adds a `## <version>` section to the root
     [CHANGELOG.md](../CHANGELOG.md);
   - the node package manifests are regenerated.
2. Review that pull request like any other (CI runs on it when `RELEASE_TOKEN` is set, see
   below) and merge it.
3. The workflow sees no pending changesets and no `v<version>` tag, tags the merge commit,
   builds the images for `linux/amd64` and `linux/arm64`, pushes them with SBOMs and provenance,
   attests them, and creates the GitHub release with the CHANGELOG section as its notes.

A tag pushed by hand (`git tag -a v0.4.1 -m "FlowAId 0.4.1" && git push origin v0.4.1`) publishes
that commit the same way; use it to re-run a release whose image build failed. A version with a
hyphen (`0.5.0-rc.1`) is published as a pre-release and does not move `latest` or `0.5`.

To try the versioning locally without committing: `pnpm version-packages`, inspect the diff,
then discard it.

## Images

| Image                           | Built from (`docker/Dockerfile` target) |
| ------------------------------- | --------------------------------------- |
| `ghcr.io/morohn/flowaid-api`    | `api`                                   |
| `ghcr.io/morohn/flowaid-worker` | `worker` (also the `worker-code` host)  |
| `ghcr.io/morohn/flowaid-web`    | `web`                                   |

Tags: `<version>` (for example `0.4.0`), `<major>.<minor>` and `latest` for final releases, and
`sha-<commit>` for every build. Deploy a version, not `latest`, and pin its digest for
reproducible rollouts.

Run them with Docker Compose through the overlay that swaps only where the app images come from:

```sh
FLOWAID_IMAGE_TAG=0.4.0 docker compose -f docker/compose.yml -f docker/compose.images.yml up -d
```

`FLOWAID_IMAGE_REGISTRY` points the overlay at a mirror (default `ghcr.io/morohn`).

The web image has no URL baked in: the web app forwards `/v1`, `/hooks` and `/mcp` to
`FLOWAID_API_INTERNAL_URL` at request time, so one image serves every deployment.

## Verifying an image

Each image carries a build provenance attestation (SLSA, signed by GitHub's Sigstore instance)
and an SPDX SBOM:

```sh
gh attestation verify oci://ghcr.io/morohn/flowaid-api:0.4.0 --owner MoRohn
docker buildx imagetools inspect ghcr.io/morohn/flowaid-api:0.4.0 --format '{{ json .Provenance }}'
docker buildx imagetools inspect ghcr.io/morohn/flowaid-api:0.4.0 --format '{{ json .SBOM }}'
```

The OCI labels record the version, the commit (`org.opencontainers.image.revision`) and the
source repository.

## One-time setup (maintainers)

- **Packages**: the first release creates the three packages under the repository owner on
  GHCR. Make them public (Package settings → Change visibility) so deployments can pull without
  credentials, and link them to the repository.
- **Workflow permissions**: Settings → Actions → General → Workflow permissions must allow
  "Read and write permissions" and "Allow GitHub Actions to create and approve pull requests"
  (the Version packages pull request).
- **`RELEASE_TOKEN`** (recommended): pull requests opened with the default `GITHUB_TOKEN` do not
  start other workflows, so CI would not run on the Version packages pull request. Store a
  fine-grained token (or a GitHub App token) as the `RELEASE_TOKEN` repository secret, with
  repository access to this repository only and these permissions set to **Read and write**:
  **Contents**, **Pull requests** and **Workflows** (the Version packages branch is reset to
  `main`, whose history changes `.github/workflows`; without Workflows GitHub refuses the update
  with "Resource not accessible by personal access token"). The workflow uses the token when
  present; when the token is refused it warns and falls back to the default token, so a release
  is never blocked by it.
- **Branch protection**: require the `check`, `test`, `integration` and `acceptance journey`
  checks on `main`, so a release is only ever cut from a green commit.

## Contributor hooks

`pnpm install` installs [lefthook](../lefthook.yml) hooks in a git checkout (never in CI or
Docker builds): pre-commit checks formatting and lints the staged files with their package's
ESLint config, pre-push runs the dependency boundaries and the root typecheck. Skip them once
with `--no-verify`, or set `FLOWAID_SKIP_HOOKS=1` before `pnpm install` to not install them.
