# Requirement: Dynamische Biome und nachwachsende Ressourcen

Stand: **Entwurf, alle Regeln und Zahlen mit dem Nutzer entschieden** (Klimadrift, Rückkehr zum Klimax, Nachbardruck nur Richtung Klimax, gefestigtes Biom, Ökoton-Rand, Takt 5 Jahre, keine Abholzung, Nachwachsen, Siedlungs-Hexfelder, Gott-Fähigkeiten, Anzeige, Fixierung durch Biome Shift). **Die Zahlen sind entschieden** (Simulation `tools/biomeStats.ts`, 36 Welten × 500/1000 Jahre, Ergebnis in Abschnitt 11); Feintuning nur, falls die Umsetzung oder der Benchmark es erzwingt. Ablauf: Design → Simulation (erledigt) → Umsetzung. Spieltexte sind Englisch („Biome“, „Becoming Forest“).

Baut auf `Requirement Regionale Rohstoffe.md` (Kapazitäten, Versorgung, Gebäude), `Requirement Gacha.md` (Wild Fire, Biome Shift, Drought, Fertile Blessing, Exhausted Soil), `Requirement Speichern und Laden.md` und `Requirement Kartenmodi.md` auf. **Dieses Requirement überschreibt** `Requirement Gacha.md` §7.9 „Kein Nachwachsen“ und die Aussage „Drought stuft Biome nicht neu ein“ (siehe Abschnitt 12).

## 1. Ziel

Die Landschaft ist nicht mehr nach der Weltbildung eingefroren: Biome wandern langsam mit einem schwankenden Klima, Wälder wachsen nach, Brachland und Ruinen werden wieder grün, Übernutzung verändert das Land. Der Spieler sieht über Jahrhunderte, wie seine Völker und der Gott die Karte prägen. Eine vom Gott gesetzte Biomänderung bleibt dagegen bestehen (Abschnitt 8).

## 2. Ist-Stand (Kurzfassung)

- Das Biom wird einmal bei der Weltbildung aus Höhe, Temperatur und Feuchtigkeit bestimmt (`landBiome(elevation, temperature, moisture)` in `world/classify.ts`) und ändert sich nur durch die Gacha-Fähigkeiten Wild Fire (verbrannt → Plains), Biome Shift und Great River (Senke → Lake) über `setBiome` (`society/gacha.ts`).
- Ressourcen (`world.resources`, `world.resourceCapacity`, je Hexfeld: Fruchtbarkeit, Wild, Fisch, Holz, Stein, Erz) sind Bestandswerte, die die Ernte **nicht** verbraucht; sie sinken heute nur durch Exhausted Soil, Wild Fire und Biome Shift und kommen nicht zurück (Gacha §7.9).
- `moisture` ändert sich nur durch Drought (Gott-Schicht, mit Rückbau); `temperature` und `elevation` sind fest.

## 3. Grundregel: Klimadrift, Rückkehr zum Klimax, Nachbardruck

