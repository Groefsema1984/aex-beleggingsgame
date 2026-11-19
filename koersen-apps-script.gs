/**
 * AEX Beleggingsgame – server (Google Sheets + Apps Script)  ·  versie 2 (fraudebestendig)
 * ======================================================================================
 * Deze server is de "bank" van het spel:
 *  - levert de koersen (GOOGLEFINANCE, ca. 15–20 min vertraagd);
 *  - registreert leerlingen (speler-ID + herstelcode);
 *  - voert ALLE orders zelf uit tegen de koers uit deze Sheet (de iPad kan geen koers,
 *    saldo of aantal vervalsen);
 *  - legt iedere transactie onuitwisbaar vast in het tabblad "Transacties";
 *  - maakt dagelijks een stand per leerling, bevriest de dag-30-eindstand en
 *    maakt een ranglijst voor de docent ("Overzicht");
 *  - bewaart het PO-logboek (startplan, evaluaties dag 10 en 20, eindreflectie) met
 *    tijdstempel, onwijzigbaar, en houdt actieve dagen en transacties per periode bij.
 *
 * INSTALLEREN: zie het stappenplan. Kort: plak deze code in Extensies > Apps Script,
 * voer "setup" uit, en implementeer als web-app (Uitvoeren als: Ikzelf · Toegang: Iedereen).
 * DEEL DEZE SPREADSHEET NIET MET LEERLINGEN.
 */

/* ------------------------------- INSTELLINGEN ------------------------------- */
const CFG = {
  START_CAPITAL: 10000,
  COST_FIXED: 2.00,
  COST_PERCENT: 0.10,            // % van de orderwaarde
  GAME_DAYS: 30,
  FIXED_START_DATE: null,        // bijv. '2026-11-23' voor de hele klas, of null = dag van aanmelden
  STRICT_EURONEXT_HOURS: true,   // false = buiten beurstijd direct tegen slotkoers
  MIN_MOTIVATION: 10,
  PENDING_RESERVE_BUFFER: 0.05,  // extra cash geblokkeerd bij een kooporder (koers kan stijgen)
  // Anti-fraude: een order wordt pas uitgevoerd tegen een koers die NA het inleggen tot stand kwam.
  MIN_DELAY_MIN: 2,              // minimaal zoveel minuten na inleggen
  MAX_WAIT_MIN: 30,              // als de koerstijd onbekend is: uiterlijk zoveel min na inleggen/opening
  MAX_ORDERS_PER_DAY: 40,
  DIVIDEND_TAX_PCT: 15,          // dividendbelasting in % (0 = leerlingen krijgen het brutobedrag)
  MAX_RESTORE_FAILS: 10,
  // ---- PO-eisen ----
  PERIOD_DAYS: 10,               // 3 periodes van 10 dagen: dag 1–10, 11–20, 21–30
  PERIOD_MIN_TX: 5,              // minimaal zoveel transacties per periode (dividend telt niet)
  PERIOD_MIN_DAYS: 3,            // ... op minimaal zoveel verschillende dagen
  LOG_GRACE_DAYS: 2,             // logboek: zoveel dagen uitloop na de inleverdag; daarna "te laat" (0 punten)
  REQUIRE_STARTPLAN: true,       // geen orders voordat het startplan is ingeleverd
  VISIT_GRACE_DAYS: 3,           // bezoekopdracht: uiterlijk zoveel dagen na de bezoekdatum inleveren
  PHOTO_MAX_KB: 1500             // maximale grootte per foto (de app verkleint foto's tot ca. 200–400 kB)
};

/* PO-logboek. dueDay = inleverdag (speeldag); tot en met dueDay + LOG_GRACE_DAYS is op tijd.
   openDay 0 = direct na aanmelden. min = minimaal aantal woorden per vraag. */
const LOGBOEK = [
  { id:'start', title:'Startplan', openDay:0, dueDay:0, intro:'Schrijf je plan vóór je eerste transactie. Pas daarna kun je handelen. Minimaal 300 woorden.',
    questions:[
      { q:'Strategie en risico', hint:'Hoe verdeel je je € 10.000? Kies je voor veel of weinig risico, veel of weinig spreiding (aandelen en sectoren), en waarom past dat bij jou?', min:70 },
      { q:'Mijn aandelen', hint:'Bespreek elk aandeel dat je gaat kopen: wat doet het bedrijf, waarom koop je het (minstens twee argumenten, bijvoorbeeld nieuws, sector, winst, dividend, rente of koersontwikkeling) en welk risico zie je? "De koers gaat stijgen" is geen argument: leg uit waarom.', min:150 },
      { q:'Mijn verwachting', hint:'Wat verwacht je na 10 dagen en na 30 dagen? Doe je het beter of slechter dan de AEX, en waarom?', min:40 },
      { q:'Mijn spelregels', hint:'Welke regels spreek je met jezelf af? Wanneer verkoop je (winst nemen, verlies beperken), wanneer koop je bij, en hoeveel stop je maximaal in één aandeel?', min:40 }
    ] },
  { id:'eval1', title:'Tussenevaluatie dag 10', openDay:10, dueDay:10, intro:'Kijk terug op dag 1 t/m 10 en kijk vooruit naar de komende 10 dagen. Minimaal 200 woorden.',
    questions:[
      { q:'Resultaat', hint:'Hoe sta je ervoor ten opzichte van de AEX (zie de stand hieronder)? Welke aandelen en welk nieuws verklaren dat? Was het een goede keuze of geluk?', min:60 },
      { q:'Plan en werkelijkheid', hint:'Heb je je aan je startplan en je spelregels gehouden? Wat ging goed en wat niet?', min:50 },
      { q:'Portefeuillecheck', hint:'Is je portefeuille nog goed voor de komende 10 dagen? Welke transacties ga je doen (of heb je gedaan) en waarom? Verander je niets, leg dan uit waarom dat de beste keuze is.', min:60 },
      { q:'Wat heb ik geleerd', hint:'Wat heb je deze periode geleerd over beleggen, risico of de economie? Noem iets concreets, ook van het bezoek aan de AEX of DNB als dat al geweest is.', min:30 }
    ] },
  { id:'eval2', title:'Tussenevaluatie dag 20', openDay:20, dueDay:20, intro:'Kijk terug op dag 11 t/m 20 en kijk vooruit naar de laatste 10 dagen. Minimaal 200 woorden.',
    questions:[
      { q:'Resultaat', hint:'Hoe sta je ervoor ten opzichte van de AEX (zie de stand hieronder)? Welke aandelen en welk nieuws verklaren dat? Was het een goede keuze of geluk?', min:60 },
      { q:'Plan en werkelijkheid', hint:'Heb je je aan je plan van dag 10 gehouden? Wat ging goed en wat niet?', min:50 },
      { q:'Portefeuillecheck', hint:'Is je portefeuille nog goed voor de laatste 10 dagen? Welke transacties ga je doen (of heb je gedaan) en waarom? Verander je niets, leg dan uit waarom dat de beste keuze is.', min:60 },
      { q:'Wat heb ik geleerd', hint:'Wat heb je deze periode geleerd over beleggen, risico of de economie? Noem iets concreets, ook van het bezoek aan de AEX of DNB als dat al geweest is.', min:30 }
    ] },
  { id:'eind', title:'Eindreflectie dag 30', openDay:30, dueDay:30, intro:'Kijk terug op de hele PO. Lees eerst je startplan en evaluaties terug. Minimaal 440 woorden.',
    questions:[
      { q:'Eindresultaat', hint:'Wat is je eindresultaat ten opzichte van de AEX en hoe verklaar je het verschil? Welk deel was een goede keuze en welk deel geluk of pech?', min:80 },
      { q:'Verwachting en werkelijkheid', hint:'Wat klopte er van de verwachting en de spelregels uit je startplan, en wat niet? Waarom?', min:80 },
      { q:'Beste en slechtste beslissing', hint:'Wat was je beste en je slechtste transactie (noem datum en aandeel)? Wat dacht je toen en wat weet je nu?', min:80 },
      { q:'Wat neem ik mee', hint:'Wat is het belangrijkste dat je over beleggen hebt geleerd? Wat zou je anders doen als het echt geld was?', min:80 },
      { q:'Bezoek AEX Experience', hint:'Wat heb je bij de AEX Experience geleerd dat je in de game terugzag of had kunnen gebruiken? Denk aan risico, spreiding, koersvorming en nieuws. Verwijs naar je eigen transacties. (Deed je de vervangende opdracht? Schrijf dan over die locatie.)', min:60 },
      { q:'Bezoek DNB', hint:'Wat heb je bij De Nederlandsche Bank geleerd over geld, rente en inflatie? Hoe heeft dat invloed op de bedrijven in de AEX en op jouw portefeuille? (Deed je de vervangende opdracht? Schrijf dan over die locatie.)', min:60 }
    ] }
];

