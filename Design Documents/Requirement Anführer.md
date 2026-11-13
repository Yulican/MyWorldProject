# Requirement: Anführer

Stand: **vom Nutzer entschieden und bestätigt (Attribute, Ziele, Nachfolge, Anzeige, alle Punkte aus Abschnitt 12), simuliert (Runde 3, Abschnitt 11a), noch nicht umgesetzt** (Branch `feature/leaders`). Ablauf: Design → Simulation → Umsetzung. **Alle Zahlen in diesem Dokument sind in Runde 3 gemessen (24 Welten, Abschnitt 11a); Feinschliff bei der Implementierung.** Abschnitt 12 hält die bestätigten Festlegungen fest. Spieltexte sind Englisch („Leader“).

Baut auf Krieg (`Requirement Krieg.md`), Diplomatie (`Requirement Diplomatie.md`), Zentralregierung (`Requirement Zentralregierung.md`), Zufriedenheit (`Requirement Zufriedenheit.md`) und Handel (`Requirement Handel.md`) auf. Eines der letzten Features für Version 1.0.

## 1. Ziel

Jedes Volk wird von einem **Anführer** regiert. Er regiert, bis er stirbt, hat Attribute und ein Ziel und prägt das Verhalten seines Volks **stark**: Er verschiebt die Schwellen und Wahrscheinlichkeiten, nach denen das Volk heute automatisch entscheidet (Krieg, Bündnisse, Grenzen, Handel, Bau, Steuern, Siedeln, Aufstände, Andacht zum Gott). Völker mit gleicher Lage verhalten sich dadurch verschieden, und ein Herrscherwechsel kann das Verhalten eines Volks kippen. Der starke Einfluss ist gewollt.

Es gibt keine Sturz-Mechanik: kein Putsch, keine Absetzung, auch nicht bei Aufständen. Ein Eingriff des Gottes auf Anführer kommt **nicht in 1.0** (Abschnitt 10, „Später“).

## 2. Der Anführer

| Eigenschaft | Regel |
|---|---|
| Name | Dynastie-Stammname des Volks plus Zähler (Abschnitt 6), z. B. „Aron“, „Aron II.“, „Aron III.“ |
| Alter bei Amtsantritt | gleichverteilt 20 bis 40 Jahre |
| Amtszeit | bis zum Tod; endet das Volk (kein Gebiet mehr), endet die Amtszeit |
| Tod | jährlich gewürfelt: unter 55 Jahren nie; ab 55 Jahren Wahrscheinlichkeit 2 % + 1,5 Prozentpunkte je Jahr über 55, höchstens 50 % (Startwert; erwartetes Sterbealter ≈ 63, Amtszeit im Mittel gut 30 Jahre; kalibrieren (Simulation)) |
| Attribute | 1 bei Amtsantritt, das 2. nach 10 Regierungsjahren, das 3. bei Abschluss des Ziels; höchstens 3 (Abschnitt 4) |
| Ziel | 1 bei Amtsantritt, fest, **kein Zielwechsel** (Abschnitt 5) |

- Der Tod fällt in den jährlichen Schritt des Volks; der Nachfolger tritt im selben Jahr an (Abschnitt 6).
- Eigener Zufallsgenerator „leader“ (deterministisch pro Seed, ohne die Folgen anderer Systeme zu verschieben).

## 3. Wirkung auf Hebel, Deckel, Kombination

Jedes Attribut und die Zielwirkung ändern bestehende Hebel (Abschnitte 4 und 5). Regeln für mehrere Wirkungen auf denselben Hebel:

- **Schwellen und Wahrscheinlichkeiten:** Die Abweichungen vom Grundwert werden **addiert** (z. B. Kriegswurf 10 % + 15 Punkte + 5 Punkte).
- **Prozentfaktoren** (Stärke, Sold, Zoll, Unterhalt): **multipliziert**.
- **Deckel (entschieden):**
  - Summe aller Zufriedenheitswirkungen von Attributen und Ziel: **höchstens ±8** (Teilwert „Leader“, Abschnitt 7). Teilwerte, die Zufriedenheit nur über Steuern ändern („Taxes“), zählen mit.
  - 2×-Schwelle der Kriegserklärung (Krieg §6) **nie unter 1,2×**.
  - Eigener Kriegswurf **nie über 40 %** pro Jahr, nie unter 0 %.
