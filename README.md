# AEX Beleggingsgame: stappenplan en advies

Bestanden in deze map:

- `index.html` (in Drive: `aex-beleggingsgame.html`): de complete app in één bestand
- `koersen-apps-script.gs`: de server (Google Apps Script). Die levert de koersen, voert orders uit, bewaart alles centraal en maakt het docentenoverzicht.
- dit document: stappenplan voor de koppeling, online zetten en advies

---

## 1. Belangrijk vooraf: de AEX heeft nu 29 fondsen, niet 25

Sinds 22 september 2025 heeft de AEX ruimte voor **30 fondsen** (dat was 25). Door overnames zijn Just Eat Takeaway, JDE Peet's en InPost van de beurs gehaald. Volgens Euronext telde de AEX op **30 september 2026 29 fondsen**. Daarom bevat de app 29 bedrijven:

Aalberts, ABN AMRO, Adyen, Aegon, Ahold Delhaize, AkzoNobel, ArcelorMittal, ASM International, ASML, a.s.r., BE Semiconductor (Besi), CVC Capital Partners, DSM-Firmenich, Exor, Heineken, IMCD, ING, KPN, The Magnum Ice Cream Company, NN Group, Philips, Prosus, RELX, SBM Offshore, Shell, Universal Music Group, Unilever, WDP en Wolters Kluwer.

Recente wijzigingen: SBM Offshore kwam in maart 2026 in de plaats van Randstad en Aalberts kwam erbij in juni 2026. Bij de herziening in september 2026 veranderde er niets. De volgende kwartaalherziening van Euronext is in **december 2026**. Controleer de lijst dan nog even. Je past hem aan in `AEX_STOCKS` bovenaan de HTML en in `TICKERS` in het script.

---

## 2. Eerlijk over "live zonder vertraging"

**Gratis realtime koersen van Euronext Amsterdam bestaan in de praktijk niet.** Euronext rekent licentiekosten voor realtime data. Alle gratis bronnen (Google Finance, Yahoo, beurssites) lopen daarom **15 tot 20 minuten** achter. Het Apps Script hieronder gebruikt `GOOGLEFINANCE`: gratis, stabiel en zonder CORS-problemen, maar met die vertraging. In de app staat "Live koersen", en via het badge-icoon zien leerlingen dat de koersen tot ongeveer 20 minuten vertraagd zijn.

Echte realtime koersen kan alleen met een betaalde data-API:

| Optie | Realtime Euronext? | Nadelen voor school |
|---|---|---|
| **Twelve Data** | Ja, op duurdere abonnementen | Maandabonnement. Voor het tonen aan leerlingen (= "display" aan derden) kan een extra licentie nodig zijn. API-sleutel mag niet in de app staan, dus je hebt een tussenserver nodig. |
| **EODHD** | Vooral vertraagde of end-of-day data voor Europa | Goedkoop, maar geen echte realtime voor Amsterdam. |
| **Finnhub** | Europese realtime data alleen in betaalde pakketten | Prijzig. Dezelfde sleutel- en licentiekwesties. |
| **Euronext zelf** | Ja | Bedoeld voor professionele afnemers en veel te duur voor een PO. |

**Mijn advies:** gebruik de gratis Google-koppeling. Voor een PO van 30 dagen maakt 15 tot 20 minuten vertraging didactisch niets uit. Wat telt is dat **iedereen tegen dezelfde koersen handelt** en dat de motivatie centraal staat. Betaalde realtime data kost geld en brengt licentie- en privacyvragen mee. Daarmee win je geen leerdoel.

**Het enige echte risico van vertraging** is valsspelen. Een slimme leerling ziet op een beursapp dat ASML de afgelopen 10 minuten 3% is gestegen en koopt snel in de game tegen de "oude" koers. **Dat is in servermodus opgelost:** de server voert een order pas uit tegen een koers die ná het inleggen tot stand kwam (zie hoofdstuk 3).

---

## 3. Fraudebestendig en niets kwijtraken: zo werkt het (versie 2)