- **Klimadrift (neu):** jede Welt bekommt **6 weiche Klimaregionen** (Gauß-Blobs, Mittelpunkt zufällig je Seed, Radius ~10 Hexfelder). Jede schwingt **sinusförmig** mit eigener Periode **300 ± 100 Jahre** (je Region 200–400) und eigener Phase, Amplitude **±0,2 Feuchtigkeits-Offset** (Summe der Blobs normiert, also höchstens ±0,2 an einem Hexfeld). Der Offset je Hexfeld ist der **Drift-Offset**. Die Klimadrift ist die einzige Quelle natürlicher Veränderung des Klimax; Mittelpunkte, Radien, Perioden und Phasen leiten sich aus dem Seed ab (Abschnitt 10).
- **Klimax** eines Landhexfelds = `landBiome(elevation, temperature, moisture + Drift-Offset (+ Drought))`. Er folgt also Drift und Drought (Abschnitt 8) und wird beim Prüfen des Hexfelds neu berechnet.
- **Kette** (wie Biome Shift, Gacha §7.4): `Desert ↔ Savanna ↔ Plains ↔ Forest ↔ Jungle ↔ Swamp`; `Tundra ↔ Plains`; `Hills ↔ Plains`. Eine Änderung ist immer **ein Schritt** in der Kette.
- **Ökoton-Rand:** ein Hexfeld gilt nur dann als **abweichend vom Klimax**, wenn seine (effektive) Feuchtigkeit (mit Drift und Drought) um **mehr als 0,02** jenseits der Biomgrenze liegt. Knapp über der Grenze entsteht so kein Flackern.
- **Prüfung je Hexfeld** (entschieden):
  1. **Rückkehr zum Klimax:** weicht das Biom (nach Ökoton-Rand) vom Klimax ab, mit **25 %** je Prüfung ein Schritt zum Klimax.
  2. **Nachbardruck nur Richtung Klimax:** **8 %** je Prüfung, **nur wenn schon ein Nachbar das Biom hat, das einen Schritt näher am Klimax des Hexfelds liegt** (Fronten). **Kein Druck weg vom Klimax.**
  3. **Gefestigtes Biom:** jeder Land-Nachbar mit **demselben Biom** multipliziert die Wechselchance mit **(1 − 0,15)**.
  4. **Wasser in der Nähe** (Meer, See, **Fluss**): Schritte zu „wetter“ ×2. **Kein Desert direkt neben Wasser** (Meer, See; ein Schritt, der ein Desert-Hexfeld neben Wasser ergäbe, entfällt) **nur für Hexfelder, die bei der Weltbildung nicht Desert waren**.
- **Takt:** rotierende Prüfung, **jedes Hexfeld alle 5 Jahre** (1/5 der Landhexfelder je Jahr, z. B. Hexfeld-Index mod 5 = Jahr mod 5, über die 52 Ticks verteilt, damit kein Tick mehr als einige Hexfelder prüft). Gemessen (Abschnitt 11) wechseln dabei **~0,22 % der Landhexfelder je Jahr**.
- Ein Wechsel setzt über `setBiome` (bestehend): Kapazität (× `terrainVariation`), `danger`, `moveCost` neu aus der Biomtabelle. `moisture`/`temperature`, Straßen, Gebäude, Besitzer und Bewohner bleiben.

## 4. Welche Biome sich ändern

| Verhalten | Biome |
|---|---|
| ändern sich | Plains, Forest, Savanna, Desert, Jungle, Swamp, Tundra, Hills |
| fest | Mountains, Ice, Meer, See (Lake) und Hexfelder mit mystischem Sondervorkommen (`HolySpring`, `SacredGrove`, `Meteorite`, `AncientRuins`) |

Fest heißt: das Hexfeld wechselt nicht, zählt aber als Nachbar für den Druck der Nachbarn. Wild Fire: ein verbranntes Hexfeld wird Plains (Gacha §7.3) und kehrt über die Rückkehr zum Klimax nach und nach zu Forest zurück, wo der Klimax Forest ist.

## 5. Ressourcen wachsen nach (entschieden)