- **Vorrang:** „erklärt nie selbst Krieg“ (Pacifist) schlägt jede Erhöhung des Kriegswurfs.
- Wirkung gilt für das ganze Volk (alle Bezirke und Siedlungen), solange der Anführer lebt.

## 4. Attribute (25)

Alle Zahlen sind **in Runde 3 gemessen (Abschnitt 11a), Feinschliff bei der Implementierung**. Grundwerte: Kriegswurf 10 %, 2×-Schwelle, Aufgabe bei 40 % der Gegnerstärke, Erschöpfung 10 Jahre, Grenze öffnen Vertrauen ≥ 50 und Gefahr ≤ 40, schließen Vertrauen < 35 oder Gefahr > 60, Pakt Vertrauen ≥ 40, Bündnis ≥ 80, Freihandel ≥ 55, Handelsabkommen ≥ 45 (einseitig) und ≥ 40 (Tausch) (`diplomacy.ts`: `FREE_TRADE_TRUST`, `TRADE_AGREEMENT_TRUST`, `EXCHANGE_AGREEMENT_TRUST`), Startvertrauen bei Kontakt 20, Sicherheitsabstand der Steuern 5, Einkommensprüfung 40 %, Wachstumsbau einer Siedlung ab 50 % Kapazität (Game Design, Bauentscheidung; die Regierung baut Wachstum ab 80 %, `Requirement Zentralregierung.md` §5, wird vom Anführer nicht verschoben), Siedler ziehen los, sobald Bevölkerung > Kapazität × 1,0 (Überlast-Faktor; Anführer verschieben **diesen Faktor**, nicht den Siedlungsscore, der nur die Rangfolge im Volk ändert), Andacht 0,02 × Kultur „Devout“.

„Schließt aus“: Ein Anführer bekommt nie zwei Attribute eines Ausschlusspaars (auch nicht über Erbe oder Erlebtes).

**Krieg** (`Requirement Krieg.md`, Abschnitte 2 und 6)

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 1 | Warmonger | Kriegstreiber | Kriegswurf 10 → 40 % (Deckel 40 %); Soldatenanteil höchstens 10 → 15 % der Einwohner, Ausbildungsanteil 25 → 35 %, Anteil der Soldaten im Heer 70 → 85 %; Sold normal; Zufriedenheit −2 (Kriegsmüdigkeit). Die 2×-Schwelle bleibt unverändert (wirkte kaum) | 2, 3 |
| 2 | Pacifist | Friedfertig | erklärt nie selbst Krieg; Grenze öffnen schon ab Vertrauen 40; Aufgabe schon bei 55 % | 1, 4 |
| 3 | Cautious Strategist | Vorsichtiger Stratege | erklärt nur ab 3× Stärke; Kriegswurf ×0,8 (8 %, unter dem Grundwert); Schlachtverluste −25 %; Zufriedenheit +1 | 1 |
| 4 | Stubborn | Starrsinnig | gibt nie auf (statt bei 40 %); Besetzung eines seiner Sitze braucht ×1,5 Belagerungszeit (104 → 156 Wochen); Zufriedenheit −3 solange das Volk im Krieg ist | 2, 5 |
| 5 | Craven | Zaghaft | schickt nur 25 % statt 70 % seiner Soldaten ins Heer; Sold −30 %; gibt schon bei 60 % auf. Zweischneidig: billig, verliert aber Belagerungen | 4 |
| 6 | Drillmaster | Ausbilder | Soldatenstärke +25 %, Sold +30 % | – |

**Diplomatie** (`Requirement Diplomatie.md`, Abschnitte 1 und 2; `Requirement Krieg.md`, Abschnitt 7)

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 7 | Silver Tongue | Redegewandt | Vertrauen zu allen Völkern dauerhaft +10; Startvertrauen bei Kontakt 20 → 25 (nach der ersten Simulation etwa halbiert, sonst Bündnisse ~40×) | 8 |
| 8 | Xenophobe | Fremdenfeind | schließt Grenzen schon bei Gefahr > 45 (statt 60) und öffnet nur bei Gefahr ≤ 25 (statt 40); Zoll auf Fremde ×3; Verteidigungsbonus +25 % im eigenen Land | 7, 12 |
| 9 | Oathkeeper | Eidtreu | Bündnis ab Vertrauen 65 (statt 80, −15), Pakt ab 30 (statt 40, −10); tritt jedem Krieg eines Verbündeten auf dessen Seite bei, auch ohne Stärkeprüfung der Angreiferseite | – |
| 10 | Opportunist | Gelegenheitsjäger | 2×-Schwelle → 1,2× gegen Völker, die im Krieg oder in einer Rebellion sind; gegen alle anderen 2,5× | – |
| 11 | Grudge-bearer | Nachtragend | „Rache“: Kriegswurf ×2 und 2×-Schwelle 1,2× gegen Völker, die es in den letzten 30 Jahren besiegt oder besetzt haben; Waffenstillstand nach eigenen Kriegen 20 → 10 Jahre; Kriegsmalus des Vertrauens −30 → −60 | 2 |

