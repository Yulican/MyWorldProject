# Requirement: Gacha und Fähigkeiten

Stand: **Entwurf, Grundregeln vom Nutzer entschieden (Faith nach Spielzeit, 3 Fähigkeiten je Ziehung, Inventar, 4 Seltenheiten, alle 25 Fähigkeiten in Version 1); alle Zahlen sind Startwerte „vorläufig, wird kalibriert“ (Simulation durch `sim-analyst`); zwei Fähigkeiten sind „Vorschlag, mit User abzustimmen“ (Abschnitt 6.5).** Ablauf: Design → Simulation → Umsetzung. Spieltexte sind Englisch („Faith“, „Gacha“, „Charge“).

Baut auf `Game Design Gott einer Zivilisation` (Abschnitte 7 und 10), `Requirement Anführer.md` (Eingriffe auf Anführer), `Requirement Zufriedenheit.md`, `Requirement Diplomatie.md`, `Requirement Handel.md` und `Requirement Krieg.md` auf. Rivalen-Götter (Game Design, Abschnitt 8) bleiben vorerst außen vor.

## 1. Ziel

Der Spieler greift nur über **Fähigkeiten** in die Welt ein. Er bekommt sie aus **Gacha-Ziehungen**, die er mit **Faith** bezahlt, einer Währung, die die Gläubigen seines Volks laufend erzeugen. Jede Fähigkeit ist eine verbrauchbare **Ladung**, die der Spieler später **bewusst** auf ein selbst gewähltes Ziel wirft. Es gibt keine erzwungenen Negativ-Effekte: auch schädliche Fähigkeiten wirft der Spieler selbst, auch auf das eigene Volk.

Der Reiz ist die Überraschung der Ziehung und die Frage, wo man die Ladung am besten einsetzt. Das Spiel bleibt eine Sandbox: Fähigkeiten stoßen die Völker an, die Völker entscheiden weiter selbst.

## 2. Faith (Währung)

| Regel | Wert |
|---|---|
| Name | „Faith“ (ersetzt die „Einflusspunkte“ im Game Design) |
| Quelle | die Gläubigen (Glaubenswert ≥ 0,5, `BELIEVER_FAITH`) des **Volks des Spielers** (`worshipsPlayer`); andere Völker erzeugen kein Faith |
| Zufluss | **je Tick (Spielzeit)**, nicht je Echtzeit: Faith je Tick = Gläubige × Faktor. Faktor **vorläufig 0,0005 Faith je Gläubigem und Tick** (≈ 0,026 je Gläubigem und Jahr); wird kalibriert |
| Eichziel | Bei Standardgeschwindigkeit (6 Ticks je Sekunde) soll sich etwa **alle 5 Echtminuten** eine Ziehung leisten lassen (5 min = 1800 Ticks ≈ 35 Spieljahre). Der Faktor ist so zu eichen, dass dieses Ziel über eine typische Partie (die Gläubigenzahl wächst, der Preis steigt) ungefähr hält |
| Zeitraffer | Bei höheren Stufen (26 und 104 Ticks je Sekunde) läuft Faith entsprechend schneller auf: mehr Ziehungen je Echtminute. Das ist gewollt |
| Kein Zeitgeber | Es gibt keinen Timer und keine Wartezeit; leistbar ist, was angespart ist |
| Vorrat | kein Deckel; Faith bleibt unbegrenzt gespeichert |
| Startvorrat | vorläufig 0 (die erste Ziehung nach etwa 5 Echtminuten); Offen (Abschnitt 12) |
| Gläubige = 0 | Es fließt nichts; das Spiel endet ohnehin ohne Gläubige (Game Design, Abschnitt 9) |

Faith ist ein einzelner Zähler (`Float64`) im Spielerzustand, im Kern geführt und mit der Simulation gespeichert. Die Gläubigen je Tick kommen aus der Zählung des Volks (heute `believers` je Volk, jährlich aktualisiert); der Zufluss je Tick nutzt den letzten Wert und braucht keine Schleife über Bewohner.

## 3. Preis und Ziehung

