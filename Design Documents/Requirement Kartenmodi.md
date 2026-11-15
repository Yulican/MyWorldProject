# Requirement: Kartenmodi

Stand: vom Nutzer entschieden (UI, Reihenfolge, Speichern, Benchmark, Eimergrenzen Runde 1); Runde 1 umgesetzt (`src/map/mapModes.ts`, Eimergrenzen dort an einer Stelle, Farben in `palette.ts`), Runde 2 offen. Offene Punkte stehen in Abschnitt 11. Die Eimergrenzen von Runde 1 sind aus der Spreizung gealterter Welten gemessen (`tools/modeBucketStats.ts`) und mit dem Nutzer festgelegt; übrige Zahlen sind Startwerte. Spieltexte sind Englisch. Ablauf: Design → Umsetzung (keine Spielregel ändert sich, daher keine Simulationsstufe; nur Messung im Benchmark).

Baut auf allen Systemen auf, deren Werte gezeigt werden: Zufriedenheit, Regionale Rohstoffe (Versorgung, Bauplätze, Stadtstufen, Vorkommen), Diplomatie, Krieg, Zentralregierung, Handel (`Requirement *.md`). Ein Kartenmodus liest nur vorhandene Werte; er erfindet keine neue Regel.

## 1. Ziel

Die Karte zeigt heute Gelände, Gebiete mit Grenzen, Sitze, Armeen und Stadt-Symbole. Wie es einem Volk geht, sieht man nur im Panel pro Hex. Kartenmodi färben die Karte nach einem Wert und zeigen ihn als Zahl, damit man Probleme (Unruhe, Hunger, Krieg) auf einen Blick findet und dann im gewohnten Hex-Panel nachsieht.

## 2. Bedienung

- Im unteren Balken steht neben „Peoples“ ein Knopf **„Map“**. Er öffnet eine kleine Liste der Modi (ein Eintrag je Modus, der aktive hervorgehoben). Antippen wählt den Modus und schließt die Liste.
- **Genau ein Modus ist immer aktiv.** Die Standardkarte **„Political“** (heutiges Aussehen) ist ein eigener Eintrag und der Start- und Rückfallmodus.
- Der Name des aktiven Modus und seine **Legende** stehen als schmale Leiste am Kartenrand (Farbskala mit Endwerten oder Farbliste; bei „Political“ keine Leiste). Hat ein Modus Untermodi (Abschnitt 4, Versorgung), sind sie in der Leiste umschaltbar.
- Die Panels bleiben. **Antippen eines Hex öffnet in jedem Modus dasselbe Hex-Panel** wie heute (Ausnahme: Modus mit Volksauswahl, Abschnitt 5).
- Der Knopf „Map“ ist beim Gacha-Zielmodus (CastBar) wie die übrigen unteren Knöpfe gesperrt oder ausgeblendet, wenn diese es sind; Antippen auf der Karte bedeutet dort weiter „Ziel wählen“.

## 3. Darstellung in allen Modi

- **Immer sichtbar:** Grenzen (offen gestrichelt, Krieg rot gestrichelt), Regierungssitz-Flaggen, Belagerungsrahmen und Armee-Marker. Sie liegen über der Färbung.
- **Modi mit Hex-Füllung** (alle außer Political und „Deposits“ ohne Füllung, siehe dort): Das Gelände wird gedimmt (Helligkeit etwa 50 %) und das Hex mit der Modusfarbe halbtransparent gefüllt. **Straßen und Hex-Symbole (Stadt, Mine, Hafen) werden gedimmt** (etwa 35 % Deckkraft), damit die Füllung lesbar bleibt. Gebietsfarben der Völker entfallen als Fläche; die Grenzlinien bleiben.
- **Zahlen:** Wo ein Modus einen Zahlenwert hat, steht er als kleine Zahl im Hex (Regeln je Modus in Abschnitt 4, Performance in Abschnitt 9).
- **Farbskalen:** Werte werden in **8 bis 12 Stufen** eingeteilt (Eimer), nicht stufenlos; jede Stufe hat eine feste Farbe in `palette.ts`. Skalen: *divergierend* (rot – gelb – grün) für „gut/schlecht“-Werte, *sequenziell* (hell – dunkel einer Farbe) für Mengen, *kategorisch* (feste Farbliste) für Arten. Keine Vorgabe für Farbenblindheit.
- **Nicht betroffene Hexe** (kein Volk, kein Wert): im Modus ohne Füllung, nur gedimmtes Gelände; dies ist keine Stufe der Skala. Nur die Modi „Fertility“ und „Deposits“ füllen auch unbesiedelte Hexe.

