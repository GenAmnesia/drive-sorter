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
- [x] Implement review-folder behavior for invalid/uncertain classifications and unsupported formats, with no classified-document write in DRY_RUN.
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
- [x] Run `runSorter` with `DRY_RUN=true`, review structured execution logs, and confirm that classified documents and folders remain unchanged.
- [ ] After validating proposed actions, explicitly set `DRY_RUN=false` and optionally install the time trigger.

## 8. Autonomous folder proposals from review (new active scope)

The goal of this phase is to recognize a missing leaf in a strong existing
taxonomy, such as `IMU/{2024,2025} -> IMU/2023` or
`Casa/Roma/{IMU,TARI} -> Casa/Roma/TASI`. Gemini may only return a proposal;
application code remains the sole authority that validates and creates folders.

### 8.1 Behavior, configuration, and types

- [x] Define a separate `FolderCreationProposal` contract containing trusted parent ID/path, one or more proposed leaf segments, pattern type, evidence folder IDs, confidence, and a short reason.
- [x] Add `FOLDER_CREATION_MODE=OFF|SUGGEST|AUTO`, currently defaulting to `AUTO` while `DRY_RUN=true` protects classified documents and taxonomy; the later audit-log phase records the only intentional Drive-write exception.
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
- [x] Reject proposals below `FOLDER_CREATION_CONFIDENCE_THRESHOLD`; in `SUGGEST` mode do not modify classified documents or taxonomy, log the proposal/decision, and leave the document in inbox for manual review.
- [x] If an equivalent child already exists case-insensitively, do not create another folder; leave the file for a fresh classification against the updated tree or safely reuse it only after full destination/duplicate validation.
- [x] Validate temporal proposals deterministically against cited year siblings; treat semantic sibling proposals as higher-risk and require the same or a stricter confidence/evidence policy.
- [x] In `OFF`/`AUTO`, route invalid, ambiguous, structurally weak, or over-depth proposals to `Da controllare`; in `SUGGEST` or on proposal API/infrastructure errors leave the file in inbox.

### 8.5 Guarded creation and move behavior

- [x] Add a single guarded `CREATE_FOLDER_AND_MOVE` mutation path; Gemini must never call Drive or supply the created folder ID.
- [x] Immediately before creation, reopen the source by ID, verify its inbox parent and immutable snapshot, and revalidate the parent name/path, ancestry, exclusions, depth, and sibling evidence.
- [x] Recheck for an equivalent child immediately before `createFolder` to prevent duplicate folders under concurrent/manual changes.
- [x] In `DRY_RUN` and `SUGGEST` modes perform no creation/move/rename of classified documents or taxonomy; log the exact proposed parent, leaf, final path, confidence, and evidence. The later audit-log phase adds an intentional Google Doc-only exception.
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

## 9. Persistent per-run Drive audit log (new active scope)

The audit log is a deliberately narrow exception to the read-only document
sorting policy: each acquired, validly configured `runSorter` execution creates
one Google Doc under `ROOT_FOLDER_ID` and appends sanitized records as it runs.
It never changes a classified document, renames an existing file, or deletes
anything.

- [x] Define persistent audit-log state and a bounded, non-secret document name derived from the run ID.
- [x] Create one new Google Doc per valid acquired run, move only that newly created audit file into the configured root, and never overwrite an existing log.
- [x] Initialize the audit document before the batch `STARTED` record and append every sanitized batch/file record immediately with `saveAndClose()`.
- [x] Write an action-intent audit record before each live document mutation so an interrupted run remains traceable.
- [x] Fail closed before further document/folder mutations when the persistent audit document cannot be updated; retain console diagnostics without logging secrets.
- [x] Treat audit-document creation/update as the only explicit Drive-write exception in `DRY_RUN` and `SUGGEST`, while keeping all classified documents and taxonomy folders unchanged.
- [x] Add the minimum Google Docs OAuth scope, static/mock verification, and a clearly labeled manual audit-log smoke test.
- [x] Update README safety, scope, rollout, and troubleshooting documentation for the audit exception and required reauthorization.
- [x] Run typecheck, build, static verification, clasp status, and full diff/secret/destructive-operation review.