- **Preis:** Die n-te Ziehung kostet **20 × 1,25^(n−1)** Faith (vorläufig, wird kalibriert; n zählt alle bisherigen Ziehungen des Spiels). Der Preis **steigt nur**, kein Zurücksetzen, kein Rabatt. Anzeige gerundet.
- **Eine Ziehung** kostet einmal den Preis und liefert **3 Fähigkeiten**. Alle 3 kommen als Ladungen ins Inventar. Kein Wählen, kein Verwerfen.
- **Mischung:** Die 3 Ziehungen sind unabhängig und stammen aus dem **ganzen Pool aller Kategorien** (Land, Völker, Anführer). Es gibt keinen Slot je Kategorie.
- **Zufall:** stark, kein Pity-System (Game Design, Abschnitt 10). Eigener Zufallsgenerator „gacha“ (deterministisch pro Seed, verschiebt die Folgen anderer Systeme nicht).
- **Dubletten erlaubt:** Jede Fähigkeit steht **genau einmal** im Pool und wird nie daraus entfernt; dieselbe Fähigkeit kann beliebig oft fallen, auch 2-mal in einer Ziehung.
- Ziehung nur bei genug Faith. Eine Ziehung ist sofort (kurze Aufdeck-Animation, Abschnitt 8), nicht abbrechbar.

## 4. Seltenheiten

Vier Stufen: **Common, Rare, Epic, Legendary**. Je mehr eine Fähigkeit das Spiel verändert (Reichweite, Dauer, Dauerhaftigkeit, Risiko, neue Systeme), desto seltener.

- **Ziehung:** erst die Stufe nach Gewicht, dann gleichverteilt unter den Fähigkeiten der Stufe (jede Fähigkeit einmal im Pool, Stufen mit weniger Fähigkeiten geben der einzelnen also mehr Gewicht).
- **Stufengewichte (vorläufig, wird kalibriert):** Common 60 %, Rare 28 %, Epic 10 %, Legendary 2 %.
- Die niedrigste Stufe muss nützlich sein (Game Design): Alle Common-Fähigkeiten wirken sichtbar und billig.
- Die Zuordnung der Fähigkeiten zu Stufen (Abschnitt 6) ist **vorläufig**; die Simulation prüft die Wirkung je Fähigkeit und schiebt sie bei Bedarf in eine andere Stufe.

## 5. Inventar und Einsatz

- **Inventar:** je Fähigkeit eine Zahl (Ladungen), **keine Obergrenze**. Es liegt nur im Spielerzustand, nie in der Simulation selbst.
- **Einsatz:** Spieler wählt die Ladung, dann das **Ziel**, bestätigt; eine Ladung wird verbraucht, der Effekt greift sofort (bzw. beginnt) im nächsten Tick. Kein Abbrechen nach der Bestätigung, vorher jederzeit.
- **Ziele:**
  - **Land:** ein Hexfeld (Mitte), die Fläche folgt aus der Fähigkeit (Radius 0, 1, 2, 3 = 1, 7, 19, 37 Hexfelder). Land-Fähigkeiten dürfen auf jedes Hexfeld, auch außerhalb von Gebieten; Wasser nur, wo die Fähigkeit es sagt.
  - **Volk:** ein Volk (Antippen eines Hexfelds des Volks oder Wahl in der Liste). Auch das eigene Volk ist Ziel.
  - **Anführer:** der Anführer eines Volks (Wahl in der Liste „Leader ›“ oder Antippen eines Hexfelds des Volks).
- Mehrere Ladungen auf dasselbe Ziel: Dauer-Effekte derselben Fähigkeit **verlängern** sich nicht und stapeln nicht, sondern **ersetzen** den laufenden (Dauer beginnt neu); Einmal-Effekte wirken jedes Mal.
- Jede Fähigkeit hat einen Zielprüfer („ist dieses Ziel zulässig?“, z. B. Great River braucht Land mit Gefälle); unzulässige Ziele werden in der Auswahl grau gezeigt, die Ladung wird dann nicht verbraucht.
- **Chronik:** Einsätze erscheinen als stiller Eintrag („You cast … on …“); wichtige Folgen (Rebellion, Tod des Anführers) kommen über die bestehenden Einträge.

## 6. Fähigkeiten (25)

Alle 25 gehören zu Version 1. Zahlen sind Startwerte („vorläufig, wird kalibriert“). „Jahre“ sind Spieljahre (52 Ticks). Die Hebel sind die bestehenden Hebel des Kerns (`LEVERS`, `Requirement Anführer.md` §9), die Einsätze legen eine **Gott-Schicht** darüber (Abschnitt 7.1).

### 6.1 Land (10)