## 4. Modi, Datenquelle, Skala, Legende, Zahl

Alle Werte stammen aus den vorhandenen flachen Arrays der Simulation und werden wie die Gebietsdaten **pro Snapshot** in einen kompakten Karten-Puffer kopiert (ein Byte je Hex: Stufe 0–15). Die Simulation ändert sich nicht.

### Runde 1

| Modus (Eintrag) | Wert und Quelle | Skala | Zahl im Hex |
|---|---|---|---|
| **Political** | Standardkarte | – | – |
| **Satisfaction** | Zufriedenheit −100…+100 je bewohntem Hex (`Requirement Zufriedenheit.md` §1) | divergierend, 10 Stufen, untere Grenzen −20, −10, −5, 0, 5, 10, 15, 20, 30; 0 ist die Grenze rot/grün (vier rote Stufen unter 0); Legende etwa −30 … +40 | der Wert, auf ganze Zahlen gerundet. **„May rebel“-Marker:** Siedlungen mit Wert < 0 (unzufrieden im Sinn von `Requirement Krieg.md` §8, Hauptstadt nie) bekommen einen kleinen roten Rand um die Zahl; so ist erkennbar, was bei Stärke zur Rebellion führen kann |
| **Population** (density) | Einwohner je Hex | sequenziell, 10 Stufen, untere Grenzen 10, 20, 35, 50, 65, 80, 100, 125, 150 | Einwohnerzahl |
| **Supply** (load) | Einwohner / Tragfähigkeit des Hex (`Requirement Regionale Rohstoffe.md`, Versorgung) in drei **Untermodi** Food, Water, Space (Umschalter in der Legendenleiste, Standard Food) | divergierend, 8 Stufen, untere Grenzen 25, 50, 70, 85, 95, 105, 120 % (alle Untermodi): grün < 70 %, gelb 85–105 %, dunkelrot ab 120 % | Last in Prozent (z. B. „120“) |
| **Fertility** (Soil, Resources) | Natürlicher Ertrag je Hex, **auch ohne Volk** (alle Land-Hexe); Untermodi (Standard Food): *Food* und *Water* als Ertrag in Personen je Hex ohne Gebäude (`baseSupply`, wie im Hex-Panel), *Wood* und *Stone* als Rohstoffwert 0–1 in Prozent (`resources`) | sequenziell; Food 9 Stufen (10, 20, 30, 45, 60, 80, 100, 130), Water 9 Stufen (10, 20, 35, 50, 70, 90, 120, 160), Wood 8 Stufen (5, 10, 20, 30, 50, 70, 90 %), Stone 8 Stufen (10, 15, 20, 30, 50, 70, 90 %) | keine Zahl im Standard (zu viele Hexe, Abschnitt 9) |
| **Deposits** | Sonder-Vorkommen (`world/deposits.ts`: Eisen, Feuerstein, Luxusarten, Gold nur als Geld usw.), **kategorisch**: eine Farbe je Kategorie (Metal, Mineral, Bounty, Mystic; die vorhandenen `DEPOSIT_COLORS`) | Farbliste, Legende nennt jede Kategorie mit allen ihren Arten | keine Zahl; ein kleiner Farbpunkt/Symbol im Hex statt Füllung, Gelände nur leicht gedimmt (bleibt lesbar, auch außerhalb von Gebieten) |

### Runde 2

| Modus | Wert und Quelle | Skala | Zahl im Hex |
|---|---|---|---|
| **Diplomacy** | Ausgewähltes Volk (Abschnitt 5) → alle anderen: Untermodi *Trust* (Vertrauen −100…+100, `Requirement Diplomatie.md` §1) und *Relation* (kategorisch: unbekannt, Grenze zu, offen, Freihandel, Abkommen, Bündnis, Krieg) | divergierend (Trust) bzw. Farbliste (Relation); das gewählte Volk selbst neutral hervorgehoben | Vertrauen als Zahl auf dem Sitz oder, wenn der Sitz fehlt, auf der Siedlung |
| **War** | Seiten A/B je Krieg des gewählten Volks (`sim.war.side`/`foe`), Besetzte Hexe schraffiert (`Requirement Krieg.md` §5) | Farbliste: Seite A, Seite B, neutral, besetzt (Schraffur in der Farbe des Besetzers) | keine Zahl |
| **Military** | Soldaten je Hex (`hexMilitary`) | sequenziell, 8 Stufen | Soldatenzahl |
| **Government** | Entfernung zum Sitz (Hexe auf dem Weg, `Requirement Zentralregierung.md` §3 Bezirke) | sequenziell, 8 Stufen, Sitz selbst markiert | Entfernung in Hexen |
| **Economy** | Belegte Bauplätze und Stadtstufe (`cityTier`, `Requirement Regionale Rohstoffe.md` §11); Untermodi *Slots* (belegt/nutzbar in Prozent) und *Tier* (kategorisch: Stamm, kleine, große Stadt) | sequenziell bzw. Farbliste | belegte Bauplätze (z. B. „4“) |

