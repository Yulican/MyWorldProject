# Requirement: Zufriedenheit pro Siedlung

Status: **Umgesetzt auf Branch `feature/settlement-satisfaction`, Zahlen kalibriert** (siehe „Kalibrierung“ am Ende; die Regeln mit allen Werten stehen im Game-Design-Dokument, Abschnitt 5). Die Zahlen sind Startwerte. Vor der
Umsetzung werden sie per Simulation kalibriert (siehe „Abnahme“) und dir
noch einmal vorgelegt. Spieltexte sind Englisch („Satisfaction“).

Abhängigkeit: das Gebäude-Feature der anderen Session (Vorrat pro Siedlung,
Slots, Bau, Unterhalt, Ruinen). Die Komfortgebäude hier nutzen dieses System
und kommen in dessen Katalog. Deshalb wird dieses Feature erst nach dem
Gebäude-Feature umgesetzt.

## 1. Der Wert

- Pro bewohntem Hex gibt es einen Wert von −100 bis +100.
- Der **Zielwert** ist die Summe benannter Teilwerte (Begriffssystem, wie bei
  Nahrung, Wasser und Platz). Die Hexfeld-Info zeigt jeden Teilwert einzeln.
- Der **tatsächliche Wert** folgt dem Zielwert träge: um 25 % des Abstands
  pro Jahr. Er wird vierteljährlich berechnet, also um etwa 6,9 % pro
  Quartal.
- Eine neue Siedlung (Expansion) übernimmt keinen Wert. Ihr Wert wird neu
  berechnet und startet direkt beim eigenen Zielwert.
- Speicher: flache Arrays pro Hex für den Wert und die Jahre im Minus. Damit
  bleibt das Feature leicht nach C++ portierbar.

## 2. Teilwerte

| Teilwert | Startwert (Vorschlag) | Bemerkung |
|---|---|---|
| Nahrung fehlt | −100 × Anteil des fehlenden Bedarfs | nur Abzug; gedeckt = 0 |
| Wasser fehlt | −100 × Anteil des fehlenden Bedarfs | nur Abzug |
| Platz fehlt | −100 × Anteil des fehlenden Bedarfs | nur Abzug |
| Enge | ab 80 % der Kapazität linear bis −5 bei 100 % | bewusst schwach (kalibriert, vorher −10) |
| Anbindung | +10 bis 0,5 Reisekosten vom nächsten Regierungssitz des eigenen Volks, linear bis −20 ab 4 Reisekosten (über Straßen kostet ein Hex meist 0,5) | ersetzt die alte Entfernungsregel; Regierungssitz = Hauptstadt oder lokaler Regierungssitz (3b) |
| Komfort: Gebäude | bis +15 | siehe 3a |
| Komfort: Luxusgüter | +5 je abgedecktem Gut, bis +15 | siehe 3c |
| Neuer Stamm | +10, klingt über 10 Jahre ab | nur im neuen Volk |
| Erfolgreiche Revolution | +20, klingt über 10 Jahre ab | zusätzlich zum Wert eines neuen Stamms |
| Verlorene Revolution | −5, klingt über 10 Jahre ab | alle Siedlungen des alten Volks; klein, kann aber Randsiedlungen weiter destabilisieren (bestätigt); eine weitere verlorene Revolution erneuert den Malus, statt ihn zu stapeln |

Folgen dieser Zahlen:
- Eine voll versorgte Siedlung ohne Komfort liegt nahe der Hauptstadt bei
  etwa +10 bis 0 und am Rand bei bis zu −30.
- Komfort hebt Randsiedlungen wieder ins Plus.
- Die Abspaltung trifft also vor allem schlecht angebundene Siedlungen ohne
  Komfort, und Siedlungen in Not.

## 3. Komfort

### 3a. Komfortgebäude (allgemein, aus Holz und Stein)

Sie sind überall baubar und kommen in den Gebäudekatalog: mit Slot, Kosten,
Unterhalt und Ruine nach 2 Jahren ohne Unterhalt.

| Gebäude (Arbeitstitel) | Baustoff | Wirkung |
|---|---|---|
| Versammlungsplatz | Holz | Komfort für 50 Einwohner |
| Badehaus | Stein, braucht Wasserüberschuss | Komfort für 100 Einwohner |