// [app-ticker, Google Finance-code, naam, sector]  (zelfde lijst als AEX_STOCKS in de app)
const TICKERS = [
  ['AALB.AS','AMS:AALB','Aalberts','Industrie'],
  ['ABN.AS','AMS:ABN','ABN AMRO','Financiële dienstverlening'],
  ['ADYEN.AS','AMS:ADYEN','Adyen','Technologie'],
  ['AGN.AS','AMS:AGN','Aegon','Financiële dienstverlening'],
  ['AD.AS','AMS:AD','Ahold Delhaize','Consumentengoederen'],
  ['AKZA.AS','AMS:AKZA','AkzoNobel','Grondstoffen & chemie'],
  ['MT.AS','AMS:MT','ArcelorMittal','Grondstoffen & chemie'],
  ['ASM.AS','AMS:ASM','ASM International','Technologie'],
  ['ASML.AS','AMS:ASML','ASML','Technologie'],
  ['ASRNL.AS','AMS:ASRNL','a.s.r.','Financiële dienstverlening'],
  ['BESI.AS','AMS:BESI','BE Semiconductor (Besi)','Technologie'],
  ['CVC.AS','AMS:CVC','CVC Capital Partners','Financiële dienstverlening'],
  ['DSFIR.AS','AMS:DSFIR','DSM-Firmenich','Consumentengoederen'],
  ['EXO.AS','AMS:EXO','Exor','Financiële dienstverlening'],
  ['HEIA.AS','AMS:HEIA','Heineken','Consumentengoederen'],
  ['IMCD.AS','AMS:IMCD','IMCD','Grondstoffen & chemie'],
  ['INGA.AS','AMS:INGA','ING Groep','Financiële dienstverlening'],
  ['KPN.AS','AMS:KPN','KPN','Telecom'],
  ['MICC.AS','AMS:MICC','The Magnum Ice Cream Company','Consumentengoederen'],
  ['NN.AS','AMS:NN','NN Group','Financiële dienstverlening'],
  ['PHIA.AS','AMS:PHIA','Philips','Gezondheidszorg'],
  ['PRX.AS','AMS:PRX','Prosus','Technologie'],
  ['REN.AS','AMS:REN','RELX','Zakelijke informatie'],
  ['SBMO.AS','AMS:SBMO','SBM Offshore','Energie'],
  ['SHELL.AS','AMS:SHELL','Shell','Energie'],
  ['UMG.AS','AMS:UMG','Universal Music Group','Media & entertainment'],
  ['UNA.AS','AMS:UNA','Unilever','Consumentengoederen'],
  ['WDP.AS','EBR:WDP','WDP (Warehouses De Pauw)','Vastgoed'],
  ['WKL.AS','AMS:WKL','Wolters Kluwer','Zakelijke informatie']
];
const INDEX = ['^AEX', 'INDEXEURO:AEX'];
const TZ = 'Europe/Amsterdam';

/* Bezoekopdrachten. photos = minimaal aantal foto's, min = minimaal aantal woorden. */
const BEZOEKEN = [
  { id:'aex', title:'AEX Experience', place:'Beursplein 5, Amsterdam', tasks:[
    { id:'a1', title:'Toen en nu', photos:2,
      instr:'Zoek in het museumdeel een voorwerp of afbeelding uit de begintijd van de beurs, bijvoorbeeld een oud VOC-aandeel of een prent van de handel. Foto 1: jij naast dat voorwerp, met het codewoord in beeld. Foto 2: jij op de handelsvloer met deze app open op je scherm (je portefeuille in beeld).',
      q:'Wat is er sinds de tijd van de VOC hetzelfde gebleven aan beleggen, en wat is totaal anders? Wat betekent dat voor een aandeel uit jouw eigen portefeuille?', min:60 },
    { id:'a2', title:'Beslismoment in de beleggingsgame', photos:1,
      instr:'Tijdens de beleggingsgame in teams: maak een foto van jouw team op een beslismoment, met het nieuwsbericht of het scherm en het codewoord in beeld. Jij staat zelf op de foto.',
      q:'Welk nieuwsbericht kreeg je team, wat besloten jullie en hoe pakte dat uit? Zou je in je eigen game hetzelfde doen? Gebruik minstens één van deze begrippen: risico, spreiding, rendement, koers.', min:60 }
  ] },
  { id:'dnb', title:'De Nederlandsche Bank', place:'De Nieuwe Schatkamer, Frederiksplein 61, Amsterdam', tasks:[
    { id:'d1', title:'Jij bent de president', photos:1,
      instr:'Neem in de tentoonstelling plaats in de stoel van de DNB-president en neem het rentebesluit. Foto: jij in de stoel of bij het scherm, met jouw besluit of de uitkomst en het codewoord in beeld.',
      q:'Welke rente koos je en wat gebeurde er met de inflatie en de economie? Wat doet een hogere rente met de aandelen in jouw portefeuille? Denk aan banken, vastgoed of techbedrijven.', min:60 },
    { id:'d2', title:'Waar zit de waarde?', photos:1,
      instr:'Kies in de geldcollectie of bij de goudkluis het voorwerp dat volgens jou het beste laat zien waarom mensen geld vertrouwen (of juist niet meer). Foto: jij met dat voorwerp en het codewoord in beeld.',
      q:'Waarom koos je dit voorwerp? Wat maakt geld waardevol en welke rol speelt DNB daarbij? Wat heeft dat te maken met banken in de AEX, zoals ING of ABN AMRO?', min:60 }
  ] }
];
/* Vervangende opdracht (bij een gemist bezoek), op een economische locatie die de docent vooraf goedkeurt. */
const VERVANG = { title:'Vervangende opdracht', tasks:[
  { id:'v1', title:'Waar ontstaat hier waarde?', photos:2,
    instr:'Foto 1: jij, herkenbaar op de locatie (naambord of gebouw in beeld), met je persoonlijke codewoord in beeld. Foto 2: de plek waar hier iets van waarde wordt gemaakt, verhandeld of vervoerd.',
    q:'Wat gebeurt hier economisch? Hoe ontstaat hier een prijs of waarde, en welke factoren spelen mee (vraag, aanbod, kosten, rente, energieprijzen)?', min:80 },
  { id:'v2', title:'De link met de beurs of DNB', photos:1,
    instr:'Foto van iets op de locatie dat te maken heeft met een bedrijf uit de AEX, of met rente, geld of inflatie. Jij en je codewoord staan in beeld.',
    q:'Welk AEX-bedrijf of welk onderwerp van DNB hoort hierbij, en waarom? Wat betekent dit voor jouw beleggingen?', min:80 }
] };

/* ------------------------------- TABBLADEN ------------------------------- */
const SH = { K:'Koersen', P:'Spelers', O:'Orders', T:'Transacties', S:'Snapshots', E:'Eindstand', R:'Overzicht', D:'Dividenden', L:'Logboek',
  C:'Codewoorden', F:'Fotos', B:'Bezoeken', G:'Beoordeling' };
const HEAD = {
  P: ['Speler-ID','Voornaam','Achternaam','Klas','Startdatum','Einddatum','Herstelcode','Token','Aangemeld','Cash','Gerealiseerd','Kosten','Posities (JSON)','AEX bij start','Bevroren','Mislukte herstelpogingen','Laatste activiteit','Dividend netto','Actieve dagen','Actieve dagen (lijst)','App geopend (keer)'],
  O: ['Order-ID','Client-ID','Speler-ID','Ingelegd','Kant','Ticker','Aantal','Motivatie','Geblokkeerd','Indicatiekoers','Status','Afgehandeld','Koers','Opmerking'],
  T: ['Transactie-ID','Order-ID','Speler-ID','Naam','Klas','Tijd','Type','Ticker','Aandeel','Aantal','Koers','Orderwaarde','Kosten','Netto','Gerealiseerd','Cash na','Motivatie','Koerstijd','Opmerking'],
  S: ['Datum','Speler-ID','Naam','Klas','Waarde','AEX-benchmark','Rendement %','AEX %'],
  L: ['Log-ID','Speler-ID','Naam','Klas','Onderdeel','Ingeleverd','Speeldag','Uiterlijk (datum)','Op tijd','Woorden','Tekst','Stand bij inleveren','Antwoorden (JSON)'],
  C: ['Onderdeel (aex of dnb)','Codewoord','Bezoekdatum (jjjj-mm-dd)','Speler-ID (alleen bij vervangende opdracht)','Locatie vervangende opdracht','Opmerking'],
  F: ['Foto-ID','Speler-ID','Naam','Klas','Onderdeel','Opdracht','Nr','Geüpload','Drive-bestand','Opnamedatum (EXIF)','Grootte (kB)'],
  B: ['Inlever-ID','Speler-ID','Naam','Klas','Onderdeel','Vervangend','Locatie','Ingeleverd','Bezoekdatum','Op tijd','Codewoord juist','Foto\'s op bezoekdag','Woorden','Tekst','Foto-ID\'s (JSON)','Antwoorden (JSON)'],
  D: ['Ticker','Aandeel','Ex-datum (jjjj-mm-dd)','Bruto dividend per aandeel (€)','Verwerkt op'],
  E: ['Speler-ID','Naam','Klas','Vastgelegd op','Einddatum','Eindwaarde','Rendement %','AEX %','Verschil (pp)','Kosten','Aantal transacties','Data (JSON)']
};
// kolomnummers Spelers (1-based)
const PC = { id:1, first:2, last:3, klas:4, start:5, end:6, code:7, token:8, created:9, cash:10, realized:11, costs:12, pos:13, startIdx:14, frozen:15, fails:16, last:17, div:18, act:19, actList:20, opens:21 };

