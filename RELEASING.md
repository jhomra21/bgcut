# Releasing bgcut

bgcut releases are designed to be driven from the repository. After the one-time npm trusted-publisher setup, maintainers and authorized coding agents should not need a long-lived npm token or an interactive `npm publish` command.

## Current release policy

bgcut is in beta today.

- Beta versions use semver such as `0.1.0-beta.2`.
- Beta versions publish to the npm `beta` dist-tag.
- Beta versions create GitHub prereleases.
- Stable versions have no prerelease suffix, publish to npm `latest`, and create normal GitHub releases.
- Do not declare a stable release until the browser UI and its acceptance criteria are ready for that transition.

The repository package version is the release source of truth.

## One-time npm trusted-publisher setup

The package must trust this repository's `.github/workflows/release.yml` workflow before GitHub Actions can publish with OIDC.

Requirements:

- `bgcut` already exists on npm and the configuring account has write access.
- npm account 2FA is enabled.
- npm CLI is 11.15.0 or newer for the `npm trust` command.

From an authenticated maintainer shell:

```sh
npm install -g 'npm@^11.15.0'
npm trust github bgcut \
  --file release.yml \
  --repo jhomra21/bgcut \
  --allow-publish
```

Complete npm's 2FA flow when prompted. No npm token needs to be added to GitHub.

Verify the relationship with:

```sh
npm trust list bgcut
```

The trusted publisher must identify:

- provider: GitHub Actions
- repository: `jhomra21/bgcut`
- workflow: `release.yml`
- direct `npm publish`: allowed

If the trust relationship ever needs to change, revoke the existing relationship with `npm trust revoke` and create the replacement explicitly. Do not add a broad long-lived publish token as a shortcut.

## Automated release contract

`.github/workflows/release.yml` runs on pushes to `main` that modify `package.json`, but it only publishes when the resulting commit message begins with:

```text
chore(release):
```

That makes ordinary package metadata changes safe: changing `package.json` in a normal PR does not publish anything unless the merge commit is intentionally named as a release.

The workflow:

1. checks out the exact `main` commit;
2. installs Bun 1.4.2 and Node 24;
3. installs an npm 11 version with trusted-publishing support;
4. runs `bun install --frozen-lockfile`;
5. runs the complete `bun run check` gate;
6. reads the package name and version from `package.json`;
7. maps `*-beta.*` to npm `beta` + GitHub prerelease, or stable semver to npm `latest` + normal GitHub release;
8. publishes with npm trusted publishing/OIDC when that exact version is not already present;
9. waits for registry propagation;
10. creates the matching `v<version>` GitHub release and tag with generated release notes.

The workflow is intentionally idempotent enough to repair a missing GitHub release when the npm version already exists. It does not overwrite or republish an existing npm version.

## Preparing a beta release

Before a release PR:

1. Make sure product changes are already merged and `main` CI is green.
2. Update user-facing documentation when behavior changed.
3. Update `CHANGELOG.md` with the new version and user-visible changes.
4. Update the package version in `package.json`, for example:

```json
"version": "0.1.0-beta.2"
```

5. Run or verify the full release gate:

```sh
bun install --frozen-lockfile
bun run check
```

6. Open a dedicated release PR containing the version/changelog release changes.
7. Merge only after the PR-triggered gate passes on the exact release head.
8. Use a merge commit title in this exact form:

```text
chore(release): bgcut v0.1.0-beta.2
```

The merge to `main` then performs the npm publish and GitHub prerelease automatically.

## Preparing a stable release

Stable release mechanics are the same, except the version has no prerelease suffix:

```json
"version": "1.0.0"
```

and the merge commit is, for example:

```text
chore(release): bgcut v1.0.0
```

The workflow publishes the stable version to `latest` and creates a non-prerelease GitHub release.

Do not switch to stable solely because the CLI works. Stable should represent the intended product contract, including the browser UI and documentation.

## npm dist-tags

During beta, documentation should explicitly install `bgcut@beta`:

```sh
bunx bgcut@beta --help
npm install -g bgcut@beta
```

Do not rely on plain `bgcut`/`latest` until a stable release is intentionally published.

Publishing a beta through the automated workflow moves only the `beta` dist-tag. Publishing a stable version moves `latest`.

## Agent skill shipping contract

The npm tarball includes `skills/bgcut/SKILL.md`. It is a self-contained Agent Skills-format instruction file for agents that need to invoke bgcut without searching for external instructions.

The package smoke test must verify that both the executable and the bundled skill survive `npm pack` and a clean external install.

When CLI syntax or supported formats change, update all of these in the same product PR:

- `README.md`
- `skills/bgcut/SKILL.md`
- CLI help text when applicable
- relevant tests
- `CHANGELOG.md` when the change is release-worthy

## Release failure handling

If the workflow fails before npm publication, fix the cause and prepare a new release attempt from the same unpublished version if appropriate.

If npm reports the version as published but GitHub release creation fails, do not increment or republish just to repair GitHub metadata. Rerun or repair the repository release for the same version.

Never attempt to overwrite an npm version that already exists. npm versions are immutable release identities.
