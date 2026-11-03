# Requirement: Krieg

Stand: **Entwurf, vom Nutzer entschieden, noch nicht simuliert und nicht umgesetzt** (Branch `feature/war`). Ablauf: Design → Simulation → Umsetzung. Alle Zahlen sind Startwerte; was noch gerechnet werden muss, ist mit „kalibrieren (Simulation)“ markiert. Spieltexte sind Englisch.

Baut auf Diplomatie (`Requirement Diplomatie.md`, Stufe 2), Zufriedenheit (`Requirement Zufriedenheit.md`), Zentralregierung (`Requirement Zentralregierung.md`), regionalen Rohstoffen (`Requirement Regionale Rohstoffe.md`, strategische Güter) und Handel auf.

## 1. Ziel

Völker rüsten auf, bedrohen einander, erklären Kriege um Regierungssitze und Bezirke, schließen Bündnisse. Aufstände laufen künftig ebenfalls als Krieg ab. Gebäude, Güter und Geld des Volks bekommen damit einen militärischen Zweck.

## 2. Soldaten und Stärke

- **Ausbildung:** Militärgebäude bilden jährlich Soldaten aus der Bevölkerung aus. Soldaten werden von der Bevölkerung abgezogen (sie kosten Wachstum und Ernte).
- **Gebäude:** Kaserne = Nahkampf, Schießplatz = Fernkampf, Stall = Schock (braucht Pferde). Soldaten pro Gebäude und Jahr, Kosten, Unterhalt: kalibrieren (Simulation).
- **Soldaten sind in der Siedlung**, können aber zu Armeen zusammengestellt und bewegt werden (Abschnitt 4).
- **Sold:** nur Geld, aus der Kasse des Bezirks (`Requirement Zentralregierung.md`). Keine Nahrung. Der Sold zählt zur Einkommensprüfung (40 %-Regel) wie der Unterhalt der Regierungsgebäude; Höhe pro Soldat: kalibrieren (Simulation). Kann der Bezirk den Sold nicht zahlen: Soldaten desertieren (Anteil kalibrieren).
- **Strategische Güter:** Je Truppenart und Gut gibt es einen Stärkefaktor (Startwert ×1,5, z. B. Pferde für Schock). Das Gut wird jährlich verbraucht; fehlt es, gilt der Faktor nicht. Zuordnung der Güter: `Requirement Regionale Rohstoffe.md`, Abschnitt 10.
- **Stärke eines Volks:** Summe der Soldaten, gewichtet mit den Güterfaktoren. Verbündete zählen zur Stärke (Abschnitt 7).
- **Gefahr:** 50 × Stärke des anderen ÷ eigene Stärke, höchstens 100, × Nähe. Ersetzt die Bevölkerung in der Gefahr-Formel (`Requirement Diplomatie.md`, Abschnitt 1).
- **Kauf strategischer Güter:** Völker wollen sie kaufen, um ihre Armee zu stärken. Sie verkaufen sie nur an Völker, deren Gefahr für sie ≤ X ist (X: kalibrieren (Simulation), Startwert 40), nie an Kriegsgegner und deren Verbündete.

## 3. Schlacht

- Armeen bestehen aus Nahkampf, Fernkampf und Schock.
- Eine Schlacht dauert wenige Runden (Startwert 5). Je Runde verliert eine Seite einen festen Anteil der Stärke der anderen (Startwert 10 %; kalibrieren (Simulation)).
- **Reihenfolge je Runde:**
  1. Fernkampf trifft den gegnerischen Nahkampf.
  2. Nahkampf kämpft gegen Nahkampf.
  3. Schock trifft den gegnerischen Nahkampf.
- **Ersatzrolle:** Ist kein Nahkampf mehr da, übernimmt Schock die Rolle des Nahkampfs, danach Fernkampf. Beide kämpfen mit Strafe (Startwert −50 %; kalibrieren (Simulation)).
- Gerechnet wird pro Schlacht mit Zählern, nicht pro Soldat (Rechenzeit).

## 4. Armeen

- Eine Armee ist ein Zähler (Nahkampf / Fernkampf / Schock) mit Position. Die Soldaten werden aus der Heimatsiedlung abgezogen.
- Armeen marschieren über Straßen nach Reisekosten. Eine Armee darf im ganzen Land frei zu jedem Ort ziehen; sie muss nur hinkommen.
- Zusammenführen mehrerer Armeen und Marschgeschwindigkeit: kalibrieren (Simulation).

## 5. Belagerung und Besetzung