### 9.1 Owner/manual verification

- [ ] Push the audit-log change, authorize the additional Google Docs scope, run `runSorter` with `DRY_RUN=true`, and confirm a new `Drive Sorter Audit` document appears directly in `ROOT_FOLDER_ID` with the configured console logger output.

## 10. Configurable console and audit logger (new active scope)

The audit document must mirror the logger output emitted to the Apps Script
console. There is exactly one audit document per valid run and no Gemini
request or companion document is used to create a human-readable report.

- [x] Add `LOG_LEVEL=JSON|PRETTY|FULL`, defaulting to `JSON`, with case-insensitive parsing and clear validation errors.
- [x] Keep `JSON` byte-for-byte compatible at record level: one sanitized JSON record per emitted logger event.
- [x] Add `PRETTY` English-only ASCII presentation for batch, lifecycle, action-intent, and file-operation messages.
- [x] Make PRETTY file operations show a readable hierarchy with file name, action, destination, Gemini type/reason/confidence, and conditional details for dry-run state, duration, duplicates, errors, and folder creation.
- [x] Add dedicated English start and terminal batch banners; terminal banners include all summary counters and elapsed time.
- [x] Make `FULL` emit the PRETTY message followed by the corresponding JSON record for every logger event.
- [x] Persist every logger message in the same order it is emitted to the console, so the one Drive audit document contains the exact logger console output for that run.
- [x] Route Gemini retry diagnostics through the shared logger so they follow the selected level and are persisted while an audit is active.
- [x] Remove all Gemini human-report contracts, prompt/schema/request, response validation, rendering, companion document creation, tests, and documentation.
- [x] Add static coverage for level parsing, JSON/PRETTY/FULL output selection, English PRETTY labels, file hierarchy, and audit persistence.
- [x] Add a manual `testPrettyLogger()` smoke test that creates one synthetic audit without calling Gemini or touching inbox files.
- [x] Update README, setup instructions, privacy notes, troubleshooting, and rollout checklist for the single-audit logger model.
- [x] Run typecheck, build, static verification, clasp status, and full diff/secret/destructive-operation review.

### 10.1 Owner/manual verification

- [ ] Push the logger upgrade, set `LOG_LEVEL=PRETTY` with `DRY_RUN=true`, and confirm that `ROOT_FOLDER_ID/logs` contains one audit whose text matches the console output, including English start/end banners and the final summary.
- [ ] Repeat with `LOG_LEVEL=JSON` and confirm one JSON record per logger event with no PRETTY text.
- [ ] Repeat with `LOG_LEVEL=FULL` and confirm every PRETTY block is immediately followed by its JSON record in both console and audit document.

## 11. Reserved `ROOT_FOLDER_ID/logs` audit location (new active scope)

- [x] Add a safe optional `LOG_FOLDER_NAME` configuration with the default `logs`, without requiring a new folder ID or secret.
- [x] Resolve the direct child `ROOT_FOLDER_ID/logs` case-insensitively; create that single application-owned audit folder when it is missing, including in `DRY_RUN`/`SUGGEST`.
- [x] Move the new audit document only into the resolved logs folder and record its ID/path in persistent audit metadata.
- [x] Exclude `logs`, its descendants, and any configured log-folder name from candidate destinations and folder-creation topology.
- [x] Preserve read-only Drive smoke tests; make only audit/logger tests and valid `runSorter` create the audit folder when necessary.
- [x] Add static/mock verification for resolution, creation, candidate exclusion, and document placement; update README/setup/troubleshooting.
- [x] Run typecheck, build, static verification, clasp status, and final diff/secret/destructive-operation review.

### 11.1 Owner/manual verification

- [ ] Push the change, run `testPersistentAuditLog()` or `runSorter` with `DRY_RUN=true`, and confirm that `ROOT_FOLDER_ID/logs` contains one per-run audit while no classified document or taxonomy folder changes.

## 12. Specific existing-folder preference (new active scope)