/* ------------------------------- SETUP ------------------------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  // Koersen
  let sh = ss.getSheetByName(SH.K) || ss.insertSheet(SH.K);
  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['App-ticker','Google-code','Koers','Slot gisteren','Verandering %','Tijd koers','Vertraging (min)']]).setFontWeight('bold');
  const rows = [INDEX].concat(TICKERS.map(t => [t[0], t[1]]));
  // Formules met komma's werken niet in een Nederlandse Sheet: tijdelijk Engelse landinstelling gebruiken.
  const oldLocale = ss.getSpreadsheetLocale();
  ss.setSpreadsheetLocale('en_US');
  SpreadsheetApp.flush();
  rows.forEach((r, i) => {
    const row = i + 2;
    sh.getRange(row, 1, 1, 2).setValues([[r[0], r[1]]]);
    sh.getRange(row, 3, 1, 5).setFormulas([[
      `=IFERROR(GOOGLEFINANCE(B${row},"price"),"")`,
      `=IFERROR(GOOGLEFINANCE(B${row},"closeyest"),"")`,
      `=IFERROR(GOOGLEFINANCE(B${row},"changepct"),"")`,
      `=IFERROR(GOOGLEFINANCE(B${row},"tradetime"),"")`,
      `=IFERROR(GOOGLEFINANCE(B${row},"datadelay"),"")`
    ]]);
  });
  sh.getRange(2, 6, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();
  if (oldLocale && oldLocale !== 'en_US') ss.setSpreadsheetLocale(oldLocale);   // weer terug naar Nederlands
  // Overige tabbladen (bestaande gegevens blijven staan!)
  ['P','O','T','S','E','L','F','B'].forEach(k => {
    let s = ss.getSheetByName(SH[k]);
    if (!s) {
      s = ss.insertSheet(SH[k]);
      s.getRange(1, 1, 1, HEAD[k].length).setValues([HEAD[k]]).setFontWeight('bold');
      s.setFrozenRows(1);
      s.getRange('A:Z').setNumberFormat('@');   // alles als tekst: geen automatische datumconversie
    }
    // beveiliging: alleen de eigenaar (docent) kan bewerken
    const p = s.protect().setDescription('Alleen het script en de docent');
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  if (!ss.getSheetByName(SH.R)) ss.insertSheet(SH.R);
  // Spelers: kolom voor dividend (ook bij een bestaande Sheet)
  ss.getSheetByName(SH.P).getRange(1, PC.div, 1, 4).setValues([HEAD.P.slice(PC.div - 1, PC.opens)]).setFontWeight('bold');
  // Dividenden: hier vul je (of ik) ex-datum en bedrag in. Niet beveiligd, zodat je het zelf kunt aanvullen.
  let dv = ss.getSheetByName(SH.D);
  if (!dv) {
    dv = ss.insertSheet(SH.D);
    dv.getRange(1, 1, 1, HEAD.D.length).setValues([HEAD.D]).setFontWeight('bold');
    dv.setFrozenRows(1);
    dv.getRange('A:A').setNumberFormat('@'); dv.getRange('C:C').setNumberFormat('@'); dv.getRange('E:E').setNumberFormat('@');
    dv.getRange(1, 7, 6, 1).setValues([['Uitleg'],['1 regel per dividend. Ticker zoals in Koersen (bijv. SHELL.AS).'],['Ex-datum als 2027-02-12 (of 12-02-2027).'],['Bedrag in euro per aandeel (bruto). Bij dollars: omrekenen.'],['Het script keert uit aan iedereen die het aandeel de dag vóór de ex-datum had.'],['Kolom E vult het script zelf in. Niet aanpassen.']]);
  }
  // Codewoorden: hier zet de docent per bezoek het codewoord en de bezoekdatum. Niet beveiligd.
  let cw = ss.getSheetByName(SH.C);
  if (!cw) {
    cw = ss.insertSheet(SH.C);
    cw.getRange(1, 1, 1, HEAD.C.length).setValues([HEAD.C]).setFontWeight('bold');
    cw.setFrozenRows(1);
    cw.getRange('A:F').setNumberFormat('@');
    cw.getRange(1, 8, 7, 1).setValues([['Uitleg'],
      ['Per bezoek één regel: onderdeel aex of dnb, het codewoord en de bezoekdatum (2027-01-14). Speler-ID leeg laten.'],
      ['Noem het codewoord pas ter plekke. Leerlingen zetten het op elke foto en typen het in de app.'],
      ['Vervangende opdracht: één regel per leerling, met onderdeel, een persoonlijk codewoord, de datum van het vervangende bezoek, het speler-ID en de locatie.'],
      ['Inleveren kan tot en met ' + CFG.VISIT_GRACE_DAYS + ' dagen na de bezoekdatum. Daarna is het te laat (0 punten).'],
      ['Twee klassen op verschillende dagen? Zet dan twee regels met elk een eigen codewoord en datum.'],
      ['Leerlingen hebben geen toegang tot deze Sheet.']]);
  }
  // Beoordeling: automatische check + kolommen voor de docent
  if (!ss.getSheetByName(SH.G)) ss.insertSheet(SH.G);
  // Map voor foto's in je Google Drive (ook nodig voor de toestemming voor Drive)
  photoFolder();
  // Trigger: elke 5 minuten orders verwerken, standen maken, eindstanden bevriezen
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'processAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processAll').timeBased().everyMinutes(5).create();
  SpreadsheetApp.flush();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AEX Game')
    .addItem('Overzicht bijwerken', 'updateOverzicht')
    .addItem('Beoordeling bijwerken', 'updateBeoordeling')
    .addItem('Orders en dividend nu verwerken', 'processAll')
    .addToUi();
}

/* ------------------------------- WEB-APP ------------------------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'state') {
      withLock(() => touch(p.id, p.token, p.open === '1'));
      return json(stateResponse(p.id, p.token));
    }
    return json(quotesPublic());
  } catch (err) { return json({ ok:false, error:String(err.message || err) }); }
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok:false, error:'Ongeldig verzoek' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    if (req.id && req.token && req.action !== 'state') touch(req.id, req.token, false);   // actieve dag bijhouden
    switch (req.action) {
      case 'register': return json(register(req));
      case 'restore':  return json(restore(req));
      case 'order':    return json(placeOrder(req));
      case 'cancel':   return json(cancelOrder(req));
      case 'state':    touch(req.id, req.token, req.open === 1 || req.open === '1'); return json(stateResponse(req.id, req.token));
      case 'logbook':  return json(submitLog(req));
      case 'photo':    return json(uploadPhoto(req));
      case 'photoGet': return json(getPhoto(req));
      case 'visit':    return json(submitVisit(req));
      default:         return json({ ok:false, error:'Onbekende actie' });
    }
  } catch (err) {
    return json({ ok:false, error:String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function withLock(fn) { const l = LockService.getScriptLock(); if (!l.tryLock(10000)) return; try { fn(); } finally { l.releaseLock(); } }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ------------------------------- KOERSEN ------------------------------- */
function readQuotes() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.K);
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  const num = x => (typeof x === 'number' && isFinite(x) && x > -1e12) ? x : null;
  const out = { quotes:{}, index:null };
  v.forEach(r => {
    const q = { price:num(r[2]), prevClose:num(r[3]), changePct:num(r[4]), tradeTime:(r[5] instanceof Date) ? r[5].toISOString() : null, delayMin:num(r[6]) };
    if (q.price !== null && q.price <= 0) q.price = null;
    if (r[0] === INDEX[0]) out.index = q; else out.quotes[r[0]] = q;
  });
  return out;
}
function quotesPublic() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('quotes');
  if (c) return JSON.parse(c);
  const q = readQuotes();
  const o = { ok:true, source:'GOOGLEFINANCE', updated:new Date().toISOString(), quotes:q.quotes, index:q.index };
  cache.put('quotes', JSON.stringify(o), 60);
  return o;
}

