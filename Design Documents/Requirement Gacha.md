# Requirement: Gacha und Fähigkeiten

Stand: **Entwurf, Grundregeln und offene Details vom Nutzer entschieden (Faith nach Spielzeit, 3 Fähigkeiten je Ziehung, Inventar, 4 Seltenheiten, alle 25 Fähigkeiten in Version 1); alle Zahlen sind Startwerte „vorläufig, wird kalibriert“ (Simulation durch `sim-analyst`).** Ablauf: Design → Simulation → Umsetzung. Spieltexte sind Englisch („Faith“, „Gacha“, „Charge“).

Baut auf `Game Design Gott einer Zivilisation` (Abschnitte 7 und 10), `Requirement Anführer.md` (Eingriffe auf Anführer), `Requirement Zufriedenheit.md`, `Requirement Diplomatie.md`, `Requirement Handel.md` und `Requirement Krieg.md` auf. Rivalen-Götter (Game Design, Abschnitt 8) bleiben vorerst außen vor.

## 1. Ziel

Der Spieler greift nur über **Fähigkeiten** in die Welt ein. Er bekommt sie aus **Gacha-Ziehungen**, die er mit **Faith** bezahlt, einer Währung, die alle Gläubigen des Gottes in allen Völkern laufend erzeugen. Jede Fähigkeit ist eine verbrauchbare **Ladung**, die der Spieler später **bewusst** auf ein selbst gewähltes Ziel wirft. Es gibt keine erzwungenen Negativ-Effekte: auch schädliche Fähigkeiten wirft der Spieler selbst, auch auf das eigene Volk.

Der Reiz ist die Überraschung der Ziehung und die Frage, wo man die Ladung am besten einsetzt. Das Spiel bleibt eine Sandbox: Fähigkeiten stoßen die Völker an, die Völker entscheiden weiter selbst.

## 2. Faith (Währung)

| Regel | Wert |
|---|---|
| Name | „Faith“ (ersetzt die „Einflusspunkte“ im Game Design) |
| Quelle | **alle Gläubigen des Gottes in allen Völkern**: Glaube ist je Bewohner der Glaube **an einen bestimmten Gott** (jetzt der Spieler-Gott, später Rivalen-Götter, Game Design 8); wer den Glaubenswert ≥ 0,5 (`BELIEVER_FAITH`) an den Gott hat, zählt, egal in welchem Volk. Faith wird also auch aus bekehrten Völkern erzeugt |
| Zufluss | **je Tick (Spielzeit)**, nicht je Echtzeit: Faith je Tick = Gläubige × Faktor. Faktor **vorläufig 0,0005 Faith je Gläubigem und Tick** (≈ 0,026 je Gläubigem und Jahr); wird kalibriert |
| Eichziel | Bei Standardgeschwindigkeit (6 Ticks je Sekunde) soll sich etwa **alle 5 Echtminuten** eine Ziehung leisten lassen (5 min = 1800 Ticks ≈ 35 Spieljahre). Der Faktor ist so zu eichen, dass dieses Ziel über eine typische Partie (die Gläubigenzahl wächst, der Preis steigt) ungefähr hält |
| Zeitraffer | Bei höheren Stufen (26 und 104 Ticks je Sekunde) läuft Faith entsprechend schneller auf: mehr Ziehungen je Echtminute. Das ist gewollt |
| Kein Zeitgeber | Es gibt keinen Timer und keine Wartezeit; leistbar ist, was angespart ist |
| Vorrat | kein Deckel; Faith bleibt unbegrenzt gespeichert |
| Startvorrat | **0** (entschieden; die erste Ziehung nach etwa 5 Echtminuten) |
| Gläubige = 0 | Es fließt nichts; das Spiel endet ohnehin ohne Gläubige (Game Design, Abschnitt 9) |

Faith ist ein einzelner Zähler (`Float64`) im Spielerzustand, im Kern geführt und mit der Simulation gespeichert. Die Gläubigen je Tick kommen aus der Zählung (heute `believers` über alle Völker, `sim.believers`, vierteljährlich/jährlich aktualisiert); der Zufluss je Tick nutzt den letzten Wert und braucht keine Schleife über Bewohner. Für spätere Rivalen-Götter wird die Zählung je Gott geführt (Gott-Index), Faith eines Gottes fließt aus seinen Gläubigen.

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
  - **Land:** ein Hexfeld (Mitte), die Fläche folgt aus der Fähigkeit (Radius 0, 1, 3 = 1, 7, 37 Hexfelder). Land-Fähigkeiten dürfen auf jedes Hexfeld, auch außerhalb von Gebieten; Wasser nur, wo die Fähigkeit es sagt.
  - **Volk:** ein Volk (Antippen eines Hexfelds des Volks oder Wahl in der Liste). Auch das eigene Volk ist Ziel.
  - **Anführer:** der Anführer eines Volks (Wahl in der Liste „Leader ›“ oder Antippen eines Hexfelds des Volks).
