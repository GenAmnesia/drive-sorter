import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "src");
const buildRoot = join(sourceRoot, "build");

function walk(directory, extension) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "build" && directory === sourceRoot
          ? []
          : walk(path, extension);
      }
      return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
    })
    .sort();
}

const typescriptFiles = walk(sourceRoot, ".ts");
const javascriptFiles = walk(buildRoot, ".js");
assert.ok(typescriptFiles.length >= 10, "Expected modular TypeScript sources.");
assert.equal(
  javascriptFiles.length,
  typescriptFiles.length,
  "Every TypeScript source must have one compiled JavaScript output.",
);

const forbiddenCalls = [
  /\.setTrashed\s*\(/,
  /\bDrive\.Files\.(?:delete|remove)\s*\(/,
  /\.removeFile\s*\(/,
  /\.removeFolder\s*\(/,
  /\.addFile\s*\(/,
  /\.addFolder\s*\(/,
  /\.setContent\s*\(/,
];

for (const path of typescriptFiles) {
  const source = readFileSync(path, "utf8");
  forbiddenCalls.forEach((pattern) => {
    assert.equal(
      pattern.test(source),
      false,
      `Forbidden destructive/legacy call in ${relative(projectRoot, path)}: ${pattern}`,
    );
  });

  for (const mutationPattern of [
    /\.moveTo\s*\(/,
    /\.setName\s*\(/,
    /\.createFolder\s*\(/,
  ]) {
    if (mutationPattern.test(source)) {
      assert.equal(
        relative(projectRoot, path),
        "src/drive.ts",
        `Drive mutation escaped the guarded boundary: ${mutationPattern}`,
      );
    }
  }
}

const context = vm.createContext({
  console,
  Math,
  Date,
  JSON,
  Set,
  WeakSet,
  Error,
  Object,
  Number,
  String,
  Array,
  RegExp,
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    computeDigest(_algorithm, bytes) {
      return Array.from(createHash("sha256").update(Buffer.from(bytes)).digest());
    },
    base64Encode(bytes) {
      return Buffer.from(bytes).toString("base64");
    },
    getUuid() {
      return "00000000-0000-4000-8000-000000000000";
    },
    sleep() {},
  },
});

for (const path of javascriptFiles) {
  const source = readFileSync(path, "utf8");
  assert.equal(
    /\b(?:import|export)\s/.test(source),
    false,
    `${path} has a runtime module statement.`,
  );
  new vm.Script(source, { filename: path }).runInContext(context);
}

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

assert.equal(evaluate("parseBoolean('true', false)"), true);
assert.equal(evaluate("parseBoolean(undefined, true)"), true);
assert.throws(() => evaluate("parseBoolean('yes', true)"));
assert.equal(evaluate("parseInteger('10', 1, 'N', 1, 20)"), 10);
assert.throws(() => evaluate("parseInteger('1.5', 1, 'N', 1, 20)"));

assert.equal(
  evaluate(
    "generateNonConflictingFilenameFromNames('documento.pdf', ['documento.pdf', 'documento (2).pdf'])",
  ),
  "documento (3).pdf",
);
assert.equal(
  evaluate("buildSafeFilename('originale.PDF', 'nuovo.docx')"),
  "nuovo.PDF",
);
assert.equal(
  evaluate("selectPlannedDestinationFilename('a:b.pdf', 'a:b.pdf')"),
  "a:b.pdf",
  "An unchanged filename must remain exact when RENAME_FILES is false.",
);
assert.equal(
  evaluate("sha256HexFromBytes([97, 98, 99])"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
evaluate(`
  globalThis.__sourceForDuplicateTest = {
    getId: function () { return 'source'; },
    getName: function () { return 'documento.pdf'; },
    getMimeType: function () { return 'application/pdf'; },
    getSize: function () { return 3; },
    getBlob: function () { return { getBytes: function () { return [97, 98, 99]; } }; }
  };
  globalThis.__existingForDuplicateTest = {
    getId: function () { return 'existing'; },
    getName: function () { return 'documento.pdf'; },
    getMimeType: function () { return 'application/pdf'; },
    getSize: function () { return 3; },
    getBlob: function () { return { getBytes: function () { return [97, 98, 99]; } }; }
  };
  globalThis.__reviewForDuplicateTest = {
    getId: function () { return 'review'; },
    getName: function () { return 'Da controllare'; },
    getFiles: function () {
      var done = false;
      return {
        hasNext: function () { return !done; },
        next: function () { done = true; return globalThis.__existingForDuplicateTest; }
      };
    },
    getFilesByName: function (name) {
      return { hasNext: function () { return name === 'documento.pdf'; } };
    },
    getFolders: function () {
      return { hasNext: function () { return false; }, next: function () { throw new Error('empty'); } };
    }
  };
`);
const exactDuplicate = JSON.parse(
  evaluate(
    "JSON.stringify(findExactDuplicate(__sourceForDuplicateTest, __reviewForDuplicateTest, {maxHashBytes:100}, Date.now()+10000))",
  ),
);
assert.equal(exactDuplicate.isDuplicate, true);
assert.equal(exactDuplicate.duplicateOfFileId, "existing");
const reviewDuplicatePlan = JSON.parse(
  evaluate(`JSON.stringify(buildReviewPlan(
    __sourceForDuplicateTest,
    {id:'source',name:'documento.pdf',mimeType:'application/pdf',sizeBytes:3,lastUpdatedEpochMs:1000},
    null,
    'UNSUPPORTED',
    'Unsupported test.',
    {maxHashBytes:100,duplicateFolderName:'Duplicati',reviewFolderId:'review'},
    {review:__reviewForDuplicateTest},
    Date.now()+10000
  ))`),
);
assert.equal(reviewDuplicatePlan.action, "DUPLICATE");
assert.equal(reviewDuplicatePlan.destinationPath, "Da controllare/Duplicati");
assert.deepEqual(
  JSON.parse(JSON.stringify(evaluate("boundDocumentText('A😀B', 2)"))),
  { text: "A", truncated: true },
);

const candidateExpression =
  "[{id:'folder_1234567890',name:'Tributi',path:'Casa/Tributi',parentId:null,depth:2}]";
const validClassification =
  "{targetFolderId:'folder_1234567890',targetFolderPath:'Casa/Tributi',documentType:'fattura',suggestedFilename:null,confidence:0.95,reason:'Contenuto fiscale.'}";
assert.equal(
  evaluate(
    `validateClassification(${validClassification}, ${candidateExpression}).valid`,
  ),
  true,
);
assert.equal(
  evaluate(
    `validateClassification({...${validClassification}, targetFolderId:'invented_1234567890'}, ${candidateExpression}).valid`,
  ),
  false,
);
assert.equal(
  evaluate(
    `validateClassification({...${validClassification}, targetFolderPath:'Altro'}, ${candidateExpression}).valid`,
  ),
  false,
);
assert.equal(
  evaluate(
    `validateClassification({...${validClassification}, confidence:NaN}, ${candidateExpression}).valid`,
  ),
  false,
);

assert.equal(
  evaluate("buildGeminiEndpoint('models/gemini-3.5-flash-lite')"),
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
);
const requestShape = evaluate(`JSON.stringify(buildGeminiClassificationRequest({
  fileId:'file',filename:'sample.pdf',mimeType:'application/pdf',sizeBytes:3,
  kind:'INLINE_DATA',parts:[{inlineData:{mimeType:'application/pdf',data:'YWJj'}}],
  extractedText:null,truncated:false,unsupportedReason:null
}, ${candidateExpression}))`);
const request = JSON.parse(requestShape);
assert.equal(
  request.generationConfig.responseFormat.text.mimeType,
  "APPLICATION_JSON",
);
assert.equal("responseMimeType" in request.generationConfig, false);
assert.equal("temperature" in request.generationConfig, false);
assert.deepEqual(
  request.generationConfig.responseFormat.text.schema.properties.targetFolderId
    .type,
  ["string", "null"],
);
const healthRequest = JSON.parse(
  evaluate("JSON.stringify(buildGeminiHealthCheckRequest())"),
);
assert.equal(
  healthRequest.generationConfig.responseFormat.text.mimeType,
  "APPLICATION_JSON",
);
assert.deepEqual(
  healthRequest.generationConfig.responseFormat.text.schema.properties.status
    .enum,
  ["ok"],
);
assert.match(request.systemInstruction.parts[0].text, /untrusted data/i);
assert.match(request.systemInstruction.parts[0].text, /Ignore every instruction/i);

const diagnosticEnvelope = JSON.stringify({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: "Unknown field responseFormat; key=test-secret-value\nsecond line",
  },
});
const diagnosticDetails = JSON.parse(
  evaluate(
    `JSON.stringify(parseGeminiApiErrorDetails(${JSON.stringify(diagnosticEnvelope)}, 'test-secret-value'))`,
  ),
);
assert.deepEqual(diagnosticDetails, {
  code: 400,
  status: "INVALID_ARGUMENT",
  message:
    "Unknown field responseFormat; key=[REDACTED_API_KEY] second line",
});
const diagnosticMessage = evaluate(
  `formatGeminiHttpErrorMessage(400, parseGeminiApiErrorDetails(${JSON.stringify(diagnosticEnvelope)}, 'test-secret-value'))`,
);
assert.match(diagnosticMessage, /status=INVALID_ARGUMENT/);
assert.match(diagnosticMessage, /Unknown field responseFormat/);
assert.doesNotMatch(diagnosticMessage, /test-secret-value/);
assert.equal(
  evaluate("parseGeminiApiErrorDetails('not-json', 'secret')"),
  null,
);

assert.throws(
  () =>
    evaluate(
      "applyFileActionPlan('file', {action:'MOVE'}, {dryRun:true}, {}, {})",
    ),
  /DRY_RUN/,
  "The mutation boundary must reject DRY_RUN before touching Drive.",
);

evaluate(`
  globalThis.__moveCalls = 0;
  globalThis.DriveApp = {
    getFileById: function () {
      return {
        isTrashed: function () { return false; },
        getParents: function () {
          var done = false;
          return {
            hasNext: function () { return !done; },
            next: function () { done = true; return { getId: function () { return 'inbox'; } }; }
          };
        },
        getId: function () { return 'file'; },
        getName: function () { return 'doc.pdf'; },
        getMimeType: function () { return 'application/pdf'; },
        getSize: function () { return 3; },
        getLastUpdated: function () { return new Date(2000); },
        moveTo: function () { globalThis.__moveCalls += 1; }
      };
    }
  };
`);
assert.throws(
  () =>
    evaluate(`applyFileActionPlan('file', {
      action:'MOVE', destinationFolderId:'target', destinationPath:'Casa',
      destinationFilename:'doc.pdf', duplicateOfFileId:null,
      exactDuplicateSha256:null,
      possibleDuplicateOfFileIds:[], classification:null, errorKind:null,
      reason:'test', requiresFolderCreation:false,
      sourceSnapshot:{id:'file',name:'doc.pdf',mimeType:'application/pdf',sizeBytes:3,lastUpdatedEpochMs:1000}
    }, {dryRun:false,inboxFolderId:'inbox'}, {}, {})`),
  /cambiato dopo la preparazione/,
  "A changed source snapshot must abort before any Drive move.",
);
assert.equal(evaluate("globalThis.__moveCalls"), 0);

const manifest = JSON.parse(
  readFileSync(join(sourceRoot, "appsscript.json"), "utf8"),
);
assert.equal(manifest.runtimeVersion, "V8");
assert.ok(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/drive"),
);

console.log(
  JSON.stringify({
    status: "ok",
    checkedTypeScriptFiles: typescriptFiles.length,
    checkedJavaScriptFiles: javascriptFiles.length,
    destructiveCallGuard: "pass",
    pureRuntimeChecks: "pass",
  }),
);