- [x] Present existing candidate folders to Gemini in a deterministic deepest-first hierarchy-aware order.
- [x] Strengthen the classification prompt: choose the most specific existing descendant when document content supports it, but retain the parent when child-level evidence is genuinely absent or uncertain.
- [x] Add a regression check for `Casa/IMU` versus `Casa/IMU/2025`, proving the request explicitly prioritizes the existing year folder without authorizing invented paths.
- [x] Update README classification guidance and run typecheck, build, static verification, clasp status, and diff review.

### 12.1 Owner/manual verification

- [ ] Push the change and run a `DRY_RUN` with a document clearly identified as IMU 2025; confirm the raw audit proposes the existing `Casa/IMU/2025` folder rather than its parent.

## 13. Explicit-year conflict avoidance (new active scope)

- [x] Strengthen the classification prompt so a clearly identified document classification year conflicts with any different four-digit year in a candidate path.
- [x] Preserve semantic judgement by distinguishing the document's relevant period/competence year from incidental issue, print, protocol, or historical dates.
- [x] Add a request-shape regression for a February 2024 payslip and `.../2023` versus `.../2024` candidates; update README and verify the build/status/diff.

### 13.1 Owner/manual verification

- [ ] Push the change and run `DRY_RUN` with a document clearly identified as 2024 and both `/2023` and `/2024` candidates; confirm the raw audit does not propose the mismatched-year folder.

## 14. Log-folder configuration diagnostics (new active scope)

- [x] Make `LOG_FOLDER_NAME` conflicts identify the exact conflicting Script Property and a safe remediation without writing user properties.
- [x] Add regression coverage and run local verification; leave the owner responsible for correcting existing Script Properties.

## 15. Scope-aware configuration validation (new active scope)

- [x] Keep non-secret values in `config.ts` as defaults while documenting that same-named Script Properties are explicit overrides.
- [x] Prevent `DRIVE`-only manual tests from parsing or rejecting folder-proposal settings that they do not use.
- [x] Retain full validation for `runSorter` and proposal tests, with an error that states the effective conflicting threshold values.
- [x] Add regression checks and run typecheck/build/status/diff verification.

## 16. Drive-folder name conflict diagnostics (new active scope)

- [x] Identify the exact `DUPLICATE_FOLDER_NAME`, `FALLBACK_FOLDER_NAME`, or `LOG_FOLDER_NAME` conflict with the actual inbox/review folder name and ID.
- [x] Add a pure regression check and rerun local verification without modifying Script Properties.

## 17. Gemini folder-proposal schema compatibility (new active scope)

- [x] Replace the nullable nested proposal schema with explicit supported JSON-Schema branches while preserving `proposal: null` or validated proposal-object semantics.
- [x] Add request-schema regression coverage and document the safe retry path for the Apps Script proposal test.
- [x] Run local verification and clasp status; leave the live Gemini request as owner/manual verification.

## 18. Folder-proposal HTTP 400 diagnostics (new active scope)

- [x] Attach a bounded, non-secret proposal-request profile to generic HTTP 400 errors without logging document content, raw prompts, blobs, or API keys.
- [x] Emit the same profile before the manual proposal test invokes Gemini, so an API rejection remains diagnosable in Apps Script executions.
- [x] Add static coverage and run local verification/status/diff checks.

## 19. Flat Gemini folder-proposal wire schema (new active scope)

- [x] Replace the nested conditional/null proposal schema with one flat, always-present proposal object and a `NONE|PROPOSE` decision discriminator.
- [x] Convert a strictly neutral `NONE` wire object to the existing internal `proposal=null` result; keep full trusted-index validation for `PROPOSE`.
- [x] Remove dynamic ID enums and conditional branches from the provider schema while retaining all ID membership enforcement at runtime.
- [x] Update prompt, diagnostics, regression tests, and documentation; run typecheck/build/status/diff verification.

### 19.1 Owner/manual verification

- [ ] Push and rerun `testFolderCreationProposal()` with the same PDF; confirm the API accepts the flat schema and the test returns `NO_PROPOSAL`, `VALID`, or a bounded validation decision instead of HTTP 400.