Zodra de server-URL in de app staat, draait de app in **servermodus**:

- **De server is de bank.** De iPad stuurt alleen "ik wil 10 ASML kopen, omdat …". Het Apps Script controleert alles zelf: is er genoeg cash, heeft de leerling de aandelen echt, is het een heel aantal, is de motivatie lang genoeg? Het voert de order uit tegen de koers uit **jouw** Google Sheet. Saldo, koers of aantal vervalsen op de iPad heeft geen effect: bij de volgende verversing overschrijft de server alles.
- **Geen voordeel van vertraagde koersen.** Een order wordt pas uitgevoerd tegen een koers die **ná** het inleggen tot stand kwam. Dat gebeurt meestal binnen 30 minuten (instelling `MAX_WAIT_MIN`). Wie op een andere app ziet dat ASML net is gestegen, kan dus niet meer tegen de oude koers kopen.
- **Onuitwisbaar logboek.** Iedere transactie komt als nieuwe regel in het tabblad **Transacties**, met tijd, koers, koerstijd, kosten en motivatie. De tabbladen zijn beveiligd, zodat alleen jij en het script ze kunnen wijzigen. Leerlingen hebben geen toegang tot de Sheet.
- **Niets kwijt.** Bij aanmelden krijgt iedere leerling een **speler-ID** en een **herstelcode** van 6 cijfers. Die staan in de app onder *Inleveren* en in jouw tabblad *Overzicht*. Is een iPad kwijt of de app verwijderd, dan kiest de leerling "Herstel je account" en is alles terug. Na 10 foute pogingen wordt herstellen geblokkeerd. Je geeft het weer vrij door in *Spelers* de kolom "Mislukte herstelpogingen" op 0 te zetten.
- **Geen internet?** Een order wordt dan op de iPad bewaard en automatisch verstuurd zodra er weer verbinding is. De server bepaalt dan de koers.
- **Docentenoverzicht.** Elke 5 minuten verwerkt het script orders. Na sluiting van de beurs (17:35) maakt het per leerling een dagstand (tabblad *Snapshots*) en een ranglijst (tabblad *Overzicht*). Op dag 30 na 17:35 legt het de **PO-eindstand** vast in tabblad *Eindstand*. Die verandert daarna niet meer, ook niet als de leerling doorspeelt. Via het menu **AEX Game > Overzicht bijwerken** kun je de ranglijst ook tussentijds vernieuwen.

### Dividend (versie 2.1)

- In het tabblad **Dividenden** zet je per uitkering één regel: ticker (zoals in Koersen, bijvoorbeeld `SHELL.AS`), aandeel, ex-datum (`2027-02-12`) en het **bruto** bedrag per aandeel in euro. Dollarbedragen reken je zelf om.
- Op de ex-datum keert het script automatisch uit aan iedere leerling die het aandeel **de dag ervoor** had. Dat bezit bepaalt het script uit het onuitwisbare transactielogboek, dus niet uit iets wat de iPad doorgeeft.
- Standaard wordt **15% dividendbelasting** ingehouden, net als in het echt. Wil je bruto uitkeren, zet dan in `CFG` `DIVIDEND_TAX_PCT: 0`.
- De leerling ziet een melding, een transactie van het type *Dividend* (de ingehouden belasting staat bij kosten) en het totaal onder *Gerealiseerd*. In *Overzicht* staat een kolom Dividend.
- Kolom E (*Verwerkt op*) vult het script zelf in. Daardoor wordt een regel nooit twee keer uitgekeerd. Een onbekende ticker krijgt daar de melding "Onbekende ticker".
- Let op: op de ex-datum daalt de koers meestal ongeveer met het dividend. Een leerling wordt er dus niet "gratis" rijker van. Dat is een mooi leerpunt voor het verslag.

## 4. Stappenplan: server installeren (ongeveer 15 minuten, gratis)

