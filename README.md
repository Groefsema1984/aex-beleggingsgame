# AEX Beleggingsgame: stappenplan en advies

Bestanden in deze map:

- `aex-beleggingsgame.html`: de complete app in één bestand
- `koersen-apps-script.gs`: het Google Apps Script voor de koersen
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

**Het enige echte risico van vertraging** is valsspelen. Een slimme leerling ziet op een beursapp dat ASML de afgelopen 10 minuten 3% is gestegen en koopt snel in de game tegen de "oude" koers. Twee maatregelen zitten al in de app:

- Lopende orders (ingelegd buiten beurstijd) worden pas **20 minuten na opening** uitgevoerd (`PENDING_EXEC_DELAY_MIN = 20`). Op dat moment heeft de gratis koers de opening bijgewerkt.
- Alle orders staan met tijd en motivatie in het logboek, zodat je verdacht snelle winsten kunt terugzien.

Wil je dit helemaal dichttimmeren, dan is de beste aanvulling: **orders altijd uitvoeren tegen de eerstvolgende koers na het inleggen**, dus nooit tegen de koers die al op het scherm stond. Dat kan ik als optie inbouwen.

---

## 3. Stappenplan: koersenkoppeling (ongeveer 15 minuten)

1. Ga naar **sheets.google.com** en maak een nieuwe, lege spreadsheet. Noem hem bijvoorbeeld "AEX koersen". Gebruik bij voorkeur een schoolaccount of een apart Google-account.
2. Ga naar **Bestand > Instellingen** en zet de tijdzone op *(GMT+01:00) Amsterdam*. Klik op Opslaan.
3. Ga naar **Extensies > Apps Script**. Verwijder de voorbeeldcode en plak de volledige inhoud van `koersen-apps-script.gs`. Klik op het diskette-icoon (Opslaan).
4. Kies bovenin in het keuzemenu de functie **`setup`** en klik op **Uitvoeren**. Google vraagt om toestemming. Kies je account, dan *Geavanceerd > Ga naar (projectnaam)* en vervolgens *Toestaan*.
5. Ga terug naar de spreadsheet. Er staat nu een tabblad **"Koersen"** met 30 regels (de AEX-index en 29 aandelen). Wacht ongeveer een minuut tot de koersen verschijnen.
   - Blijft een cel leeg, dan kent Google die code niet. Verander in kolom B bijvoorbeeld `AMS:WDP` in `EBR:WDP` (WDP noteert ook in Brussel), of controleer de code op google.com/finance.
   - De app gaat netjes om met een ontbrekende koers: dat aandeel krijgt het label "geen actuele koers" en handelen erin wordt tijdelijk geblokkeerd.
6. Ga in Apps Script naar **Implementeren > Nieuwe implementatie**. Klik op het tandwiel en kies **Web-app**.
   - Beschrijving: "AEX koersen"
   - Uitvoeren als: **Ikzelf**
   - Wie heeft toegang: **Iedereen** (dus ook zonder inloggen; nodig voor de iPads van leerlingen)
   - Klik op **Implementeren** en kopieer de **web-app-URL** (die eindigt op `/exec`).
7. Test de URL in je browser. Je ziet dan JSON met `"ok":true` en de koersen.
8. Open `aex-beleggingsgame.html` in een teksteditor en vul bovenaan de URL in:
   `const DATA_ENDPOINT_URL = "https://script.google.com/macros/s/…/exec";`
9. Wijzig je later het script, kies dan **Implementeren > Implementaties beheren > potlood > Versie: Nieuwe versie**. Zo blijft de URL hetzelfde.

Het script cachet de koersen 60 seconden. Ook bij een volle klas die tegelijk ververst blijft het daardoor ruim binnen de gratis limieten van Google.

## 4. Stappenplan: online zetten

**Netlify (snelst):**
1. Hernoem het bestand naar `index.html` en zet het in een lege map.
2. Ga naar **app.netlify.com/drop** en sleep de map erin. Je krijgt meteen een link. Maak gratis een account aan, anders verdwijnt de site na een tijd.
3. Via *Site configuration > Change site name* kies je een nette naam, bijvoorbeeld `aex-game-jouwschool.netlify.app`.

**GitHub Pages:** maak een repository, upload `index.html` en zet Pages aan via *Settings > Pages > Deploy from branch (main)*.

**Op de iPad (instructie voor leerlingen):**
1. Open de link in **Safari** (niet in Chrome of in de Smartschool/Magister-app).
2. Tik op het deel-icoon en kies **"Zet op beginscherm"**.
3. Open de app **vanaf het beginscherm** en vul daar pas je naam en klas in.

> Let op: op iPad bewaart de app op het beginscherm zijn gegevens **apart** van Safari. Begint een leerling in Safari en zet hij de app daarna op het beginscherm, dan begint hij opnieuw. De app geeft hier zelf een tip over. Een back-up terugzetten lost het ook op.

## 5. Instellingen in de app (bovenaan het script)