- **Entschieden:** Ressourcen wachsen im selben Update **nach**: **2 % der Lücke zur Kapazität je Jahr** (Startwert). Das heilt auch Wild-Fire-Holzverlust und Exhausted Soil. (Entschieden, auch Rate **2 %/Jahr** für Fruchtbarkeit, Wild, Fisch, Holz.) Die **Kapazität folgt dem neuen Biom** (Abschnitt 3): bei einem Biomwechsel gilt sofort die neue Kapazität; der Bestand wächst oder sinkt mit derselben Rate dorthin (**kein Sprung**, ein Bestand über der neuen Kapazität sinkt mit 2 % der Lücke je Jahr), damit ein Biomwechsel die Versorgung nicht von einem Jahr aufs andere bricht.
- **Entschieden: Welche Ressourcen wachsen nach?** **Fruchtbarkeit, Wild, Fisch, Holz** (erneuerbar). **Stein und Erz nicht** (nicht erneuerbar; eine Exhausted-Soil-Wirkung auf Stein/Erz bleibt dauerhaft). **Sondervorkommen** (`deposit`, auch mystische) sind keine Ressourcen und bleiben unverändert.
- **Entschieden: Rate.** Einheitlich 2 % der Lücke je Jahr für alle nachwachsenden Ressourcen (Lücke halbiert sich in ~35 Jahren); Startwert, die Simulation kann je Ressource trennen.
- **Entschieden: keine Sperre bei Ernte.** Die Ernte verbraucht den Bestand heute nicht (Abschnitt 2); das Nachwachsen läuft immer.

- Technik: das Nachwachsen läuft in derselben rotierenden Prüfung wie die Biome (Abschnitt 3), mit dem Wert für 5 Jahre in einem Schritt (Lücke × (1 − 0,98^5) ≈ 9,6 %), damit es keinen eigenen Durchlauf über alle Hexfelder je Tick gibt.

## 6. Einflüsse der Zivilisation (Version 1)

Die Einflüsse wirken auf bewohnte und genutzte Hexfelder und gehen in die Prüfung aus Abschnitt 3 ein (entschieden):

| Einfluss | Auslöser | Wirkung |
|---|---|---|
| Überweidung | Fruchtbarkeit < 20 % der Kapazität seit **10 oder mehr Jahren** | ein Schritt trockener (Plains → Savanna → Desert), dann Zähler zurück |
| Bewässerung | Felder oder Brunnen auf Savanna/Desert neben Wasser | die Rückkehr zählt als „wetter“-Schritt (Wasser-Faktor ×2 aus Abschnitt 3 gilt auch ohne Wasser am Hexfeld), höchstens bis Plains |
| Ruinen, aufgegebenes Land | Hexfeld mit Ruine oder verlassene, einst besiedelte Fläche | Rückkehr zum Klimax ×3 (25 % × 3, begrenzt auf 100 %) |

- **Abholzung entfällt vollständig** (entschieden, Simulation): Holzfällerlager und Sägewerk verändern das Biom nicht und sperren keine Rückkehr. Holz wächst über das Nachwachsen (Abschnitt 5) nach.
- **Überweidung in Version 1 nur über Exhausted Soil** (selten, keine neue Regel). Die Ernte senkt die Fruchtbarkeit nicht (Abschnitt 2), und das Nachwachsen (2 %/Jahr) hebt sie nach Exhausted Soil in rund 6 Jahren über 20 %; der Einfluss greift also nur, wo Exhausted Soil die Fruchtbarkeit unter 20 % hält (z. B. wiederholt eingesetzt). Eine ernteabhängige Bodenerschöpfung ist eine neue Spielregel und wird später mit dem Nutzer abgestimmt.
- Die Einflüsse gelten für Prüfchancen aus Abschnitt 3 (25 %, 8 %, Faktoren); Siedlungs-Hexfelder siehe Abschnitt 7.

## 7. Siedlungs-Hexfelder (entschieden)

- **Entschieden:** Hexfelder mit Siedlung sind **nicht ausgenommen**; sie wechseln mit **halber Chance** (die Chance aus Abschnitt 3 und 6 ×0,5). Folge ist **Abwanderung** über die bestehenden Regeln (Versorgung und Platz neu aus dem neuen Biom).
- **Entschieden: Abwanderung ohne neue Regel.** Die bestehende Versorgung, Bauplätze und Wanderung (`supply.ts`, `simulation.ts`) reagieren auf die neue Kapazität und lassen die Bewohner abwandern; der Rückgang des Bestands (Abschnitt 5) verhindert einen Sprung. Eine Pauschale gibt es nicht.
- **Entschieden: nur biomgebundene Gebäude werden zu Ruinen** (Holzfällerlager und Sägewerk, wenn das Hexfeld nicht mehr Forest/Jungle ist; Steinbruch und Steinmetz, wenn es nicht mehr Hills/Mountains ist; Regeln aus `Requirement Regionale Rohstoffe.md` §3 „Baubeschränkung“), über das bestehende Ruinensystem (`ruins`, wie bei Wild Fire). Alle anderen Gebäude bleiben stehen.
- Ein Wechsel auf einem bewohnten Hexfeld bekommt einen stillen Chronik-Eintrag (Abschnitt 9).