/* ------------------------------- TIJD & BEURSKALENDER ------------------------------- */
function ams(d) {
  const s = Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd HH:mm u').split(' ');
  const hm = s[1].split(':').map(Number);
  return { key:s[0], min:hm[0] * 60 + hm[1], dow:Number(s[2]) % 7 };
}
function addDaysKey(key, n) { const p = key.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function easter(y) { const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1; return y+'-'+String(mo).padStart(2,'0')+'-'+String(da).padStart(2,'0'); }
function isTradingDay(key) {
  const y = Number(key.slice(0, 4)), p = key.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const e = easter(y);
  const hol = [y+'-01-01', addDaysKey(e, -2), addDaysKey(e, 1), y+'-05-01', y+'-12-25', y+'-12-26'];
  return dow >= 1 && dow <= 5 && hol.indexOf(key) < 0;
}
function closeMin(key) { return (/-12-(24|31)$/.test(key)) ? 14 * 60 + 5 : 17 * 60 + 30; }
function marketOpen(d) { const a = ams(d); return isTradingDay(a.key) && a.min >= 540 && a.min < closeMin(a.key); }

/* ------------------------------- HULP ------------------------------- */
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const costFor = v => round2(CFG.COST_FIXED + v * CFG.COST_PERCENT / 100);
const tick = t => TICKERS.filter(x => x[0] === t)[0];
const sheet = k => SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH[k]);
function keyOf(v) { return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || ''); }
function isoOf(v) { return (v instanceof Date) ? v.toISOString() : String(v || ''); }
function rnd(chars, n) { let s = ''; for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length)); return s; }
function appendRow(k, row) { sheet(k).appendRow(row.map(x => (typeof x === 'number') ? x : String(x === null || x === undefined ? '' : x))); }

function allRows(k) { const s = sheet(k); if (!s) return []; const n = s.getLastRow(); return n < 2 ? [] : s.getRange(2, 1, n - 1, HEAD[k].length).getValues(); }

function rowToPlayer(r, rowNum) {
  let pos = {}; try { pos = JSON.parse(r[PC.pos - 1] || '{}'); } catch (e) {}
  return { row:rowNum, id:String(r[0]), first:String(r[1]), last:String(r[2]), klas:String(r[3]), startDate:keyOf(r[4]), endDate:keyOf(r[5]),
    code:String(r[6]), token:String(r[7]), created:isoOf(r[8]), cash:Number(r[9]), realized:Number(r[10]) || 0, costs:Number(r[11]) || 0,
    positions:pos, startIdx:Number(r[13]) || null, frozen:String(r[14]) === 'ja', fails:Number(r[15]) || 0, dividends:Number(r[17]) || 0,
    actList:String(r[PC.actList - 1] || '').split(',').filter(Boolean), opens:Number(r[PC.opens - 1]) || 0 };
}
function findPlayer(id) {
  const rows = allRows('P');
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(id)) return rowToPlayer(rows[i], i + 2);
  return null;
}
function savePlayer(p) {
  const s = sheet('P');
  s.getRange(p.row, PC.cash, 1, 9).setValues([[ round2(p.cash), round2(p.realized), round2(p.costs), JSON.stringify(p.positions),
    p.startIdx || '', p.frozen ? 'ja' : 'nee', p.fails || 0, new Date().toISOString(), round2(p.dividends || 0) ]]);
}
function auth(req) {
  const p = findPlayer(req.id);
  if (!p || !req.token || p.token !== String(req.token)) throw new Error('Niet ingelogd of onbekende speler. Herstel je account met je speler-ID en herstelcode.');
  return p;
}
function openOrders(playerId) {
  return allRows('O').map((r, i) => ({ r, row:i + 2 })).filter(x => (!playerId || String(x.r[2]) === playerId) && String(x.r[10]) === 'open')
    .map(x => ({ row:x.row, id:String(x.r[0]), clientId:String(x.r[1]), playerId:String(x.r[2]), ts:isoOf(x.r[3]), side:String(x.r[4]), ticker:String(x.r[5]),
      qty:Number(x.r[6]), motivation:String(x.r[7]), reserve:Number(x.r[8]) || 0, estPrice:Number(x.r[9]) || 0 }));
}
function reserved(playerId) { return openOrders(playerId).filter(o => o.side === 'buy').reduce((a, o) => a + o.reserve, 0); }

/* ------------------------------- ACTIES ------------------------------- */
function register(req) {
  const first = String(req.first || '').trim().slice(0, 40), last = String(req.last || '').trim().slice(0, 60), klas = String(req.klas || '').trim().toUpperCase().slice(0, 15);
  if (!first || !last || !klas) throw new Error('Vul voornaam, achternaam en klas in.');
  const ids = allRows('P').map(r => String(r[0]));
  let id; do { id = 'AEX-' + rnd('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 3) + '-' + rnd('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 3); } while (ids.indexOf(id) >= 0);
  const code = rnd('0123456789', 6);
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const start = CFG.FIXED_START_DATE || ams().key;
  const q = readQuotes();
  appendRow('P', [id, first, last, klas, start, addDaysKey(start, CFG.GAME_DAYS - 1), code, token, new Date().toISOString(),
    CFG.START_CAPITAL, 0, 0, '{}', (q.index && q.index.price) || '', 'nee', 0, new Date().toISOString(), 0, 1, ams().key, 1]);
  return stateResponse(id, token);
}

function restore(req) {
  const p = findPlayer(String(req.id || '').trim().toUpperCase());
  if (!p) throw new Error('Onbekend speler-ID.');
  if (p.fails >= CFG.MAX_RESTORE_FAILS) throw new Error('Te veel foute pogingen. Vraag je docent om je account vrij te geven.');
  if (String(req.code || '').trim() !== p.code) { p.fails++; savePlayer(p); throw new Error('Herstelcode klopt niet.'); }
  p.fails = 0; savePlayer(p);
  return stateResponse(p.id, p.token);
}

function placeOrder(req) {
  const p = auth(req);
  const now = new Date(), a = ams(now);
  if (a.key < p.startDate) throw new Error('Het spel begint op ' + p.startDate + '.');
  if (CFG.REQUIRE_STARTPLAN && !logRows(p.id).some(r => String(r[4]) === 'start')) throw new Error('Lever eerst je startplan in (tabblad Logboek). Daarna kun je handelen.');
  const clientId = String(req.clientId || '');
  if (clientId && allRows('O').some(r => String(r[1]) === clientId && String(r[2]) === p.id)) return stateResponse(p.id, p.token); // al ontvangen
  const t = tick(String(req.ticker));
  if (!t) throw new Error('Onbekend aandeel.');
  const side = req.side === 'sell' ? 'sell' : (req.side === 'buy' ? 'buy' : null);
  if (!side) throw new Error('Ongeldige ordersoort.');
  const qty = Number(req.qty);
  if (!(qty >= 1 && qty <= 1000000 && Math.floor(qty) === qty)) throw new Error('Alleen hele aandelen (minimaal 1).');
  const mot = String(req.motivation || '').trim().slice(0, 500);
  if (mot.length < CFG.MIN_MOTIVATION) throw new Error('Motivatie is te kort (minimaal ' + CFG.MIN_MOTIVATION + ' tekens).');
  const todayCount = allRows('O').filter(r => String(r[2]) === p.id && keyOf(new Date(isoOf(r[3]))) === a.key).length;
  if (todayCount >= CFG.MAX_ORDERS_PER_DAY) throw new Error('Maximaal ' + CFG.MAX_ORDERS_PER_DAY + ' orders per dag.');
  const q = readQuotes().quotes[t[0]];
  if (!q || !q.price) throw new Error('Er is nu geen koers voor ' + t[2] + '. Probeer het later opnieuw.');
  const open = openOrders(p.id);
  let reserve = 0;
  if (side === 'buy') {
    const v = qty * q.price * (1 + CFG.PENDING_RESERVE_BUFFER);
    reserve = round2(v + costFor(v));
    const free = p.cash - open.filter(o => o.side === 'buy').reduce((s, o) => s + o.reserve, 0);
    if (reserve > free + 0.001) throw new Error('Niet genoeg vrij cash (incl. ' + (CFG.PENDING_RESERVE_BUFFER * 100) + '% buffer). Kopen op krediet is niet toegestaan.');
  } else {
    const have = (p.positions[t[0]] && p.positions[t[0]].qty) || 0;
    const pend = open.filter(o => o.side === 'sell' && o.ticker === t[0]).reduce((s, o) => s + o.qty, 0);
    if (qty > have - pend) throw new Error('Je hebt niet genoeg (vrije) aandelen. Short gaan is niet toegestaan.');
  }
  const orderId = 'O-' + Utilities.getUuid().slice(0, 13);
  appendRow('O', [orderId, clientId, p.id, now.toISOString(), side, t[0], qty, mot, reserve, q.price, 'open', '', '', '']);
  if (!CFG.STRICT_EURONEXT_HOURS && !marketOpen(now)) processOrders(true);
  return stateResponse(p.id, p.token, orderId);
}