**Wirtschaft** (`Requirement Zentralregierung.md`, Abschnitte 4 und 5; `Requirement Handel.md`; `Requirement Diplomatie.md`, Abschnitt 3)

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 12 | Merchant Prince | Handelsfürst | Händlerlast ×2 (40 → 80), Fahrtweite +20 %; Handelszentrum schon ab Fahrtwert 8 (statt 15); Händlerverluste ×0,5; Zoll, den das Volk zahlt, −50 %; Menge eines Handelsabkommens höchstens 20 → 30; Einkommensprüfung 40 → 50 % (der Vertrauens-Hebel entfällt: Vertrauen bindet selten) | 8 |
| 13 | Generous | Großzügig | Sicherheitsabstand der Steuern 5 → 12; Zufriedenheit +4 | 14 |
| 14 | Tax Hawk | Steuerjäger | Sicherheitsabstand 5 → 0; Einkommensprüfung 40 → 55 %; Zufriedenheit −3 | 13 |
| 15 | Builder | Bauherr | Baukosten −30 %, Bauzeit −30 %; Wachstumsbau der Siedlung schon ab 40 % (statt 50 %); Unterhalt der Regierungsgebäude +20 % (Wirkung wird nachgemessen) | 16 |
| 16 | Frugal | Sparsam | Unterhalt aller Gebäude (Siedlungen und Regierung) −30 %; Einkommensprüfung 40 → 25 %; Wachstumsbau der Siedlung erst ab 60 % (statt 50 %); Reserve der Siedlungen 2 → 4 Jahre | 15 |
| 17 | Prospector | Schürfer | Förderung aus Minen und Sondervorkommen (Eisen, Feuerstein, Gold, Salz …) +50 %; Sondervorkommen zählen im Kriegsnutzen ×2 (Krieg §6; nicht ×4) | – |

**Siedeln**

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 18 | Pioneer | Pionier | Überlast-Faktor 1,0 → 0,97 (Siedler ziehen früher los), Wegkosten ×0,7; Zufriedenheit −2 | 19 |
| 19 | Homebody | Heimatverbunden | Wegkosten ×1,5; Zufriedenheit +3 (Faktor 1,0 bleibt) | 18 |

**Ordnung** (`Requirement Zufriedenheit.md`, `Requirement Krieg.md`, Abschnitt 8: Rebellionsprüfung)

Die Rebellionsschwelle ist der Faktor, den die Stärke der Rebellen im Vergleich zum Mutterland überschreiten muss (Grundwert 1×).

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 20 | Beloved | Geliebt | Zufriedenheit +5 | 21 |
| 21 | Tyrant | Tyrann | Zufriedenheit −6; Rebellionsschwelle 2× | 20, 23 |
| 22 | Iron Fist | Eiserne Faust | Rebellionsschwelle 1,5×; Zufriedenheit −2; Sold +10 % | 23 |
| 23 | Weak Hand | Schwache Hand | Rebellionsschwelle 0,6×; Zufriedenheit +3 | 21, 22 |

**Gott und Wege**

| Nr. | Name | Beschreibung | Wirkung | Schließt aus |
|---|---|---|---|---|
| 24 | Devout | Fromm | Zufriedenheit +3 und Geburtenrate +5 % für jedes Volk; zusätzlich Andacht zum Gott +0,05 (zu 0,02 × Kultur „Devout“) im Volk des Spielers | – |
| 25 | Road Builder | Straßenbauer | Fahrtweite der Händler +30 % (Straßen kosten im Spiel nichts, darum kein Straßenkosten-Hebel) (Wegsuche 26 → 34 Reisekosten); Anbindungs-Teilwert der Zufriedenheit +3 | – |

