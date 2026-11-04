# Requirement: Krieg

Stand: **Phase 0 und 1 umgesetzt, Phase 2 (Schlacht) umgesetzt, Phasen 3 bis 5 vom Nutzer entschieden, aber noch nicht simuliert** (Branch `feature/war`). Ablauf: Design → Simulation → Umsetzung. Alle Zahlen sind Startwerte; was noch gerechnet werden muss, ist mit „kalibrieren (Simulation)“ markiert. Spieltexte sind Englisch.

Baut auf Diplomatie (`Requirement Diplomatie.md`, Stufe 2), Zufriedenheit (`Requirement Zufriedenheit.md`), Zentralregierung (`Requirement Zentralregierung.md`), regionalen Rohstoffen (`Requirement Regionale Rohstoffe.md`, strategische Güter) und Handel auf.

## 1. Ziel

Völker rüsten auf, bedrohen einander, erklären Kriege um Regierungssitze und Bezirke, schließen Bündnisse. Aufstände laufen künftig ebenfalls als Krieg ab. Gebäude, Güter und Geld des Volks bekommen damit einen militärischen Zweck.

## 2. Soldaten und Stärke

Zahlen von Phase 0 und 1 sind simuliert und vom Nutzer gewählt (Abschnitt 14); die übrigen bleiben „kalibrieren (Simulation)“.

- **Ausbildung:** Militärgebäude bilden jährlich Soldaten aus der Bevölkerung aus: 25 % der Gebäudekapazität pro Jahr, nur wenn der Sold des nächsten Jahres gedeckt ist. Soldaten werden von der Bevölkerung abgezogen (sie kosten Wachstum und Ernte).
  - **Grenzen:** Höchstens 10 % der Bevölkerung einer Siedlung sind Soldaten; pro Jahr werden höchstens 50 % ihrer Erwachsenen ausgebildet.
  - **Rückkehr:** Soldaten über der Kapazität eines Gebäudes, oder deren Siedlung ihren Bezirk verliert, kommen in die Bevölkerung zurück.
- **Soldaten sterben nur durch Krieg** (kein Altern, keine Desertion).
- **Gebäude:** Kaserne = Nahkampf, Schießplatz = Fernkampf, Stall = Schock (nur mit Pferden im Lager). Kapazität: 20 Soldaten pro Gebäude. Kosten und Unterhalt: kalibrieren (Simulation).
- **Soldaten sind in der Siedlung**, können aber zu Armeen zusammengestellt und bewegt werden (Abschnitt 4).
- **Aufrüstung macht die Regierung** (Sitz, `Requirement Zentralregierung.md`, Abschnitt 5). Ein Sitz baut Militärgebäude, wenn
  - ein stärkeres Volk das Volk bedroht (Gefahr ≥ 50), oder
  - es unzufriedene Siedlungen (Zufriedenheit < 0) im Reich gibt, oder
  - die Kasse mindestens 5 Jahre Sold eines Gebäudes übrig hat.
  Die Einkommensprüfung (40 %) schließt den Sold ein. Höchstens ein Gebäude je Art und Siedlung, ab 40 Einwohnern. Die Art ist die, von der das Volk die wenigsten Soldaten hat; ein Stall nur mit Pferden im Lager.