1. Ga naar **sheets.google.com** en maak een nieuwe, lege spreadsheet. Noem hem bijvoorbeeld "AEX Game – server". **Deel deze spreadsheet met niemand.**
2. Ga naar **Extensies > Apps Script**. Verwijder de voorbeeldcode en plak de volledige inhoud van `koersen-apps-script.gs`. Klik op Opslaan (diskette-icoon).
3. Pas eventueel de instellingen bovenaan (`CFG`) aan, bijvoorbeeld `FIXED_START_DATE: '2026-11-23'`.
4. Kies bovenin de functie **`setup`** en klik op **Uitvoeren**. Google vraagt om toestemming. Kies je account, dan *Geavanceerd > Ga naar (projectnaam) (onveilig)* en vervolgens *Toestaan*. Die waarschuwing is normaal voor een script dat je zelf hebt gemaakt.
5. In de spreadsheet staan nu de tabbladen Koersen, Spelers, Orders, Transacties, Snapshots, Eindstand, Overzicht en Dividenden. Wacht ongeveer een minuut tot de koersen verschijnen. Blijft een koers leeg, verander dan in kolom B de code. Gebruik bijvoorbeeld `EBR:WDP` in plaats van `AMS:WDP`, of zoek de juiste code op google.com/finance.
6. Ga in Apps Script naar **Implementeren > Nieuwe implementatie** > tandwiel > **Web-app**.
   - Uitvoeren als: **Ikzelf**
   - Wie heeft toegang: **Iedereen**
   - Klik op **Implementeren** en kopieer de **web-app-URL** (die eindigt op `/exec`).
7. Stuur mij die URL. Ik zet hem in de app en zet de nieuwe versie online. Wil je het zelf doen: open `index.html` en vul de URL in bij `const DATA_ENDPOINT_URL = "…";`.
8. Wijzig je later het script: plak de nieuwe code, sla op, voer **`setup`** één keer uit (bestaande gegevens blijven staan) en kies **Implementeren > Implementaties beheren > potlood > Versie: Nieuwe versie > Implementeren**. Zo blijft de URL hetzelfde.

Alles valt binnen de gratis limieten van Google. Een gewoon Gmail-account kan dagelijks ruim 1,5 uur scriptrekentijd gebruiken, en dit spel gebruikt voor een klas maar een fractie daarvan.

> **Test eerst zelf.** Meld je in de app aan als testleerling en leg een order in tijdens beurstijd. Binnen ongeveer 30 minuten verschijnt die in het tabblad Transacties. Gooi de testregels daarna weg, of maak een nieuwe spreadsheet voor de echte klas.

## 5. Online zetten

**Huidige link (GitHub Pages, gratis):** https://groefsema1984.github.io/aex-beleggingsgame/

**Alternatief, Netlify:**
1. Hernoem het bestand naar `index.html` en zet het in een lege map.
2. Ga naar **app.netlify.com/drop** en sleep de map erin. Je krijgt meteen een link. Maak gratis een account aan, anders verdwijnt de site na een tijd.
3. Via *Site configuration > Change site name* kies je een nette naam, bijvoorbeeld `aex-game-jouwschool.netlify.app`.

**GitHub Pages:** maak een repository, upload `index.html` en zet Pages aan via *Settings > Pages > Deploy from branch (main)*.

**Op de iPad (instructie voor leerlingen):**
1. Open de link in **Safari** (niet in Chrome of in de Smartschool/Magister-app).
2. Tik op het deel-icoon en kies **"Zet op beginscherm"**.
3. Open de app **vanaf het beginscherm** en vul daar pas je naam en klas in.

> Let op: op iPad bewaart de app op het beginscherm zijn gegevens **apart** van Safari. Begint een leerling in Safari en zet hij de app daarna op het beginscherm, dan begint hij opnieuw. De app geeft hier zelf een tip over. Een back-up terugzetten lost het ook op.

## 6. Instellingen in de app (bovenaan het HTML-bestand)