Ausschlusspaare insgesamt: 1/2, 1/3, 2/4, 4/5, 7/8, 13/14, 15/16, 18/19, 20/21, 21/23, 22/23, 8/12 (Xenophobe ↔ Merchant Prince), 2/11 (Pacifist ↔ Grudge-bearer). Zusätzlich schließen **Pacifist und das Ziel Glory** sowie **Homebody und das Ziel Expansion** einander aus (Abschnitt 5).

### Wie Attribute dazukommen

- **1. Attribut (Amtsantritt):** 50 % eines der Attribute des Vorgängers (zufällig unter seinen Attributen), sonst Zufall unter allen. Das erste Volk, ein neuer Stamm oder ein Rebellenvolk hat keinen Vorgänger: Zufall.
- **2. Attribut (nach 10 Regierungsjahren) und 3. Attribut (bei Abschluss des Ziels):** zu **60 % aus Erlebtem**, zu 40 % Zufall unter allen Attributen. Ausgeschlossene Attribute (Ausschlusspaare, Ausschluss durch das Ziel) und schon vorhandene werden nie gezogen.
- **Erlebtes:** Gezählt werden die Ereignisse der laufenden Amtszeit. Gewählt wird die Ereignisart mit den meisten Ereignissen (Gleichstand: das jüngste); das Attribut kommt gleichverteilt aus deren Liste. Gibt es kein Erlebtes oder ist die Liste ausgeschöpft, wird zufällig gezogen.

| Erlebnis (in der Amtszeit) | Attribute |
|---|---|
| Krieg gewonnen (Besetzung, Eroberung oder Gegner gibt auf) | Warmonger, Drillmaster, Opportunist, Stubborn |
| Krieg verloren oder Sitz belagert/Bezirk verloren | Pacifist, Cautious Strategist, Craven, Grudge-bearer |
| Aufstand im eigenen Reich (Rebellion erklärt oder Volk durch Aufstand entstanden) | Iron Fist, Weak Hand, Beloved, Tyrant |
| Hunger oder Not (eine Siedlung mit fehlender Nahrung/Wasser, Zufriedenheit < 0) | Frugal, Tax Hawk, Generous, Homebody |
| Handelserfolg (neues Handels- oder Freihandelsabkommen) | Merchant Prince, Builder, Prospector, Silver Tongue, Road Builder |
| Bündnis oder Pakt geschlossen oder Kriegsbeitritt als Verbündeter | Oathkeeper, Silver Tongue, Opportunist |
| Grenze gegen das Volk geschlossen oder Vertrauen stark gefallen (Gefahr > 60) | Xenophobe, Grudge-bearer, Cautious Strategist |
| Neue Siedlungen gegründet (ab 2) | Pioneer, Builder, Prospector, Road Builder |
| Lange Friedenszeit (10 Jahre ohne Krieg) | Pacifist, Merchant Prince, Beloved, Generous |

Devout kommt nur über Zufall oder Erbe. Seine Andacht wirkt nur beim Volk des Spielers; Zufriedenheit und Geburtenrate wirken in jedem Volk.

## 5. Ziele (4)

Jeder Anführer bekommt bei Amtsantritt **ein** Ziel. Es bleibt bis zu seinem Tod; es gibt keinen Zielwechsel. Solange das Ziel **aktiv** ist, wirkt es wie unten. Bei **Abschluss** (die Bedingung ist jährlich geprüft) bleibt die Wirkung zu **50 %** bestehen (die Abweichung vom Grundwert halbiert), und der Anführer bekommt sein 3. Attribut (Abschnitt 4). Stirbt er **vor** Abschluss, verfällt das Ziel ohne Folgen; der Nachfolger bekommt ein eigenes Ziel (Abschnitt 6).

Abschlussbedingungen sind **relativ zum Stand bei Amtsantritt** gemessen (kleine und große Völker können sie erreichen). Ziel für die Kalibrierung: etwa ein Drittel bis die Hälfte der Anführer schafft sie in ca. 15 bis 30 Regierungsjahren.