- **Reihenfolge der Regierungsvorhaben:** Regierungssitz > Komfort > Militär > Wachstum (Sitz und Komfort zählen als Loyalität der Siedlungen).
- **Sold:** nur Geld, 0,1 pro Soldat und Jahr, aus der Kasse des Bezirks. Reicht sie nicht, deckt der Topf der übrigen Sitze des Volks die Lücke. Die Regierung hält die Sold-Reserve zurück und gibt sie nicht für Vorhaben aus.
- **Ohne Sold** werden Soldaten entlassen und kommen in die Bevölkerung ihrer Siedlung zurück (kein Verlust durch Desertion).
- **Strategische Güter:** Faktor ×1,5 je Truppenart und Gut. Verbrauch: 1 Einheit je 20 Soldaten und Jahr; fehlt das Gut, gilt der Faktor nicht. Zuordnung: Eisen → Nahkampf, Feuerstein → Fernkampf, Pferde → Schock (`Requirement Regionale Rohstoffe.md`, Abschnitt 10). Eisen und Feuerstein sind keine Luxusgüter und geben keinen Komfort.
- **Beschaffung:** Regierungshändler (der Sitze) kaufen fehlende strategische Güter bei eigenen Siedlungen und bringen sie zu den Soldaten. Ein Volk siedelt freie Eisen- und Feuerstein-Vorkommen nur, wenn es bedroht ist (ein Volk hat Gefahr ≥ 50 ihm gegenüber).
- **Handel:** Strategische Güter sind Teil der Handelsabkommen, mit starkem Wunsch (5-faches Gewicht). Verkauf nur, wenn die Gefahr des Käufers für den Verkäufer ≤ 40 ist, nie an Kriegsgegner und deren Verbündete. Ohne Abkommen gibt es über geschlossene Grenzen keinen Handel damit.
- **Gold:** Abgebautes Gold ist Geld, das in der Siedlung entsteht, und wird wie anderes erzeugtes Geld besteuert (der Steueranteil geht in die Kasse des Bezirks). 5 Geld je Einheit.
- **Stärke eines Volks:** Summe der Soldaten, gewichtet mit den Güterfaktoren. Verbündete zählen zur Stärke (Abschnitt 7).
- **Gefahr:** 50 × (Stärke des anderen + 20) ÷ (eigene Stärke + 20), höchstens 100, × Nähe. Die +20 verhindern 0 ÷ 0. Ersetzt die Bevölkerung in der Gefahr-Formel (`Requirement Diplomatie.md`, Abschnitt 1).

## 3. Schlacht

Simuliert und vom Nutzer gewählt (Abschnitt 14).

- Armeen bestehen aus Nahkampf, Fernkampf und Schock. Stärke einer Truppe = Soldaten × Güterfaktor.
- **Schaden:** Jeder Angriff entzieht dem Ziel 10 % × Angriffsstärke. Das Ziel verliert Soldaten = Schaden ÷ sein Faktor.
- **Ziel:** Fernkampf und Schock treffen nur die vorderste Linie des Gegners: Nahkampf, sonst Schock, sonst Fernkampf.
- **Vorderste Linie ohne Nahkampf:** Kämpft mit −50 % und nutzt in dieser Runde nicht ihre eigene Rolle.
- **Ablauf je Runde:** Fernkampf → Nahkampf → Schock. Innerhalb einer Phase wirken beide Seiten gleichzeitig, zwischen den Phasen nacheinander.
- **Dauer:** höchstens 5 Runden.
- **Rückzug:** Eine Seite zieht ab, wenn ihre Stärke zu Beginn einer Runde unter 50 % der Anfangsstärke liegt (geprüft am Rundenanfang, nicht nach jeder Phase; vom Nutzer bestätigt).
- **Sieger:** Die Seite, die den größeren Anteil ihrer Anfangsstärke behält.
- Gerechnet wird pro Schlacht mit Zählern, nicht pro Soldat (Rechenzeit).

## 4. Armeen

- Eine Armee ist ein Zähler (Nahkampf / Fernkampf / Schock) mit Position. Die Soldaten werden aus der Heimatsiedlung abgezogen.
- Armeen marschieren über Straßen nach Reisekosten. Eine Armee darf im ganzen Land frei zu jedem Ort ziehen; sie muss nur hinkommen.
- Zusammenführen mehrerer Armeen und Marschgeschwindigkeit: kalibrieren (Simulation).

## 5. Belagerung und Besetzung

