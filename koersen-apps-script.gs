/**
 * AEX Beleggingsgame – koersenkoppeling (Google Sheets + GOOGLEFINANCE)
 * ---------------------------------------------------------------------
 * Plak dit script in: Google Sheet > Extensies > Apps Script (vervang alle code).
 * 1. Kies bovenin de functie "setup" en klik op Uitvoeren (eenmalig; geef toestemming).
 * 2. Implementeren > Nieuwe implementatie > Type: Web-app
 *      Uitvoeren als: Ikzelf   |   Wie heeft toegang: Iedereen
 * 3. Kopieer de web-app-URL (eindigt op /exec) naar DATA_ENDPOINT_URL in de HTML-app.
 *
 * Let op: GOOGLEFINANCE-koersen zijn tot ca. 20 minuten vertraagd.
 */

// Zelfde lijst als AEX_STOCKS in de app: [app-ticker, Google Finance-code]
const TICKERS = [
  ['AALB.AS','AMS:AALB'], ['ABN.AS','AMS:ABN'], ['ADYEN.AS','AMS:ADYEN'], ['AGN.AS','AMS:AGN'],
  ['AD.AS','AMS:AD'], ['AKZA.AS','AMS:AKZA'], ['MT.AS','AMS:MT'], ['ASM.AS','AMS:ASM'],
  ['ASML.AS','AMS:ASML'], ['ASRNL.AS','AMS:ASRNL'], ['BESI.AS','AMS:BESI'], ['CVC.AS','AMS:CVC'],
  ['DSFIR.AS','AMS:DSFIR'], ['EXO.AS','AMS:EXO'], ['HEIA.AS','AMS:HEIA'], ['IMCD.AS','AMS:IMCD'],
  ['INGA.AS','AMS:INGA'], ['KPN.AS','AMS:KPN'], ['MICC.AS','AMS:MICC'], ['NN.AS','AMS:NN'],
  ['PHIA.AS','AMS:PHIA'], ['PRX.AS','AMS:PRX'], ['REN.AS','AMS:REN'], ['SBMO.AS','AMS:SBMO'],
  ['SHELL.AS','AMS:SHELL'], ['UMG.AS','AMS:UMG'], ['UNA.AS','AMS:UNA'], ['WDP.AS','AMS:WDP'],
  ['WKL.AS','AMS:WKL']
];
const INDEX = ['^AEX', 'INDEXEURO:AEX'];
const SHEET_NAME = 'Koersen';
const CACHE_SECONDS = 60;

/** Eenmalig uitvoeren: maakt het tabblad met GOOGLEFINANCE-formules. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  sh.clear();
  const header = [['App-ticker', 'Google-code', 'Koers', 'Slot gisteren', 'Verandering %', 'Tijd koers', 'Vertraging (min)']];
  sh.getRange(1, 1, 1, header[0].length).setValues(header).setFontWeight('bold');
  const rows = [INDEX].concat(TICKERS);
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
  sh.autoResizeColumns(1, 7);
  SpreadsheetApp.flush();
}

/** Web-app: geeft alle koersen als JSON. */
function doGet(e) {
  const cache = CacheService.getScriptCache();
  let json = cache.get('quotes');
  if (!json) {
    json = JSON.stringify(buildQuotes());
    cache.put('quotes', json, CACHE_SECONDS);
  }
  const cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) {           // optionele JSONP-ondersteuning
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function buildQuotes() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) return { ok: false, error: 'Tabblad "' + SHEET_NAME + '" ontbreekt. Voer eerst setup() uit.' };
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const out = { ok: true, source: 'GOOGLEFINANCE', updated: new Date().toISOString(), quotes: {}, index: null };
  values.forEach(r => {
    const q = {
      price: num(r[2]),
      prevClose: num(r[3]),
      changePct: num(r[4]),
      tradeTime: (r[5] instanceof Date) ? r[5].toISOString() : null,
      delayMin: num(r[6])
    };
    if (r[0] === INDEX[0]) out.index = q; else out.quotes[r[0]] = q;
  });
  out.missing = Object.keys(out.quotes).filter(k => out.quotes[k].price === null);
  return out;
}

/** Handig om te testen: Uitvoeren > testQuotes en bekijk het logboek. */
function testQuotes() {
  Logger.log(JSON.stringify(buildQuotes(), null, 2));
}