| Ziel | Bedeutung | Wirkung solange aktiv (Startwerte) | Abschlussbedingung (Startwerte) |
|---|---|---|---|
| **Expansion** | Land und Siedlungen gewinnen | Überlast-Faktor 1,0 → 0,98; Einwohner zählen im Kriegsnutzen ×1,5; Wachstumsbau der Siedlung ab 40 % (statt 50 %) | Zahl der Siedlungen (auch eroberte) ≥ 1,5 × Zahl bei Amtsantritt, mindestens +2 |
| **Wealth** | Reichtum und Handel | Handelsabkommen 5 Vertrauen früher (55/45/40 → 50/40/35); Einkommensprüfung +10 Punkte; Regierungshändler und Handelsgebäude zuerst | jährlicher Handelswert (Binnen- und Außenhandel zusammen) ≥ 1,5 × Schnitt der letzten 5 Jahre vor Amtsantritt, die Basis mit Mindestwert 15–20 (**genauer Wert wird vom `sim-engineer` zwischen 15 und 20 gemessen**); keine Handelspartner-Bedingung |
| **Security** | Sicherheit | eigener Kriegswurf ×0,5; Pakt ab Vertrauen 30; Militärbau ab Gefahr 35 (statt 50); Stärke +10 % | 5 Jahre in Folge Gefahr ≤ 40 von allen Nachbarvölkern, kein Siedlungsverlust in dieser Zeit und mindestens ein Pakt oder Bündnis |
| **Glory** | Ruhm | Kriegswurf ×2; 2×-Schwelle → 1,2×; Hauptstadt wird zuerst ausgebaut; Zufriedenheit +2 für 10 Jahre nach einem gewonnenen Krieg | ein Krieg als Angreifer gewonnen (auch ohne eroberten Bezirk), oder die Hauptstadt steigt eine Stadtstufe auf (`cityTier`, Regionale Rohstoffe §11) |

Ausschlüsse: **Security** ist für Völker ohne Nachbarvolk (keine gemeinsame Grenze, Krieg §6) nicht wählbar. **Glory** ist mit dem Attribut Pacifist, **Expansion** mit Homebody unvereinbar (weder beim Wählen des Ziels noch beim Ziehen des Attributs).

Die Zielwirkung zählt zu den Deckeln aus Abschnitt 3 (Zufriedenheit ±8, 2×-Schwelle ≥ 1,2×, Kriegswurf ≤ 40 %).

## 6. Nachfolge, Dynastie, neues Volk

- **Dynastie:** Jedes Volk hat einen **Stammnamen** (aus der Namensliste der Kultur). Der erste Anführer heißt „Aron“, der nächste „Aron II.“, dann „Aron III.“ usw. Der Zähler gehört zum Volk.
- **Stirbt der Anführer:** Der Nachfolger tritt im selben Jahr an: gleicher Stammname, Zähler +1, Alter 20 bis 40, **1 Attribut** (50 % eines der Attribute des Vorgängers, sonst Zufall, Abschnitt 4), neues **Ziel** (Abschnitt unten). Der Vorgänger-Fortschritt (Zehnjahresuhr, 2. und 3. Attribut, Zielfortschritt) beginnt neu.
- **Neues Volk** (Aufstand, neuer Stamm, abgeschnittenes Gebiet, Rebellenvolk): **neuer Stamm** (neuer Stammname, Zähler 1), erster Anführer mit zufälligem Attribut und Ziel nach Lage. Bei einem Rebellenvolk gilt das auch für jedes der Völker, die aus den Gruppen entstehen.
- **Eroberung:** Der Anführer des Verlierers bleibt. Verliert ein Volk seine letzten Bezirke (es gibt das Volk nicht mehr), endet die Amtszeit ohne Nachfolger. Wird die ID eines Volks wiederverwendet (`resetWarCiv`), beginnt ein neuer Stamm.
- **Zielwahl** (bei jedem Amtsantritt, nach der Lage des Volks, mit Zufallsanteil): zu **60 %** gewichtet nach Lage, zu 40 % gleichverteilt unter den wählbaren Zielen. Gewichte (Startwerte, Grundgewicht 1):

| Ziel | Gewicht |
|---|---|
| Expansion | ×2, wenn freies, erreichbares Siedelland vorhanden ist (Kapazität mindestens 20 % des heutigen Volks) |
| Wealth | ×2, wenn das Volk mindestens 2 Handelszentren/Häfen oder ein Handelsabkommen mit einem anderen Volk hat |
| Security | ×3, wenn ein Nachbarvolk Gefahr ≥ 50 hat (sonst ×1; nicht wählbar ohne Nachbarn) |
| Glory | ×2, wenn die eigene Stärke ≥ 1,5 × der Stärke eines Nachbarn ist |