- Mehrere Ladungen auf dasselbe Ziel: Dauer-Effekte derselben Fähigkeit **verlängern** sich nicht und stapeln nicht, sondern **ersetzen** den laufenden (Dauer beginnt neu); Einmal-Effekte wirken jedes Mal.
- Jede Fähigkeit hat einen Zielprüfer („ist dieses Ziel zulässig?“, z. B. Great River braucht Land mit Gefälle); unzulässige Ziele werden in der Auswahl grau gezeigt, die Ladung wird dann nicht verbraucht.
- **Chronik:** Einsätze erscheinen als stiller Eintrag („You cast … on …“); wichtige Folgen (Rebellion, Tod des Anführers) kommen über die bestehenden Einträge.

## 6. Fähigkeiten (25)

Alle 25 gehören zu Version 1 (vom Nutzer gesehen und bestätigt, bis auf die zwei Ersatz-Fähigkeiten Nr. 14 und Nr. 23, Abschnitt 6.5). Zahlen sind Startwerte („vorläufig, wird kalibriert“). „Jahre“ sind Spieljahre (52 Ticks). Die Hebel sind die bestehenden Hebel des Kerns (`LEVERS`, `Requirement Anführer.md` §9); die Einsätze legen eine **Gott-Schicht** darüber (Abschnitt 7.1).

### 6.1 Land (9)

| Nr. | Name | Stufe | Fläche | Wirkung |
|---|---|---|---|---|
| 1 | Fertile Blessing | Common | Radius 1 | Fruchtbarkeit sofort auf Kapazität und die natürliche Kapazität der Fruchtbarkeit ×1,25 (höchstens 1) für 20 Jahre; die Ernte steigt über die bestehende Versorgung/Ernte (Gott-Schicht, Abschnitt 7.1) |
| 2 | Exhausted Soil | Common | 1 Hexfeld | alle Ressourcen des Hexfelds (Fruchtbarkeit, Wild, Fisch, Holz, Stein, Erz) sofort auf 10 % ihres Werts; sie wachsen über das normale Nachwachsen zurück |
| 3 | Wide Foundations | Rare | 1 Hexfeld | +1 Bauplatz der Siedlung (Abschnitt 7.5); dauerhaft, ohne Grenze |
| 4 | Cramped Ground | Rare | 1 Hexfeld | −1 Bauplatz, nie unter die belegten Plätze; sind **alle** Plätze des Hexfelds belegt, ist es ein **unzulässiges Ziel** (Abschnitt 7.5); dauerhaft, ohne Grenze |
| 5 | Drought | Rare | Radius 3 | Feuchtigkeit (`moisture`) −0,25 für 20 Jahre, dadurch weniger Regenwasser in der Versorgung (`supply.ts`, `RAIN_WATER × moisture`); danach zurück. Biome werden nicht neu eingestuft |
| 6 | Rich Vein | Rare | 1 Hexfeld | legt ein Sondervorkommen (Metall oder Mineral) auf das Hexfeld; Art zufällig unter Copper, Tin, Iron, Gold, Salt, Flint, Marble, Gems, gewichtet nach `deposits.ts`, nur eine zum Biom passende; Zielprüfer: Landhexfeld ohne Sondervorkommen. Förderung, Handel und Kriegsgüter laufen über die bestehenden Systeme |
| 7 | Great River | Legendary | Pfad bis 12 Hexfelder | bildet oder verlängert einen Fluss (Abschnitt 7.2) |
| 8 | Wild Fire | Epic | Start 1 Hexfeld, breitet sich aus | Wald brennt, Holz weg, Gebäude werden Ruinen, später Ebene (Abschnitt 7.3) |
| 9 | Biome Shift | Legendary | Radius 1 | wechselt das Biom der Hexfelder zu einem verwandten (Abschnitt 7.4) |

### 6.2 Völker (8)