function cancelOrder(req) {
  const p = auth(req);
  const o = openOrders(p.id).filter(x => x.id === String(req.orderId))[0];
  if (!o) throw new Error('Deze order is al uitgevoerd of bestaat niet.');
  sheet('O').getRange(o.row, 11, 1, 4).setValues([['geannuleerd', new Date().toISOString(), '', 'Geannuleerd door leerling']]);
  return stateResponse(p.id, p.token);
}

/* ------------------------------- ORDERS UITVOEREN ------------------------------- */
function processOrders(forceClosed) {
  const now = new Date(), a = ams(now);
  const isOpen = marketOpen(now);
  if (!isOpen && !(forceClosed || !CFG.STRICT_EURONEXT_HOURS)) return 0;
  const quotes = readQuotes().quotes;
  const orders = openOrders().sort((x, y) => x.ts < y.ts ? -1 : 1);
  const openAt = new Date(now.getTime() - (a.min - 540) * 60000);   // vandaag 09:00 Amsterdam
  let n = 0;
  const players = {};
  orders.forEach(o => {
    const q = quotes[o.ticker];
    if (!q || !q.price) return;
    const ts = new Date(o.ts);
    if (isOpen) {
      const age = (now - ts) / 60000;
      if (age < CFG.MIN_DELAY_MIN) return;
      const after = new Date(Math.max(ts.getTime(), openAt.getTime()));
      const freshQuote = q.tradeTime && new Date(q.tradeTime) >= ts;
      if (!freshQuote && (now - after) / 60000 < CFG.MAX_WAIT_MIN) return;   // wacht op een koers van na het inleggen
    }
    const p = players[o.playerId] || (players[o.playerId] = findPlayer(o.playerId));
    if (!p) return;
    const note = isOpen ? '' : 'Beurs gesloten – uitgevoerd tegen slotkoers';
    execute(p, o, q, note);
    n++;
  });
  return n;
}

function execute(p, o, q, note) {
  const t = tick(o.ticker), price = q.price, s = sheet('O');
  const others = openOrders(p.id).filter(x => x.id !== o.id);
  let qty = o.qty, msg = note || '';
  if (o.side === 'buy') {
    const free = p.cash - others.filter(x => x.side === 'buy').reduce((a, x) => a + x.reserve, 0);
    while (qty > 0 && round2(qty * price) + costFor(qty * price) > free) qty--;
    if (qty <= 0) { s.getRange(o.row, 11, 1, 4).setValues([['afgewezen', new Date().toISOString(), price, 'Onvoldoende saldo bij uitvoering']]); return; }
    if (qty < o.qty) msg = (msg ? msg + '; ' : '') + 'aantal verlaagd van ' + o.qty + ' naar ' + qty + ' wegens saldo';
    const value = round2(qty * price), costs = costFor(value), total = round2(value + costs);
    const pos = p.positions[o.ticker] || { qty:0, avg:0 };
    pos.avg = (pos.avg * pos.qty + price * qty) / (pos.qty + qty); pos.qty += qty;
    p.positions[o.ticker] = pos;
    p.cash = round2(p.cash - total); p.costs = round2(p.costs + costs);
    appendRow('T', ['T-' + Utilities.getUuid().slice(0, 13), o.id, p.id, p.first + ' ' + p.last, p.klas, new Date().toISOString(), 'Koop', o.ticker, t[2], qty, price, value, costs, -total, 0, p.cash, o.motivation, q.tradeTime || '', msg]);
  } else {
    const pos = p.positions[o.ticker];
    const have = pos ? pos.qty : 0;
    qty = Math.min(qty, have);
    if (qty <= 0) { s.getRange(o.row, 11, 1, 4).setValues([['afgewezen', new Date().toISOString(), price, 'Geen aandelen meer in bezit']]); return; }
    const value = round2(qty * price), costs = costFor(value), net = round2(value - costs), realized = round2((price - pos.avg) * qty);
    pos.qty -= qty; if (pos.qty <= 0) delete p.positions[o.ticker];
    p.cash = round2(p.cash + net); p.realized = round2(p.realized + realized); p.costs = round2(p.costs + costs);
    appendRow('T', ['T-' + Utilities.getUuid().slice(0, 13), o.id, p.id, p.first + ' ' + p.last, p.klas, new Date().toISOString(), 'Verkoop', o.ticker, t[2], qty, price, value, costs, net, realized, p.cash, o.motivation, q.tradeTime || '', msg]);
  }
  savePlayer(p);
  s.getRange(o.row, 11, 1, 4).setValues([['uitgevoerd', new Date().toISOString(), price, msg]]);
}

/* ------------------------------- WAARDERING ------------------------------- */
function valuation(p, qd) {
  let stock = 0, unreal = 0; const sectors = {}, positions = [];
  Object.keys(p.positions).forEach(k => {
    const pos = p.positions[k]; if (!pos || pos.qty <= 0) return;
    const t = tick(k) || [k, '', k, 'Overig'];
    const price = (qd.quotes[k] && qd.quotes[k].price) || pos.avg;
    const v = pos.qty * price; stock += v; unreal += (price - pos.avg) * pos.qty;
    sectors[t[3]] = (sectors[t[3]] || 0) + v;
    positions.push({ ticker:k, name:t[2], sector:t[3], qty:pos.qty, avg:pos.avg, price:price, value:v, unr:(price - pos.avg) * pos.qty, unrPct:pos.avg ? (price / pos.avg - 1) * 100 : 0 });
  });
  const total = p.cash + stock;
  const idx = qd.index && qd.index.price;
  const benchPct = (idx && p.startIdx) ? (idx / p.startIdx - 1) * 100 : 0;
  const retPct = (total / CFG.START_CAPITAL - 1) * 100;
  return { total:total, stockValue:stock, unrealized:unreal, sectors:sectors, positions:positions.sort((a, b) => b.value - a.value),
    retPct:retPct, ret:total - CFG.START_CAPITAL, benchPct:benchPct, benchValue:CFG.START_CAPITAL * (1 + benchPct / 100), diffPP:retPct - benchPct };
}

/* ------------------------------- TRIGGER (elke 5 min) ------------------------------- */
function processAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    processOrders(false);
    processDividends();
    const now = new Date(), a = ams(now);
    const rows = allRows('P');
    if (!rows.length) return;
    const qd = readQuotes();
    const afterClose = a.min >= 17 * 60 + 35 || !isTradingDay(a.key);
    const props = PropertiesService.getScriptProperties();
    const doSnap = afterClose && props.getProperty('snap') !== a.key;
    rows.forEach((r, i) => {
      const p = rowToPlayer(r, i + 2);
      let dirty = false;
      if (!p.startIdx && qd.index && qd.index.price) { p.startIdx = qd.index.price; dirty = true; }
      const val = valuation(p, qd);
      if (doSnap && a.key >= p.startDate) {
        appendRow('S', [a.key, p.id, p.first + ' ' + p.last, p.klas, round2(val.total), round2(val.benchValue), round2(val.retPct), round2(val.benchPct)]);
      }
      if (!p.frozen && (a.key > p.endDate || (a.key === p.endDate && a.min >= 17 * 60 + 35))) {
        const txCount = allRows('T').filter(t => String(t[2]) === p.id).length;
        const data = { frozenAt:now.toISOString(), endDate:p.endDate, lateFreeze:a.key > addDaysKey(p.endDate, 1), total:round2(val.total), cash:round2(p.cash),
          stockValue:round2(val.stockValue), ret:round2(val.ret), retPct:val.retPct, benchValue:round2(val.benchValue), benchPct:val.benchPct, diffPP:val.diffPP,
          realized:round2(p.realized), unrealized:round2(val.unrealized), costs:round2(p.costs), dividends:round2(p.dividends || 0), sectors:val.sectors, positions:val.positions, txCount:txCount };
        appendRow('E', [p.id, p.first + ' ' + p.last, p.klas, now.toISOString(), p.endDate, round2(val.total), round2(val.retPct), round2(val.benchPct), round2(val.diffPP), round2(p.costs), txCount, JSON.stringify(data)]);
        p.frozen = true; dirty = true;
      }
      if (dirty) savePlayer(p);
    });
    if (doSnap) { props.setProperty('snap', a.key); updateOverzicht(); updateBeoordeling(); }
  } finally { lock.releaseLock(); }
}