| Constante | Standaard | Betekenis |
|---|---|---|
| `DATA_ENDPOINT_URL` | `""` | URL van je Apps Script. Leeg = simulatiemodus |
| `STRICT_EURONEXT_HOURS` | `true` | Buiten beurstijd worden orders lopende orders. `false` = direct tegen slotkoers |
| `START_CAPITAL` | 10000 | Startkapitaal |
| `COST_FIXED` / `COST_PERCENT` | 2,00 / 0,10 | Transactiekosten |
| `GAME_DAYS` | 30 | Looptijd van de PO |
| `FIXED_START_DATE` | `null` | **Aanrader:** zet bijvoorbeeld `"2026-11-23"` zodat de hele klas dezelfde 30 dagen speelt en eindstanden eerlijk vergelijkbaar zijn |
| `PENDING_EXEC_DELAY_MIN` | 20 | Hoeveel minuten na opening lopende orders worden uitgevoerd |
| `REFRESH_INTERVAL_MIN` | 60 | Automatisch verversen (minuten) |

---

## 6. Wat ik heb toegevoegd ten opzichte van je opdracht

- **Tabblad "Bedrijven"** met per AEX-fonds: wat het bedrijf doet, bekende producten en merken, waarom het belangrijk is, en waar je als belegger op let. De tekst is geschreven voor bovenbouwleerlingen en ingedeeld per sector. Vanuit de beurslijst tik je ook direct op een bedrijf.
- **Euronext-feestdagen**: Nieuwjaar, Goede Vrijdag, Tweede Paasdag, 1 mei en beide Kerstdagen worden herkend. Op 24 en 31 december sluit de beurs om 14:05.
- **Eerlijke uitvoering van lopende orders**: is er te weinig cash bij opening (de koers kan gestegen zijn), dan wordt het aantal automatisch verlaagd. Daarbij wordt 5% extra cash geblokkeerd als buffer.
- **Benchmark als keten-index**: de AEX-vergelijking springt niet als de app wisselt tussen simulatie en live.
- **PDF-rapport als echt PDF-bestand** (via jsPDF), dat leerlingen direct kunnen AirDroppen, plus een printversie als reserve.
- **Kosten als percentage van de order** in het orderscherm, zodat leerlingen zien dat kleine orders relatief duur zijn.

## 7. Advies voor verbeteringen (als app-ontwikkelaar en beleggingsspecialist)

**Didactisch**

1. **Gebruik een vaste startdatum voor de klas** (`FIXED_START_DATE`). Alleen dan kun je rendementen eerlijk vergelijken. De markt is niet elke maand hetzelfde.
2. **Laat leerlingen vooraf een beleggingsplan schrijven**: risicoprofiel, gekozen sectoren en een maximum per aandeel. Laat ze in het eindverslag reflecteren op het verschil tussen plan en uitvoering. Dat levert meer op dan alleen naar het rendement kijken.
3. **Beoordeel niet (alleen) op rendement.** In 30 dagen is rendement vooral geluk. Beoordeel ook de kwaliteit van de motivaties, de spreiding en de reflectie. Anders beloon je gokgedrag, zoals alles in één aandeel stoppen.
4. **Overweeg spreidingsregels**, zoals maximaal 30% in één aandeel of minimaal 3 sectoren. Die kan ik als waarschuwing of harde regel inbouwen.
5. **Dividend** wordt nu niet meegenomen. Over 30 dagen is het effect klein, maar het is een mooi begrip voor in het verslag. Ik kan uitkeringen op de ex-dividenddatum toevoegen.

**Technisch / organisatorisch**

6. **Klassenoverzicht voor de docent.** Nu staan alle gegevens alleen op de iPad van de leerling (localStorage). Leerlingen kunnen daar in theorie mee knoeien, en jij ziet pas iets als ze inleveren. Met een kleine uitbreiding van hetzelfde Apps Script kan de app de dagelijkse stand automatisch naar een Google Sheet van de docent sturen. Dan heb je een live ranglijst en een controle-exemplaar van elke portefeuille. **Dit is mijn belangrijkste aanbeveling.**
7. **Back-ups**: laat leerlingen elke week naast de CSV ook een back-up (.json) maken. Safari kan websitegegevens wissen als een site lang niet gebruikt is. Voor apps op het beginscherm geldt dat in de praktijk niet, maar een back-up is een goede verzekering.
8. **Privacy (AVG)**: de app verstuurt geen leerlinggegevens. Alles blijft op de iPad, en het koersenscript ontvangt alleen een verzoek om koersen. Kies je voor punt 6, dan gaan namen naar een Google-account van school. Stem dat af met je privacyfunctionaris.
9. **Test de koppeling vóór de start.** Gaat de klas eerst in simulatiemodus van start en zet je later de koppeling aan, dan springen de koersen van simulatie naar echt. Dat geeft scheve resultaten.

## Bronnen samenstelling AEX

- Euronext: AEX Equal Weight-samenstelling per 30-09-2026 (29 fondsen) en AEX-factsheet per 30-09-2026
- Euronext-persberichten over de kwartaalherzieningen: maart 2026 (SBM Offshore in, Randstad uit), juni 2026 (Aalberts in) en september 2026 (geen wijzigingen)
- Lynx.nl: "AEX van 25 naar 30 aandelen" (uitbreiding per 22-09-2025)