Ziel ist ein Volk (auch das eigene). Die Wirkung gilt für alle Bezirke und Siedlungen des Volks.

| Nr. | Name | Stufe | Wirkung |
|---|---|---|---|
| 10 | Fruitful Waters | Common | Geburtenrate +10 % für 30 Jahre (Hebel `L.birth`) |
| 11 | Lean Years | Common | Geburtenrate −10 % für 30 Jahre (`L.birth`) |
| 12 | Grateful Hearts | Common | Zufriedenheit +3 für 30 Jahre (Teilwert „Divine“, Abschnitt 7.6) |
| 13 | Restless Spirits | Common | Zufriedenheit −3 für 30 Jahre (Teilwert „Divine“) |
| 14 | Wanderlust | Common | Überlast-Faktor des Siedelns −0,05 und Wegkosten des Siedelns ×0,8 für 15 Jahre (Hebel `L.settleOver`, `L.travel`) |
| 15 | Prophet's Light | Rare | Glaube aller Einwohner einmalig +0,15 und Andacht +0,03 je Jahr für 10 Jahre (Abschnitt 7.7) |
| 16 | Doubt | Rare | Glaube aller Einwohner an **alle Götter** einmalig −0,15 und Andacht −0,03 je Jahr für 10 Jahre (Abschnitt 7.7) |
| 17 | Golden Harvest | Epic | Ernte und Handelswert +15 % für 20 Jahre (Hebel `L.harvest`, `L.load`) |

### 6.3 Anführer (8)

Ziel ist der Anführer eines Volks (`Requirement Anführer.md`). Der Gott ist die Ausnahme von den Attribut-Plätzen (Abschnitt 7.8).

| Nr. | Name | Stufe | Wirkung |
|---|---|---|---|
| 18 | Gift of Trait | Epic | gibt dem Anführer ein **zufälliges** Attribut aus den 25 (Ausschlusspaare und Zielverbote gelten, schon vorhandene nicht); es gibt **keine Obergrenze** der Attribute: auch über 3 hinaus, ohne ein anderes zu ersetzen |
| 19 | Mark of Weakness | Epic | gibt ihm **zufällig** eines der schwächenden Attribute: Craven, Weak Hand, Tyrant, Tax Hawk, Xenophobe, Stubborn (Ausschlusspaare gelten; keine Obergrenze der Attribute) |
| 20 | Long Life | Rare | niedrigere Sterberate: Todesalter −10 Jahre (er würfelt den Tod mit „Alter − 10“), nur für diesen Anführer (Abschnitt 7.8) |
| 21 | Brittle Crown | Rare | höhere Sterberate: Todesalter +10 Jahre („Alter + 10“), nur für diesen Anführer |
| 22 | Reroll Destiny | Rare | würfelt das **Ziel** neu (Gewichte wie `Requirement Anführer.md` §6, ohne das heutige Ziel); Fortschritt beginnt neu; nur bei noch aktivem Ziel |
| 23 | Young Heir | Rare | der **nächste Nachfolger** tritt mit Alter 20 an (statt 20 bis 40): längste Amtszeit; gilt für einen Nachfolger, dann verbraucht (Abschnitt 7.8) |
| 24 | Honed Mind | Epic | ein **zufälliges** vorhandenes Attribut des Anführers wird verstärkt: die Abweichung seiner Wirkungen vom Grundwert ×1,5 (Zufriedenheit weiter im ±8-Deckel); nur für diesen Anführer (Abschnitt 7.8) |
| 25 | Dynasty's Heir | Epic | der **nächste Nachfolger** erbt sicher ein Attribut des Vorgängers (statt 50 %; Zufall unter dessen Attributen); gilt für einen Nachfolger, dann verbraucht (Abschnitt 7.8) |

### 6.4 Stufenzuordnung (vorläufig)

Je mehr eine Fähigkeit das Spiel verändert (Dauer, Dauerhaftigkeit, Reichweite, neue Systeme), desto seltener.

| Stufe | Anzahl | Fähigkeiten |
|---|---|---|
| Common | 7 | Fertile Blessing, Exhausted Soil, Fruitful Waters, Lean Years, Grateful Hearts, Restless Spirits, Wanderlust |
| Rare | 10 | Wide Foundations, Cramped Ground, Drought, Rich Vein, Prophet's Light, Doubt, Long Life, Brittle Crown, Reroll Destiny, Young Heir |
| Epic | 6 | Wild Fire, Golden Harvest, Gift of Trait, Mark of Weakness, Honed Mind, Dynasty's Heir |
| Legendary | 2 | Great River, Biome Shift |

