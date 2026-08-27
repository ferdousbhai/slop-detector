# Releasing

One `vX.Y.Z` tag tests the extension and creates a draft GitHub Release with a
Chrome Web Store ZIP and its SHA-256 checksum. Upload and submission to the
Chrome Web Store remain manual.

## Prepare a version

Update `extension/manifest.json` to the next version, then run:

```bash
npm ci
npm run check
npm test
```

Commit every intended source, documentation, icon, and store-asset change. The
Chrome packaging script refuses a dirty tree and archives the committed
`extension/` directory, not uncommitted files.

## Create the draft release

Create and push an annotated tag matching the manifest version:

```bash
git tag -a v1.1.1 -m "Slop Detector v1.1.1"
git push origin v1.1.1
```

`.github/workflows/release.yml` checks the tag, runs the suite, and creates:

```text
slop-detector-chrome-store-v1.1.1.zip
slop-detector-chrome-store-v1.1.1.zip.sha256
```

The workflow retains both files as a workflow artifact and attaches them to a
draft GitHub Release. Review the notes and artifacts, then publish the release.

## Publish Chrome

Upload `slop-detector-chrome-store-v1.1.1.zip` from the GitHub Release to the
existing Chrome Web Store item. The ZIP already has `manifest.json` at its root.
Complete the listing and privacy review, then submit the update.

Chrome requires an uploaded manifest version to be higher than the current
store version. Review is asynchronous, so the public GitHub Release can precede
the Web Store update.

The Chrome Web Store API can automate updates after the item and OAuth publisher
credentials exist. This repository currently keeps upload and submission
manual.

## Recovery

- If the tag workflow fails, fix the source, bump to a new version, and create a
  new tag. Do not move a published release tag.
- If Chrome rejects an upload, fix the extension, increment the manifest
  version, and release again.