- Teilwert: +15 × Anteil der Einwohner, die mit Komfort versorgt sind.
- Kosten und Unterhalt legt der Gebäudekatalog fest.
- Die Bauentscheidung bleibt „was am meisten bringt“. Komfortgebäude werden
  gebaut, wenn die Siedlung unzufrieden ist und die Grundbedürfnisse gedeckt
  sind.

### 3b. Lokaler Regierungssitz

Ein Gebäude für die Anbindung. Für den Teilwert „Anbindung“ zählt die
Reiseentfernung zum **nächsten Regierungssitz** des eigenen Volks: zur
Hauptstadt oder zu einem lokalen Regierungssitz.

- Er kommt in den Gebäudekatalog: teuer in Holz und Stein, mit hohem
  Unterhalt und 1 Slot. Zur Ruine wird er wie jedes Gebäude nach 2 Jahren
  ohne Unterhalt, dann wirkt er nicht mehr.
- Er braucht einen Mindestabstand zur Hauptstadt und zu anderen
  Regierungssitzen (Startwert: so weit, dass sich die Bereiche mit +10 nicht
  überschneiden). So entsteht kein Sitz in jeder Siedlung.
- Gebaut wird er von einer Siedlung mit genug Vorrat, wenn ihn viele
  Siedlungen des Volks in seiner Reichweite brauchen. Gemessen wird das an
  der Summe der verbesserten Anbindung über diese Siedlungen.
- Die Siedlung mit dem Sitz kann trotzdem abtrünnig werden, nur die
  Hauptstadt nicht.
- Spaltet sich ein Bund mit einem oder mehreren lokalen Regierungssitzen ab,
  wird der Sitz mit den meisten Einwohnern die Hauptstadt des neuen Volks.
  Ohne Sitz im Bund wird es die größte Siedlung.
- Der Sitz bleibt bestehen, wenn sein Hex das Volk wechselt, und wirkt dann
  für das neue Volk. Das gilt bei beiden Arten der Abspaltung, und wenn ein
  anderes Volk den Sitz als Ruine repariert.

### 3c. Luxusgüter aus Sondervorkommen

Ein Gebäude im Hex mit dem Vorkommen baut das Gut ab. Das Gut kommt in den
Vorrat der Siedlung, und die Einwohner verbrauchen es jährlich. Das ist die
Grundlage für den späteren Handel.

| Vorkommen | Gebäude zum Abbau | Ø pro Welt* | Gut |
|---|---|---|---|
| Salt | Saline | 6 | Salz |
| Spices | Gewürzgarten | 5 | Gewürze |
| Gems | Edelsteinmine | 3 | Edelsteine |
| Gold | Goldmine | 3 | Gold (Schmuck) |
| Marble | Marmorbruch | 4 | Marmor |
| Wild horses | Pferdezucht | 6 | Pferde |

\* gezählt in 8 erzeugten Welten mit je etwa 2.000 Landhexes.

- Jahresbedarf: 1 Einheit je 100 Einwohner und Gut (anfangs 1 je 20; nach
  dem Test im Spiel gesenkt, damit ein Abbaugebäude mehrere Städte
  versorgt).
- Teilwert: +5 je Gut, dessen Jahresbedarf aus dem Vorrat gedeckt ist,
  höchstens +15. Die Vielfalt zählt, nicht die Menge. Das macht den Handel
  später wertvoll.
- **Wichtig:** Ohne Handel profitiert nur die eine Siedlung auf dem
  Vorkommen. Das sind etwa 27 von 2.000 Landhexes. Bis zum Handel kommt der
  allgemeine Komfort deshalb aus den Gebäuden in 3a.
- Nicht als Komfortgüter vorgesehen:
  - Kupfer, Zinn und Eisen gehören zur späteren Werkzeug-Stufe.
  - Heilige Quelle, Heiliger Hain, Meteorit und Alte Ruinen gehören zum
    späteren Glauben.
  - Schwemmland und Fischgründe sind Nahrung.

## 4. Wirkungen

**Geburten und Erträge**
- Geburtenrate × (1 + 0,25 × Zufriedenheit/100), also ±25 %.
- Erträge × (1 + 0,2 × Zufriedenheit/100), also ±20 %. Gemeint ist der
  Abbau von Holz, Stein und Luxusgütern.
- Nahrung, Wasser und Platz sind ausgenommen, sonst droht eine
  Abwärtsspirale (unzufrieden → weniger Nahrung → noch unzufriedener).
  (bestätigt)