/* ------------------------------- DIVIDEND ------------------------------- */
function num(v) { if (typeof v === 'number') return v; const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function processDividends() {
  const dv = sheet('D'); if (!dv || dv.getLastRow() < 2) return 0;
  const today = ams().key;
  const rows = dv.getRange(2, 1, dv.getLastRow() - 1, 5).getValues();
  let done = 0;
  rows.forEach((r, i) => {
    const ticker = String(r[0] || '').trim().toUpperCase(), amount = num(r[3]);
    let ex = keyOf(r[2]).trim(); const nl = ex.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);   // ook 12-02-2027 mag
    if (nl) ex = nl[3] + '-' + ('0' + nl[2]).slice(-2) + '-' + ('0' + nl[1]).slice(-2);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(ex) || !(amount > 0) || String(r[4] || '') !== '' || ex > today) return;
    const t = tick(ticker);
    if (!t) { dv.getRange(i + 2, 5).setValue('Onbekende ticker'); return; }
    // bezit per speler op de dag vóór de ex-datum, opgebouwd uit het onuitwisbare transactielogboek
    const held = {};
    allRows('T').forEach(x => {
      if (String(x[7]) !== ticker) return;
      if (keyOf(new Date(isoOf(x[5]))) >= ex) return;
      const q = Number(x[9]) || 0, pid = String(x[2]);
      if (String(x[6]) === 'Koop') held[pid] = (held[pid] || 0) + q;
      else if (String(x[6]) === 'Verkoop') held[pid] = (held[pid] || 0) - q;
    });
    let count = 0;
    Object.keys(held).forEach(pid => {
      const qty = held[pid]; if (qty <= 0) return;
      const p = findPlayer(pid); if (!p) return;
      const gross = round2(qty * amount), tax = round2(gross * CFG.DIVIDEND_TAX_PCT / 100), net = round2(gross - tax);
      p.cash = round2(p.cash + net); p.dividends = round2((p.dividends || 0) + net);
      savePlayer(p);
      appendRow('T', ['T-' + Utilities.getUuid().slice(0, 13), 'DIV-' + ex, p.id, p.first + ' ' + p.last, p.klas, new Date().toISOString(), 'Dividend', ticker, t[2], qty, amount, gross, tax, net, 0, p.cash,
        'Dividenduitkering (ex-datum ' + ex + ')', '', CFG.DIVIDEND_TAX_PCT ? CFG.DIVIDEND_TAX_PCT + '% dividendbelasting ingehouden' : '']);
      count++;
    });
    dv.getRange(i + 2, 5).setValue(new Date().toISOString() + ' · ' + count + ' leerling(en)');
    done++;
  });
  return done;
}

/* ------------------------------- DOCENTENOVERZICHT ------------------------------- */
function updateOverzicht() {
  const qd = readQuotes(), a = ams();
  const tx = allRows('T');
  const frozen = {}; allRows('E').forEach(r => frozen[String(r[0])] = r);
  const list = allRows('P').map((r, i) => {
    const p = rowToPlayer(r, i + 2), v = valuation(p, qd), f = frozen[p.id];
    const day = Math.round((Date.parse(a.key) - Date.parse(p.startDate)) / 86400000) + 1;
    return [p.first + ' ' + p.last, p.klas, p.id, p.code, p.startDate, day > CFG.GAME_DAYS ? 'klaar (' + day + ')' : day,
      round2(v.total), round2(v.retPct), round2(v.benchPct), round2(v.diffPP), round2(p.costs), round2(p.dividends || 0), tx.filter(t => String(t[2]) === p.id && String(t[6]) !== 'Dividend').length,
      f ? Number(f[5]) : '', f ? Number(f[6]) : '', f ? Number(f[8]) : ''];
  }).sort((x, y) => (y[14] === '' ? y[7] : y[14]) - (x[14] === '' ? x[7] : x[14]));
  const sh = sheet('R'); sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Bijgewerkt', Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy HH:mm')]]);
  const head = ['#','Naam','Klas','Speler-ID','Herstelcode','Start','Dag','Waarde nu (€)','Rendement %','AEX %','Verschil pp','Kosten (€)','Dividend (€)','Transacties','PO-eindwaarde (€)','PO-rendement %','PO-verschil pp'];
  sh.getRange(3, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  if (list.length) sh.getRange(4, 1, list.length, head.length).setValues(list.map((r, i) => [i + 1].concat(r)));
  sh.setFrozenRows(3);
}

/* ------------------------------- STAAT NAAR DE APP ------------------------------- */
function stateResponse(id, token, newOrderId) {
  const p = findPlayer(id);
  if (!p || p.token !== String(token)) throw new Error('Niet ingelogd of onbekende speler.');
  const qd = quotesPublic();
  const transactions = allRows('T').filter(r => String(r[2]) === p.id).map(r => ({
    id:String(r[0]), ts:isoOf(r[5]), type:String(r[6]), ticker:String(r[7]), name:String(r[8]), qty:Number(r[9]), price:Number(r[10]), value:Number(r[11]),
    costs:Number(r[12]), net:Number(r[13]), realized:Number(r[14]) || 0, motivation:String(r[16]), note:String(r[18] || '') }));
  const ordersAll = allRows('O').filter(r => String(r[2]) === p.id);
  const pending = ordersAll.filter(r => String(r[10]) === 'open').map(r => {
    const t = tick(String(r[5]));
    return { id:String(r[0]), clientId:String(r[1]), ts:isoOf(r[3]), side:String(r[4]), ticker:String(r[5]), name:t ? t[2] : String(r[5]), qty:Number(r[6]), motivation:String(r[7]), reserve:Number(r[8]) || 0, estPrice:Number(r[9]) || 0 };
  });
  const notices = ordersAll.filter(r => String(r[10]) === 'afgewezen').slice(-10).map(r => ({ id:String(r[0]), ts:isoOf(r[11]), ticker:String(r[5]), qty:Number(r[6]), note:String(r[13]) }));
  const snapshots = allRows('S').filter(r => String(r[1]) === p.id).map(r => ({ date:keyOf(r[0]), value:Number(r[4]), bench:Number(r[5]) }));
  const fr = allRows('E').filter(r => String(r[0]) === p.id)[0];
  let frozen = null; if (fr) { try { frozen = JSON.parse(fr[11]); } catch (e) {} }
  const logs = logRows(p.id), visits = visitRows(p.id), txAll = allRows('T').filter(r => String(r[2]) === p.id);
  const po = poStats(p, txAll, logs, visits);
  const logbook = logs.map(r => { let ans = []; try { ans = JSON.parse(r[12]); } catch (e) {} return { moment:String(r[4]), ts:isoOf(r[5]), day:Number(r[6]), due:keyOf(r[7]), onTime:String(r[8]) === 'ja', words:Number(r[9]), answers:ans, stand:String(r[11]) }; });
  const visitList = visits.map(r => { let ans = {}, ph = {}; try { ans = JSON.parse(r[15]); } catch (e) {} try { ph = JSON.parse(r[14]); } catch (e) {}
    return { part:String(r[4]), replace:String(r[5]) === 'ja', location:String(r[6]), ts:isoOf(r[7]), visitDate:keyOf(r[8]), onTime:String(r[9]) === 'ja', photosOnDay:String(r[11]) === 'ja', words:Number(r[12]), answers:ans, photos:ph }; });
  const photos = allRows('F').filter(r => String(r[1]) === p.id).map(r => ({ id:String(r[0]), part:String(r[4]), task:String(r[5]), nr:Number(r[6]), ts:isoOf(r[7]) }));
  const visitDates = {}; codeRows().forEach(r => { const part = String(r[0]).trim().toLowerCase(), pid = String(r[3] || '').trim().toUpperCase();
    if (!pid || pid === p.id) (visitDates[part] = visitDates[part] || []).push({ date:normDate(r[2]), replace:!!pid, location:String(r[4] || '') }); });
  return { ok:true, now:new Date().toISOString(), newOrderId:newOrderId || null,
    config:{ START_CAPITAL:CFG.START_CAPITAL, COST_FIXED:CFG.COST_FIXED, COST_PERCENT:CFG.COST_PERCENT, GAME_DAYS:CFG.GAME_DAYS, MIN_MOTIVATION:CFG.MIN_MOTIVATION,
      STRICT_EURONEXT_HOURS:CFG.STRICT_EURONEXT_HOURS, PENDING_RESERVE_BUFFER:CFG.PENDING_RESERVE_BUFFER, MAX_WAIT_MIN:CFG.MAX_WAIT_MIN,
      PERIOD_DAYS:CFG.PERIOD_DAYS, PERIOD_MIN_TX:CFG.PERIOD_MIN_TX, PERIOD_MIN_DAYS:CFG.PERIOD_MIN_DAYS, LOG_GRACE_DAYS:CFG.LOG_GRACE_DAYS,
      VISIT_GRACE_DAYS:CFG.VISIT_GRACE_DAYS, REQUIRE_STARTPLAN:CFG.REQUIRE_STARTPLAN, LOGBOEK:LOGBOEK, BEZOEKEN:BEZOEKEN, VERVANG:VERVANG },
    player:{ id:p.id, first:p.first, last:p.last, klas:p.klas, startDate:p.startDate, endDate:p.endDate, code:p.code, token:p.token, createdAt:p.created },
    cash:p.cash, realized:p.realized, totalCosts:p.costs, dividends:p.dividends || 0, dividendTaxPct:CFG.DIVIDEND_TAX_PCT, positions:p.positions, startIdx:p.startIdx,
    transactions:transactions, pending:pending, notices:notices, snapshots:snapshots, frozen:frozen,
    logbook:logbook, visits:visitList, photos:photos, visitDates:visitDates, po:po,
    quotes:qd.quotes, index:qd.index, updated:qd.updated };
}


