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
 *    maakt een ranglijst voor de docent ("Overzicht").
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
  MAX_RESTORE_FAILS: 10
};

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
  ['WDP.AS','AMS:WDP','WDP (Warehouses De Pauw)','Vastgoed'],
  ['WKL.AS','AMS:WKL','Wolters Kluwer','Zakelijke informatie']
];
const INDEX = ['^AEX', 'INDEXEURO:AEX'];
const TZ = 'Europe/Amsterdam';

/* ------------------------------- TABBLADEN ------------------------------- */
const SH = { K:'Koersen', P:'Spelers', O:'Orders', T:'Transacties', S:'Snapshots', E:'Eindstand', R:'Overzicht' };
const HEAD = {
  P: ['Speler-ID','Voornaam','Achternaam','Klas','Startdatum','Einddatum','Herstelcode','Token','Aangemeld','Cash','Gerealiseerd','Kosten','Posities (JSON)','AEX bij start','Bevroren','Mislukte herstelpogingen','Laatste activiteit'],
  O: ['Order-ID','Client-ID','Speler-ID','Ingelegd','Kant','Ticker','Aantal','Motivatie','Geblokkeerd','Indicatiekoers','Status','Afgehandeld','Koers','Opmerking'],
  T: ['Transactie-ID','Order-ID','Speler-ID','Naam','Klas','Tijd','Type','Ticker','Aandeel','Aantal','Koers','Orderwaarde','Kosten','Netto','Gerealiseerd','Cash na','Motivatie','Koerstijd','Opmerking'],
  S: ['Datum','Speler-ID','Naam','Klas','Waarde','AEX-benchmark','Rendement %','AEX %'],
  E: ['Speler-ID','Naam','Klas','Vastgelegd op','Einddatum','Eindwaarde','Rendement %','AEX %','Verschil (pp)','Kosten','Aantal transacties','Data (JSON)']
};
// kolomnummers Spelers (1-based)
const PC = { id:1, first:2, last:3, klas:4, start:5, end:6, code:7, token:8, created:9, cash:10, realized:11, costs:12, pos:13, startIdx:14, frozen:15, fails:16, last:17 };