Stufengewichte 60/28/10/2 (vorläufig); Young Heir steht in Rare (wirkt einmal, verlängert aber eine ganze Amtszeit). Die Simulation kalibriert Gewichte und Zuordnung (Wirkung je Fähigkeit, ob Common nützlich ist).

Aufteilung nach Kategorie: Land 9, Völker 8, Anführer 8.

### 6.5 Ersetzte Fähigkeiten (entschieden)

Nr. 14 und Nr. 23 ersetzen „Seafarers' Whisper“ (Kulturwerte wirken noch nirgends) und „Seeker of …“ (zu ähnlich zu Reroll Destiny). Beide sind vom Nutzer bestätigt.

| Nr. | Fähigkeit | System |
|---|---|---|
| 14 (Völker) | **Wanderlust**: Siedeln früher und weiter (15 Jahre) | Hebel des Siedelns `L.settleOver`, `L.travel` (`simulation.ts`) |
| 23 (Anführer) | **Young Heir**: der nächste Nachfolger tritt mit Alter 20 an | Nachfolge (`startLeader`, `Requirement Anführer.md` §6) |

## 7. Neue Teilsysteme

### 7.1 Gott-Schicht (zeitlich begrenzte Wirkungen)

Alle Dauer-Effekte (Fertile Blessing, Drought, Völker-Fähigkeiten) laufen über **eine** gemeinsame Liste, nicht über eigene Schleifen je Fähigkeit.

- **Liste aktiver Effekte** (flache Typed Arrays, höchstens 256 Einträge; ein neuer Eintrag derselben Art und desselben Ziels ersetzt den alten): Art, Ziel (Hexfeld-Mitte oder Volk), Radius, Wert, Ende (Tick). Gespeichert mit dem Spielstand.
- **Volks-Effekte** schreiben in einen **Hebelsatz „Gott“** (`godLev`, Volk × Hebel, neutral 0 bzw. 1 wie `LEVERS`), der mit dem Hebelsatz des Anführers kombiniert wird (additiv addiert, multiplikativ multipliziert, `Requirement Anführer.md` §3) und nur bei Beginn und Ende eines Effekts neu berechnet wird. Die Deckel aus Anführer §3 gelten für die Anführer-Schicht; die Gott-Schicht hat eigene Obergrenzen je Hebel (vorläufig).
- **Land-Effekte** (Kapazität, Feuchtigkeit, Gefahr) ändern die Kartenfelder um einen Betrag/Faktor und ziehen ihn am Ende **exakt wieder ab** (gemerkt je Eintrag); überlappende Effekte addieren sich richtig; angewandt bei Beginn und Ende, nicht jeden Tick.
- **Ablauf:** je Tick eine Prüfung, ob der früheste Eintrag endet.

### 7.2 Great River

- Ziel: ein Landhexfeld. Ab dort wird **bergab** gesucht: jeweils der Nachbar mit der niedrigsten Höhe (`elevation`), der tiefer liegt (Gleichstand: mehr Feuchtigkeit). Der Weg endet an Meer, See oder einem bestehenden Fluss (`riverFlow > 0`), dann fließt der neue Fluss hinein; liegt das Ziel schon an einem Fluss, wird dieser **verlängert** (die Suche beginnt an seinem Ende).
- **Senke (entschieden):** Hat der Weg keinen Auslauf (Hexfeld ohne tieferen Nachbarn, oder 12 Hexfelder ohne Meer/See/Fluss), wird sein **letzter Hexfeld zu einem See** (`Biome.Lake`; Kapazität, `danger`, `moveCost` neu aus der Biomtabelle wie bei Biome Shift, 7.4). Das Ziel ist also immer zulässig, wenn das Zielhexfeld Land ist; liegt auf dem See-Hexfeld eine Siedlung, wird sie **überflutet**: ihre Gebäude werden zu Ruinen (bestehendes Ruinensystem), die Einwohner wandern über die bestehenden Regeln ab (entschieden).
- Wirkung: je Hexfeld des Pfads `riverDir` auf das nächste und `riverFlow` auf einen kleinen Bachwert (Startwert Offen, Eichung so, dass `supply.ts` das Hexfeld als Flusshexfeld wertet; ein bestehender Fluss am Auslauf behält seinen Wert).
- Folgen über bestehende Systeme: Wasser (`FRESH_WATER` in `supply.ts` liest `riverFlow` im Hexfeld und an Nachbarn) und Fruchtbarkeit am Pfad; die Kacheln werden neu gezeichnet. `riverFlow`/`riverDir` sind veränderlich und werden mit dem Spielstand gespeichert.