## 8. Gott-Fähigkeiten

- **Biome Shift (fest gesetzt, entschieden):** das vom Gott gesetzte Biom bleibt **dauerhaft**, bis der Spieler es erneut ändert. Dafür bekommt jedes Hexfeld ein Flag **`pinned`** („vom Gott gesetzt“). Natürliche Übergänge (Abschnitt 3) überspringen ein fixiertes Hexfeld. Ein erneuter Biome Shift auf dem Hexfeld setzt weiter und bleibt fixiert; eine Fixierung hat kein Ablaufdatum und es gibt keine Aufhebung außer durch einen weiteren Einsatz (der es neu fixiert).
- **Einflüsse der Zivilisation auf fixierte Hexfelder (entschieden):** **übersprungen**, fixiert heißt voll fixiert (Überweidung, Bewässerung, Ruinen wirken nicht auf das Biom). **Das Nachwachsen der Ressourcen (Abschnitt 5) läuft auch auf fixierten Hexfeldern**, gegen die Kapazität des fixierten Bioms. Fixierte Hexfelder zählen weiter als Nachbarn für den Druck.
- **Wild Fire:** das verbrannte Hexfeld wird Plains, ist **nicht fixiert**, und Holz wächst mit dem Nachwachsen wieder (Gacha §7.3 geändert); Plains kehrt dort, wo der Klimax Forest ist, über die Rückkehr zu Forest zurück. Gebäude auf dem Hexfeld werden wie bisher zu Ruinen.
- **Drought:** `moisture` −0,25 für 20 Jahre bleibt (Gott-Schicht mit Rückbau). Der Klimax folgt `moisture` + Drift-Offset + Drought und **verschiebt sich trockener**: Hexfelder im Radius 3 wandern in den 20 Jahren über die natürliche Rückkehr (Abschnitt 3) zum trockeneren Klimax; nach Ende der Wirkung kehrt der Klimax zurück und sie wandern wieder zurück. (Überschreibt „Biome werden nicht neu eingestuft“.)
- **Fertile Blessing:** zusätzlich die **Rückkehr zum Klimax ×2** in Richtung „grün“, solange die Wirkung läuft (20 Jahre, Radius 1); „grün“ = Richtung Forest (also von Desert/Savanna/Plains aus; kein Schritt über den Klimax hinaus). Fruchtbarkeit und Kapazität wirken wie bisher.
- **Exhausted Soil:** die Verluste sind nicht mehr dauerhaft, sondern wachsen nach (Abschnitt 5; Stein und Erz bleiben verloren).
- **Great River:** der See bleibt fest (Wasser); „Wasser in der Nähe“ wird aus dem Zustand gelesen (Meer, See, Fluss, also auch neue Flüsse), `moisture` bleibt unverändert.

## 9. Anzeige