## 7. Wirkung auf Zufriedenheit

- Neuer Teilwert **„Leader“** in der Zufriedenheit jeder Siedlung: Summe der Zufriedenheitswirkungen des Anführers (Abschnitt 4 und 5), begrenzt auf ±8. Er erscheint in der Hexfeld-Info neben den anderen Teilwerten.
- Ein Anführerwechsel ändert den Zielwert; der tatsächliche Wert folgt träge (25 % des Abstands pro Jahr, `Requirement Zufriedenheit.md`, Abschnitt 1).

## 8. Anzeige

- **Peoples-Panel:** eigenes Untermenü „Leader ›“ (wie „War ›“, „Diplomacy ›“, „Government ›“). Es zeigt: Name (mit Zähler), Alter, Regierungsjahre, jedes Attribut mit Beschreibung und **Wirkung in Zahlen**, das Ziel mit Wirkung in Zahlen (aktiv oder zur Hälfte nach Abschluss) und den **Zielfortschritt** (Stand/Ziel, z. B. „Settlements 7 / 9“). Für das 2. Attribut: Jahre bis zum Eintreffen.
- **Chronik** (`Requirement Zufriedenheit.md`, Abschnitt 5): Einträge „Leader takes office“ (Name, Volk), „Leader died“ (Alter, Regierungsjahre), „Leader gains trait“ (Attribut), „Goal reached“ (Ziel). Mit „Go to“ auf die Hauptstadt. Alle stehen **still in der Liste ohne Dialog** (bestätigt).
- Karte: nichts Neues.
- Gott-Eingriff: nicht in 1.0.

## 9. Datenhaltung

- Je Volk flache Typed Arrays: 3 Attribut-Slots (`Uint8Array`, 0 = leer), Ziel (`Uint8Array`), Ziel-Ausgangswert und Zielfortschritt (`Int32Array`), Alter bei Amtsantritt und Amtsbeginn (Jahr), Stammname-Index und Zähler. Keine Objekte im Kern.
- Aus Attributen und Ziel wird bei jeder Änderung (Amtsantritt, 2. Attribut, Abschluss) ein **Hebelsatz je Volk** (`Float32Array`, Volk × Hebel) einmal berechnet; die Entscheidungen lesen nur diesen Satz, durchsuchen nie die Attribute. Das ist auch die Schnittstelle für die spätere C++-Portierung.
- **Hebel, die je Volk einstellbar sein müssen** (heute teils Modul-Konstanten, die der Kern je Volk lesen muss): Kriegswurf, 2×-Schwelle (allgemein und gegen Völker mit Krieg/Rebellion bzw. gegen frühere Sieger), Aufgabeschwelle, Erschöpfungsjahre, Belagerungszeit bis zur Besetzung (`occupyWeeks`), Anteil der Soldaten im Heer (`sendShare`), Soldatenanteil, Ausbildungsanteil, Sold, Stärkefaktor, Schlachtverluste (Verteidigungs- und Verlustfaktor), Verteidigungsbonus im eigenen Land, Waffenstillstandsjahre, Vertrauensverlust nach Krieg; Vertrauen zu allen, Startvertrauen, Pakt- und Bündnisschwelle, Handelsabkommen-Schwellen, Grenzschwellen (Gefahr öffnen/schließen), Gefahr-Faktor, Zoll (gezahlt und verlangt); Händlerlast (`MERCHANT_LOAD`), Mindestwert Handelszentrum (`CENTER_MIN_VALUE`), Händlerverluste (`LOSS_*`), Fahrtweite (`MAX_TRIP_COST`), Menge je Handelsabkommen, Straßenkosten; Sicherheitsabstand, Einkommensprüfung, Siedlungs-Baugrenze (`buildFrom`), Baukosten, Bauzeit, Unterhalt (Regierung und alle Gebäude), Reserve der Siedlungen; Überlast-Faktor des Siedelns, Wegkosten des Siedelns; Förderung der Sondervorkommen, Kriegsnutzen-Faktor; Rebellionsschwelle; Zufriedenheit (Teilwert „Leader“), Anbindungs-Teilwert, Geburtenrate, Andacht (nur Spielervolk).
- Zählung für Erlebtes: kleiner Zähler je Volk und Ereignisart, beim Amtsantritt auf 0.
- Neu zu erfassen für die Ziele: jährlicher Handelswert je Volk (heute nicht erfasst), Zahl der Jahre in Folge mit Gefahr ≤ 40, Zahl der Siedlungen bei Amtsantritt.