### 7.3 Wild Fire

- Zündung: Hexfeld der Biome Forest, Jungle, Savanna (brennbar); Zielprüfer: Zielhexfeld brennbar.
- Ablauf in Wochen-Ticks: ein brennendes Hexfeld brennt **6 Wochen**; jede Woche entzündet es jeden brennbaren Nachbarn mit **15 %**; ein Hexfeld brennt nur einmal; höchstens **40 Hexfelder** je Brand.
- Während es brennt: Gefahr +0,3 (Gott-Schicht, exakter Rückbau), Einwohner −3 % je Woche. Ausgebrannt: **Holz 0**, Wild ×0,3, und das Biom wird **Plains** (Kapazität, `danger`, `moveCost` neu aus der Biomtabelle wie bei Biome Shift, 7.4); die Ressourcen wachsen normal nach. Straßen und Besitzer bleiben; **stehende Gebäude auf ausgebrannten Hexfeldern werden zu Ruinen** (bestehendes Ruinensystem `ruins`).
- Liste der brennenden Hexfelder (≤ 64 Einträge: Hexfeld, Restwochen); pro Tick nur diese Liste; eigenes Kartensymbol.

### 7.4 Biome Shift

- Ziel: Hexfeld-Mitte, Wirkung auf die 7 Hexfelder (Land). Meer, See, Eis und Hexfelder mit mystischem Sondervorkommen (`HolySpring`, `SacredGrove`, `Meteorite`, `AncientRuins`) bleiben; Zielprüfer: mindestens ein Hexfeld wechselt.
- **Wechselregel** (jedes Landhexfeld ein Schritt in der Kette, Richtung „wetter“ oder „trockener“ vom Spieler gewählt):

  `Desert ↔ Savanna ↔ Plains ↔ Forest ↔ Jungle ↔ Swamp`, `Tundra ↔ Plains`, `Hills ↔ Mountains`, `Hills ↔ Plains`.

  Wetter = in Richtung Swamp, trockener = in Richtung Desert; am Kettenende bleibt das Hexfeld.
- Danach neu aus der Biomtabelle: `resourceCapacity` (× `terrainVariation`), `danger`, `moveCost`; aktuelle Ressourcen wachsen über das normale Nachwachsen. `moisture`/`temperature`, Straßen, Gebäude, Besitzer und Bewohner bleiben; wer im neuen Biom nicht leben kann, wandert über die bestehenden Regeln ab. Kacheln neu gezeichnet.

### 7.5 Bauplatz-Modifikator (Wide Foundations, Cramped Ground)

- Neues Feld je Hexfeld `slotMod` (`Int8Array`, **keine Grenze**, wird mit dem Spielstand gespeichert). Die nutzbaren Siedlungsplätze eines Hexfelds (`usableSlots` in `economy.ts`) werden um `slotMod` verschoben (kein Deckel von 6, keine Grenze des Modifikators; die Slot-Arrays in `buildings.ts` müssen dafür mitwachsen können: Folgeaufgabe der Umsetzung) und liegen **nie unter den belegten** Plätzen (stehend, im Bau, Ruine, Reparatur). Cramped Ground ist ein **unzulässiges Ziel**, wenn alle Plätze des Hexfelds belegt sind.
- Folgen über bestehende Systeme: Kapazität für Gebäude, Stadtstufe (`cityTier` = benutzte Plätze im Verhältnis zu den nutzbaren), Bauentscheidung.

### 7.6 Teilwert „Divine“ der Zufriedenheit

Neuer Teilwert in der Zufriedenheit jeder Siedlung (`Requirement Zufriedenheit.md`, neben „Leader“ in der Hexfeld-Info): Summe der laufenden Gott-Wirkungen (Grateful Hearts +3, Restless Spirits −3) des Volks, eigene Grenze ±15 (vorläufig), unabhängig vom ±8-Deckel des Anführers. Wirkt auf den Zielwert; der Istwert folgt träge (25 % des Abstands je Jahr). Restless Spirits lange auf einem Volk kann Aufstände auslösen (bestehende Regeln).