- **Hexfeld-Panel:** neue Zeile **„Biome“** mit dem aktuellen Biom und, falls ein Übergang ansteht, dem Trend („Becoming Forest“); bei fixiertem Hexfeld ein Hinweis („Set by the god“) statt Trend. Der Trend ist das Biom, auf das die nächste Rückkehr hinführen würde (Klimax-Schritt), nicht eine Vorhersage des Zeitpunkts.
- **Chronik:** stille Einträge (kein Pausieren, kein Dialog, `important` false) **nur für große Änderungen**: Wechsel auf einem bewohnten Hexfeld, Beginn und Ende einer Drought-Wirkung auf Siedlungen, Biomwechsel mit der Folge Ruinen. Reine Wildnis-Wechsel bleiben ohne Eintrag.
- **Karte:** **kein Marker.** Die Kachel wird neu gezeichnet; das geschieht wie bei Gacha-Landänderungen **nur, wenn die Karte ruht** (bestehendes Signal für Landänderungen und Kachel-Signatur, `Requirement Gacha.md` §10, `Requirement Kartenmodi.md` §8). Die Übersicht bleibt bei 1 s Ruhe.
- Kartenmodi (Fertility, Supply, Deposits) lesen die Werte wie bisher; sie ändern sich mit Biom und Nachwachsen im nächsten Snapshot (kein neuer Modus).

## 10. Datenhaltung

- Neue Zustandsfelder je Hexfeld (flache Typed Arrays, im Kern, portierbar): **`pinned`** (`Uint8Array`, vom Gott gesetzt), **`climax`** (`Uint8Array`, Biom-Id; zwischengespeichert, beim Prüfen neu berechnet), **`trend`** (`Uint8Array`, Ziel-Biom-Id oder 0; für das Panel), **`grazeYears`** (`Uint8Array`, Jahre mit Fruchtbarkeit < 20 %, Abschnitt 6).
- **Speichern/Laden** (`Requirement Speichern und Laden.md`): `pinned` und `grazeYears` sind Spielzustand und **müssen gespeichert werden**; `climax` und `trend` sind Zwischenwerte, die der generische Spielstand mit dem Zustand mitnimmt (entschieden: speichern, damit der geladene Stand bitgleich weiterläuft, ohne dass die Prüfung neu rechnen muss). Alle neuen Felder gehören in den Spielstand, **`SAVE_VERSION` wird erhöht**, `saveSchema.txt` neu geschrieben (`UPDATE_SAVE_SCHEMA=1 npm test`). Test: ein gespeicherter und geladener Stand läuft mit dynamischen Biomen bitgleich weiter (`save.test.ts`, gealtert).
- Eigener Zufallsgenerator „biome“ für Prüfungen (deterministisch je Seed, mitgespeichert), damit die Reihenfolge der Würfe der anderen Systeme nicht verschoben wird.
- Die rotierende Prüfung richtet sich nach Jahr und Tick (kein eigener Zähler).
- **Klimadrift: nicht speichern, aus dem Seed ableiten** (Mittelpunkte, Radien, Perioden, Phasen der 6 Regionen; der Drift-Offset ist eine reine Funktion von Seed und Spieljahr). Der Spielstand bleibt dadurch klein und bitgleich. Dafür darf die Ableitung keinen gemeinsamen Zufallsgenerator der Weltbildung verschieben (eigener Strom aus dem Seed). `Requirement Speichern und Laden.md` braucht deshalb keine Änderung über die bereits genannten Felder hinaus.

## 11. Performance, Benchmark, Simulation