## 10. Später (nicht in 1.0)

- Eingriff des Gottes auf Anführer (Segen, Fluch, früherer Tod, Ziel eingeben); gehört zu den Gacha-Fähigkeiten im Game-Design-Dokument.
- Anführer anderer Völker erst bei Kontakt sichtbar machen.
- Sturz, Putsch, Regentschaft, Anführer, die auf Verträge reagieren.

## 11. Performance, Benchmark, Simulation

- Rechenaufwand: eine Prüfung je Volk und Jahr (Tod, 10-Jahres-Uhr, Zielfortschritt), nur ein paar Dutzend Operationen; keine Kartenänderung, kein neuer Benchmark nötig. Die Szenarien `unrest`, `war` und `diplomacy` bleiben, können sich durch neue Zufallsfolgen ändern; Setups (`stirUnrest`, `declareWars`) prüfen.
- **Simulation (`sim-analyst`, 12 Welten, 300 Jahre, gegen den Stand ohne Anführer):** Zahl der Kriege, Bündnisblöcke, Rebellionen, Zahl der Völker, Außenhandel, Siedlungswachstum; Abschlussquote der Ziele (Ziel: ⅓ bis ½ in 15 bis 30 Jahren), Amtszeiten, Verteilung der Attribute; extreme Kombinationen (Warmonger + Glory + Opportunist) dürfen das Spiel nicht sprengen (Deckel prüfen). Tool geplant: `tools/leaderStats.ts`.
- Zufallsgenerator „leader“ je Seed.

## 11a. Messung Runde 3 und Entscheidungen

24 Welten, ohne Anführer → mit Anführern (Jahr 300 | Jahr 500):

| Kennzahl | Jahr 300 | Jahr 500 |
|---|---|---|
| Siedlungen | 89 → 122 | 239 → 291 |
| Kriege | 0,58 → 0,88 | 3,7 → 7,7 |
| Bündnisse | 0,2 → 0,75 | 3,6 → 13,9 |
| Aufstände | 0,63 → 1,9 | 2,1 → 5,1 |
| Zufriedenheit | 13,7 → 13,8 | 13,1 → 13,9 |
| Spiel vorbei | 0 | 0 |

- Skeptic ist ausgebaut: kein vorzeitiges Spielende mehr.
- Gemessene Abschlussquote der Ziele: ca. 24–27 %. Das 3. Attribut ist selten; der Nutzer akzeptiert das mit der Glory-Erleichterung (Krieg als Angreifer gewonnen genügt).
- Security wird nur von 2–8 % der Anführer gewählt (so gewollt).
- Entschieden nach Runde 2 und 3: Wealth (Abschluss bei ≥ 1,5 × Schnitt der letzten 5 Jahre, Basis mindestens 15–20, keine Handelspartner-Bedingung); Warmonger Kriegswurf 40 %, Deckel 40 %, Glory Kriegswurf ×2 und Schwelle 1,2×; Devout Geburtenrate +5 %; Builder ab 40 %; Craven 25 % der Soldaten; Merchant Prince Händlerlast ×2 und Fahrtweite +20 %; Pioneer 0,97; Road Builder ohne Straßenkosten-Hebel.

## 12. Bestätigte Festlegungen

Der Nutzer hat alle folgenden Punkte bestätigt; sie stehen in den Regelabschnitten. Die Zahlen sind in Runde 3 gemessen (Abschnitt 11a), Feinschliff bei der Implementierung.