| Constante | Standaard | Betekenis |
|---|---|---|
| `DATA_ENDPOINT_URL` | `""` | URL van je Apps Script. Leeg = simulatiemodus (alles alleen op de iPad, om te testen). Ingevuld = servermodus. In servermodus gelden de instellingen uit `CFG` in het script. |
| `STRICT_EURONEXT_HOURS` | `true` | Buiten beurstijd worden orders lopende orders. `false` = direct tegen slotkoers |
| `START_CAPITAL` | 10000 | Startkapitaal |
| `COST_FIXED` / `COST_PERCENT` | 2,00 / 0,10 | Transactiekosten |
| `GAME_DAYS` | 30 | Looptijd van de PO |
| `FIXED_START_DATE` | `null` | **Aanrader:** zet bijvoorbeeld `"2026-11-23"` zodat de hele klas dezelfde 30 dagen speelt en eindstanden eerlijk vergelijkbaar zijn |
| `PENDING_EXEC_DELAY_MIN` | 20 | Hoeveel minuten na opening lopende orders worden uitgevoerd |
| `REFRESH_INTERVAL_MIN` | 60 | Automatisch verversen (minuten) |

---

## 7. Wat ik heb toegevoegd ten opzichte van je opdracht

- **Tabblad "Bedrijven"** met per AEX-fonds: wat het bedrijf doet, bekende producten en merken, waarom het belangrijk is, en waar je als belegger op let. De tekst is geschreven voor bovenbouwleerlingen en ingedeeld per sector. Vanuit de beurslijst tik je ook direct op een bedrijf.
- **Euronext-feestdagen**: Nieuwjaar, Goede Vrijdag, Tweede Paasdag, 1 mei en beide Kerstdagen worden herkend. Op 24 en 31 december sluit de beurs om 14:05.
- **Eerlijke uitvoering van lopende orders**: is er te weinig cash bij opening (de koers kan gestegen zijn), dan wordt het aantal automatisch verlaagd. Daarbij wordt 5% extra cash geblokkeerd als buffer.
- **Benchmark als keten-index**: de AEX-vergelijking springt niet als de app wisselt tussen simulatie en live.
- **PDF-rapport als echt PDF-bestand** (via jsPDF), dat leerlingen direct kunnen AirDroppen, plus een printversie als reserve.
- **Kosten als percentage van de order** in het orderscherm, zodat leerlingen zien dat kleine orders relatief duur zijn.

## 8. Advies voor verbeteringen (als app-ontwikkelaar en beleggingsspecialist)

**Didactisch**

1. **Gebruik een vaste startdatum voor de klas** (`FIXED_START_DATE`). Alleen dan kun je rendementen eerlijk vergelijken. De markt is niet elke maand hetzelfde.
2. **Laat leerlingen vooraf een beleggingsplan schrijven**: risicoprofiel, gekozen sectoren en een maximum per aandeel. Laat ze in het eindverslag reflecteren op het verschil tussen plan en uitvoering. Dat levert meer op dan alleen naar het rendement kijken.
3. **Beoordeel niet (alleen) op rendement.** In 30 dagen is rendement vooral geluk. Beoordeel ook de kwaliteit van de motivaties, de spreiding en de reflectie. Anders beloon je gokgedrag, zoals alles in één aandeel stoppen.
4. **Overweeg spreidingsregels**, zoals maximaal 30% in één aandeel of minimaal 3 sectoren. Die kan ik als waarschuwing of harde regel inbouwen.
5. **Dividend** zit er nu in (zie hoofdstuk 3). In de meeste 30-dagenperiodes valt er weinig of geen ex-datum. De meeste AEX-bedrijven keren uit tussen februari en mei en tussen augustus en november. Check vóór de start op de beleggerssites van de bedrijven of er een ex-datum in jouw periode valt.

**Technisch / organisatorisch**