- **Belagert werden können Regierungssitze,** auch die Hauptstadt.
- **Während der Belagerung:** alle Kapazitäten der Siedlung (Ernte, Bau, Bevölkerung) halbiert; der Handel mit der Siedlung ruht.
- **Entsatz:** Die Armee der Siedlung oder Armeen anderer Siedlungen des Volks (und von Verbündeten) können die Belagerung brechen. Es gibt keine Entfernungsgrenze, die Armee muss den Weg zurücklegen.
- **Verteidigerbonus:** +25 % im Sitz, +50 % mit eigener Armee im Sitz (kalibrieren (Simulation)).
- **Besetzung:** Erreicht die Unzufriedenheit der Siedlung den Wert, bei dem sie sich abspalten würde (dieselbe 5-Jahres-Regel wie beim Aufstand, `Requirement Zufriedenheit.md`), wird sie besetzt statt abtrünnig.
- **Beute:** Der Eroberer übernimmt das Lager und die Hälfte der Kasse; Gebäude bleiben stehen.
- **Hauptstadt:** Wird die Hauptstadt besetzt, wird das Volk annektiert und ausgelöscht; sein ganzes Gebiet fällt an den Eroberer.

## 6. Kriegserklärung, Frieden, Eroberung

- **Erklärung:** Ein Volk darf erklären, wenn seine Stärke das ≥2-Fache des Nachbarn ist. Ziel: einen Regierungssitz samt Bezirk erobern. Der Sitz muss besetzt werden können, und der Feind darf nicht glauben, ihn zurückzuerobern (Aufgabe: siehe unten).
- Höchstens **ein Krieg** je Volk gleichzeitig.
- **Aufgabe des Feindes:** Hat er weniger als X % der Stärke des Angreifers (kalibrieren (Simulation)), gibt er auf.
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

- Gilt nur für **echte Aufstände** (Abspaltung durch Unzufriedenheit). Abgeschnittene Gebiete bleiben friedlich wie heute (sie werden direkt ein neues Volk). Winzige Splitter (unter der Grenze der Abspaltung, 3 Siedlungen oder 100 Einwohner) machen keinen Krieg und verlieren Leute durch Abwanderung wie heute.
- **Unzufriedene Siedlungen** bleiben normaler Teil des Reichs, ohne Sonderzustand, bis die **Stärke aller unzufriedenen Siedlungen zusammen größer ist als die Stärke des Mutterlandes** (nicht die ≥2-Schwelle der Kriegserklärung). Dann erklären sie den Krieg und werden dabei **sofort ein unabhängiges Volk** (Hauptstadt wie in `Requirement Zufriedenheit.md`).
- **Krieg der Rebellen:** Das Mutterland muss alle Regierungssitze des neuen Volks erobern. Gelingt das, werden die Rebellen wieder annektiert. Endet der Krieg ohne das (Erschöpfung, Frieden), bleiben die Rebellen unabhängig.
- **Hilfe von außen:** Völker, die sich vom Mutterland bedroht fühlen und nicht mit ihm befreundet sind, können den Rebellen als Bündnispartner helfen.
- Teilwerte: „Neuer Stamm“ und „Erfolgreiche Revolution“ gelten, wenn die Rebellen den Krieg gewinnen; „Verlorene Revolution“ wird zu Annexion (Abschnitt 2, Tabelle der Teilwerte, in `Requirement Zufriedenheit.md`).

## 9. Anzeige

- Kriegs-Panel („War ›“ im Völker-Panel, wie Diplomatie und Government): Stärke, Armeen, Kriege, Belagerungen, Bündnisse, Gefahr in beide Richtungen mit Teilwerten.
- Karte: Armeen als Marker, belagerte Sitze mit Rahmen, Kriegsgrenzen farbig (kommt in Phase 3).

## 10. Phasen

1. **Militär ohne Kampf:** Gebäude, Soldaten, Sold, strategische Güter und ihr Verkauf; Gefahr aus Stärke statt Bevölkerung; Anzeige. Simulation: Auswirkung auf Grenzen, Handel, Siedlungswachstum.
2. **Schlachtrechnung** als reine Funktion mit Tests und Stats-Tool (`warStats`).
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

- **Unzufrieden** (für die Rebellenstärke): aktuell Zufriedenheit < 0, oder die bestehende Regel „5 Jahre am Stück unter 0“? Empfehlung: die 5-Jahres-Regel, sonst zählen kurze Schwankungen.
- Muss die Rebellengruppe **zusammenhängen** (über Straßen, wie der Bund heute), oder zählen alle unzufriedenen Siedlungen des Volks zusammen? Empfehlung: zusammenhängend, sonst entsteht ein Volk aus verstreuten Siedlungen.
- Was geschieht mit Siedlungen, die nach der Kriegserklärung zufrieden werden, und mit besetzten, aber annektierten Rebellensiedlungen (Malus „erobert“)?
- Alle Zahlen mit „kalibrieren (Simulation)“ (Soldaten je Gebäude, Sold, Verlustanteil, Ersatzrollenstrafe, Verteidigerbonus, Aufgabeanteil, Erschöpfungsjahre, Verkaufsgrenze X, Auflösungsschwellen).
- Wie verhalten sich Kriegsgegner zu Rebellen-Verbündeten im Kriegs-Panel (Anzeige)?