/* ------------------------------- PO: LOGBOEK, BEZOEKEN, ACTIVITEIT ------------------------------- */
function dayOf(p, key) { return Math.round((Date.parse(key) - Date.parse(p.startDate)) / 86400000) + 1; }
function words(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
function normDate(v) {
  let k = keyOf(v).trim(); const nl = k.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (nl) k = nl[3] + '-' + ('0' + nl[2]).slice(-2) + '-' + ('0' + nl[1]).slice(-2);
  return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : '';
}
function logRows(pid) { return allRows('L').filter(r => String(r[1]) === pid); }
function visitRows(pid) { return allRows('B').filter(r => String(r[1]) === pid); }
function codeRows() { const s = sheet('C'); if (!s || s.getLastRow() < 2) return []; return s.getRange(2, 1, s.getLastRow() - 1, 5).getValues().filter(r => String(r[0]).trim() && String(r[1]).trim()); }

// Actieve dagen en aantal keer app geopend bijhouden
function touch(id, token, open) {
  const p = findPlayer(id);
  if (!p || p.token !== String(token)) return;
  const k = ams().key; let ch = false;
  if (p.actList.indexOf(k) < 0) { p.actList.push(k); ch = true; }
  if (open) { p.opens++; ch = true; }
  if (ch) sheet('P').getRange(p.row, PC.act, 1, 3).setValues([[p.actList.length, p.actList.join(','), p.opens]]);
}

// Automatische check: transacties per periode, actieve dagen, status logboek en bezoeken
function poStats(p, txRows, logs, visits) {
  const P = CFG.PERIOD_DAYS, nPer = Math.ceil(CFG.GAME_DAYS / P);
  const tx = txRows.filter(r => String(r[6]) !== 'Dividend').map(r => dayOf(p, keyOf(new Date(isoOf(r[5])))));
  const periods = [];
  for (let n = 1; n <= nPer; n++) {
    const from = (n - 1) * P + 1, to = Math.min(n * P, CFG.GAME_DAYS);
    const inP = tx.filter(d => d >= from && d <= to);
    const days = Object.keys(inP.reduce((o, d) => (o[d] = 1, o), {})).length;
    const ok = inP.length >= CFG.PERIOD_MIN_TX && days >= CFG.PERIOD_MIN_DAYS;
    periods.push({ n:n, from:from, to:to, tx:inP.length, days:days, ok:ok, pts:ok ? 2 : (inP.length ? 1 : 0) });
  }
  const active = p.actList.filter(k => { const d = dayOf(p, k); return d >= 1 && d <= CFG.GAME_DAYS; }).length;
  const actPts = active >= 20 ? 4 : active >= 15 ? 3 : active >= 10 ? 2 : active >= 5 ? 1 : 0;
  const perPts = periods.reduce((a, x) => a + x.pts, 0);
  const log = {}; LOGBOEK.forEach(m => { const r = logs.filter(x => String(x[4]) === m.id)[0];
    log[m.id] = r ? { done:true, onTime:String(r[8]) === 'ja', words:Number(r[9]), day:Number(r[6]) } : { done:false, due:addDaysKey(p.startDate, m.dueDay + CFG.LOG_GRACE_DAYS - 1) }; });
  const vis = {}; BEZOEKEN.forEach(b => { const r = visits.filter(x => String(x[4]) === b.id)[0];
    vis[b.id] = r ? { done:true, onTime:String(r[9]) === 'ja', codeOk:String(r[10]) === 'ja', photosOnDay:String(r[11]) === 'ja', replace:String(r[5]) === 'ja',
      evidence:String(r[9]) !== 'ja' ? 0 : (String(r[11]) === 'ja' ? 8 : 4) } : { done:false, evidence:0 }; });
  return { day:dayOf(p, ams().key), periods:periods, activeDays:active, opens:p.opens, periodPts:perPts, activePts:actPts, activity:perPts + actPts, log:log, visits:vis };
}

function submitLog(req) {
  const p = auth(req);
  const m = LOGBOEK.filter(x => x.id === String(req.moment))[0];
  if (!m) throw new Error('Onbekend logboekonderdeel.');
  if (logRows(p.id).some(r => String(r[4]) === m.id)) throw new Error('Dit onderdeel is al ingeleverd en kan niet meer worden gewijzigd.');
  const today = ams().key, day = dayOf(p, today);
  if (m.openDay > 0 && day < m.openDay) throw new Error(m.title + ' kan pas vanaf dag ' + m.openDay + ' (' + addDaysKey(p.startDate, m.openDay - 1) + ') worden ingeleverd.');
  const ans = Array.isArray(req.answers) ? req.answers.map(a => String(a || '').trim().slice(0, 8000)) : [];
  if (ans.length !== m.questions.length) throw new Error('Niet alle vragen zijn beantwoord.');
  m.questions.forEach((q, i) => { const w = words(ans[i]); if (w < q.min) throw new Error('"' + q.q + '" heeft ' + w + ' woorden; minimaal ' + q.min + '.'); });
  const lastDay = m.dueDay + CFG.LOG_GRACE_DAYS, onTime = day <= lastDay;
  const v = valuation(p, readQuotes());
  const nTx = allRows('T').filter(r => String(r[2]) === p.id && String(r[6]) !== 'Dividend').length;
  const stand = 'Dag ' + day + ': waarde € ' + round2(v.total) + ' (' + round2(v.retPct) + '%), AEX ' + round2(v.benchPct) + '%, verschil ' + round2(v.diffPP) + ' pp, ' + nTx + ' transacties. Posities: ' +
    (v.positions.map(x => x.name + ' ' + x.qty).join(', ') || 'geen');
  const text = m.questions.map((q, i) => (i + 1) + '. ' + q.q + '\n' + ans[i]).join('\n\n');
  const total = ans.reduce((a, x) => a + words(x), 0);
  appendRow('L', ['L-' + Utilities.getUuid().slice(0, 13), p.id, p.first + ' ' + p.last, p.klas, m.id, new Date().toISOString(), day,
    addDaysKey(p.startDate, lastDay - 1), onTime ? 'ja' : 'nee', total, text, stand, JSON.stringify(ans)]);
  return stateResponse(p.id, p.token);
}

function photoFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('photoFolder');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const f = DriveApp.createFolder('AEX Game – PO-foto\'s (niet delen)');
  props.setProperty('photoFolder', f.getId());
  return f;
}
function visitDef(part, replace) {
  const b = BEZOEKEN.filter(x => x.id === part)[0];
  if (!b) throw new Error('Onbekend onderdeel.');
  return { b:b, tasks:replace ? VERVANG.tasks : b.tasks };
}
function uploadPhoto(req) {
  const p = auth(req);
  const part = String(req.part || ''), task = String(req.task || ''), nr = Number(req.nr);
  const all = visitDef(part, false).tasks.concat(VERVANG.tasks);
  if (!all.some(t => t.id === task)) throw new Error('Onbekende opdracht.');
  if (!(nr >= 1 && nr <= 3)) throw new Error('Ongeldig fotonummer.');
  if (visitRows(p.id).some(r => String(r[4]) === part)) throw new Error('Dit bezoek is al ingeleverd.');
  const data = String(req.data || '').replace(/^data:image\/\w+;base64,/, '');
  const kb = Math.round(data.length * 0.75 / 1024);
  if (kb < 5) throw new Error('Foto is leeg of beschadigd.');
  if (kb > CFG.PHOTO_MAX_KB) throw new Error('Foto is te groot (' + kb + ' kB).');
  if (allRows('F').filter(r => String(r[1]) === p.id).length >= 60) throw new Error('Maximaal aantal foto\'s bereikt. Vraag je docent.');
  const fid = 'F-' + Utilities.getUuid().slice(0, 13);
  const name = [p.klas, p.first + ' ' + p.last, part.toUpperCase(), task, nr, fid].join(' – ') + '.jpg';
  const file = photoFolder().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', name));
  const exif = /^\d{4}-\d{2}-\d{2}/.test(String(req.exif || '')) ? String(req.exif).slice(0, 19) : '';
  appendRow('F', [fid, p.id, p.first + ' ' + p.last, p.klas, part, task, nr, new Date().toISOString(), file.getId(), exif, kb]);
  return { ok:true, photoId:fid, ts:new Date().toISOString() };
}
function getPhoto(req) {
  const p = auth(req);
  const r = allRows('F').filter(x => String(x[0]) === String(req.photoId) && String(x[1]) === p.id)[0];
  if (!r) throw new Error('Foto niet gevonden.');
  return { ok:true, photoId:String(r[0]), data:Utilities.base64Encode(DriveApp.getFileById(String(r[8])).getBlob().getBytes()) };
}
function submitVisit(req) {
  const p = auth(req);
  const part = String(req.part || ''), replace = !!req.replace;
  const def = visitDef(part, replace);
  if (visitRows(p.id).some(r => String(r[4]) === part)) throw new Error('Dit bezoek is al ingeleverd en kan niet meer worden gewijzigd.');
  const location = String(req.location || '').trim().slice(0, 120);
  if (replace && location.length < 3) throw new Error('Vul de locatie van je vervangende opdracht in.');
  const code = String(req.code || '').trim().toLowerCase();
  const rows = codeRows().filter(r => String(r[0]).trim().toLowerCase() === part && (replace ? String(r[3] || '').trim().toUpperCase() === p.id : !String(r[3] || '').trim()));
  if (!rows.length) throw new Error(replace ? 'Je docent heeft nog geen persoonlijk codewoord voor je vervangende opdracht ingesteld.' : 'Je docent heeft voor dit bezoek nog geen codewoord ingesteld.');
  const match = rows.filter(r => String(r[1]).trim().toLowerCase() === code)[0];
  if (!code || !match) throw new Error('Het codewoord klopt niet.');
  const visitDate = normDate(match[2]);
  if (!visitDate) throw new Error('Je docent heeft geen geldige bezoekdatum ingesteld.');
  const today = ams().key;
  if (today < visitDate) throw new Error('Inleveren kan vanaf de bezoekdatum (' + visitDate + ').');
  const myPhotos = allRows('F').filter(r => String(r[1]) === p.id && String(r[4]) === part);
  const photoIds = {}, answers = {}; let allOnDay = true, total = 0;
  def.tasks.forEach(t => {
    const ids = (req.photos && Array.isArray(req.photos[t.id]) ? req.photos[t.id] : []).map(String);
    const found = ids.map(id => myPhotos.filter(r => String(r[0]) === id && String(r[5]) === t.id)[0]).filter(Boolean);
    if (found.length < t.photos) throw new Error('"' + t.title + '": er ' + (t.photos === 1 ? 'is 1 foto' : 'zijn ' + t.photos + ' foto\'s') + ' nodig.');
    found.forEach(r => { const up = keyOf(new Date(isoOf(r[7]))), ex = String(r[9] || '').slice(0, 10); if (up !== visitDate && ex !== visitDate) allOnDay = false; });
    const a = String((req.answers || {})[t.id] || '').trim().slice(0, 8000), w = words(a);
    if (w < t.min) throw new Error('"' + t.title + '" heeft ' + w + ' woorden; minimaal ' + t.min + '.');
    photoIds[t.id] = found.map(r => String(r[0])); answers[t.id] = a; total += w;
  });
  const onTime = today <= addDaysKey(visitDate, CFG.VISIT_GRACE_DAYS);
  const text = (replace ? 'Vervangende opdracht – locatie: ' + location + '\n\n' : '') + def.tasks.map((t, i) => (i + 1) + '. ' + t.title + '\n' + answers[t.id]).join('\n\n');
  appendRow('B', ['B-' + Utilities.getUuid().slice(0, 13), p.id, p.first + ' ' + p.last, p.klas, part, replace ? 'ja' : 'nee', location, new Date().toISOString(), visitDate,
    onTime ? 'ja' : 'nee', 'ja', allOnDay ? 'ja' : 'nee', total, text, JSON.stringify(photoIds), JSON.stringify(answers)]);
  return stateResponse(p.id, p.token);
}