/* ------------------------------- SETUP ------------------------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  // Koersen
  let sh = ss.getSheetByName(SH.K) || ss.insertSheet(SH.K);
  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['App-ticker','Google-code','Koers','Slot gisteren','Verandering %','Tijd koers','Vertraging (min)']]).setFontWeight('bold');
  const rows = [INDEX].concat(TICKERS.map(t => [t[0], t[1]]));
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
  // Overige tabbladen (bestaande gegevens blijven staan!)
  ['P','O','T','S','E'].forEach(k => {
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
  // Trigger: elke 5 minuten orders verwerken, standen maken, eindstanden bevriezen
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'processAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processAll').timeBased().everyMinutes(5).create();
  SpreadsheetApp.flush();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AEX Game')
    .addItem('Overzicht bijwerken', 'updateOverzicht')
    .addItem('Orders nu verwerken', 'processAll')
    .addToUi();
}

/* ------------------------------- WEB-APP ------------------------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'state') return json(stateResponse(p.id, p.token));
    return json(quotesPublic());
  } catch (err) { return json({ ok:false, error:String(err.message || err) }); }
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok:false, error:'Ongeldig verzoek' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    switch (req.action) {
      case 'register': return json(register(req));
      case 'restore':  return json(restore(req));
      case 'order':    return json(placeOrder(req));
      case 'cancel':   return json(cancelOrder(req));
      case 'state':    return json(stateResponse(req.id, req.token));
      default:         return json({ ok:false, error:'Onbekende actie' });
    }
  } catch (err) {
    return json({ ok:false, error:String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

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

function allRows(k) { const s = sheet(k); const n = s.getLastRow(); return n < 2 ? [] : s.getRange(2, 1, n - 1, HEAD[k].length).getValues(); }

function rowToPlayer(r, rowNum) {
  let pos = {}; try { pos = JSON.parse(r[PC.pos - 1] || '{}'); } catch (e) {}
  return { row:rowNum, id:String(r[0]), first:String(r[1]), last:String(r[2]), klas:String(r[3]), startDate:keyOf(r[4]), endDate:keyOf(r[5]),
    code:String(r[6]), token:String(r[7]), created:isoOf(r[8]), cash:Number(r[9]), realized:Number(r[10]) || 0, costs:Number(r[11]) || 0,
    positions:pos, startIdx:Number(r[13]) || null, frozen:String(r[14]) === 'ja', fails:Number(r[15]) || 0 };
}
function findPlayer(id) {
  const rows = allRows('P');
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(id)) return rowToPlayer(rows[i], i + 2);
  return null;
}
function savePlayer(p) {
  const s = sheet('P');
  s.getRange(p.row, PC.cash, 1, 8).setValues([[ round2(p.cash), round2(p.realized), round2(p.costs), JSON.stringify(p.positions),
    p.startIdx || '', p.frozen ? 'ja' : 'nee', p.fails || 0, new Date().toISOString() ]]);
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
    CFG.START_CAPITAL, 0, 0, '{}', (q.index && q.index.price) || '', 'nee', 0, new Date().toISOString()]);
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
          realized:round2(p.realized), unrealized:round2(val.unrealized), costs:round2(p.costs), sectors:val.sectors, positions:val.positions, txCount:txCount };
        appendRow('E', [p.id, p.first + ' ' + p.last, p.klas, now.toISOString(), p.endDate, round2(val.total), round2(val.retPct), round2(val.benchPct), round2(val.diffPP), round2(p.costs), txCount, JSON.stringify(data)]);
        p.frozen = true; dirty = true;
      }
      if (dirty) savePlayer(p);
    });
    if (doSnap) { props.setProperty('snap', a.key); updateOverzicht(); }
  } finally { lock.releaseLock(); }
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
      round2(v.total), round2(v.retPct), round2(v.benchPct), round2(v.diffPP), round2(p.costs), tx.filter(t => String(t[2]) === p.id).length,
      f ? Number(f[5]) : '', f ? Number(f[6]) : '', f ? Number(f[8]) : ''];
  }).sort((x, y) => (y[13] === '' ? y[7] : y[13]) - (x[13] === '' ? x[7] : x[13]));
  const sh = sheet('R'); sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Bijgewerkt', Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy HH:mm')]]);
  const head = ['#','Naam','Klas','Speler-ID','Herstelcode','Start','Dag','Waarde nu (€)','Rendement %','AEX %','Verschil pp','Kosten (€)','Transacties','PO-eindwaarde (€)','PO-rendement %','PO-verschil pp'];
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
  return { ok:true, now:new Date().toISOString(), newOrderId:newOrderId || null,
    config:{ START_CAPITAL:CFG.START_CAPITAL, COST_FIXED:CFG.COST_FIXED, COST_PERCENT:CFG.COST_PERCENT, GAME_DAYS:CFG.GAME_DAYS, MIN_MOTIVATION:CFG.MIN_MOTIVATION,
      STRICT_EURONEXT_HOURS:CFG.STRICT_EURONEXT_HOURS, PENDING_RESERVE_BUFFER:CFG.PENDING_RESERVE_BUFFER, MAX_WAIT_MIN:CFG.MAX_WAIT_MIN },
    player:{ id:p.id, first:p.first, last:p.last, klas:p.klas, startDate:p.startDate, endDate:p.endDate, code:p.code, token:p.token, createdAt:p.created },
    cash:p.cash, realized:p.realized, totalCosts:p.costs, positions:p.positions, startIdx:p.startIdx,
    transactions:transactions, pending:pending, notices:notices, snapshots:snapshots, frozen:frozen,
    quotes:qd.quotes, index:qd.index, updated:qd.updated };
}

/* Test: Uitvoeren > testQuotes en bekijk het logboek. */
function testQuotes() { Logger.log(JSON.stringify(readQuotes(), null, 2)); }
