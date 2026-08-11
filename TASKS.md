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

- [ ] Review the local diff before the next commit or production rollout.
- [x] Execute `npm run push` to update the linked Apps Script project.
- [x] Set `ROOT_FOLDER_ID`, `INBOX_FOLDER_ID`, `REVIEW_FOLDER_ID`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in Apps Script Script Properties.
- [x] Run `testDriveAccess`, `testGemini`, and `testFolderTree` in the Apps Script editor and approve required scopes.
- [x] Run `runSorter` with `DRY_RUN=true`, review structured execution logs, and confirm that Drive remains unchanged.
- [ ] After validating proposed actions, explicitly set `DRY_RUN=false` and optionally install the time trigger.

## 8. Autonomous folder proposals from review (new active scope)

The goal of this phase is to recognize a missing leaf in a strong existing
taxonomy, such as `IMU/{2024,2025} -> IMU/2023` or
`Casa/Roma/{IMU,TARI} -> Casa/Roma/TASI`. Gemini may only return a proposal;
application code remains the sole authority that validates and creates folders.

### 8.1 Behavior, configuration, and types

- [x] Define a separate `FolderCreationProposal` contract containing trusted parent ID/path, one or more proposed leaf segments, pattern type, evidence folder IDs, confidence, and a short reason.
- [x] Add `FOLDER_CREATION_MODE=OFF|SUGGEST|AUTO`, defaulting to `OFF`; `DRY_RUN=true` must override every mode and prohibit all Drive writes.
- [x] Add and validate `FOLDER_CREATION_CONFIDENCE_THRESHOLD`, with a conservative proposed default of `0.97` and an allowed range of `0..1`.
- [x] Add and validate `FOLDER_CREATION_MAX_FINAL_DEPTH`, measured from the configured root, with a default no greater than the folder-index depth.
- [x] Add `FOLDER_CREATION_MAX_NEW_SEGMENTS=1` by default so autonomous creation initially permits only a missing leaf, not an invented multi-level hierarchy.
- [x] Add `FOLDER_CREATION_MIN_SIBLING_EVIDENCE=2` so an autonomous proposal must cite a real, repeatable sibling pattern.
- [x] Add and validate `FOLDER_CREATION_SEMANTIC_GROUPS_JSON` as an explicit bounded name-family allowlist for `SEMANTIC` AUTO proposals; keep `[["IMU","TARI","TASI"]]` as the documented default and let `[]` disable semantic AUTO authorization.
- [x] Keep the existing `ALLOW_FOLDER_CREATION` root fallback behavior separate and document its relationship with the new review-driven mode.
- [x] Extend action-plan, result, log, and batch-summary types for `SUGGEST_FOLDER` and `CREATE_FOLDER_AND_MOVE` without weakening existing `MOVE`, `REVIEW`, or `DUPLICATE` behavior.

### 8.2 Trusted topology and pattern evidence

- [x] Enrich the per-run folder index with deterministic parent/child and sibling-group lookups without performing a second full Drive traversal per file.
- [x] Build bounded creation context from existing, non-reserved folders only; never expose root, inbox, review, `Duplicati`, excluded IDs, or their descendants as creation parents/evidence.
- [x] Detect temporal sibling patterns in application code, including four-digit year siblings, and require the proposed year to be plausibly close to the observed sequence.
- [x] Represent semantic sibling evidence such as `IMU`, `TARI`, and proposed `TASI` under the same trusted parent without treating name similarity alone as authorization.
- [x] Refuse creation context that exceeds configured folder/depth/candidate limits rather than sending a truncated or misleading topology to Gemini.

### 8.3 Review-aware Gemini proposal stage

- [x] Removed/not needed: invoke the proposal stage only after an existing-folder classification has already fallen below `CONFIDENCE_THRESHOLD`; this would discard the distinction between normal move confidence and the deliberately higher folder-creation confidence.
- [x] Preserve the normal existing-folder result as a fallback and evaluate a folder proposal only when no existing target was selected or its confidence is below `FOLDER_CREATION_CONFIDENCE_THRESHOLD`; never invoke it after unsupported input, invalid model output, API outage, or internal failure.
- [x] If folder creation is declined or rejected, still use the existing target when it meets `CONFIDENCE_THRESHOLD`; otherwise route to `Da controllare` in `OFF`/`AUTO`.
- [x] Reuse the already prepared document and cached folder index, and make at most one additional Gemini proposal request per file/run.
- [x] Write a dedicated prompt that treats document content, filenames, folder names, and paths as untrusted data and explicitly ignores folder-creation instructions found inside documents.
- [x] Require Gemini to propose only an existing parent ID/path and real evidence folder IDs supplied by the application; Gemini must never return or invent a new folder ID.
- [x] Require structured JSON containing proposed segments rather than a free-form full path, plus confidence, pattern type, evidence IDs, and a bounded reason.
- [x] Reuse the existing retry, sanitized-error, rate-limit, and runtime-deadline controls for the proposal call.