### Später (nicht in Runde 1 oder 2)

**Trade** (zunächst ohne Routenlinien: Handelsgewicht je Siedlung, Hafen/Zentrum), **Faith** (Anteil Gläubiger des Gottes je Siedlung, `Requirement Gacha.md`), **Leaders** (Ziel und Eigenschaft des Herrschers je Volk), **God effects** (Hexe mit laufenden Effekten der Götterebene). Jeder braucht vor der Umsetzung einen eigenen Abschnitt in diesem Dokument.

## 5. Volksauswahl (Diplomacy, War)

- Diplomacy und War brauchen ein **ausgewähltes Volk**. Es lässt sich **per Antippen auf der Karte** (Hex eines Volks) und **über die Volksliste** („Peoples“, Eintrag „Show on map“ oder gleichwertig) wählen.
- Beim Wechsel in einen dieser Modi gilt das zuletzt gewählte Volk; gibt es keines, das Volk des Spielers (Start-Volk) bzw. das größte lebende Volk.
- Ist ein Hex-Antippen in diesen Modi die Volkswahl, öffnet es **trotzdem** das Hex-Panel; die Auswahl wird gesetzt, und das Panel zeigt wie sonst die Hex-Daten. Es gibt also nur eine Antipp-Aktion, kein zweites Menü.
- Stirbt das ausgewählte Volk, springt die Auswahl auf das größte lebende Volk; die Legendenleiste nennt immer den Namen des gewählten Volks.

## 6. Reihenfolge (Runden)

1. **Runde 1:** Menü, Legendenleiste, Modusumschaltung, Speichern, Benchmark `modes` mit Political, Satisfaction, Population, Supply, Fertility, Deposits.
2. **Runde 2:** Diplomacy, War (mit Volksauswahl), Military, Government, Economy. Das Szenario `modes` läuft automatisch durch alle dann vorhandenen Modi.
3. **Später:** Trade, Faith, Leaders, God effects.

## 7. Speichern

- Der **aktive Modus** (mit Untermodus) und das **ausgewählte Volk** werden mit dem Spiel gespeichert und beim Laden wiederhergestellt. Sie stehen im **Text-Trailer der App** (nicht im Simulationszustand; `Requirement Speichern und Laden.md` §2, `saveFormat.ts`), damit sich `SAVE_VERSION` und die Bitgleichheit der Simulation nicht ändern.
- Fehlt das Feld (älterer Spielstand) oder passt es nicht (Volk tot, Modus unbekannt), gilt „Political“ und das Standardvolk.
- „New World“ setzt den Modus auf „Political“.

## 8. Wann die Karte neu gezeichnet wird

- Die Modus-Färbung ist Teil der **Kachelbilder** (Detail- und Übersichtskacheln). Eine Kachel trägt als Signatur den Modus, Untermodus, ausgewähltes Volk und die Eimerwerte ihrer Hexe.
- **Ein Moduswechsel zeichnet Kacheln nur, wenn die Karte ruht** (`setResting`). Bis dahin bleiben die alten Kacheln sichtbar (Modus „von gestern“ ist kurz zu sehen, kein Flackern). Die Übersicht (`buildTerrainOverview`) wird wie bisher erst nach `OVERVIEW_REST_MS` neu gebaut.
- Ändern sich Werte während des Spiels (Snapshot), werden nur Kacheln neu gezeichnet, deren Eimerwerte sich ändern, und nur bei ruhender Karte.
- Das Wischen selbst bleibt ohne Mehrarbeit: keine Modusberechnung im Frame; der Karten-Puffer entsteht im Snapshot der Spielzeit.

## 9. Performance und Benchmark

