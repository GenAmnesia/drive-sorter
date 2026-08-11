# Drive Sorter per Google Drive

Drive Sorter è un progetto Google Apps Script sviluppato localmente con `clasp` e TypeScript. Analizza i file presenti nella cartella configurata come `Da smistare`, invia a Gemini solo i dati necessari alla classificazione, valida la proposta del modello contro l'indice reale delle cartelle Drive e pianifica lo spostamento verso una destinazione esistente. Opzionalmente può anche proporre, o creare in modalità controllata, una singola cartella foglia mancante quando l'albero esistente fornisce evidenza molto forte.

Il progetto non usa server o database esterni, non richiede il servizio Drive avanzato e parte in modalità sicura:

- `DRY_RUN=true`: nessuno spostamento, rinomina o creazione di cartelle;
- `RENAME_FILES=false`: i suggerimenti di nome del modello non vengono applicati;
- `ALLOW_FOLDER_CREATION=false`: il raro fallback applicativo è disabilitato;
- `FOLDER_CREATION_MODE=OFF`: la creazione guidata dalla review è disabilitata;
- nessuna chiamata applicativa elimina o cestina file;
- Gemini propone soltanto una classificazione JSON e non può invocare Drive;
- output invalido, ambiguo o sotto soglia viene destinato a `Da controllare` quando le scritture sono abilitate;
- errori API o infrastrutturali lasciano il file nella inbox.

> **Prima di usare documenti reali:** `DRY_RUN` impedisce modifiche a Drive, ma esegue comunque le chiamate Gemini e quindi invia il contenuto dei documenti all'API. Leggere la sezione [Privacy e trattamento dei contenuti](#privacy-e-trattamento-dei-contenuti).

## Come funziona

Per ogni esecuzione, `runSorter()`:

1. acquisisce un lock di script, evitando due batch concorrenti;
2. valida le Script Properties e la relazione tra root, inbox e review;
3. costruisce l'indice ricorsivo delle cartelle candidate e le relazioni parent/figli usate come evidenza;
4. legge soltanto i file figli diretti della inbox, fino a `MAX_FILES_PER_RUN`;
5. prepara il documento con limiti di dimensione e testo;
6. chiede a Gemini una risposta JSON strutturata;
7. valida a runtime ogni campo e la coppia esatta `folderId`/`path`;
8. applica `CONFIDENCE_THRESHOLD` alla destinazione esistente e, se abilitato, valuta con una sola richiesta aggiuntiva una cartella foglia mancante usando una soglia distinta e più alta;
9. se la creazione non è autorizzata, conserva la destinazione esistente quando supera la sua soglia normale; altrimenti, in `OFF`/`AUTO`, pianifica `Da controllare`;
10. controlla duplicati e collisioni e applica un unico piano validato; in `DRY_RUN` e `SUGGEST` registra soltanto l'esito;
11. emette log JSON per ogni file e per il batch.

Il contenuto del documento è trattato nel prompt come dato non affidabile. Istruzioni presenti nel file, inclusi tentativi di prompt injection come “ignora le istruzioni precedenti”, non autorizzano alcuna operazione.

## Requisiti