/* ------------------------------- BEOORDELING (docent) ------------------------------- */
// Kolommen A–M vult het script (automatische check). Kolommen N–X vul jij in. Y en Z rekenen het cijfer uit.
const G_HEAD = ['Speler-ID','Naam','Klas','Activiteit (auto, /10)','Toelichting activiteit','Startplan','Evaluatie dag 10','Evaluatie dag 20','Eindreflectie',
  'AEX: check','AEX bewijs (voorstel, /8)','DNB: check','DNB bewijs (voorstel, /8)',
  'Motivaties (/5)','Startplan (/10)','Evaluatie 10 (/5)','Evaluatie 20 (/5)','Eindreflectie game (/15)',
  'AEX bewijs (/8, leeg = voorstel)','AEX opdrachten (/12)','AEX in eindreflectie (/5)','DNB bewijs (/8, leeg = voorstel)','DNB opdrachten (/12)','DNB in eindreflectie (/5)',
  'Totaal (/100)','Cijfer','Opmerking'];
function updateBeoordeling() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SH.G) || ss.insertSheet(SH.G);
  if (String(sh.getRange(1, 1).getValue()) !== G_HEAD[0]) {
    sh.clear(); sh.getRange(1, 1, 1, G_HEAD.length).setValues([G_HEAD]).setFontWeight('bold').setWrap(true);
    sh.setFrozenRows(1); sh.setFrozenColumns(3);
    sh.getRange(1, 1, 1, 13).setBackground('#e8eefc'); sh.getRange(1, 14, 1, 11).setBackground('#fff4d6'); sh.getRange(1, 25, 1, 2).setBackground('#dcf5e7');
  }
  const players = allRows('P').map((r, i) => rowToPlayer(r, i + 2));
  const tx = allRows('T'), logs = allRows('L'), vis = allRows('B');
  const n = sh.getLastRow();
  const existing = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
  const st = x => !x.done ? 'ontbreekt' : (x.onTime ? 'op tijd · ' + x.words + ' w' : 'TE LAAT (0)');
  const vs = x => !x.done ? 'ontbreekt' : (!x.onTime ? 'TE LAAT (0)' : 'op tijd' + (x.replace ? ' · vervangend' : '') + ' · codewoord ok · foto\'s ' + (x.photosOnDay ? 'op bezoekdag' : 'NIET op bezoekdag'));
  const newRows = [];
  players.forEach(p => {
    const po = poStats(p, tx.filter(r => String(r[2]) === p.id), logs.filter(r => String(r[1]) === p.id), vis.filter(r => String(r[1]) === p.id));
    const expl = po.periods.map(x => 'P' + x.n + ': ' + x.tx + ' tx/' + x.days + ' d (' + x.pts + ')').join(' · ') + ' · actief ' + po.activeDays + ' d (' + po.activePts + ') · app geopend ' + po.opens + '×';
    const auto = [p.id, p.first + ' ' + p.last, p.klas, po.activity, expl, st(po.log.start), st(po.log.eval1), st(po.log.eval2), st(po.log.eind),
      vs(po.visits.aex), po.visits.aex.evidence, vs(po.visits.dnb), po.visits.dnb.evidence];
    const i = existing.indexOf(p.id);
    if (i >= 0) sh.getRange(i + 2, 1, 1, 13).setValues([auto]); else newRows.push(auto);
  });
  if (newRows.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, newRows.length, 13).setValues(newRows);
    // formules met Engelse landinstelling schrijven (werkt ook in een Nederlandse Sheet)
    const oldLocale = ss.getSpreadsheetLocale();
    if (oldLocale !== 'en_US') { ss.setSpreadsheetLocale('en_US'); SpreadsheetApp.flush(); }
    sh.getRange(start, 25, newRows.length, 2).setFormulas(newRows.map((_, k) => { const r = start + k; return [
      `=D${r}+N${r}+IF(LEFT(F${r},2)="op",O${r},0)+IF(LEFT(G${r},2)="op",P${r},0)+IF(LEFT(H${r},2)="op",Q${r},0)+IF(LEFT(I${r},2)="op",R${r}+U${r}+X${r},0)+IF(LEFT(J${r},2)="op",IF(S${r}="",K${r},S${r})+T${r},0)+IF(LEFT(L${r},2)="op",IF(V${r}="",M${r},V${r})+W${r},0)`,
      `=MAX(1,ROUND(Y${r}/10,1))` ]; }));
    SpreadsheetApp.flush();
    if (oldLocale && oldLocale !== 'en_US') ss.setSpreadsheetLocale(oldLocale);
  }
  sh.getRange(1, G_HEAD.length + 2, 6, 1).setValues([['Uitleg'],
    ['Blauwe kolommen vult het script (automatische check). Niet aanpassen: ze worden overschreven.'],
    ['Gele kolommen vul jij in met de rubric. Bewijs leeg laten = het voorstel telt.'],
    ['TE LAAT of ontbreekt = het onderdeel telt automatisch voor 0 punten mee.'],
    ['Cijfer = punten / 10, minimaal 1,0.'],
    ['Bijgewerkt: ' + Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy HH:mm')]]);
}

/* Test: Uitvoeren > testQuotes en bekijk het logboek. */
function testQuotes() { Logger.log(JSON.stringify(readQuotes(), null, 2)); }