- Grenze: **jeder Swipe ≥ 60 fps, kein Frame über 25 ms**, unverändert.
- **Zahlen im Hex (Regel):**
  - Zahlen werden in die **Kachelbilder** gezeichnet (Glyphen aus einem vorgerenderten Zahlenatlas, kein Live-Text im Frame). Umsetzung: Ziffern, Minus und „k“ als fest hinterlegte Vektorstriche (`GLYPHS` in `mapModes.ts`), je Kachel ein Pfad für alle Zahlen (dunkle Kontur, weiße Linie), keine Schriftart und kein Bild-Atlas nötig.
  - **Nur ab Detailstufe 1 (Zoom ≥ 1,15)**; darunter nur Farbe. Der Benchmark läuft bei Zoom ×2, die Zahlen sind also dabei.
  - **Nur für Siedlungs-Hexe** (bewohnte Hexe): Satisfaction, Population, Supply, Military, Government, Economy, Diplomacy. Es gibt je Welt höchstens einige hundert.
  - **Für Flächen-Modi** (Fertility, alle Hexe) **keine Zahl** im Standard; die Legende gibt die Stufengrenzen. (Zahl ab Zoom ≥ 3 ist offen, Abschnitt 11.)
  - Höchstens 4 Zeichen je Zahl (Werte über 999 als „1k“), Schrift so groß, dass sie bei Zoom ×2 lesbar ist.
- **Neues Szenario `modes`:** gealterte Welten (300 Jahre, wie `aged`), danach **wechselt der Modus während der Swipes** der Reihe nach durch alle vorhandenen Modi (und Untermodi), z. B. ein Wechsel alle 8 Swipes; die Kacheln werden gezeichnet, wenn die Karte ruht (wie in Abschnitt 8). Für Diplomacy/War ist ein Volk ausgewählt (das größte). Schwellen unverändert.
- **Alle bisherigen Szenarien laufen im Modus Political** (Standardmodus) und müssen unverändert bestehen.
- Das Szenario kommt in `src/bench/` (Hook z. B. `modeCycle.ts`), in `benchmark.ts`, `useBenchmark.ts`, im Workflow `.github/workflows/android-build.yml` und in `AGENTS.md` (Szenarioliste) dazu.
- Speicher: ein Byte je Hex für den Karten-Puffer (46 × 44 = rund 2 000 Hexe), kein Problem; er wird pro Snapshot nur gefüllt, wenn ein Modus ungleich Political aktiv ist.

## 10. Abhängigkeiten

- Satisfaction-Modus: `Requirement Zufriedenheit.md` §1, §4; „May rebel“ nach `Requirement Krieg.md` §8.
- Supply, Fertility, Deposits, Economy: `Requirement Regionale Rohstoffe.md` (Versorgung §3, Vorkommen, Stadtstufen §11).
- Diplomacy: `Requirement Diplomatie.md` §1, §4 (Anzeige). War/Military: `Requirement Krieg.md`. Government: `Requirement Zentralregierung.md`. Trade: `Requirement Handel.md` §11.
- Speichern: `Requirement Speichern und Laden.md` §2 (Trailer).
- Ändert sich eine dieser Datenquellen (z. B. Zufriedenheitsskala), ändern sich die Skalen hier.

## 11. Offene Punkte

- **Offen: Zahlenregel (Zoom).** Empfehlung wie Abschnitt 9: Zahlen nur bei Siedlungs-Hexen und ab Zoom ≥ 1,15, Flächen-Modi ohne Zahl. Alternative: Fertility-Zahlen ab Zoom ≥ 3 (Tier 2) einführen, falls Messung im Benchmark Luft zeigt.
- **Entschieden: Eimergrenzen.** Runde 1 gemessen über gealterte Welten (`tools/modeBucketStats.ts`) und festgelegt, siehe Tabelle in Abschnitt 4.
- **Offen: Gedimmtes Gelände.** 50 % Helligkeit und 35 % Symboldeckkraft sind Startwerte, per Sichtprüfung auf dem Handy abstimmen.
- **Offen: Volkswahl per Karte.** Empfehlung wie Abschnitt 5 (Antippen setzt Auswahl und öffnet das Hex-Panel). Alternative: erst Antippen = Auswahl, zweites Antippen desselben Hex = Panel.
- **Offen: Political-Eintrag.** Eigener Eintrag als erster in der Liste (Entscheidung des Nutzers); ob zusätzlich ein Kurzknopf auf der Karte nötig ist, nach dem ersten Test auf dem Handy.
- **Entschieden: „Fertility“-Untermodi.** Food und Water als Ertrag in Personen je Hex (`baseSupply`), Wood und Stone als Rohstoffwert in Prozent (Abschnitt 4).