- **Belagert werden können Regierungssitze,** auch die Hauptstadt.
- **Während der Belagerung:** alle Kapazitäten der Siedlung (Ernte, Bau, Bevölkerung) halbiert; der Handel mit der Siedlung ruht.
- **Entsatz:** Die Armee der Siedlung oder Armeen anderer Siedlungen des Volks (und von Verbündeten) können die Belagerung brechen. Es gibt keine Entfernungsgrenze, die Armee muss den Weg zurücklegen.
- **Verteidigerbonus:** +25 % in einem belagerten Sitz, +50 % mit eigener Armee im Sitz (entschieden).
- **Besetzung:** Erreicht die Unzufriedenheit der Siedlung den Wert, bei dem sie sich abspalten würde, wird sie besetzt statt abtrünnig. Für die Besetzung gilt weiter die 5-Jahres-Regel (5 Jahre am Stück unter 0), anders als beim Aufstand (Abschnitt 8).
- **Beute:** Der Eroberer übernimmt das Lager und die Hälfte der Kasse; Gebäude bleiben stehen.
- **Hauptstadt:** Wird die Hauptstadt besetzt, wird das Volk annektiert und ausgelöscht; sein ganzes Gebiet fällt an den Eroberer.

## 6. Kriegserklärung, Frieden, Eroberung

- **Erklärung:** Ein Volk darf erklären, wenn seine Stärke das ≥2-Fache des Nachbarn ist. Ziel: einen Regierungssitz samt Bezirk erobern. Der Sitz muss besetzt werden können, und der Feind darf nicht glauben, ihn zurückzuerobern (Aufgabe: siehe unten).
- Höchstens **ein Krieg** je Volk gleichzeitig.
- **Aufgabe:** Eine Seite gibt auf, wenn sie weniger als 40 % der Stärke des Gegners hat (entschieden).
- **Kriegsbeginn:** Abkommen und offene Grenzen enden, Handel mit dem Gegner ruht.
- **Ende:** Der Krieg endet, wenn das Kriegsziel erreicht ist oder nach N Jahren Erschöpfung (N: kalibrieren (Simulation)). Danach: Vertrauen −30 (klingt in 10 Jahren ab), Grenzen geschlossen, alle Abkommen aufgehoben, 20 Jahre Waffenstillstand (keine neue Erklärung zwischen diesen Völkern).
- **Eroberung:** Der ganze Bezirk des Sitzes wechselt den Besitzer. Zufriedenheit dort: Teilwert „erobert“ −15, klingt über 10 Jahre ab.
- Chronik: Kriegserklärung, Belagerung, Besetzung, Frieden, Annexion, mit Dialog und „Go to“.

## 7. Bündnisse

- **Verteidigungspakt:** Vertrauen ≥ 40 und gemeinsame Bedrohung (beide haben Gefahr ≥ 50 durch dasselbe dritte Volk). Hilft nur, wenn ein Partner angegriffen wird.
- **Bündnis:** Vertrauen ≥ 70. Die Partner helfen auch bei Angriffen (sie ziehen in Angriffskriege mit).
- **Auflösung:** mit Abstand zu den Schwellen (Lücke gegen Hin und Her, Startwerte Pakt < 30, Bündnis < 55; kalibrieren (Simulation)).
- Verbündete zählen zur Stärke (Abschnitt 2).
- Ein Krieg bricht alle Abkommen zwischen den Kriegsparteien ab.

## 8. Aufstände als Krieg