### 7.7 Andacht und Prophet's Light/Doubt

- Der Glaubensschritt je Bewohner (`simulation.ts`, jährlich: Umfeld, Andacht, Vergessen) bekommt einen Summanden **`godDevotion[civ]`** (Float32 je Volk, +0,03 Light, −0,03 Doubt, 0 sonst; aus der Gott-Schicht).
- **Glaube ist Glaube an einen bestimmten Gott** (Spieler-Gott jetzt, Rivalen-Götter später): der Glaubenswert des Bewohners bezieht sich auf einen Gott. Der Summand `godDevotion` und der Einmalwert von **Light** gehören dem **wirkenden Gott**.
- **Light** hebt in **jedem Volk** den Glauben an den wirkenden Gott (auch in Völkern, die ihn noch nicht anbeten; der Summand überwiegt das Vergessen −0,005, solange der Effekt läuft).
- **Doubt (entschieden)** senkt in jedem Volk (auch im eigenen) den Glauben an **alle Götter**, nicht nur an den wirkenden (Faith sinkt, dem Spieler überlassen). Je Gott ein Summand; jetzt gibt es nur den Spieler-Gott.
- Einmalig zusätzlich: Glaubenswert aller Einwohner ±0,15 (auf 0..1 begrenzt), mit neuen Posten „Divine light“/„Divine doubt“ in der Glaubensbilanz (`faithYear`), damit sie aufgeht.
- Faith: Die so gewonnenen Gläubigen zählen in den Faith-Zufluss (Abschnitt 2).
- **Anbetung (entschieden):** Ein Volk **betet einen Gott an**, sobald **mindestens 55 % seiner Bevölkerung** an diesen Gott glauben (Glaubenswert ≥ 0,5, `BELIEVER_FAITH`), und **hört auf**, sobald der Anteil **unter 45 %** fällt (Hysterese gegen Flackern; dazwischen bleibt der bisherige Zustand). Das ersetzt das feste Ja/Nein `worshipsPlayer`: es wird je Volk und Gott abgeleitet (`worships(civ, god)`) und jährlich im Schritt des Volks neu berechnet (so oft wie die Zählung der Gläubigen); der Startstamm (75–100 % Gläubige) betet den Spieler von Anfang an an. Folgen, die bisher an `worshipsPlayer` hingen, hängen an `worships(civ, spieler)`: Andacht (0,02 × Kultur „Devout“ plus Hebel `devotion` des Anführers) statt Vergessen (−0,005). Im Kern wird `civ.worshipsPlayer` ein abgeleiteter Wert.

### 7.8 Eingriffe auf Anführer (aus `Requirement Anführer.md` §10 „Später“, jetzt Teil von 1.0)

- **Todesalter-Verschiebung** `ageShift` je Anführer (`Int8Array`, −10 / 0 / +10; mit dem Anführer zurückgesetzt, nicht vererbt): die Todeswahrscheinlichkeit (`Requirement Anführer.md` §2) rechnet mit „Alter + ageShift“. Long Life und Brittle Crown setzen ihn (ein neuer Einsatz ersetzt den alten).
- **Attribute:** Gift of Trait und Mark of Weakness ziehen **zufällig** (Ausschlusspaare und Zielverbote gelten auch für den Gott) und hängen ein Attribut an; die **Attribut-Slots sind nicht auf 3 begrenzt** (Slot-Array je Anführer größer, vorläufig 8 Plätze; ein Anführer mit allen verfügbaren Attributen bekommt nichts mehr: unzulässiges Ziel). Danach `recompute` des Hebelsatzes; die Summen-Deckel aus Anführer §3 (Zufriedenheit ±8, Kriegswurf ≤ 40 %, 2×-Schwelle ≥ 1,2×) bleiben.
- **Honed Mind:** Verstärker `honed` je Anführer (Index eines zufällig gewählten vorhandenen Attribut-Slots, 0 = keiner); `recompute` skaliert die Hebelabweichung dieses Attributs ×1,5 (additiv: Abweichung ×1,5; multiplikativ: Faktor^1,5). Endet mit dem Anführer.
- **Dynasty's Heir:** Flag `heirInherits` je Volk; beim Amtsantritt des nächsten Nachfolgers (`startLeader`) erbt dieser zu 100 % statt 50 % ein Attribut des Vorgängers (hat der Vorgänger keins, Zufall); das Flag wird dann gelöscht.
- **Young Heir:** Flag `youngHeir` je Volk; beim Amtsantritt des nächsten Nachfolgers (`startLeader`) ist das Alter 20 statt gleichverteilt 20–40; das Flag wird dann gelöscht.
- **Ziel:** Reroll Destiny ruft die Zielwahl (§6) neu auf; Ausgangswert und Fortschritt zurück. Das ist die **einzige** Ausnahme von „kein Zielwechsel“.
- Chronik: ein vom Gott gesetzter Wechsel bekommt einen stillen Eintrag mit „by the god“. Das Panel „Leader ›“ zeigt das Ergebnis ohne Änderung; das **Todesalter wird nicht angezeigt** (entschieden).