- Node.js 20 o successivo, richiesto dalle versioni correnti di `clasp`;
- npm;
- un account Google con accesso in lettura e scrittura alle cartelle coinvolte;
- un progetto Google Apps Script standalone;
- [Apps Script API abilitata](https://script.google.com/home/usersettings) per usare `clasp`;
- una API key Gemini creata in Google AI Studio;
- Visual Studio Code è consigliato, ma non obbligatorio.

Le dipendenze di sviluppo sono intenzionalmente ridotte a:

- `@google/clasp` 3.3.x;
- TypeScript 7.0.x;
- `@types/google-apps-script`.

## Installazione locale

Dalla root del repository:

```bash
npm install
npm run typecheck
npm run verify
```

Con un lockfile invariato, `npm ci` è l'alternativa riproducibile a `npm install`.

Non è necessario installare `clasp` globalmente: i comandi seguenti usano la copia locale tramite `npx`. Effettuare il login con lo stesso account che possiede o può modificare il progetto Apps Script:

```bash
npx clasp login
```

## Collegare `clasp` a un progetto Apps Script

Il file `.clasp.json` contiene almeno lo Script ID e `rootDir: "src"`. È escluso da Git e non deve essere aggiunto al repository. Se è già presente localmente e `npm run status` funziona, non ricrearlo.

Per trovare lo Script ID: aprire il progetto Apps Script, entrare in **Impostazioni progetto**, sezione **ID**, e copiare **ID script**.

### Collegare un progetto esistente

`clasp clone` scarica anche i file remoti. Per non sovrascrivere i sorgenti di questo repository, eseguirlo in una directory temporanea vuota e copiare qui soltanto `.clasp.json`. Nell'esempio, sostituire i percorsi e `SCRIPT_ID`:

```bash
mkdir /tmp/drive-sorter-clasp-link
cd /tmp/drive-sorter-clasp-link
/percorso/drive-sorter/node_modules/.bin/clasp clone SCRIPT_ID --rootDir src
cp .clasp.json /percorso/drive-sorter/.clasp.json
cd /percorso/drive-sorter
```

### Creare un nuovo progetto standalone

Anche la creazione può essere fatta in una directory temporanea, copiando poi soltanto il collegamento locale:

```bash
mkdir /tmp/drive-sorter-clasp-new
cd /tmp/drive-sorter-clasp-new
/percorso/drive-sorter/node_modules/.bin/clasp create --type standalone --title "Drive Sorter" --rootDir src
cp .clasp.json /percorso/drive-sorter/.clasp.json
cd /percorso/drive-sorter
```

Verificare che Git continui a ignorarlo:

```bash
git check-ignore .clasp.json
```

Non inserire Script ID, folder ID o chiavi API nei sorgenti, in `.env` o nella documentazione. `.env` e le sue varianti locali, `.clasp.json`, `.clasprc.json`, `node_modules` e `src/build` sono esclusi da Git; soltanto un eventuale `.env.example` privo di segreti è ammesso dal `.gitignore`.

## Pipeline TypeScript 7 e `clasp`

I file `src/*.ts` sono moduli sorgente leggibili, ma Apps Script riceve JavaScript. Con TypeScript 7 e `clasp` 3 la pipeline è esplicita e non usa bundler:

- `npm run typecheck` esegue il controllo strict senza emissione;
- `npm run build` pulisce soltanto la directory generata `src/build` e compila ogni `src/*.ts` nel corrispondente `src/build/*.js`, senza emettere output se TypeScript fallisce;
- i sorgenti non usano `import`/`export` runtime: Apps Script li carica nello stesso ambiente globale;
- `npm run verify` esegue typecheck, build e controlli statici/puri, inclusa la scansione delle chiamate Drive vietate;
- `.claspignore` consente il push soltanto di `src/appsscript.json` e `src/build/*.js`.

Comandi disponibili:

```bash
npm run typecheck  # controllo TypeScript, nessuna emissione
npm run build      # genera src/build/*.js
npm run verify     # typecheck + build + verifiche statiche/pure
npm run status     # build + clasp status
npm run push       # build + clasp push
npm run pull       # clasp pull: usare solo intenzionalmente
npm run open       # apre l'editor Apps Script
```

Con `clasp` 3.3, `status` è l'alias di `show-file-status` e mostra il set di file destinato al push, non un diff remoto. L'output atteso contiene il manifest e i JavaScript in `src/build`; i `.ts` possono comparire come **Untracked files** nel significato di `clasp`, perché sono deliberatamente esclusi dal push. Non confondere questo elenco con `git status`.

Prima del primo upload:

```bash
npm run verify
npm run status
npm run push
npm run open
```

Non usare `--force` al primo push senza aver compreso un eventuale conflitto del manifest. `npm run pull` può importare i JavaScript remoti nell'albero `src`: eseguirlo soltanto con una working tree controllata e revisionare subito il diff.

`clasp push` sincronizza il progetto come insieme completo, non come aggiornamento isolato dei soli file modificati. Prima del push verificare che non esistano file mantenuti soltanto nell'editor online: se non sono nel set mostrato da `npm run status`, possono essere rimossi dal progetto remoto.

## Struttura Drive

Esempio:

```text
DOCUMENTI/
├── Da smistare/
├── Da controllare/
├── Casa/
├── Lavoro/
├── Personali/
└── Altro/
```

`ROOT_FOLDER_ID` identifica `DOCUMENTI`; inbox e review devono essere cartelle distinte e discendenti della root. L'indice candidato è ricorsivo e produce path relativi come `Casa/Tributi/IMU`.

Non vengono mai proposte a Gemini come destinazioni normali:

- la root;
- la inbox;
- la cartella review;
- qualsiasi cartella chiamata `Da smistare`, `Da controllare`, `Duplicati`, come il nome effettivo della inbox/review o come `DUPLICATE_FOLDER_NAME`, senza distinzione tra maiuscole e minuscole;
- gli ID elencati in `EXCLUDED_FOLDER_IDS`;
- tutti i discendenti di una cartella riservata o esclusa.

L'indice si ferma a `MAX_FOLDER_DEPTH`. Se supera `MAX_CANDIDATE_FOLDERS`, il batch fallisce in sicurezza prima di inviare una lista troncata a Gemini.

### Come trovare un folder ID

Aprire la cartella in Drive. Nell'URL:

```text
https://drive.google.com/drive/folders/FOLDER_ID
```

copiare soltanto `FOLDER_ID`, non l'intero URL. La configurazione rifiuta URL e ID troppo corti. L'account che esegue lo script deve poter leggere root/inbox/review e, quando `DRY_RUN=false`, spostare file dalla inbox e scrivere nelle destinazioni.

## Gemini API

### Creare e conservare la API key

1. Aprire [Google AI Studio – API keys](https://aistudio.google.com/apikey).
2. Creare o selezionare un progetto Google Cloud dedicato.
3. Generare una chiave e salvarla come Script Property `GEMINI_API_KEY`.
4. Non inserirla mai in Git, nel codice, in `.env` o nei log.
5. Se disponibile per il progetto, applicare restrizioni d'uso appropriate e ruotare la chiave se sospettata compromessa.

La richiesta usa l'header `x-goog-api-key`; il valore non viene aggiunto all'URL e non viene incluso nei log applicativi.

Ad agosto 2026, la [guida ufficiale sulle chiavi Gemini](https://ai.google.dev/gemini-api/docs/generate-content/api-key) richiede di preferire una nuova **Auth key** creata in AI Studio; Google indica che le vecchie Standard API key non conformi alla migrazione verranno rifiutate da settembre 2026. Se una chiave esistente smette di funzionare, crearne una nuova in AI Studio invece di inserirla nell'URL o allentare le protezioni del codice.

### Scegliere il modello

`GEMINI_MODEL` è obbligatoria e non ha un default nel codice, così un cambio di disponibilità non richiede modifiche in più file. Il valore consigliato attuale è:

```text
gemini-3.5-flash-lite
```

[Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) è un modello GA multimodale che supporta testo, immagini, PDF e output strutturato ed è adatto a parsing/classificazione a basso costo. Il modello disponibile e le quote possono cambiare: verificare sempre la [pagina modelli](https://ai.google.dev/gemini-api/docs/models) e le disponibilità del proprio progetto. È accettato anche il prefisso `models/`, ma il valore senza prefisso è più chiaro.

I modelli recenti possono usare token di ragionamento: il codice lascia il livello predefinito del modello per mantenere `GEMINI_MODEL` intercambiabile e riserva sufficiente margine in `maxOutputTokens`. Flash-Lite usa attualmente un livello minimo predefinito; un altro modello può avere latenza e consumo maggiori e deve essere verificato con `testGemini()`.

`testGemini()` effettua una richiesta JSON minima, non legge Drive e non modifica file.

Il client usa il metodo REST stateless `generateContent` tramite `UrlFetchApp`, che resta supportato ma nelle guide più recenti è classificato come API legacy rispetto alla nuova Interactions API. Per questa singola classificazione senza stato evita SDK e dipendenze; una futura migrazione a Interactions è intenzionalmente rinviata e richiederà una nuova verifica di schema, quote e compatibilità Apps Script.

Nel JSON REST di `responseFormat.text.mimeType` il client usa il valore enum `APPLICATION_JSON`: il backend `TextResponseFormat.MimeType` lo richiede anche se alcuni esempi SDK/documentali rappresentano lo stesso valore come MIME string `application/json`.

## Script Properties

Aprire **Apps Script → Impostazioni progetto → Proprietà script**. Non esiste una funzione che scrive automaticamente segreti o ID. `showSetupInstructions()` stampa un promemoria sicuro e non legge né modifica Drive o proprietà.

### Obbligatorie

| Proprietà | Uso |
| --- | --- |
| `ROOT_FOLDER_ID` | Root dell'albero documentale. |
| `INBOX_FOLDER_ID` | Cartella `Da smistare`, discendente della root. |
| `REVIEW_FOLDER_ID` | Cartella `Da controllare`, discendente della root e distinta dalla inbox. |
| `GEMINI_API_KEY` | Chiave Gemini; non viene mai loggata intenzionalmente. |
| `GEMINI_MODEL` | Modello disponibile, consigliato `gemini-3.5-flash-lite`. |

### Opzionali e default

Tutte le proprietà sono stringhe nell'interfaccia Apps Script. Usare esattamente `true`/`false` per i booleani e il punto per i decimali.

| Proprietà | Default | Vincoli/comportamento |
| --- | ---: | --- |
| `DRY_RUN` | `true` | Blocca ogni mutazione Drive. |
| `CONFIDENCE_THRESHOLD` | `0.85` | Numero tra `0` e `1`; sotto soglia il file va in review. |
| `MAX_FILES_PER_RUN` | `10` | Intero `1..100`. |
| `MAX_FOLDER_DEPTH` | `10` | Intero `1..100`; i figli oltre il limite non sono candidati. |
| `DUPLICATE_FOLDER_NAME` | `Duplicati` | Nome sicuro `1..200` caratteri, senza slash o controlli. |
| `RENAME_FILES` | `false` | Abilita il solo suggerimento nome validato; l'estensione originale è sempre preservata. |
| `MAX_INPUT_BYTES` | `10485760` | Massimo input preparato, `1..12582912` byte (12 MiB) per contenere l'espansione base64. |
| `MAX_HASH_BYTES` | `10485760` | Massimo blob per SHA-256, `1..52428800` byte. |
| `MAX_TEXT_CHARS` | `100000` | Testo UTF-8 inviato, `1000..1000000` caratteri; l'eccesso è troncato. |
| `MAX_CANDIDATE_FOLDERS` | `500` | Intero `1..2000`; non viene mai inviata una lista parziale. |
| `MAX_RUN_MILLIS` | `270000` | Budget applicativo `60000..330000` ms, con margine prima del limite Apps Script. |
| `MAX_RETRIES` | `3` | Retry dopo il tentativo iniziale, `0..8`. |
| `RETRY_BASE_DELAY_MS` | `1000` | Base backoff, `100..60000` ms. |
| `RETRY_MAX_DELAY_MS` | `30000` | Tetto backoff, `100..120000` ms e non inferiore alla base. |
| `TRIGGER_MINUTES` | `15` | Solo `1`, `5`, `10`, `15` o `30`. |
| `EXCLUDED_FOLDER_IDS` | vuoto | Lista CSV di folder ID, senza URL; esclude l'intero sottoalbero e non può contenere `ROOT_FOLDER_ID`. |
| `ALLOW_FOLDER_CREATION` | `false` | Abilita soltanto il rarissimo fallback descritto sotto. |
| `FALLBACK_FOLDER_NAME` | `Altro` | Nome applicativo fisso e validato, mai suggerito da Gemini. |
| `FOLDER_CREATION_MODE` | `OFF` | `OFF`, `SUGGEST` o `AUTO`; `SUGGEST` è interamente read-only, `AUTO` abilita la sola creazione validata. |
| `FOLDER_CREATION_CONFIDENCE_THRESHOLD` | `0.97` | Soglia `0..1` distinta; con `SUGGEST`/`AUTO` deve essere almeno `CONFIDENCE_THRESHOLD`. |
| `FOLDER_CREATION_MAX_FINAL_DEPTH` | `MAX_FOLDER_DEPTH` | Profondità finale `1..100`, misurata dalla root e mai superiore a `MAX_FOLDER_DEPTH`. |
| `FOLDER_CREATION_MAX_NEW_SEGMENTS` | `1` | Intero `1..10`; in questa versione `AUTO` accetta comunque esattamente una nuova foglia. |
| `FOLDER_CREATION_MIN_SIBLING_EVIDENCE` | `2` | Intero `2..100`; numero minimo di cartelle sorelle reali e distinte da citare. |
| `FOLDER_CREATION_SEMANTIC_GROUPS_JSON` | `[["IMU","TARI","TASI"]]` | Allowlist JSON per `SEMANTIC` in `AUTO`; gruppi di `3..50` nomi sicuri/univoci e almeno `MIN_SIBLING_EVIDENCE + 1`. `[]` disabilita l'autorizzazione automatica semantica. |

Esempio descrittivo, senza valori reali:

```text
ROOT_FOLDER_ID=ID_DELLA_ROOT
INBOX_FOLDER_ID=ID_DA_SMISTARE
REVIEW_FOLDER_ID=ID_DA_CONTROLLARE
GEMINI_API_KEY=CHIAVE_SALVATA_SOLO_NELLE_SCRIPT_PROPERTIES
GEMINI_MODEL=gemini-3.5-flash-lite
DRY_RUN=true
FOLDER_CREATION_MODE=OFF
FOLDER_CREATION_CONFIDENCE_THRESHOLD=0.97
FOLDER_CREATION_SEMANTIC_GROUPS_JSON=[["IMU","TARI","TASI"]]
```

Gli ID root, inbox e review devono essere tutti diversi. `DUPLICATE_FOLDER_NAME` non può coincidere con i nomi riservati o con i nomi effettivi di inbox/review. `FALLBACK_FOLDER_NAME` non può essere `Da smistare`, `Da controllare` o `Duplicati`, non può coincidere con inbox/review né con `DUPLICATE_FOLDER_NAME`.

## Formati documentali e limiti

| Formato | Preparazione |
| --- | --- |
| PDF (`application/pdf`) | Blob inviato inline a Gemini. |
| JPEG (`image/jpeg`) | Immagine inviata inline. |
| PNG (`image/png`) | Immagine inviata inline. |
| Testo (`text/plain`) | Decodifica UTF-8 e limite `MAX_TEXT_CHARS`. |
| DOC (`application/msword`) | Conversione Apps Script in PDF, poi invio inline. |
| DOCX | Conversione Apps Script in PDF, poi invio inline. |
| Google Docs | Esportazione in PDF tramite `getAs`, poi invio inline. |

Audio, video, fogli, presentazioni, archivi, shortcut e altri MIME non sono supportati da questa versione, anche se il modello scelto potrebbe accettarli. Un formato non supportato o un file oltre `MAX_INPUT_BYTES` produce `UNSUPPORTED`: in `DRY_RUN`/`SUGGEST` viene solo registrato; con scritture abilitate in `OFF`/`AUTO` viene spostato in review con un nome non conflittuale. Un fallimento della conversione DOC/DOCX/Google Docs è invece trattato prudentemente come `API_ERROR`, perché il codice non può distinguere un outage/quota temporaneo da un limite permanente: il file resta nella inbox anche fuori da `DRY_RUN`.

Il limite viene ricontrollato dopo la conversione. I file Google Workspace possono riportare dimensione zero prima dell'esportazione. Base64, quote `UrlFetchApp`, conversioni Apps Script e limiti del modello introducono ulteriori limiti effettivi: aumentare `MAX_INPUT_BYTES` fino al massimo configurabile non garantisce che una richiesta molto grande riesca. Il default di 10 MiB è intenzionalmente conservativo.

## Validazione e gestione della confidenza

Gemini deve restituire esattamente:

```json
{
  "targetFolderId": null,
  "targetFolderPath": null,
  "documentType": "tipo breve",
  "suggestedFilename": null,
  "confidence": 0.0,
  "reason": "motivazione breve"
}
```

L'applicazione non usa il type system come confine di sicurezza. Controlla JSON, campi mancanti o extra, tipi, stringhe, caratteri di controllo, lunghezze, confidenza finita `0..1`, coerenza dei due campi null e corrispondenza esatta della coppia ID/path con l'indice affidabile.

Un ID inventato, un path non corrispondente, risposta bloccata/mancante, JSON invalido o schema non conforme diventa `CLASSIFICATION_UNCERTAIN`: con scritture abilitate in `OFF`/`AUTO` va in review; in `DRY_RUN`/`SUGGEST` resta nella inbox con il relativo log. Per una destinazione nulla o sotto soglia, `AUTO` può prima valutare la proposta descritta sotto e applica poi il fallback a cartella esistente o review. Un errore `API_ERROR` o `INTERNAL_ERROR` lascia invece il file nella inbox quando possibile, in modo da non confondere un outage con una decisione documentale.

### Due soglie indipendenti e fallback

`CONFIDENCE_THRESHOLD` (default `0.85`) decide se una cartella **già esistente** è utilizzabile. `FOLDER_CREATION_CONFIDENCE_THRESHOLD` (default `0.97`) decide se è sicuro creare una cartella che ancora non esiste. La seconda non sostituisce né alza implicitamente la prima e, quando `SUGGEST` o `AUTO` è abilitato, la configurazione richiede che sia maggiore o uguale alla soglia normale.

Esempio: Gemini classifica un file verso `Casa/Roma/IMU` con confidenza `0.90`. Il risultato supera `0.85` ma non `0.97`. In `AUTO` il sorter può cercare una proposta migliore; se la nuova cartella viene rifiutata o il modello restituisce `null`, il file viene comunque spostato nella cartella IMU esistente. Se invece anche la destinazione esistente è sotto `0.85`, il file va in `Da controllare`.

| Modalità | Nessuna creazione autorizzata | Scritture Drive |
| --- | --- | --- |
| `OFF` | Usa una destinazione esistente se raggiunge `CONFIDENCE_THRESHOLD`; altrimenti `Da controllare`. Non esegue la seconda richiesta Gemini. | Normali, salvo `DRY_RUN`. |
| `SUGGEST` | Logga proposta e decisione e lascia sempre il file nella inbox, anche se esiste un fallback. | Nessuna: la modalità è interamente read-only. |
| `AUTO` | Usa il fallback esistente se raggiunge `CONFIDENCE_THRESHOLD`; altrimenti `Da controllare`. | Può creare e poi spostare soltanto dopo tutti i controlli. |

`DRY_RUN=true` prevale su tutte le modalità e impedisce ogni scrittura.

## Proposte di nuove cartelle dalla review

La fase opzionale viene considerata soltanto con `SUGGEST` o `AUTO`, dopo una classificazione normale valida, quando non è stata scelta alcuna destinazione oppure la sua confidenza è inferiore alla soglia di creazione. Non viene avviata per formati non supportati, output iniziale invalido, errori API o errori interni. Riusa lo stesso documento preparato e lo stesso indice e fa al massimo una richiesta Gemini aggiuntiva per file/run.

Esempi di pattern attesi:

```text
Tributi/IMU/{2024, 2025} + documento IMU 2023
  -> proposta: parent=Tributi/IMU, nuova foglia=2023

Casa/Roma/{IMU, TARI} + documento TASI
  -> proposta: parent=Casa/Roma, nuova foglia=TASI
```

Gemini restituisce un oggetto strutturato con parent ID/path esistente, segmenti proposti, tipo `TEMPORAL` o `SEMANTIC`, ID delle cartelle sorelle usate come evidenza, confidenza e motivo breve. Non restituisce mai l'ID della nuova cartella e non può creare nulla direttamente.

L'applicazione autorizza la proposta soltanto se:

- parent ID/path ed evidence ID corrispondono esattamente all'indice completo e non riservato;
- almeno `FOLDER_CREATION_MIN_SIBLING_EVIDENCE` cartelle reali, distinte e figlie dirette dello stesso parent sono citate;
- nomi con slash, traversal, controlli, URL/ID, nomi operativi o equivalenti case-insensitive a un figlio esistente vengono rifiutati;
- profondità e numero di segmenti rispettano entrambi i limiti;
- `AUTO` crea esattamente una foglia, accetta solo pattern `TEMPORAL`/`SEMANTIC` e richiede la soglia di creazione;
- un anno `TEMPORAL` completa una sequenza contigua plausibile;
- per `SEMANTIC`, nome proposto e nomi di tutte le evidenze devono appartenere allo stesso gruppo esplicito in `FOLDER_CREATION_SEMANTIC_GROUPS_JSON`; la sola parentela o somiglianza dei nomi non autorizza nulla.

L'allowlist semantica è una stringa JSON nelle Script Properties. Per esempio:

```json
[
  ["IMU", "TARI", "TASI"],
  ["Luce", "Gas", "Acqua"]
]
```

Ogni gruppo deve contenere `3..50` nomi distinti già in forma sicura e, quando le proposte sono abilitate, almeno `FOLDER_CREATION_MIN_SIBLING_EVIDENCE + 1` nomi. Duplicati, nomi operativi, slash, traversal, valori vuoti, gruppi duplicati o oltre i limiti fanno fallire la configurazione. Usare `[]` per disabilitare l'autorizzazione `SEMANTIC` in `AUTO`; `SUGGEST` può ancora mostrarne una per la valutazione manuale, senza scrivere. Aggiungere un gruppo equivale ad autorizzare una categoria di creazioni automatiche: farlo soltanto dopo averla osservata in `SUGGEST`.

Subito prima della creazione vengono ricontrollati file sorgente, parent, ancestry, evidenze ed eventuali figli equivalenti sul Drive reale. Dopo la creazione l'indice in memoria viene aggiornato con l'ID reale. Se la cartella viene creata ma il successivo spostamento fallisce, resta intatta e il log segnala esplicitamente la mutazione parziale; il progetto non elimina mai la cartella o il file.

## Duplicati, collisioni e rinomina

### Duplicati esatti

La prima versione dichiara un duplicato soltanto con SHA-256 identico:

1. confronta prima la dimensione con i file direttamente presenti nella destinazione;
2. calcola gli hash solo per file non Google Workspace e non oltre `MAX_HASH_BYTES` (inclusi i file binari da zero byte);
3. se l'hash è identico, conserva l'originale e pianifica il nuovo file in `Destinazione/Duplicati`;
4. crea `Duplicati` solo quando manca, solo fuori da `DRY_RUN` e solo per un duplicato esatto.

`ALLOW_FOLDER_CREATION=false` non impedisce la creazione della cartella speciale `Duplicati`: quella proprietà controlla soltanto il fallback estremo. Nessun duplicato viene eliminato. Per i file nativi Google Workspace l'hash byte-per-byte non viene calcolato, quindi non sono dichiarati automaticamente duplicati esatti.

La stessa regola vale quando la destinazione applicativa è la review: un file incerto o non supportato byte-identico a un file già presente in `Da controllare` viene pianificato in `Da controllare/Duplicati`.

File con lo stesso nome ma hash differente o non disponibile sono documenti distinti. I relativi ID vengono riportati in `possibleDuplicateOfFileIds`; Gemini non decide duplicati semantici e non causa spostamenti automatici per sola somiglianza.

### Collisioni filename

Se il nome esiste già, il progetto non sovrascrive: genera `documento (2).pdf`, `documento (3).pdf` e così via, preservando l'estensione. La stessa protezione vale per destinazione, review e `Duplicati`.

Con `RENAME_FILES=true`, il modello può suggerire soltanto lo stem. Il codice sanitizza caratteri problematici, limita la lunghezza, ignora l'estensione suggerita e conserva quella originale. Con `RENAME_FILES=false`, il nome originale resta invariato salvo il suffisso necessario a evitare una collisione. In `DRY_RUN` nessuna rinomina viene applicata.

## Creazione rara della cartella fallback

Il fallback è deliberatamente più restrittivo di una normale classificazione:

- viene valutato soltanto quando l'indice contiene **zero** cartelle candidate normali e la inbox contiene almeno un file;
- richiede contemporaneamente `ALLOW_FOLDER_CREATION=true` e `DRY_RUN=false`;
- crea sotto la root soltanto `FALLBACK_FOLDER_NAME`, dopo validazione e controllo contro i nomi riservati;
- il nome e l'ID non provengono mai da Gemini;
- dopo la creazione l'indice viene ricostruito.

`ALLOW_FOLDER_CREATION` è indipendente da `FOLDER_CREATION_MODE`: il primo controlla soltanto questo bootstrap fisso quando l'indice è vuoto; il secondo controlla le nuove foglie proposte dalla review dentro una tassonomia già esistente. Non serve attivare `ALLOW_FOLDER_CREATION` per usare `SUGGEST` o `AUTO`.

Se esiste almeno una candidata ma nessuna è adatta, il fallback `Altro` non viene creato. La proposta review può essere valutata soltanto secondo la modalità descritta sopra; se non viene autorizzata, in `OFF`/`AUTO` il file va in `Da controllare`, mentre in `SUGGEST` resta nella inbox. Lasciare il fallback fisso disabilitato finché non esiste un caso operativo realmente necessario.

## DRY_RUN e rollout consigliato

Con `DRY_RUN=true` tutte le operazioni Drive del sorter sono di sola lettura:

- nessun `moveTo`;
- nessun `setName`;
- nessuna cartella `Duplicati`, fallback o tassonomica creata;
- preparazione, classificazione e validazione vengono comunque eseguite; collisioni e SHA-256 vengono controllati quando esiste una destinazione applicativa da pianificare;
- un piano riuscito ha `action: "DRY_RUN"` e `wouldAction` indica anche eventuali `SUGGEST_FOLDER` o `CREATE_FOLDER_AND_MOVE`; un errore API/interno usa invece `action: "ERROR"` e lascia il file nella inbox.

Anche `FOLDER_CREATION_MODE=SUGGEST` impedisce tutte le mutazioni, indipendentemente dal valore memorizzato di `DRY_RUN`: registra classificazione, proposta, evidenze e fallback, poi lascia il file in inbox. Lo stesso file può quindi consumare nuovamente una o due chiamate Gemini al run successivo.

Rollout:

1. configurare tutte le proprietà con `DRY_RUN=true` e `FOLDER_CREATION_MODE=OFF`;
2. eseguire i test manuali di sola lettura, incluso `testFolderCreationProposal()`;
3. impostare `FOLDER_CREATION_MODE=SUGGEST` e provare pochi documenti rappresentativi: Drive deve rimanere invariato;
4. controllare parent/path, pattern, evidenze, proposta, entrambe le soglie e l'eventuale fallback esistente;
5. provare casi temporali, semantici, ambigui, over-depth e contenenti prompt injection;
6. impostare `FOLDER_CREATION_MODE=AUTO` mantenendo ancora `DRY_RUN=true` e verificare i piani `CREATE_FOLDER_AND_MOVE`;
7. solo dopo impostare esplicitamente `DRY_RUN=false` per un batch manuale molto piccolo;
8. verificare cartella creata, spostamento, collisioni, duplicati e log di eventuali esiti parziali prima di installare il trigger.

Un file rimasto nella inbox in `DRY_RUN` verrà riclassificato in una futura esecuzione: la deduplicazione delle chiamate vale all'interno del singolo run. Fuori da `DRY_RUN`, un file spostato non è più figlio diretto della inbox e non viene ripreso dal batch successivo.

## Entry point e test manuali

Dopo `npm run push`, aprire l'editor con `npm run open`, selezionare una funzione e premere **Esegui**.

| Funzione | Effetto |
| --- | --- |
| `showSetupInstructions()` | Stampa la guida proprietà; non legge/modifica Drive. |
| `testHashing()` | Self-test SHA-256 in memoria; nessun accesso Drive. |
| `testFilenameCollision()` | Test puro di collisione/estensione; nessun accesso Drive. |
| `testDriveAccess()` | Legge la inbox e logga nome, ID, MIME e size; nessuna modifica. |
| `testFolderTree()` | Costruisce e stampa l'indice candidato; nessuna creazione. |
| `testGemini()` | Richiesta minima Gemini; nessun accesso Drive. |
| `testFolderCreationProposal()` | Usa il primo file diretto della inbox e forza in memoria `DRY_RUN` + `SUGGEST`; prepara il documento e fa al massimo una richiesta proposta, senza modificare Drive. |
| `runSorter()` | Esegue il batch; inizialmente usarlo solo con `DRY_RUN=true`. |
| `installTimeTrigger()` | Crea esplicitamente un trigger `runSorter`. |
| `removeTimeTriggers()` | Rimuove soltanto i trigger clock del progetto con handler esatto `runSorter`, visibili all'utente corrente. |

I primi test Drive/Gemini possono mostrare la schermata di consenso OAuth. Verificare sempre che il progetto aperto sia quello collegato da `.clasp.json`.

## Autorizzazioni Apps Script

Il manifest conserva la timezone preesistente `America/New_York`, usa il runtime V8 e tre scope espliciti:

| Scope | Motivo |
| --- | --- |
| `https://www.googleapis.com/auth/drive` | Leggere l'albero, leggere blob, spostare/rinominare file e creare le sole cartelle consentite. |
| `https://www.googleapis.com/auth/script.external_request` | Chiamare Gemini con `UrlFetchApp`. |
| `https://www.googleapis.com/auth/script.scriptapp` | Creare e rimuovere i trigger espliciti. |

Lo scope Drive è ampio: Google non offre uno scope “solo sposta file arbitrari” adatto a questo flusso. Il progetto limita le operazioni a livello di codice e verifica statica, ma l'autorizzazione OAuth in sé consente più di quanto il sorter esegua. Autorizzare soltanto account e progetto sotto il proprio controllo.

Il progetto non abilita il Drive Advanced Service. La prima esecuzione viene autorizzata dall'utente al browser; un trigger installabile viene poi eseguito come l'utente che lo ha creato.

## Trigger

Nessun trigger viene creato automaticamente. Per installarlo:

1. mantenere `DRY_RUN=true` e verificare un batch manuale;
2. impostare `TRIGGER_MINUTES` su `1`, `5`, `10`, `15` o `30`;
3. eseguire manualmente `installTimeTrigger()`.

L'installazione è idempotente per l'utente corrente: se esiste già un trigger clock `runSorter`, non ne aggiunge un secondo. Cambiare `TRIGGER_MINUTES` non modifica un trigger esistente; eseguire prima `removeTimeTriggers()` e poi reinstallarlo.

`removeTimeTriggers()` non elimina trigger con altri handler. I trigger installabili appartengono all'utente che li crea: in un progetto con più editor, ogni utente deve gestire i propri. Il lock di script evita comunque due elaborazioni contemporanee dello stesso progetto.

## Logging e audit

La prima versione scrive una riga JSON con `console.log` per:

- inizio/fine/fallimento del batch (`event: "BATCH"`);
- ogni file (`event: "FILE"`);
- lock non acquisito;
- funzioni di test e trigger.

I record file includono timestamp, run ID, file ID, nome originale, MIME, size, classificazione, azione, azione pianificata in dry run, destinazione, filename risultante, duplicato esatto, possibili duplicati, categoria errore, durata e motivo. Per la creazione includono anche modalità, decisione, proposta validata e bounded, errori di validazione, esito soglia, ID/path realmente creati e indicatore di mutazione parziale; il contenuto del documento non viene loggato. Le azioni includono `MOVE`, `REVIEW`, `DUPLICATE`, `SUGGEST_FOLDER`, `CREATE_FOLDER_AND_MOVE`, `DRY_RUN`, `UNSUPPORTED`, `ERROR` e `SKIP`.

Il record batch conta richieste di proposta, proposte accettate/rifiutate, errori API della seconda richiesta, cartelle realmente create ed esiti parziali. Una proposta accettata in `SUGGEST` è soltanto un suggerimento validato, non una cartella creata.

Aprire **Apps Script → Esecuzioni**, selezionare il run e consultare i log. Non è incluso un Google Sheet di audit e i log seguono la retention della piattaforma. Chiavi con nomi sensibili e pattern comuni di API key/token vengono redatti; richieste e risposte Gemini complete non vengono loggate. Nomi file, folder path e ID sono invece dati operativi e possono essere sensibili: limitare l'accesso al progetto e ai log.

## Free Tier, quote e retry

Al momento della redazione, `gemini-3.5-flash-lite` è disponibile come modello stabile e la [pagina prezzi Gemini](https://ai.google.dev/gemini-api/docs/pricing) indica input/output gratuiti nel Free Tier. Prezzi, modelli e limiti non sono garantiti e possono cambiare.

Le [rate limit Gemini](https://ai.google.dev/gemini-api/docs/rate-limits) dipendono da modello, progetto, tier e stato account; vengono misurate tipicamente in RPM, TPM e RPD e sono applicate per progetto, non per singola API key. Controllare i limiti effettivi in AI Studio invece di copiarne valori nella configurazione.

Il progetto riduce il consumo con:

- massimo 10 file per run di default;
- una costruzione dell'albero per run, più una sola ricostruzione nell'eccezionale caso di creazione del fallback;
- una classificazione normale per file e, solo quando necessaria/abilitata, al massimo una seconda richiesta per la proposta; nessuna ripetizione dello stesso stadio nello stesso run;
- output Gemini limitato e testo/documenti bounded;
- guardia di durata prima del limite Apps Script;
- retry limitato con backoff esponenziale, jitter, rispetto di `Retry-After` e controllo della deadline prima di ogni tentativo o attesa.

Vengono ritentati errori di trasporto senza risposta e risposte HTTP transitorie `408`, `429`, `500`, `502`, `503` e `504`. Non si ritentano automaticamente `400`, `401` o `403`. Ogni singola attesa è comunque limitata a 60 secondi anche se `RETRY_MAX_DELAY_MS` è maggiore. Dopo l'esaurimento dei retry il file resta nella inbox. Un `429` per quota giornaliera non si risolve con retry ravvicinati: ridurre frequenza/batch o attendere il reset indicato dal provider.

La modalità proposta può quindi arrivare a circa due richieste Gemini per file invece di una. `OFF` evita sempre la seconda richiesta; `SUGGEST` può ripeterla a ogni run perché lascia intenzionalmente il file in inbox. Sul Free Tier conviene usare batch piccoli, trigger meno frequenti e una fase `SUGGEST` breve ma rappresentativa prima di `AUTO`.

Esistono inoltre [quote Apps Script](https://developers.google.com/apps-script/guides/services/quotas) per runtime, `UrlFetchApp`, trigger e conversioni. `MAX_RUN_MILLIS` è una guardia applicativa, non aumenta la quota della piattaforma.

## Privacy e trattamento dei contenuti

Il sorter invia a Gemini nome file, MIME, size, lista di cartelle candidate e contenuto preparato. Quando la proposta è abilitata può inviare una seconda volta lo stesso documento insieme al contesto bounded di parent e cartelle sorelle esistenti. Non usare documenti reali finché non è stata valutata la base giuridica, la policy aziendale e la classificazione dei dati.

Le [condizioni Gemini API](https://ai.google.dev/gemini-api/terms) distinguono servizi gratuiti e a pagamento. In generale, per i servizi gratuiti Google dichiara che input/output possono essere usati per migliorare i prodotti e possono essere esaminati da revisori umani; raccomanda di non inviare informazioni sensibili, riservate o personali. Le condizioni correnti prevedono eccezioni regionali, inclusa l'applicazione dei termini di trattamento dei servizi a pagamento per utenti nello Spazio Economico Europeo, Svizzera e Regno Unito, e regole specifiche per applicazioni rese disponibili ad altri utenti. Per i servizi associati a un progetto con billing attivo, Google dichiara di non usare prompt, file e risposte per migliorare i prodotti, pur mantenendo log limitati per sicurezza e obblighi legali.

Queste regole possono cambiare e dipendono da regione, account, billing e modalità d'uso. Verificare le condizioni vigenti e non dedurre la privacy soltanto dall'etichetta “Free Tier”. `DRY_RUN` non cambia il trattamento dei dati Gemini.

## Sicurezza

- Nessun sorgente applicativo chiama `setTrashed(true)`, API di eliminazione Drive o primitive legacy di rimozione.
- `npm run verify` controlla staticamente le chiamate vietate e impone che `moveTo`, `setName` e `createFolder` restino nel confine Drive sorvegliato.
- Gemini riceve solo destinazioni, parent ed evidenze esistenti e non ha tool, credenziali o funzioni per modificare Drive; una nuova cartella non ha un ID finché non la crea il codice.
- Ogni destinazione viene risolta nuovamente dall'indice affidabile subito prima della mutazione; la creazione ricontrolla anche parent/path, ancestry, evidenze, profondità e figli equivalenti sul Drive reale.
- `DRY_RUN` e `SUGGEST` terminano prima del confine di mutazione; i test locali verificano entrambe le barriere.
- Il file deve essere ancora non cestinato, figlio diretto della inbox e identico allo snapshot pre-classificazione per nome, MIME, size e data di modifica.
- Non esiste sovrascrittura: ogni collisione produce un nome nuovo.
- Errori per file sono isolati e non fermano il resto del batch.
- Il lock impedisce batch concorrenti; il codice non riprocessa due volte lo stesso ID nel medesimo run.
- Chiavi e ID non sono hardcoded; `GEMINI_API_KEY` è letta soltanto dalle Script Properties.

Le Script Properties sono accessibili a chi può modificare il progetto Apps Script e non sostituiscono un secret manager dedicato. Ridurre gli editor, usare un progetto/API key dedicati e ruotare la chiave quando necessario.

## My Drive e Shared Drives

Questa versione usa il servizio nativo `DriveApp` ed è progettata per una gerarchia in **My Drive**. Google raccomanda il Drive Advanced Service per il supporto completo agli Shared Drives. In uno Shared Drive, enumerazione, conversione o `moveTo` possono fallire in base a supporto API, ruolo e permessi sul parent sorgente e sulla destinazione.

Non è stato aggiunto automaticamente lo scope/servizio avanzato per mantenere l'architettura minima. Se la root è in uno Shared Drive:

1. mantenere `DRY_RUN=true`;
2. eseguire `testDriveAccess()` e `testFolderTree()` con l'utente che installerà il trigger;
3. verificare i permessi di organizzazione/spostamento;
4. considerare un adattamento esplicito al Drive Advanced Service prima dell'uso live.

Non assumere che un test riuscito in My Drive garantisca lo stesso comportamento in uno Shared Drive.

## Rischi e limiti noti

- La classificazione AI può essere errata anche con confidenza alta; la soglia non è una garanzia.
- Anche una proposta `SEMANTIC` ad alta confidenza può essere concettualmente sbagliata; mantenere una soglia più alta, evidenze forti e una fase `SUGGEST` rappresentativa.
- `LockService` coordina le esecuzioni dello script, non modifiche simultanee fatte da persone o altri software.
- Tra controllo collisione e mutazione un attore esterno può creare una gara sul filename; Drive consente nomi uguali, quindi non avviene sovrascrittura, ma può servire revisione manuale.
- Uno spostamento e una rinomina sono due chiamate Drive: se la seconda fallisce dopo la prima, il file può risultare già spostato con il nome originale. Il log segnala l'errore; ispezionare Drive senza eliminare nulla.
- Creazione e spostamento sono chiamate separate: se la nuova cartella viene creata ma una verifica o il move fallisce, la cartella può restare vuota. Il log la registra come esito parziale e il codice non la elimina.
- Il rilevamento duplicati esatti non copre file Google Workspace nativi né file oltre `MAX_HASH_BYTES`.
- Lo stesso nome con contenuto diverso o hash non disponibile resta un documento distinto; gli eventuali candidati sono indicati nel campo `possibleDuplicateOfFileIds`.
- La conversione DOC/DOCX/Google Docs dipende dalle capacità e quote `getAs` di Apps Script.
- I file sono letti soltanto se figli diretti della inbox; le sottocartelle della inbox sono intenzionalmente escluse insieme ai loro discendenti.
- Non esiste memoria persistente delle classificazioni fallite: API outage e dry run possono causare una nuova chiamata in un run successivo.
- `SUGGEST` lascia intenzionalmente ogni file in inbox e può ripetere classificazione/proposta e relativi costi in ogni run.
- La deadline impedisce nuovi tentativi e mutazioni quando il margine è insufficiente, ma Apps Script non permette di interrompere una singola `UrlFetchApp.fetch` già in corso.
- L'indice interrompe presto alberi con troppe candidate, ma la traversata Drive iniziale non è interrompibile a metà di una singola chiamata/iterazione lenta; un albero eccezionalmente grande o un Drive degradato può ancora raggiungere il timeout della piattaforma.
- Un modello configurato con ragionamento dinamico molto profondo può raggiungere `MAX_TOKENS` anche con il margine previsto; il risultato viene rifiutato in modo fail-safe e, in `OFF`/`AUTO` live, va in review, quindi provare sempre il modello con `testGemini()` e un piccolo DRY_RUN.
- Il log su console non è un archivio audit permanente.
- `generateContent` è ancora supportato ma oggi è documentato come API legacy; una futura migrazione a Interactions API richiederà una verifica dedicata.

## Troubleshooting

### `clasp` non è autenticato o non trova il progetto

- abilitare Apps Script API;
- ripetere `npx clasp login` con l'account corretto;
- verificare che `.clasp.json` esista nella root e non contenga un URL al posto dello Script ID;
- eseguire `npm run status` e `npm run open`.

### `clasp status` mostra i `.ts` come untracked

È previsto. I TypeScript sono sorgenti locali; il push contiene manifest e `src/build/*.js`. Eseguire `npm run build` o, meglio, `npm run verify` prima di `npm run status`.

### Le funzioni non appaiono nell'editor Apps Script

Eseguire `npm run push`, ricaricare l'editor e controllare che `npm run status` includa `src/build/main.js`, `tests.js` e `triggers.js`.

### Errore di configurazione Drive

- usare soltanto ID, non URL;
- verificare che i tre ID siano distinti;
- verificare che inbox e review siano realmente sotto la root;
- eseguire `testDriveAccess()` con l'utente corretto;
- controllare policy Workspace o Shared Drive.

### Troppe cartelle candidate

Il sorter non tronca la lista. Ridurre `MAX_FOLDER_DEPTH`, aggiungere sottoalberi a `EXCLUDED_FOLDER_IDS` oppure aumentare prudentemente `MAX_CANDIDATE_FOLDERS` fino al massimo validato di 2000.

### `testGemini()` restituisce 401/403

Controllare `GEMINI_API_KEY`, progetto Cloud, abilitazione/accesso API, restrizioni della chiave, regione, billing e termini applicabili. Il codice non ritenta errori di autenticazione/autorizzazione.

### Gemini restituisce 404 o modello non disponibile

Aggiornare `GEMINI_MODEL` con un modello presente per il proprio progetto e compatibile con input multimodale e output JSON strutturato. Non modificare l'endpoint in più file: il modello è centralizzato nella proprietà.

### Gemini restituisce 400

Il modello potrebbe non supportare l'attuale schema di output strutturato o il documento potrebbe superare un limite effettivo. `testGemini()` e i normali log HTTP riportano soltanto i campi sanificati e limitati `status`, `code` e `message` dell'envelope di errore; richiesta completa, risposta completa e chiave non vengono loggate. Controllare quel dettaglio, modello e proprietà, poi ridurre `MAX_INPUT_BYTES`, `MAX_TEXT_CHARS` o numero di candidate se il messaggio indica un limite. Non viene fatto retry su 400.

### Errori 429/5xx

Controllare le quote reali in AI Studio, ridurre `MAX_FILES_PER_RUN`, aumentare l'intervallo trigger e consultare il log dei retry. Dopo il fallimento definitivo il file resta nella inbox e può essere riprovato da un run successivo.

### DOC/DOCX/Google Docs non viene classificato

Se il file o il PDF esportato supera `MAX_INPUT_BYTES`, il risultato è `UNSUPPORTED` e in `OFF`/`AUTO` live va in review; `SUGGEST` resta read-only. Se `getAs` fallisce per permessi, conversione, outage o quota, il risultato è invece `API_ERROR`: il batch continua e il file resta nella inbox per un tentativo successivo. Non abilitare un OCR o servizio esterno senza una decisione esplicita su sicurezza e privacy.

### Il trigger mantiene il vecchio intervallo

`TRIGGER_MINUTES` viene letto solo in fase di creazione. Eseguire `removeTimeTriggers()`, aggiornare la proprietà e poi `installTimeTrigger()`.

### Un file resta nella inbox

Controllare `errorKind`: `API_ERROR` e `INTERNAL_ERROR` lasciano intenzionalmente il file dov'è; lock non disponibile salta l'intero run. Anche `DRY_RUN=true` e `FOLDER_CREATION_MODE=SUGGEST` lo lasciano intenzionalmente in inbox. In `OFF`/`AUTO`, classificazione incerta o formato unsupported devono invece pianificare/spostare in review quando le scritture sono abilitate.

### Nessuna proposta di nuova cartella

- eseguire `testFolderTree()` e verificare che il parent e almeno `FOLDER_CREATION_MIN_SIBLING_EVIDENCE` figli diretti non riservati siano indicizzati;
- controllare `FOLDER_CREATION_MAX_FINAL_DEPTH`, `MAX_FOLDER_DEPTH` e `MAX_CANDIDATE_FOLDERS`;
- per `SEMANTIC`, controllare che proposta ed evidenze appartengano allo stesso gruppo in `FOLDER_CREATION_SEMANTIC_GROUPS_JSON`; `[]` disabilita questo pattern;
- eseguire `testFolderCreationProposal()` e leggere `status`, `proposalRequestMade` e `validationErrors`;
- verificare nei log `folderCreationDecision`: `NO_CONTEXT`, `MODEL_DECLINED` e `REJECTED` sono decisioni sicure, non errori Drive;
- ricordare che `OFF` non effettua la richiesta aggiuntiva e che un errore API della proposta lascia il file in inbox per un nuovo tentativo.

## Checklist operativa finale

- [ ] impostare ROOT_FOLDER_ID
- [ ] impostare INBOX_FOLDER_ID
- [ ] impostare REVIEW_FOLDER_ID
- [ ] impostare GEMINI_API_KEY
- [ ] impostare GEMINI_MODEL
- [ ] impostare FOLDER_CREATION_MODE=OFF
- [ ] verificare FOLDER_CREATION_CONFIDENCE_THRESHOLD (default 0.97)
- [ ] verificare FOLDER_CREATION_SEMANTIC_GROUPS_JSON o impostare []
- [ ] eseguire testDriveAccess
- [ ] eseguire testGemini
- [ ] eseguire testFolderTree
- [ ] eseguire testFolderCreationProposal
- [ ] eseguire runSorter con DRY_RUN
- [ ] controllare i log
- [ ] provare FOLDER_CREATION_MODE=SUGGEST e controllare che Drive resti invariato
- [ ] provare FOLDER_CREATION_MODE=AUTO mantenendo DRY_RUN=true
- [ ] solo dopo impostare DRY_RUN=false