- Gilt nur für **echte Aufstände** (Abspaltung durch Unzufriedenheit). Abgeschnittene Gebiete bleiben friedlich wie heute (sie werden direkt ein neues Volk). Es gibt keine Mindestgröße der Rebellen mehr (die heutige Bundgröße von 3 Siedlungen oder 100 Einwohnern entfällt für Aufstände).
- **Unzufrieden** heißt: Zufriedenheit der Siedlung aktuell < 0. Die 5-Jahres-Regel entfällt für Aufstände (die Rebellen müssen ohnehin lange genug unter 0 bleiben, um die Stärke aufzubauen). Die Hauptstadt wird nie unzufrieden im Sinn der Abspaltung.
- **Unzufriedene Siedlungen** müssen **nicht zusammenhängen**. Sie bleiben normaler Teil des Reichs, ohne Sonderzustand, bis die **Stärke aller unzufriedenen Siedlungen des Reichs zusammen größer ist als die Stärke des Mutterlandes** (nicht die ≥2-Schwelle der Kriegserklärung). Dann erklären sie den Krieg und werden dabei **sofort ein unabhängiges Volk** (Hauptstadt wie in `Requirement Zufriedenheit.md`).
- **Ein Krieg, eine Seite:** Alle unzufriedenen Siedlungen beginnen die Rebellion gemeinsam und kämpfen im Krieg als eine Seite. Gewinnen sie, wird aus jeder zusammenhängenden Gruppe ein eigenes Volk; die neuen Völker sind miteinander verbündet.
- **Krieg der Rebellen:** Das Mutterland muss alle Regierungssitze des neuen Volks erobern. Gelingt das, werden die Rebellen wieder annektiert. Endet der Krieg ohne das (Erschöpfung), bleiben die Rebellen unabhängig.
- **Besitzerwechsel zur Erklärung:** Die Rebellensiedlungen wechseln mit der Erklärung den Besitzer; ihre spätere Zufriedenheit ist für den Krieg ohne Belang. Siedlungen, die an einem laufenden Rebellenkrieg beteiligt sind (auf beiden Seiten), können sich keiner weiteren Rebellion anschließen.
- **Annektierte Rebellensiedlungen** bekommen den Teilwert „erobert“ (−15, klingt über 10 Jahre ab).
- **Hilfe von außen:** Völker, die sich vom Mutterland bedroht fühlen und nicht mit ihm befreundet sind, können den Rebellen als Bündnispartner helfen.
- Teilwerte: „Neuer Stamm“ und „Erfolgreiche Revolution“ gelten, wenn die Rebellen den Krieg gewinnen; „Verlorene Revolution“ gilt für das Mutterland, wenn die Rebellen unabhängig bleiben (Abschnitt 2, Tabelle der Teilwerte, in `Requirement Zufriedenheit.md`).

## 9. Anzeige

- Kriegs-Panel („War ›“ im Völker-Panel, wie Diplomatie und Government): Stärke, Armeen, Kriege, Belagerungen, Bündnisse, Gefahr in beide Richtungen mit Teilwerten.
- Karte: Armeen als Marker, belagerte Sitze mit Rahmen, Kriegsgrenzen farbig (kommt in Phase 3).

## 10. Phasen

0. **Vorstufe:** Abbaugebäude für Eisen und Feuerstein, beide als Handelswaren (Vorkommen bei der Weltgenerierung doppelt so häufig); Gold wird abgebaut und kommt direkt als Geld in die Siedlung (kein Luxusgut mehr, Luxusgüter 6 → 5). Simuliert, Zahlen gewählt (Abschnitt 14).
1. **Militär ohne Kampf:** Gebäude, Soldaten, Sold, strategische Güter und ihr Verkauf; Gefahr aus Stärke statt Bevölkerung; Anzeige. Simuliert, Zahlen gewählt (Abschnitt 14).
2. **Schlachtrechnung** als reine Funktion mit Tests und Stats-Tool (`warStats`). Simuliert, Zahlen gewählt (Abschnitt 14).
3. **Krieg auf der Karte:** Armeen, Marsch, Belagerung, Besetzung, Kriegserklärung, Frieden, Annexion der Hauptstadt.
4. **Bündnisse und Verteidigungspakte.**
5. **Aufstände als Krieg** (Abschnitt 8).

Jede Phase wird mit 12 Welten simuliert (Kettenreaktionen von Aufständen, Kriege je Welt, Bevölkerung, Handel, Rechenzeit) und vor der Umsetzung mit dem Nutzer abgestimmt.

## 11. Performance und Benchmark

- Stärke und Gefahr jährlich pro Volkspaar (Zähler); Schlachten pro Schlacht, nicht pro Soldat; Armeen als wenige Zähler.
- Ziel: ein simuliertes Jahr höchstens 1,3-mal so teuer wie heute.
- **Neues Benchmark-Szenario `war`:** 300 Jahre gealtert, danach Kriege überall: Armeen unterwegs, belagerte Sitze, Rebellenkriege. Marker und Rahmen erscheinen überall auf der Karte. Alle Szenarien müssen bestehen.

## 12. Abhängigkeiten