### 8.4 Runtime validation and confidence policy

- [x] Runtime-validate every proposal field, reject extra/missing fields, and require finite confidence within `0..1`.
- [x] Resolve the proposed parent exclusively through the trusted index and require exact parent ID/path agreement.
- [x] Validate that every evidence ID exists, is non-reserved, shares the proposed parent, and meets `FOLDER_CREATION_MIN_SIBLING_EVIDENCE` after deduplication.
- [x] Sanitize each proposed segment and reject blank names, control characters, slashes, dot segments, reserved names, IDs/URLs, and names exceeding Drive/config limits.
- [x] Enforce both maximum new segments and maximum final depth in application code, independently of Gemini confidence.
- [x] Reject proposals below `FOLDER_CREATION_CONFIDENCE_THRESHOLD`; in `SUGGEST` mode remain completely read-only, log the proposal/decision, and leave the document in inbox for manual review.
- [x] If an equivalent child already exists case-insensitively, do not create another folder; leave the file for a fresh classification against the updated tree or safely reuse it only after full destination/duplicate validation.
- [x] Validate temporal proposals deterministically against cited year siblings; treat semantic sibling proposals as higher-risk and require the same or a stricter confidence/evidence policy.
- [x] In `OFF`/`AUTO`, route invalid, ambiguous, structurally weak, or over-depth proposals to `Da controllare`; in `SUGGEST` or on proposal API/infrastructure errors leave the file in inbox.

### 8.5 Guarded creation and move behavior

- [x] Add a single guarded `CREATE_FOLDER_AND_MOVE` mutation path; Gemini must never call Drive or supply the created folder ID.
- [x] Immediately before creation, reopen the source by ID, verify its inbox parent and immutable snapshot, and revalidate the parent name/path, ancestry, exclusions, depth, and sibling evidence.
- [x] Recheck for an equivalent child immediately before `createFolder` to prevent duplicate folders under concurrent/manual changes.
- [x] In `DRY_RUN` and `SUGGEST` modes perform no `createFolder`, `moveTo`, or `setName`; log the exact proposed parent, leaf, final path, confidence, and evidence.
- [x] After successful creation, preserve existing collision, optional rename, exact-duplicate, and safe-move guarantees before moving the document.
- [x] If an external actor creates the same child during the race window, abort safely and retry on a later run rather than merging into an unvalidated destination.
- [x] Record partial outcomes explicitly when folder creation succeeds but move/rename/post-condition verification fails; never delete the newly created folder or any file.
- [x] Update the in-memory folder index after a confirmed creation so later files in the same batch can classify against the new real folder without rebuilding the entire tree.

### 8.6 Logging, tests, and documentation

- [x] Extend structured file logs with the complete bounded proposal, threshold decision, pattern/evidence, mode, created folder ID/path, and partial-mutation state without logging document content.
- [x] Add batch counters for folder proposals, accepted proposals, created folders, rejected proposals, and proposal API errors.
- [x] Add pure tests for `IMU/{2024,2025} -> IMU/2023` and `Casa/Roma/{IMU,TARI} -> Casa/Roma/TASI`.
- [x] Add negative tests for invented parents/evidence, same-parent but unrelated siblings, insufficient evidence, reserved names, traversal strings, excess depth/segments, low confidence, existing equivalent folders, prompt injection, and disabled semantic AUTO authorization.
- [x] Add mutation-boundary tests proving that `DRY_RUN` and `SUGGEST` cannot create/move/rename, that the legacy fallback is also suppressed in live `SUGGEST`, and that source/destination TOCTOU checks still abort safely.
- [x] Add a read-only Apps Script manual test that prints folder-creation proposals and validation decisions without creating folders or moving files.
- [x] Update README setup, Script Properties, two-threshold fallback policy, security model, Free Tier cost impact of the optional second Gemini call, rollout, logs, examples, and troubleshooting.
- [x] Run final typecheck, build, static verification, clasp status, diff/secret/destructive-operation review, and synchronize every checkbox with verified repository state.

### 8.7 Controlled rollout (owner/manual)

- [ ] Push the verified implementation and add the new Script Properties while keeping `DRY_RUN=true` and `FOLDER_CREATION_MODE=OFF`.
- [ ] Run the new read-only proposal test, then use `FOLDER_CREATION_MODE=SUGGEST` to review proposal confidence/evidence on representative documents; account for repeated evaluation because files intentionally remain in inbox.
- [ ] Exercise temporal, semantic, ambiguous, malicious-name, existing-folder, and over-depth cases and confirm that Drive remains unchanged.
- [ ] Switch to `FOLDER_CREATION_MODE=AUTO` while still in `DRY_RUN`, and approve the exact planned folder paths from structured logs.
- [ ] Enable live writes only for a small manual batch after proposal quality is demonstrated; verify created folders, moves, duplicates, collisions, and partial-failure logs before enabling any trigger.