## 8. Anzeige

- **Faith-Anzeige:** oben auf dem Bildschirm eine kleine Anzeige „Faith 17,3 / 20“ (Stand / Preis der nächsten Ziehung) und ein Knopf „Gacha“, grün hervorgehoben, wenn eine Ziehung leistbar ist.
- **Gacha-Bildschirm:** Preis, Knopf „Pull (3)“, Aufdecken der 3 Ergebnisse nacheinander mit Seltenheitsfarbe (Common grau, Rare blau, Epic violett, Legendary gold). Nach der Ziehung bleiben die Ergebnisse sichtbar, bis der Spieler sie schließt.
- **Inventar:** Liste der Fähigkeiten mit Zahl der Ladungen, nach Kategorie (Land, Völker, Anführer) und Seltenheit; Antippen zeigt die Beschreibung mit Zahlen und den Knopf „Use“.
- **Zielwahl:** Land: Antippen eines Hexfelds mit Vorschau der betroffenen Fläche (Great River zeigt den Pfad, Biome Shift den Wahlknopf „wetter/trockener“), Bestätigen/Abbrechen. Volk/Anführer: Liste oder Antippen.
- **Karte:** brennende Hexfelder (Wild Fire) und Ruinen sichtbar, neue Flüsse und geänderte Biome erscheinen nach dem Einsatz in den Kacheln.
- Alle Texte Englisch.

## 9. Datenhaltung

- Spielerzustand (nicht Teil des Hexfeld-Zustands): `faith` (`Float64`), `pulls` (Anzahl bisheriger Ziehungen für den Preis, `Int32`), `charges` (`Int32Array`, 25 Einträge), Zufallsgenerator „gacha“.
- Gott-Schicht: Effektliste (Abschnitt 7.1), `godLev` (Volk × Hebel, `Float32Array`), `godDevotion` (je Volk), `ageShift`, `honed` (je Anführer), `heirInherits`, `youngHeir` (je Volk), `slotMod` (je Hexfeld), Feuerliste (Abschnitt 7.3), Zähler für den Teilwert „Divine“.
- Fähigkeitstabelle: `ABILITIES` mit Id, Name, Kategorie, Stufe, Zielart, Fläche, Dauer, Zielprüfer, Wirkung (eine reine Funktion je Fähigkeit im Kern, kein React). Kern und Zufall sind **portierbar** (flache Arrays, deterministisch pro Seed).
- Faith-Zufluss läuft **je Tick** im Kern; die Ziehung selbst ist ein Aufruf des Kerns (`pullGacha(sim)`), kein Zeitgeber der App.

## 10. Performance, Benchmark, Simulation

- Laufender Aufwand: Faith je Tick eine Multiplikation; Effektliste und Feuerliste klein (≤ 256 bzw. ≤ 64), ein Vergleich je Tick. Einmalige Eingriffe (Biome Shift, Great River, Fertile Blessing) berühren ≤ 37 Hexfelder bzw. ≤ 12 Pfadfelder.
- **Benchmark (Pflicht, `AGENTS.md`):** neues Szenario `gacha` (aged, mit Ladungen aller 25 Fähigkeiten, die der Setup auf verteilten Zielen einsetzt: Wild Fire in Wäldern, Great River, Biome Shift, Wide Foundations/Cramped Ground, Effekte aller Völker, brennende Hexfelder, neue Flüsse, viele Kacheln auf Neuzeichnen) und alle Szenarien bleiben grün. Die Karten-Kacheln werden bei Biom-, Fluss-, Ruinen- und Brandänderung neu gezeichnet; das darf auch während der Wischer keine Frames über 25 ms kosten (Neuzeichnen nur, wenn die Karte ruht, wie heute).
- **Simulation (`sim-analyst`, 12 Welten, 300 Jahre):**
  1. Eichung des Faith-Faktors und der Preiskurve: Ziehungen je Echtminute bei Geschwindigkeit 1 (Eichziel 5 min je Ziehung) und bei den höheren Stufen; Gläubigenzahl über die Zeit.
  2. Stufengewichte und Stufenzuordnung: Verteilung der Ziehungen, Wirkungsstärke je Fähigkeit (z. B. Wirkung auf Siedlungen, Kriege, Rebellionen, Handel bei Einsatz auf ein typisches Ziel), ob Common wirklich nützlich ist.
  3. Extremfälle: Einsatz **aller** Ladungen auf ein Volk (Gott-Schicht-Deckel), Doubt + Restless Spirits auf das eigene Volk (Spielende), Brittle Crown in Serie (Dynastie), Exhausted Soil und Cramped Ground auf die Hauptstadt.
  4. Dauern und Flächen (Abschnitt 12).