- **Laufender Aufwand:** je Jahr 1/5 der Landhexfelder (bei 46 × 44 rund 400 Hexfelder), verteilt über 52 Ticks, also wenige Hexfelder je Tick; ein Wechsel ruft `setBiome` auf (bestehend). Der Drift-Offset je Hexfeld wird beim Prüfen berechnet (6 Blobs), kein eigener Durchlauf.
- **Karte:** Neuzeichnung der Kacheln nur bei ruhender Karte (Abschnitt 9); jedes geänderte Hexfeld erhöht den Landzähler (`gacha.landTotal`/`landChanges` oder ein gleichwertiges Signal der Umsetzung).
- **Benchmark (Pflicht, `AGENTS.md`):** alle Szenarien laufen mit dynamischen Biomen und müssen grün bleiben (`aged` usw. altern 300 Jahre, mit Wechseln). Entschieden: **kein neues Szenario**, sondern ein Hook im Szenario `gacha`, der zusätzlich die natürliche Prüfung beschleunigt (alle Hexfelder alle 5 Ticks), damit die Kachel-Neuzeichnung bei Biomwechseln unter Last gemessen wird (**bleibt**).
- **Simulation (erledigt, `tools/biomeStats.ts`, 36 Welten × 500/1000 Jahre) und Ergebnis als Grundlage der Zahlen:**
  - **~0,22 %** der Landhexfelder wechseln je Jahr.
  - **3,7 %** Rückwechsel (Flackern) innerhalb von 50 Jahren.
  - Ein Zustand hält im Mittel **~66 Jahre**.
  - **62 %** der Wechsel geschehen als **Fronten** (Nachbardruck Richtung Klimax).
  - Biomanteile schwingen über 1000 Jahre mit **3–4,5 %** um den Start; Desert **11,1 %** gegen 12,8 % am Start.
  - Wirtschaft (Wachstum, Handel) **im Rauschen**; Holz je Siedlung rund **10 % niedriger**.
- **Noch offen für die Umsetzung (kein Spielregel-Punkt):** Tests (`society/biomes.test.ts`, `save.test.ts`) und der Benchmark-Hook.
- Tool: `tools/biomeStats.ts` (vorhanden).

## 12. Überschriebene und betroffene Regeln

- `Requirement Gacha.md`: §6.1 (Nr. 1, 2, 5, 8, 9), §7.3, §7.4, §7.9, §9, §11, §12, §13.
- `Requirement Regionale Rohstoffe.md`: neuer Abschnitt 12 (Ressourcen wachsen nach, Kapazität folgt dem Biom).
- `Requirement Speichern und Laden.md`: §2, §8 (neue Felder, `SAVE_VERSION`).
- `Requirement Kartenmodi.md`: §8, §10 (Datenquellen ändern sich im Spiel; kein neuer Modus).
- Unverändert, aber betroffen: `Requirement Zufriedenheit.md` (Abwanderung aus Siedlungen mit Biomwechsel verändert die Zufriedenheit nur über die bestehenden Regeln), `Requirement Handel.md` (Warenvorkommen folgen der Versorgung).

## 13. Entschiedene Punkte (früher offen)

- Nachwachsen: Fruchtbarkeit, Wild, Fisch, Holz; Stein, Erz und Sondervorkommen nicht; 2 % der Lücke je Jahr einheitlich; keine Sperre bei Ernte; Bestand über neuer Kapazität sinkt mit derselben Rate.
- Siedlungs-Hexfelder: keine neue Abwanderungsregel; nur biomgebundene Gebäude werden Ruinen.
- Überweidung in Version 1 nur über Exhausted Soil; eine ernteabhängige Bodenerschöpfung wäre eine neue Spielregel und kommt später (nach Abstimmung).
- Fixierte Hexfelder: Zivilisationseinflüsse überspringen sie, das Nachwachsen läuft weiter.
- Fluss zählt als „Wasser in der Nähe“; kein Desert direkt neben Meer oder See.
- Zahlen entschieden (Simulation): Klimadrift 6 Regionen, Periode 300 ± 100 Jahre, Amplitude ±0,2; Rückkehr 25 %; Nachbardruck 8 % nur Richtung Klimax; gefestigtes Biom ×(1 − 0,15) je gleichem Land-Nachbar; Ökoton-Rand 0,02; Takt 5 Jahre; Ruinen ×3.
- Abholzung entfällt; die Klimadrift wird nicht gespeichert, sondern aus dem Seed abgeleitet.
- Kein Desert neben Wasser nur für Hexfelder, die bei der Weltbildung nicht Desert waren.
- Benchmark: kein neues Szenario; der `gacha`-Hook beschleunigt die natürliche Prüfung (alle Hexfelder alle 5 Ticks).
- `climax` und `trend` werden mitgespeichert.