| Name | Stufe | Fläche | Wirkung |
|---|---|---|---|
| Rain of Plenty | Common | Radius 2 | Fruchtbarkeit, Wild, Fisch und Holz der Hexfelder springen sofort auf ihre natürliche Kapazität (Nachwachsen des Kerns, `resources` → `resourceCapacity`) |
| Blight | Common | Radius 2 | Fruchtbarkeit, Wild, Fisch und Holz fallen sofort auf 20 % ihres heutigen Werts; sie wachsen danach über das normale Nachwachsen zurück |
| Warding Light | Common | Radius 2 | Gefahr (`danger`) −0,15 für 15 Jahre (Sterblichkeit sinkt) |
| Drought | Rare | Radius 3 | natürliche Kapazität von Fruchtbarkeit und Fisch ×0,6 für 15 Jahre (Abschnitt 7.1), danach zurück |
| Rich Vein | Rare | 1 Hexfeld | **Vorschlag, mit User abzustimmen** (ersetzt „Seeker of …“, Abschnitt 6.5): legt ein Sondervorkommen (Metall oder Mineral) auf das Hexfeld |
| Great River | Epic | Pfad bis 12 Hexfelder | bildet einen Fluss, Abschnitt 7.2 |
| Wild Fire | Epic | Start 1 Hexfeld, breitet sich aus | Feuer, Abschnitt 7.3 |
| Shaking Earth | Epic | Radius 1 | alle stehenden Gebäude der Hexfelder werden zu Ruinen (bestehendes Ruinensystem `ruins`: Reparatur nach den normalen Regeln); die Einwohner der Hexfelder −20 % |
| Biome Shift | Legendary | Radius 1 | wechselt das Biom der Hexfelder, Abschnitt 7.4 |
| Meteor Strike | Legendary | Radius 1 | Mitte: Sondervorkommen „Meteorite“ (`Deposit.Meteorite`); alle 7 Hexfelder: Einwohner −60 %, Gebäude werden Ruinen, Ressourcen sofort 0 (wachsen normal zurück) |

### 6.2 Völker (8)

Ziel ist immer ein Volk. Die Wirkung gilt für alle Bezirke und Siedlungen des Volks, Dauer **10 Jahre** (vorläufig), wenn nichts anderes steht.

