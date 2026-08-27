# Releasing

One `vX.Y.Z` tag prepares both distributions. The tag creates a draft GitHub
Release; publishing that release publishes npm through OIDC. Chrome Web Store
upload remains manual.

## One-time npm setup

1. Confirm the `@ferdousbhai` npm scope can publish
   `@ferdousbhai/slop-detector`.
2. In npm Trusted Publishing, add a GitHub Actions publisher with these exact
   values:
   - owner: `ferdousbhai`
   - repository: `slop-detector`
   - workflow: `publish-npm.yml`
   - environment: `npm`
3. Create the protected `npm` environment in GitHub and add the desired reviewer
   policy.

The publishing job uses `contents: read` and `id-token: write`. It runs on Node
26 and installs the latest npm CLI. Trusted publishing adds provenance
automatically for a public package from a public repository.

## Prepare a version

Update both version fields to the same value:

```text
package.json
extension/manifest.json
```

Then run:

```bash
npm ci
npm run check
npm test
npm run verify:package
```

Commit every intended source, documentation, icon, and store-asset change. The
Chrome packaging script refuses a dirty tree and archives the committed
`extension/` directory, not uncommitted files.

## Create the draft release

Create and push an annotated tag:

```bash
git tag -a v1.1.1 -m "Slop Detector v1.1.1"
git push origin v1.1.1
```

`.github/workflows/release.yml` checks the tag against both versions, runs the
suite, and creates these artifacts in `dist/`:

```text
slop-detector-chrome-store-v1.1.1.zip
slop-detector-chrome-store-v1.1.1.zip.sha256
ferdousbhai-slop-detector-1.1.1.tgz
ferdousbhai-slop-detector-1.1.1.tgz.sha256
```

The workflow uploads the directory as a workflow artifact and attaches each
file to a draft GitHub Release.

## Publish npm

Review the draft release notes and artifacts, then publish the GitHub Release.
That `release.published` event starts `.github/workflows/publish-npm.yml`.

The npm workflow:

1. checks out the exact release tag;
2. installs dependencies and a trusted-publishing-compatible npm CLI;
3. runs syntax checks, tests, and package verification;
4. confirms tag, npm package, and Chrome manifest versions match; and
5. runs `npm publish` through OIDC.

No long-lived npm token is stored in GitHub.

After completion, verify:

```bash
npm view @ferdousbhai/slop-detector version dist.attestations
npm exec --yes @ferdousbhai/slop-detector@1.1.1 -- --version
```

## Publish Chrome

Upload `slop-detector-chrome-store-v1.1.1.zip` from the GitHub Release to the
existing Chrome Web Store item. The ZIP already has `manifest.json` at its root.
Complete the listing and privacy review, then submit the update.

Chrome requires every uploaded manifest version to be higher than the current
store version. The Web Store release is separate from npm publication and can
finish later because Chrome review is asynchronous.

The Chrome Web Store API can automate updates after the item and OAuth publisher
credentials exist, but this repository currently keeps upload and submission
manual.

## Recovery

- If the tag workflow fails, fix the source, bump to a new version, and create a
  new tag. Do not move a published release tag.
- If npm publishing fails before registry publication, correct trusted-publisher
  or environment configuration and release a corrected version.
- npm versions cannot be republished after successful publication.
- If Chrome rejects an upload, fix the extension, increment both versions, and
  release again.