6. **Klassenoverzicht**: dit zit nu in de server (zie hoofdstuk 3).
7. **Back-ups**: in servermodus staat alles op de server en herstellen gaat met de herstelcode. Laat leerlingen die code wel bewaren (screenshot). Download zelf af en toe een kopie van de spreadsheet (Bestand > Downloaden > .xlsx) als extra zekerheid.
8. **Privacy (AVG)**: in servermodus komen naam, klas en transacties van leerlingen in jouw Google Sheet. Gebruik bij voorkeur een Google-account van school, en stem dit kort af met je privacyfunctionaris. Er staan geen leerlinggegevens op GitHub.
9. **Zet de server aan vóór de start.** Wat leerlingen in simulatiemodus doen, wordt niet meegenomen. Als de server aanstaat, begint iedereen opnieuw met een echt account.

## Bronnen samenstelling AEX

- Euronext: AEX Equal Weight-samenstelling per 30-09-2026 (29 fondsen) en AEX-factsheet per 30-09-2026
- Euronext-persberichten over de kwartaalherzieningen: maart 2026 (SBM Offshore in, Randstad uit), juni 2026 (Aalberts in) en september 2026 (geen wijzigingen)
- Lynx.nl: "AEX van 25 naar 30 aandelen" (uitbreiding per 22-09-2025)

---

## 9. PO-onderdelen in de app (versie 3)

De hele praktische opdracht zit nu in de app, in het tabblad **PO**. Leerlingen leveren uiteindelijk één PDF in: het **PO-dossier**.

**Logboek** (startplan, tussenevaluatie dag 10, tussenevaluatie dag 20, eindreflectie dag 30)
- Vaste vragen met een minimum aantal woorden per vraag. Startplan minimaal 300 woorden, evaluaties minimaal 200, eindreflectie minimaal 440 (met aparte vragen over de AEX Experience en DNB).
- Een leerling kan pas handelen als het startplan is ingeleverd (`REQUIRE_STARTPLAN`).
- Inleveren kan op de inleverdag plus 2 dagen uitloop (`LOG_GRACE_DAYS`). Daarna staat het als **TE LAAT** en telt het voor 0 punten.
- Na inleveren ligt alles met tijdstempel vast in het tabblad **Logboek**. Wijzigen kan niet meer.

**Bezoekopdrachten** (AEX Experience en DNB, plus een vervangende opdracht)
- Per bezoek 2 opdrachten met foto's (camera of fotorol) en een korte reflectie.
- Foto's worden in de app verkleind en opgeslagen in je Google Drive, in de map **"AEX Game – PO-foto's (niet delen)"**. Tabblad **Fotos** laat per foto het uploadtijdstip en, als die er is, de opnamedatum zien.
- **Codewoorden**: zet vóór het bezoek per onderdeel (aex of dnb) een regel in het tabblad **Codewoorden** met het codewoord en de bezoekdatum. Noem het codewoord pas ter plekke. De server controleert het codewoord bij inleveren.
- **Vervangende opdracht**: zet een regel met een persoonlijk codewoord, de datum, het speler-ID van de leerling en de locatie.
- Inleveren kan tot en met 3 dagen na de bezoekdatum (`VISIT_GRACE_DAYS`).

**Automatische check en beoordeling**
- Per periode van 10 dagen minimaal 5 transacties op minimaal 3 verschillende dagen (`PERIOD_MIN_TX`, `PERIOD_MIN_DAYS`). De server telt ook de **actieve dagen** (dagen waarop de app is geopend).
- Tabblad **Beoordeling** (wordt elke avond en via het menu *AEX Game > Beoordeling bijwerken* bijgewerkt):
  - De blauwe kolommen vult het script: activiteit (automatisch, maximaal 10 punten), status van elk onderdeel (op tijd, te laat of ontbreekt) en een voorstel voor de bewijspunten per bezoek.
  - De gele kolommen vul jij in met de rubric. Laat je de bewijskolom leeg, dan telt het voorstel.
  - Totaal en cijfer rekenen zichzelf uit. Te laat of ontbrekend telt automatisch voor 0 punten.

**Installeren van versie 3:** plak het nieuwe script, voer **`setup`** één keer uit en geef Google toestemming voor **Drive** (nieuw, voor de foto's). Kies daarna *Implementeren > Implementaties beheren > potlood > Nieuwe versie*. Bestaande gegevens blijven staan.