| Name | Stufe | Wirkung |
|---|---|---|
| Festival of Joy | Common | Zufriedenheits-Zielwert aller Siedlungen +8 (neuer Teilwert „Divine“, Abschnitt 7.5) |
| Blessed Cradle | Common | **Vorschlag, mit User abzustimmen** (ersetzt „Seafarers' Whisper“, Abschnitt 6.5): Geburtenrate ×1,5 für 15 Jahre (Hebel `L.birth`) |
| Merchant's Blessing | Common | Händlerlast ×1,5 und Fahrtweite ×1,2 (Hebel `L.load`, `L.tripRange`) |
| Prophet's Light | Rare | Glaube aller Einwohner des Volks einmalig +0,15 und Andacht +0,03 je Jahr für 10 Jahre (Abschnitt 7.6) |
| Prophet's Doubt | Rare | Glaube aller Einwohner des Volks einmalig −0,15 und Andacht −0,03 je Jahr für 10 Jahre (Abschnitt 7.6) |
| Omen of Dread | Rare | Zufriedenheits-Zielwert aller Siedlungen −10 (Teilwert „Divine“). Länger als 5 Jahre unter 0 kann Aufstände/Rebellionen auslösen (bestehende Regeln) |
| Bond of Peace | Rare | Ziel: **zwei Völker**: ihr Vertrauen zueinander einmalig +25 (höchstens 100); die Völker müssen Kontakt haben |
| Martial Fervor | Epic | Soldatenstärke ×1,25 (Hebel `L.strength`) und Soldatenanteil +25 % (`L.warPop`) für 10 Jahre; der Kriegswurf des Volks bleibt unverändert |

### 6.3 Anführer (7)

Ziel ist der Anführer eines Volks (`Requirement Anführer.md`). Der Gott ist die einzige Ausnahme von „kein Zielwechsel“ und von den Attributs-Slots (Abschnitt 7.7).

| Name | Stufe | Wirkung |
|---|---|---|
| Unburden | Common | entfernt **ein vom Spieler gewähltes** Attribut des Anführers; der Platz bleibt leer, die 10-Jahres-Uhr läuft nicht neu |
| Long Life | Rare | Todesalter −10 Jahre: Der Anführer würfelt den Tod mit „Alter − 10“ (statt 55 erst ab 65), nur für diesen Anführer (Abschnitt 7.7) |
| Brittle Crown | Rare | Todesalter +10 Jahre: er würfelt mit „Alter + 10“ (ein 50-Jähriger wie ein 60-Jähriger) |
| Reroll Destiny | Rare | würfelt das **Ziel** neu (Gewichte wie `Requirement Anführer.md` §6, ohne das heutige Ziel); der Fortschritt beginnt neu. Nur für Anführer mit noch aktivem Ziel (nicht nach Abschluss) |
| Gift of Trait | Epic | gibt dem Anführer ein zufälliges **Attribut** aus allen 25 (ohne Ausschlusspaare, ohne bereits vorhandene) |
| Mark of Weakness | Epic | gibt ihm zufällig eines der **schwächenden** Attribute: Craven, Weak Hand, Tyrant, Tax Hawk, Xenophobe, Stubborn (ohne Ausschlusspaare); Menge Offen |
| Wisdom of Ages | Epic | füllt sofort den **nächsten freien Attribut-Platz** (2. oder 3.) nach der Erlebt-Regel (60 % aus Erlebtem, 40 % Zufall, `Requirement Anführer.md` §4); die spätere 10-Jahres-Zuteilung dieses Platzes entfällt |

Ist der Anführer schon bei 3 Attributen, **ersetzt** Gift of Trait/Mark of Weakness ein zufälliges (Offen: Empfehlung ersetzen statt Fehlschlag).

### 6.4 Stufenzuordnung (vorläufig)

| Stufe | Anzahl | Fähigkeiten |
|---|---|---|
| Common | 7 | Rain of Plenty, Blight, Warding Light, Festival of Joy, Blessed Cradle, Merchant's Blessing, Unburden |
| Rare | 9 | Drought, Rich Vein, Prophet's Light, Prophet's Doubt, Omen of Dread, Bond of Peace, Long Life, Brittle Crown, Reroll Destiny |
| Epic | 7 | Great River, Wild Fire, Shaking Earth, Martial Fervor, Gift of Trait, Mark of Weakness, Wisdom of Ages |
| Legendary | 2 | Biome Shift, Meteor Strike |

Aufteilung nach Kategorie: Land 10, Völker 8, Anführer 7 (der frühere Entwurf hatte 9 / 8 / 8, siehe 6.5).

### 6.5 Ersetzte Fähigkeiten (Vorschlag, mit User abzustimmen)

Der Nutzer will zwei Fähigkeiten nicht: „Seafarers' Whisper“ (Kulturwerte wirken im Spiel noch nirgends) und „Seeker of Glory/Wealth/…“ (zu ähnlich zu Reroll Destiny). Jeder bekommt **einen** Ersatz, der über ein bestehendes, funktionierendes System direkt auf die Welt wirkt. **Beide Ersatz-Fähigkeiten sind Vorschlag, mit User abzustimmen.**

| Ersetzt | Vorschlag | System | Alternative |
|---|---|---|---|
| Seafarers' Whisper | **Blessed Cradle** (Volk, Geburtenrate ×1,5, 15 Jahre, Common) | Geburtenhebel `L.birth` (`population.ts`/`simulation.ts`) | **Wanderlust**: Überlast-Faktor des Siedelns −0,05 und Wegkosten ×0,8 für 15 Jahre (Hebel `L.settleOver`, `L.travel`): das Volk siedelt früher und weiter |
| Seeker of … | **Rich Vein** (Land, ein Sondervorkommen auf einem Hexfeld, Rare). Das Vorkommen zieht die vorhandene Wirtschaft nach (Förderung in `economy.ts`, Handel, strategische Güter Eisen/Feuerstein im Krieg) | Sondervorkommen `deposits.ts`, Ernte `economy.ts` | **Lasting Bounty**: natürliche Kapazität (`resourceCapacity`) von Fruchtbarkeit und Fisch eines Hexfelds (Radius 1) dauerhaft +0,2 (höchstens 1): wirkt wie ein kleines, dauerhaftes Land-Upgrade |

Rich Vein: Die Art ist zufällig unter Metall/Mineral (Copper, Tin, Iron, Gold, Salt, Flint, Marble, Gems), gewichtet nach der vorhandenen Häufigkeit (`deposits.ts`) und nur eine Art, die zum Biom des Hexfelds passt (dieselbe Eignungsregel wie bei der Weltgenerierung); Zielprüfer: Landhexfeld ohne Sondervorkommen. Der Spieler wählt die Art nicht.

## 7. Neue Teilsysteme

### 7.1 Gott-Schicht (zeitlich begrenzte Wirkungen)

Alle Dauer-Effekte (Warding Light, Drought, Völker-Fähigkeiten, Lebenszeit-Verschiebung) laufen über **eine** gemeinsame Liste, nicht über eigene Schleifen je Fähigkeit.

- **Liste aktiver Effekte** (flache Typed Arrays, höchstens 256 Einträge; ein neuer Eintrag derselben Art und desselben Ziels ersetzt den alten): Art (Index), Ziel (Hexfeld-Mitte oder Volk), Radius, Wert, Ende (Tick). Gespeichert mit dem Spielstand.
- **Volks-Effekte** schreiben in einen **Hebelsatz „Gott“** (`godLev`, Volk × Hebel, neutral 0 bzw. 1 wie `LEVERS`), der **vor jedem Lesen** mit dem Hebelsatz des Anführers kombiniert wird (additiv addiert, multiplikativ multipliziert, `Requirement Anführer.md` §3). Er wird nur bei Beginn und Ende eines Effekts neu berechnet. Die Deckel aus Anführer §3 (Zufriedenheit ±8 des Anführer-Teilwerts, Kriegswurf ≤ 40 %, 2×-Schwelle ≥ 1,2×) gelten für die **Anführer-Schicht**; die Gott-Schicht hat eigene Obergrenzen je Hebel (z. B. Stärkefaktor insgesamt höchstens ×2 gegenüber dem Grundwert; vorläufig).
- **Land-Effekte** (Gefahr, Kapazität) ändern die Kartenfelder (`danger`, `resourceCapacity`) **um einen Betrag/Faktor** und ziehen ihn am Ende **exakt wieder ab** (gemerkt je Eintrag); überlappende Effekte addieren sich so richtig. Dauer-Land-Effekte werden bei Beginn und Ende angewandt, nicht jeden Tick.
- **Ablauf:** Eine Prüfung je Tick, ob der früheste Eintrag endet (Liste nach Ende sortiert oder Minimum merken), sonst nichts.

### 7.2 Great River

- Ziel: ein Landhexfeld. Ab dort wird der Weg **bergab** gesucht: jeweils der Nachbar mit der niedrigsten Höhe (`elevation`), der tiefer liegt; Gleichstand: der Nachbar mit mehr Feuchtigkeit. Der Weg endet an Meer, See (`Biome.Lake`), oder einem bestehenden Fluss (`riverFlow > 0`), dann fließt der neue Fluss hinein.
- Zielprüfer: der Pfad muss einen Auslauf finden und höchstens 12 Hexfelder lang sein; sonst ist das Ziel unzulässig (kein Fluss in einer Senke, kein See als Nebenfolge). Berge (`Biome.Mountains`) dürfen Quelle sein.
- Wirkung: für jedes Hexfeld des Pfads wird `riverDir` auf das nächste Hexfeld und `riverFlow` auf einen kleinen Bachwert gesetzt (Startwert Offen: die Simulation eicht ihn so, dass `supply.ts` das Hexfeld als Flusshexfeld wertet, ohne bestehende Flüsse zu überbieten); ein bestehender Fluss am Auslauf behält seinen Wert.
- Folgen laufen über bestehende Systeme: Wasserversorgung (`FRESH_WATER` in `supply.ts` liest `riverFlow` im Hexfeld und an Nachbarn) und Fruchtbarkeit (Fluss-Anteil der Kapazität: Fruchtbarkeits-Aufschlag neu berechnen) am Pfad und seinen Nachbarn; die Kartenkacheln dort werden neu gezeichnet (Karten-Snapshot, Abschnitt 8).
- Die Felder `riverFlow`/`riverDir` sind veränderlich (Kommentar in `world.ts` „Current amounts … change during play“ gilt auch hier), `WORLD_VERSION` bleibt, die Werte werden mit dem Spielstand gespeichert.

### 7.3 Wild Fire

- Zündung: Hexfeld der Biome Forest, Jungle, Savanna (brennbar); Zielprüfer: das Zielhexfeld ist brennbar.
- Ablauf in Wochen-Ticks: ein brennendes Hexfeld brennt **6 Wochen**; jede Woche entzündet es jeden **brennbaren** Nachbarn mit **15 %**; ein Hexfeld brennt nur einmal. Höchstens **40 Hexfelder** je Brand (danach erlischt er).
- Während es brennt: Gefahr +0,3 (Teil der Gott-Schicht, Abschnitt 7.1, mit exaktem Rückbau), Einwohner −3 % je Woche (Siedlungen, die dort liegen, leiden also; Gebäude bleiben, Offen). Wenn ein Hexfeld ausgebrannt ist: Holz 0, Wild ×0,3 (heutiger Wert), beides wächst normal nach. Das Biom bleibt.
- Liste der brennenden Hexfelder (höchstens 64 Einträge, Typed Array: Hexfeld, Restwochen); pro Tick nur diese Liste. Die Karte zeigt brennende Hexfelder mit einem eigenen Symbol (Abschnitt 8).

### 7.4 Biome Shift

- Ziel: Hexfeld-Mitte, Wirkung auf die 7 Hexfelder (Land). Meer, See, Eis und Hexfelder mit Sondervorkommen „mystic“ (`HolySpring`, `SacredGrove`, `Meteorite`, `AncientRuins`) bleiben unverändert (Zielprüfer: mindestens ein Hexfeld wechselt).
- **Wechselregel** (jedes Landhexfeld zufällig einen Schritt in die Kette, ein Schritt feuchter oder trockener je nach Wahl des Spielers: „wetter“ oder „trockener“; 2 Knöpfe bei der Zielwahl):

  `Desert ↔ Savanna ↔ Plains ↔ Forest ↔ Jungle ↔ Swamp` und `Tundra ↔ Plains`, `Hills ↔ Mountains`, `Hills ↔ Plains`.

  Wetter = nächster Biom in Richtung Swamp, trockener = in Richtung Desert; am Ende der Kette bleibt das Hexfeld.
- Nach dem Wechsel werden die vom Biom abgeleiteten Felder des Hexfelds neu gesetzt: natürliche Kapazität (`resourceCapacity` aus der Biomtabelle × `terrainVariation`), `danger`, `moveCost`; die aktuellen Ressourcen bewegen sich über das normale Nachwachsen auf die neue Kapazität. `moisture`/`temperature` bleiben. Straßen, Gebäude, Besitzer und Bewohner bleiben; Bewohner, die im neuen Biom nicht leben können (Versorgung unter Bedarf), wandern über die bestehenden Regeln ab (Hunger, Siedeln).
- Die Kartenkacheln werden neu gezeichnet.

### 7.5 Teilwert „Divine“ der Zufriedenheit

Neuer Teilwert in der Zufriedenheit jeder Siedlung (`Requirement Zufriedenheit.md`, neben „Leader“ in der Hexfeld-Info): Summe der laufenden Gott-Wirkungen (Festival +8, Omen −10) des Volks, **eigene Grenze ±15** (vorläufig), unabhängig vom ±8-Deckel des Anführers. Wirkt auf den Zielwert; der Istwert folgt träge (25 % des Abstands je Jahr).

### 7.6 Andacht und Prophet's Light/Doubt

- Der Glaubensschritt je Bewohner (`simulation.ts`, jährlich: Umfeld, Andacht, Vergessen) bekommt einen weiteren Summanden **`godDevotion[civ]`** (Float32 je Volk, +0,03 Light, −0,03 Doubt, 0 sonst; kommt aus der Gott-Schicht, Abschnitt 7.1).
- **Light** wirkt **in jedem Volk** (auch ohne `worshipsPlayer`): der Summand gilt dann zusätzlich zum fehlenden „Vergessen“, solange der Effekt läuft (Vergessen −0,005 bleibt: 0,03 ist stärker). **Doubt** wirkt in jedem Volk, auch im eigenen (Faith sinkt, dem Spieler überlassen).
- Zusätzlich einmalig: Glaubenswert **aller** Einwohner des Volks ±0,15 (auf 0..1 begrenzt), mit Eintrag in die Glaubensbilanz des Volks (`faithYear`, neue Posten „Divine light“/„Divine doubt“, damit die Bilanz aufgeht).
- Faith aus Gläubigen anderer Völker gibt es nicht (Abschnitt 2): Light auf ein fremdes Volk bringt Gläubige, aber kein Faith. Offen (Abschnitt 12).

### 7.7 Eingriffe auf Anführer (aus `Requirement Anführer.md` §10 „Später“, jetzt Teil von 1.0)

- **Todesalter-Verschiebung** `ageShift` je Anführer (`Int8Array`, −10 / 0 / +10, wird mit dem Anführer zurückgesetzt, **nicht** an den Nachfolger vererbt): die Todeswahrscheinlichkeit (`Requirement Anführer.md` §2) rechnet mit „Alter + ageShift“ statt „Alter“; Long Life und Brittle Crown setzen ihn (nicht kumulierend, ein neuer Einsatz ersetzt den alten; Offen).
- **Attribute:** Gift of Trait, Mark of Weakness, Wisdom of Ages, Unburden ändern die 3 Attribut-Slots und lösen genau wie die bestehenden Änderungen die **Neuberechnung des Hebelsatzes** (`recompute`) aus. Die Ausschlusspaare und das Zielverbot (Pacifist ↔ Glory, Homebody ↔ Expansion) gelten auch für den Gott.
- **Ziel:** Reroll Destiny ruft die Zielwahl (`Requirement Anführer.md` §6) neu auf; Ausgangswert und Fortschritt werden zurückgesetzt. Das ist die **einzige** Ausnahme von „kein Zielwechsel“.
- Chronik: „Leader gains trait“ und „Goal reached“ bleiben still; ein vom Gott gesetzter Wechsel bekommt einen stillen Eintrag mit dem Zusatz „by the god“.
- Die Panels „Leader ›“ zeigen das Ergebnis ohne Änderung (Attribute, Ziel, Alter); das Todesalter ist nicht sichtbar (Offen).

## 8. Anzeige

- **Faith-Anzeige:** oben auf dem Bildschirm eine kleine Anzeige „Faith 17,3 / 20“ (Stand / Preis der nächsten Ziehung) und ein Knopf „Gacha“, grün hervorgehoben, wenn eine Ziehung leistbar ist.
- **Gacha-Bildschirm:** Preis, Knopf „Pull (3)“, Aufdecken der 3 Ergebnisse nacheinander mit Seltenheitsfarbe (Common grau, Rare blau, Epic violett, Legendary gold). Nach der Ziehung bleiben die Ergebnisse sichtbar, bis der Spieler sie schließt.
- **Inventar:** Liste der Fähigkeiten mit Zahl der Ladungen, nach Kategorie (Land, Völker, Anführer) und Seltenheit; Antippen zeigt die Beschreibung mit Zahlen und den Knopf „Use“.
- **Zielwahl:** Land: Antippen eines Hexfelds mit Vorschau der betroffenen Fläche (Great River zeigt den Pfad, Biome Shift den Wahlknopf „wetter/trockener“), Bestätigen/Abbrechen. Volk/Anführer: Liste oder Antippen.
- **Karte:** brennende Hexfelder (Wild Fire) und Ruinen sichtbar, neue Flüsse und geänderte Biome erscheinen nach dem Einsatz in den Kacheln.
- Alle Texte Englisch.

## 9. Datenhaltung

- Spielerzustand (nicht Teil des Hexfeld-Zustands): `faith` (`Float64`), `pulls` (Anzahl bisheriger Ziehungen für den Preis, `Int32`), `charges` (`Int32Array`, 25 Einträge), Zufallsgenerator „gacha“.
- Gott-Schicht: Effektliste (Abschnitt 7.1), `godLev` (Volk × Hebel, `Float32Array`), `godDevotion` (je Volk), `ageShift` (je Anführer), Feuerliste (Abschnitt 7.3), Zähler für den Teilwert „Divine“.
- Fähigkeitstabelle: `ABILITIES` mit Id, Name, Kategorie, Stufe, Zielart, Fläche, Dauer, Zielprüfer, Wirkung (eine reine Funktion je Fähigkeit im Kern, kein React). Kern und Zufall sind **portierbar** (flache Arrays, deterministisch pro Seed).
- Faith-Zufluss läuft **je Tick** im Kern; die Ziehung selbst ist ein Aufruf des Kerns (`pullGacha(sim)`), kein Zeitgeber der App.

## 10. Performance, Benchmark, Simulation

- Laufender Aufwand: Faith je Tick eine Multiplikation; Effektliste und Feuerliste klein (≤ 256 bzw. ≤ 64), ein Vergleich je Tick. Einmalige Eingriffe (Biome Shift, Meteor Strike, Great River) berühren ≤ 37 Hexfelder bzw. ≤ 12 Pfadfelder.
- **Benchmark (Pflicht, `AGENTS.md`):** neues Szenario `gacha` (aged, mit Ladungen aller 25 Fähigkeiten, die der Setup auf verteilten Zielen einsetzt: Wild Fire in Wäldern, Great River, Biome Shift, Meteor Strike, Shaking Earth mit Ruinen, Effekte aller Völker, brennende Hexfelder, neue Flüsse, viele Kacheln auf Neuzeichnen) und alle Szenarien bleiben grün. Die Karten-Kacheln werden bei Biom-, Fluss-, Ruinen- und Brandänderung neu gezeichnet; das darf auch während der Wischer keine Frames über 25 ms kosten (Neuzeichnen nur, wenn die Karte ruht, wie heute).
- **Simulation (`sim-analyst`, 12 Welten, 300 Jahre):**
  1. Eichung des Faith-Faktors und der Preiskurve: Ziehungen je Echtminute bei Geschwindigkeit 1 (Eichziel 5 min je Ziehung) und bei den höheren Stufen; Gläubigenzahl über die Zeit.
  2. Stufengewichte und Stufenzuordnung: Verteilung der Ziehungen, Wirkungsstärke je Fähigkeit (z. B. Wirkung auf Siedlungen, Kriege, Rebellionen, Handel bei Einsatz auf ein typisches Ziel), ob Common wirklich nützlich ist.
  3. Extremfälle: Einsatz **aller** Ladungen auf ein Volk (Gott-Schicht-Deckel), Doubt + Omen auf das eigene Volk (Spielende), Brittle Crown in Serie (Dynastie), Meteor Strike auf Hauptstadt.
  4. Dauern und Flächen (Abschnitt 12).
- Tool geplant: `tools/gachaStats.ts`.

## 11. Abhängigkeiten

- `Requirement Anführer.md`: §1, §4, §5, §9, §10 (Eingriff des Gottes jetzt in 1.0; Todesalter-Verschiebung, Attribut- und Zieleingriff, Teilwert „Leader“ bleibt auf ±8).
- `Requirement Zufriedenheit.md`: neuer Teilwert „Divine“ (7.5); Chronik-Einträge (stille Einsatz-Einträge).
- `Requirement Regionale Rohstoffe.md`: Ressourcenänderung, Sondervorkommen (Rich Vein, Meteor Strike), Ruinen (Shaking Earth, Meteor Strike); Wasser aus Flüssen (Great River).
- `Requirement Handel.md`, `Requirement Krieg.md`, `Requirement Diplomatie.md`: Hebel für Händlerlast/Fahrtweite, Stärke/Soldaten, Vertrauen (Bond of Peace).
- Game Design (Abschnitte 1, 2, 7, 10, 12): Faith statt Einflusspunkte, Gacha-Regeln.
- Game Design Abschnitt 7: Glaubenswert und `faithYear` (Prophet's Light/Doubt).

## 12. Offene Punkte

- **Startvorrat** an Faith (Empfehlung 0).
- **Faktor und Preisformel** sind nur Startwerte (0,0005 je Gläubigem und Tick, 20 × 1,25^(n−1)); Eichung durch die Simulation.
- **Zufluss aus Gläubigen anderer Völker:** heute nur das Volk des Spielers; soll Faith auch aus bekehrten Völkern fließen (Empfehlung: nein in Version 1, Prophet's Light bringt dann keinen Faith-Gewinn, nur Glauben)?
- **Dauern** (10/15 Jahre) und **Flächen** (Radius 1–3) aller Fähigkeiten, die Stärken (±0,15 Glaube, +8/−10 Zufriedenheit, −20/−60 % Einwohner, ×1,25/×1,5 Hebel) und die Gott-Obergrenzen je Hebel (Abschnitt 7.1): alles vorläufig.
- **Stapelregel** (Abschnitt 5: Dauer-Effekt ersetzt den laufenden) und **Todesalter**-Stapelung (Empfehlung: ersetzen, nicht addieren).
- **Gift of Trait/Mark of Weakness bei 3 Attributen:** ersetzen (Empfehlung) statt Fehlschlag; Menge der schwächenden Attribute.
- **Wild Fire:** Gebäude im Feuer (Empfehlung: unberührt, nur Einwohner und Ressourcen), Grenzen (40 Hexfelder).
- **Great River** in Senken: Empfehlung unzulässig (kein See als Nebenfolge).
- **Todesalter** im Leader-Panel sichtbar machen (Empfehlung: nein, die Ereignisse im Chronik-Eintrag reichen).
- **Zeitraffer:** Faith läuft nach Spielzeit, bei 26/104 Ticks je Sekunde also 4-/17-mal schneller; Wirkung auf das Tempo der Partie und eine mögliche Sperre der Ziehung bei Pause prüfen.
- **Rivalen-Götter** (Game Design 8) später: dann auch Fähigkeiten auf fremde Götter.
- Ersatz-Fähigkeiten „Blessed Cradle“ und „Rich Vein“ (Abschnitt 6.5): Abstimmung mit dem Nutzer.

## 13. Später (nicht in Version 1)

- Rivalen-Götter mit eigenem Faith und eigenen Ladungen.
- Handel mit Ladungen, Verschmelzen, Pity-System (bewusst ausgeschlossen).
- Weitere Fähigkeiten nach Kultureffekten (Seafarers' Whisper, sobald Kultur im Spiel etwas bewirkt) und Fähigkeiten auf Kriege und Verträge.