- Tool geplant: `tools/gachaStats.ts`.

## 11. Abhängigkeiten

- `Requirement Anführer.md`: §1, §4, §5, §9, §10 (Eingriff des Gottes jetzt in 1.0; Todesalter-Verschiebung, Attribut- und Zieleingriff, Teilwert „Leader“ bleibt auf ±8).
- `Requirement Zufriedenheit.md`: neuer Teilwert „Divine“ (7.6); Chronik-Einträge (stille Einsatz-Einträge).
- `Requirement Regionale Rohstoffe.md`: Ressourcenänderung, Sondervorkommen (Rich Vein), Bauplätze (Wide Foundations, Cramped Ground, §7.5), Ressourcen und Wasser (Fertile Blessing, Exhausted Soil, Drought, Great River).
- `Requirement Handel.md`, `Requirement Krieg.md`, `Requirement Diplomatie.md`: Hebel für Ernte/Handel (Golden Harvest), Siedeln (Wanderlust).
- Game Design (Abschnitte 1, 2, 7, 10, 12): Faith statt Einflusspunkte, Gacha-Regeln.
- Game Design Abschnitt 7: Glaubenswert und `faithYear` (Prophet's Light/Doubt).

## 12. Offene Punkte

Entschieden (Nutzer): Startvorrat 0; Wanderlust und Young Heir; keine Grenze für Bauplätze und Attribute; zufällige Attribute; Wild Fire macht Ruinen; Great River in einer Senke macht einen See; Todesalter nicht angezeigt; Doubt senkt den Glauben an alle Götter; Anbetung ab 55 % Gläubigen, Ende unter 45 % (7.7); überflutete Siedlung bei See (7.2). Noch offen:

- **Faktor und Preisformel** sind nur Startwerte (0,0005 je Gläubigem und Tick, 20 × 1,25^(n−1)); Eichung durch die Simulation.
- **Folgeaufgabe Bauplatz-Arrays** (7.5).
- **Honed Mind:** ×1,5 auf additive Abweichungen, Faktor^1,5 auf multiplikative.
- **Dauern** (10/15 Jahre) und **Flächen** (Radius 1–3) aller Fähigkeiten, die Stärken (±0,15 Glaube, ±3 Zufriedenheit, ±10 % Geburten, +15 % Ernte, ×1,25 Fruchtbarkeit, ×1,5 Honed Mind, ±1 Bauplatz, −0,25 Feuchtigkeit) und die Gott-Obergrenzen je Hebel (Abschnitt 7.1): alles vorläufig.
- **Stapelregel** (Abschnitt 5: Dauer-Effekt ersetzt den laufenden) und **Todesalter**-Stapelung (Empfehlung: ersetzen, nicht addieren).
- **Zeitraffer:** Faith läuft nach Spielzeit, bei 26/104 Ticks je Sekunde also 4-/17-mal schneller; Wirkung auf das Tempo der Partie und eine mögliche Sperre der Ziehung bei Pause prüfen.
- **Rivalen-Götter** (Game Design 8) später: dann auch Fähigkeiten auf fremde Götter.

## 13. Später (nicht in Version 1)

- Rivalen-Götter mit eigenem Faith und eigenen Ladungen.
- Handel mit Ladungen, Verschmelzen, Pity-System (bewusst ausgeschlossen).
- Weitere Fähigkeiten nach Kultureffekten (Seafarers' Whisper, sobald Kultur im Spiel etwas bewirkt) und Fähigkeiten auf Kriege und Verträge.