- `Requirement Diplomatie.md`: Gefahr aus Stärke, Kriegszustand, Bündnisse, Verkauf strategischer Güter.
- `Requirement Zufriedenheit.md`: Aufstand läuft über Krieg; „Verlorene Revolution“ neu definiert; Teilwert „erobert“.
- `Requirement Zentralregierung.md`: Sold aus der Bezirkskasse; eroberte Sitze.
- `Requirement Regionale Rohstoffe.md`: strategische Güter und Truppenfaktoren.
- Gebäudekatalog (`Requirement Regionale Rohstoffe.md`, Gebäude): Kaserne, Schießplatz, Stall.

## 13. Offene Punkte

Entschieden (Nutzer): „Unzufrieden“ = Zufriedenheit < 0; keine Mindestgröße; Rebellen müssen nicht zusammenhängen; bei Sieg ein Volk je zusammenhängender Gruppe, miteinander verbündet; Besetzung behält die 5-Jahres-Regel; Rebellensiedlungen wechseln mit der Erklärung den Besitzer; annektierte Rebellensiedlungen bekommen „erobert“. Zuordnung der strategischen Güter, Gold, Beschaffung von Eisen und Feuerstein sowie die Zahlen von Phase 0 und 1: siehe Abschnitt 2 und 14.

Offen:
- Zahlen mit „kalibrieren (Simulation)“ für die späteren Phasen: Erschöpfungsjahre, Auflösungsschwellen der Bündnisse, Kosten und Unterhalt der Militärgebäude.
- Anzeige: Wie zeigt das Kriegs-Panel Rebellen und ihre Verbündeten?

## 14. Simulation Phase 0 und 1

24 Welten, Jahr 500, gegen den heutigen Stand:

| Kennzahl | heute | mit Phase 0+1 |
|---|---|---|
| Siedlungen | 207 | 226 |
| Einwohner | 17.699 | 17.952 |
| Soldaten | – | 589 (ca. 3,3 % der Bevölkerung) |
| Soldaten mit ihrem strategischen Gut | – | 22,5 % |
| Mangels Sold später entlassene Soldaten (zurück in die Bevölkerung) | – | ca. 44 % der ausgebildeten |
| Rechenzeit (ms pro Jahr, 12 Welten) | 9,1 | 8,7 (praktisch unverändert) |

Gemessen mit dem Produktionscode (endgültige Variante), 24 Welten, Jahr 500 (Rechenzeit auf 12 Welten).

Zusätzlich gewählt: Eisen- und Feuerstein-Vorkommen sind bei der Weltgenerierung doppelt so häufig.

### Schlacht (Phase 2)

24 Welten, 194 Nachbarpaare plus synthetische Fälle, mit 10 % Schaden, Rückzug bei 50 % und Verteidigerbonus +25 %:

| Stärkeverhältnis | Verlust des Verlierers | Verlust des Siegers |
|---|---|---|
| 1,5 : 1 | 50 % | 24 % |
| 2 : 1 | 55 % | 15 % |
| 3 : 1 | 64 % | 7 % |

- Ab 1,5-facher Stärke gewinnt fast immer die stärkere Seite; nur nahe Gleichstand entscheidet die Zusammensetzung. Die Stärkeformel (Soldaten × Faktoren) sagt den Ausgang gut voraus. Armeen ohne Nahkampf sind schwächer als ihre Stärke (bewusst akzeptiert).
- Die Kriegserklärung ab 2-facher Stärke gewinnt gegen jede Zusammensetzung, auch gegen +50 % Verteidigerbonus (mit dem Produktionscode gemessen: Gegen +50 % genügt 1,80-fach, im Feld 1,49-fach; gegen +25 % 1,62-fach).
- Rechenzeit ca. 0,13 µs pro Schlacht.
- Für Phase 3: Die echten Armeen sind klein (Ø 64 Soldaten je Volk) und nur etwa 1 % sind Schock (Pferde sind knapp).
- Für Phase 3: In den echten Armeen würde die schwächere Seite in 45 % der Nachbarpaare aufgeben (weniger als 40 % der Stärke des Gegners).