**Abwandern**
1. **Früher losziehen:** Eine Siedlung unter 0 schickt Gruppen von 25 Leuten
   los, auch unterhalb der Kapazität. Die Chance pro Jahr wächst mit der
   Unzufriedenheit: bei −100 eine Gruppe pro Jahr.
2. **Ziele:**
   - Expansion wie heute: nur in freie Nachbarhexes, mit neuer Straße.
   - Neu, Abwanderung: in bestehende Siedlungen mit freier Kapazität, die
     über Straßen erreichbar sind (Reichweite nach Reisekosten). Das gilt
     für Siedlungen des eigenen Volks und für fremde Völker.
3. **Wahl des Ziels:** zufriedenere Ziele werden bevorzugt.

Wer in fremdes Gebiet abwandert, wird dort angesiedelt und gehört dann zu
dem Volk. Der Glaube bleibt unverändert. Fremde Völker nehmen Zuwanderer
vorerst immer auf; später entscheidet die Außenpolitik.

**Abspaltung**
- Eine Siedlung wird **abtrünnig**, wenn sie 5 Jahre am Stück unter 0 liegt.
  Es gibt keine zusätzlichen Abzüge vorher.
- Abtrünnige Siedlungen desselben Volks, die über Straßen zusammenhängen,
  bilden einen **Bund**. Ein Bund spaltet sich ab, wenn er mindestens 3
  Siedlungen oder 100 Einwohner hat.
- Zufriedene Siedlungen bleiben in ihrem Volk, auch wenn sie zwischen
  abtrünnigen liegen.
- Die Hauptstadt des neuen Volks ist der lokale Regierungssitz mit den
  meisten Einwohnern im Bund, sonst die größte Siedlung (siehe 3b).
- Der Glaube bleibt unverändert. Das neue Volk zählt nicht zum Limit von
  6 Völkern.
- Teilwerte: siehe Neuer Stamm und Revolution in Abschnitt 2.
- Einzelne abtrünnige Siedlungen ohne Bund spalten sich nicht ab. Sie
  verlieren Leute durch Abwanderung.
- Die Regel für abgeschnittene Gebiete bleibt. Die alte Entfernungsregel
  wird entfernt.

## 5. Chronik-Dialog (zentrale Funktion)

- Jeder Chronik-Eintrag öffnet einen Dialog, und das Spiel pausiert.
- Der Dialog enthält die Zeitsteuerung (Pause und Geschwindigkeiten). Beim
  Schließen läuft das Spiel mit der Einstellung weiter, die dort gewählt
  ist: vorher gelaufen → läuft weiter; im Dialog Pause gewählt → bleibt
  pausiert.
- Der Dialog zeigt das Jahr und den Text.
- Ein Knopf „Go to“ zentriert die Karte auf die betroffene Zelle und wählt
  sie aus. Dazu bekommt jeder Eintrag eine Zelle. Das betrifft die 6
  heutigen Arten: Gründung, Abspaltung abgeschnittener Gebiete, Abspaltung,
  Volk verschwunden, neuer Stamm und Spielende.
- Kommen mehrere Einträge gleichzeitig, werden sie nacheinander gezeigt.
- Im Benchmark werden keine Dialoge geöffnet und das Spiel nicht pausiert.

## 6. Anzeige

- Hexfeld-Info: die Zufriedenheit mit allen Teilwerten, die Jahre im Minus,
  die Luxusgüter im Vorrat und die Komfortgebäude.
- Völker-Panel: die durchschnittliche Zufriedenheit pro Volk.
- Keine Anzeige auf der Karte. Ein eigener Kartenmodus ist später denkbar,
  gehört aber nicht zu diesem Feature.

## 7. Performance und Benchmark

- Rechnung vierteljährlich pro Hex, in flachen Arrays. Die Straßensuche für
  die Anbindung läuft einmal pro Quartal und Volk, von allen Regierungssitzen
  gleichzeitig, oder nur, wenn sich das Straßennetz oder die Sitze geändert
  haben.
- Ziel: Ein simuliertes Jahr kostet höchstens 1,3-mal so viel wie heute.
- Das aged-Szenario (300 Jahre) enthält das Feature automatisch. Alle
  Szenarien müssen bestehen.

## 8. Abnahme

- Tests für Teilwerte, Trägheit, Abwanderung, Bundbildung, Abspaltung und
  den Chronik-Dialog.