- Zuordnung Erlebnis → Attribute (Abschnitt 4) und die Regel „häufigste Erlebnisart der Amtszeit, Gleichstand: die jüngste“.
- Sterbekurve (Abschnitt 2): nie vor 55, dann 2 % + 1,5 Punkte je Jahr, höchstens 50 %.
- Zielwahl-Gewichte (60 % nach Lage, Faktoren ×2/×3, 40 % gleichverteilt) und Abschlussbedingungen aller vier Ziele (Abschnitte 5 und 6).
- Gegenseitige Ausschlüsse Pacifist ↔ Glory und Homebody ↔ Expansion (Abschnitt 5).
- Chronik-Einträge ohne Dialog (Abschnitt 8).
- „Zur Hälfte“ nach Abschluss: die Abweichung vom Grundwert wird halbiert (Abschnitt 5).
- Neues Volk (Aufstand, Stamm, Rebellen): neuer Stamm, zufälliges 1. Attribut, kein Erbe; Eroberung ändert den Anführer nicht (Abschnitt 6).
- Deckel und Kombination der Wirkungen (Abschnitt 3).
- Nachfolger beginnt Zehnjahresuhr und Zielfortschritt neu (Abschnitt 6).
- Game-Design-Dokument (Abschnitt 5, Zivilisationen) enthält den Absatz „Anführer“.

## 12a. Änderungen nach der ersten Simulation (12 Welten, Jahr 300, je Attribut erzwungen)

Entschieden (Nutzer); Zahlen in Runde 3 gemessen.

- **Grundwerte korrigiert** (Abschnitt 4): Handelsabkommen 55/45/40 statt 60, Wachstumsbau der Siedlung ab 50 % statt 80 %. Wirkungen sind Verschiebungen gegenüber dem tatsächlichen Grundwert.
- **Siedeln:** „Siedlungsscore“ ändert nur die Rangfolge im Volk und war wirkungslos. Der Hebel ist die **Überlast-Schwelle** (Siedler ziehen los, sobald Bevölkerung > Kapazität × Faktor). Pioneer Faktor 0,95 und Wegkosten ×0,7; Homebody Wegkosten ×1,5; Ziel Expansion Faktor 0,98. (Vorher dominierte das Siedeln: Pioneer 213 gegen Homebody 39 Siedlungen.)
- **Diplomatie etwa halbiert** (schaukelte sich auf, ~40× Bündnisse): Silver Tongue Vertrauen +10, Startvertrauen +5; Oathkeeper Bündnis −15, Pakt −10; Merchant Prince Handelsabkommen −15; Wealth −5.
- **Skeptic ausgebaut (später),** bis mehr Features im Spiel sind: Andacht −0,03 beendete 29 % der Welten, der Spieler kann dagegen derzeit nichts tun. Slot 25 ist jetzt **Road Builder**. Ein Hebel auf den Glauben mit negativem Vorzeichen kommt erst wieder, wenn der Spieler dagegen etwas tun kann.
- **Wealth:** Bedingung „≥ 2 Handelspartner“ entfällt; Abschluss bei ≥ 1,5 × Schnitt der letzten 5 Jahre, Basis mindestens 15–20 (wird gemessen).
- **Kriegshebel** (Runde 3, entschieden): Warmonger Kriegswurf 40 %, Deckel des Kriegswurfs 40 % (statt 30 %), Ziel Glory Kriegswurf ×2 und 2×-Schwelle 1,2×.
- **Ersetzte Attribute** (Nutzer: „die neuen Attribute passen“, Abschnitt 4): Merchant Prince, Xenophobe, Stubborn, Craven, Grudge-bearer, Prospector, Devout, Builder, Frugal, Warmonger, Cautious Strategist wirken jetzt auf Hebel, die in der Simulation wirklich binden (Händlerlast und Fahrtwert statt Vertrauen, Gefahr statt Vertrauen bei Grenzen, Belagerungszeit und Heergröße statt Aufgabeschwellen, Förderung statt Siedeln, Baukosten und Unterhalt). Neue Ausschlüsse: Merchant Prince ↔ Xenophobe, Grudge-bearer ↔ Pacifist. Alle Zahlen in Runde 3 gemessen.

## 13. Abhängigkeiten

Ändern sich mit diesem Requirement: `Requirement Krieg.md` (§6 Kriegswurf und 2×-Schwelle, Aufgabe, Erschöpfung; §7 Pakt-/Bündnisschwellen, Beitritt; §8 Rebellionsschwelle), `Requirement Diplomatie.md` (Schwellen für Grenzen, Pakte, Abkommen, Zoll), `Requirement Zentralregierung.md` (Sicherheitsabstand, Einkommensprüfung, Bauliste), `Requirement Zufriedenheit.md` (neuer Teilwert „Leader“, Chronik), `Requirement Handel.md` (Handelsabkommen, Handelswert), Game-Design-Dokument (Völker, Gott-Eingriff später).
