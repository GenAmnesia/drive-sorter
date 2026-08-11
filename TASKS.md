# Drive Sorter implementation tasks

Checkboxes are marked complete only after implementation and an appropriate local or static verification.

## 0. Repository and configuration verification

- [x] Inspect the repository tree, Git baseline, `package.json`, `package-lock.json`, `tsconfig.json`, ignored `.clasp.json`, `.claspignore`, manifest, and every existing source file.
- [x] Run the pre-implementation typecheck with the installed TypeScript 7.0.2 (`npm run typecheck`: pass).
- [x] Verify the installed clasp 3.3.0 file-status command (`clasp status` / `clasp show-file-status`) and record the empty tracked-file result.
- [x] Record pre-existing deploy problems: wrong manifest filename, root-relative `.claspignore` patterns, and no TypeScript-to-JavaScript build although clasp 3 no longer transpiles TypeScript.
- [x] Removed/not needed: a single `tsc` bundle is impossible with installed TypeScript 7.0.2 because `module: none` and `outFile` have been removed; no downgrade or bundler will be introduced.
- [x] Add a minimal TypeScript 7 build that emits Apps Script-compatible JavaScript modules under `src/build` without runtime imports or a bundler.
- [x] Make the build remove only stale generated `src/build` output and refuse emission on TypeScript errors.
- [x] Correct the manifest filename and `.claspignore`, then verify clasp sees only the manifest and generated JavaScript modules.

## 1. Core types, configuration, and logging

- [x] Define core configuration, folder, document, classification, validation, duplicate, processing, and structured-log types.
- [x] Load and validate Script Properties without hardcoded IDs or secrets, using safe defaults (`DRY_RUN=true`, threshold `0.85`, batch `10`, `Duplicati`, rename disabled).
- [x] Document required and optional Script Properties and add a safe setup/help function that never writes secrets.
- [x] Implement one structured JSON log record per processed file plus batch/lock diagnostics.

## 2. Drive inventory and guarded operations

- [x] Validate that configured root, inbox, and review folders exist under the expected tree and are distinct.
- [x] Implement one recursive folder index per run with folder ID and human-readable relative path, bounded by `MAX_FOLDER_DEPTH`, with one rebuild only after rare fallback creation.
- [x] Exclude root, inbox, review, `Duplicati`, descendants of reserved folders, and configurable excluded folder IDs from normal candidates.
- [x] Implement review-folder behavior for invalid/uncertain classifications and unsupported formats, with no write in DRY_RUN.
- [x] Implement safe move operations that never delete or overwrite and re-check source/destination immediately before mutation.
- [x] Keep rare folder creation application-controlled, strictly validated, opt-in, and completely disabled in DRY_RUN.

## 3. Document preparation and Gemini classification

- [x] Prepare bounded text, PDF, JPEG, PNG, DOC/DOCX, and Google Docs inputs using native Apps Script APIs where supported.
- [x] Mark unsupported/oversized formats per file without aborting the batch.
- [x] Implement the supported Gemini `generateContent` REST request with configurable model, API key header, multimodal parts, structured JSON output, and no secret logging.
- [x] Removed/not needed: migrate this stateless v1 classifier to the newer Interactions API; `generateContent` remains supported and avoids an unnecessary SDK/state layer, with the legacy status documented for future review.
- [x] Write a strict classification prompt that treats document content as untrusted data, ignores prompt injection, and permits only supplied destination IDs.
- [x] Parse model output defensively, including missing candidates, malformed JSON, blocked/empty responses, and API error payloads.
- [x] Runtime-validate every expected field, confidence range, filename/document fields, null consistency, and exact membership in the candidate-ID set.
- [x] Route low-confidence or null classifications to review; leave files in the inbox on infrastructure/API failures.
- [x] Add bounded retries with exponential backoff and jitter for HTTP 408/429/500/502/503/504, constrained by the run deadline.

## 4. Duplicates, names, and final action planning

- [x] Compute SHA-256 safely and compare plausible same-size destination files before declaring an exact duplicate.
- [x] Log same-name files with different or unavailable hashes in `possibleDuplicateOfFileIds` without automatic semantic duplicate handling.
- [x] Find or create `Duplicati` inside the selected destination, including review, only for an exact duplicate and never during DRY_RUN.
- [x] Generate extension-preserving, sanitized, non-conflicting names without overwriting existing files.
- [x] Keep AI-suggested renaming optional, sanitized, collision-safe, extension-preserving, and disabled by default and in DRY_RUN.
- [x] Ensure exact duplicates, filename collisions, review routing, optional folder creation, rename, and move resolve to one idempotent action plan.

## 5. Batch execution, concurrency, and entry points

- [x] Implement `runSorter()` with `LockService`, clean lock contention handling, one initial folder index shared across files, per-run file-ID deduplication, `MAX_FILES_PER_RUN`, and per-file isolation.
- [x] Avoid duplicate Gemini calls in one execution and stop safely before the Apps Script runtime budget is exhausted.
- [x] Expose read-only `testDriveAccess()`, `testFolderTree()`, `testGemini()`, `testHashing()`, and `testFilenameCollision()` manual tests.
- [x] Implement explicit configurable `installTimeTrigger()` and `removeTimeTriggers()` limited to `runSorter` clock triggers.

## 6. Verification and documentation

- [x] Add static/pure local verification for parsing, validation, filenames, hashes, prompt/request shape, DRY_RUN mutation rejection, and destructive-operation guards.
- [x] Add a bounded, secret-redacted Gemini HTTP error diagnostic so manual API tests expose safe `code`, `status`, and `message` details.
- [x] Use the REST enum value `APPLICATION_JSON` required by the deployed `TextResponseFormat.MimeType` backend and verify both health-check and classification request shapes.
- [x] Run the final TypeScript typecheck and JavaScript build with no errors.
- [x] Run clasp file status and verify the exact intended manifest/compiled-module push set without pushing.
- [x] Verify the `npm run push` pipeline builds before `clasp push`; intentionally defer the external Apps Script push until owner review.
- [x] Write a complete README covering installation, clasp, Script Properties, Drive/Gemini setup, DRY_RUN rollout, tests, triggers, quotas, duplicates, security, and troubleshooting.
- [x] Review `git status`, `git diff --stat`, the complete diff, `git diff --check`, and scan for secrets and forbidden destructive operations.

## 7. Owner configuration and live verification (intentionally manual)

- [ ] Review the local diff, then execute `npm run push` to update the linked Apps Script project.
- [ ] Set `ROOT_FOLDER_ID`, `INBOX_FOLDER_ID`, `REVIEW_FOLDER_ID`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in Apps Script Script Properties.
- [ ] Run `testDriveAccess`, `testGemini`, and `testFolderTree` in the Apps Script editor and approve required scopes.
- [ ] Run `runSorter` with `DRY_RUN=true` and review structured execution logs.
- [ ] After validating proposed actions, explicitly set `DRY_RUN=false` and optionally install the time trigger.