- Kennzahlen aus 12 Testwelten nach 100, 200 und 300 Jahren, die ins
  Design-Dokument kommen:
  - Durchschnitt und Verteilung der Zufriedenheit,
  - Abspaltungen und Größe der Bünde,
  - Gruppen, die abgewandert sind (eigenes und fremdes Volk).
- Die Startwerte oben werden damit kalibriert und dir vorgelegt.
- Das Design-Dokument wird aktualisiert.

## Entscheidungen

Alle Fragen sind beantwortet:
- Die Hauptstadt spaltet sich nie ab.
- Nahrung, Wasser und Platz sind von den Ertrags-Effekten ausgenommen.
- Die verlorene Revolution gibt −5.
- Lokale Regierungssitze sind die Bezugspunkte der Anbindung.
- Neue Siedlungen berechnen ihre Zufriedenheit neu.
- Der Chronik-Dialog enthält die Zeitsteuerung.
- Die Komfortgebäude und Luxusgüter bleiben wie oben, Marmor ist ein
  Komfortgut.
- Fremde Völker nehmen Zuwanderer vorerst immer auf.
- Abgespaltene Regierungssitze werden die Hauptstadt des neuen Volks.
- Regierungssitze bleiben bestehen, wenn ihr Hex das Volk wechselt.

Nächster Schritt: Sobald das Gebäude-Feature im Code ist, werden die
Startwerte per Simulation kalibriert und mit den Kennzahlen vorgelegt. Erst
nach der Bestätigung wird umgesetzt.

## Kalibrierung (12 Testwelten, `npx tsx tools/satisfactionStats.ts`)

Geändert gegenüber den Startwerten:
- **Enge −5 statt −10.** Mit −10 lagen volle Siedlungen nahe der Hauptstadt
  genau bei 0, weil Siedlungen erst bei Überfüllung aussiedeln. Schon
  kleinste Schwankungen führten zu Revolutionen.
- **Verlorene Revolution stapelt sich nicht.** Gestapelte −5 lösten
  Kettenreaktionen aus, mit bis zu 22 Völkern in einer Welt.
- **Anbindung 0,5 bis 4 Reisekosten statt „nah bis weit“.** Reiche sind
  über Straßen eng verbunden: Die halbe Strecke liegt bei 1,25, die längste
  bei 4,75. Mit 10 als „weit“ blieb jede Siedlung im Plus, und nichts
  passierte.
- **Mindestabstand eines neuen Regierungssitzes: 1 Reisekosten.** Der Sitz
  lohnt sich ab 40 Punkten Anbindung, die die Siedlungen zusammen gewinnen.
- **Abwanderung:** Ziele müssen über Straßen in höchstens 8 Reisekosten
  erreichbar und mindestens 10 Punkte zufriedener sein.

Ergebnis nach 300 Jahren, im Mittel (Spanne):

| Kennzahl | mit Zufriedenheit | ohne |
|---|---|---|
| Menschen | 3.400 (1.580–6.480) | 3.860 |
| Siedlungen | 47 | 50 |
| Völker | 7,1 (4–11) | 5,2 |
| Revolutionen | 1,7 (0–7), meist einzelne große Städte (100-Menschen-Regel) | – |
| Abgewanderte Gruppen | 2,8, davon 0,3 zu fremden Völkern | – |
| Zufriedenheit der Siedlungen | Median +7, 10 % unter +1,7, 6 % unter 0 | – |
| Komfortgebäude / Regierungssitze / Luxusgut-Betriebe | 21,5 / 1,2 / 0,2 | – |
| Rechenzeit unter Node | 1,5 ms pro simuliertem Jahr | 1,8 ms |

Nach 100 und 200 Jahren gibt es noch keine Revolution; die ersten kommen,
wenn Reiche groß genug für schlecht angebundene Ränder sind. Die Rechenzeit
ist gesunken, weil die Expansion die überfüllten Felder jetzt einmal sucht
statt einmal pro Volk.


## Nachtrag: Regierungssitze und Ausbreitung (mit dem Handel)

Die Regeln für Regierungssitze, den Ausbreitungsstopp bei Anbindung unter
−15 und „Zufriedenheit zuerst“ (unter 5) sind im Requirement Handel,
Abschnitt 12, beschrieben; sie ersetzen hier die alte Sitzplanung (drei
schlechtest angebundene Siedlungen, Bezahlung nur aus dem eigenen Vorrat,
Unterhalt nur aus der eigenen Ernte).
