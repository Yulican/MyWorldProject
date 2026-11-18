# Requirement: Dynamische Biome und nachwachsende Ressourcen

Stand: **Entwurf, alle Regeln mit dem Nutzer entschieden, keine offenen Punkte** (Klimax-Rückkehr mit Nachbardruck ±1, Takt, betroffene Biome, Zivilisationseinflüsse v1, Nachwachsen, Siedlungs-Hexfelder, Gott-Fähigkeiten, Anzeige, Fixierung durch Biome Shift). **Alle Zahlen sind Startwerte**, bis die Simulation (`sim-analyst`, 12 Welten, 300 Jahre) sie bestätigt hat. Ablauf: Design → Simulation → Umsetzung. Spieltexte sind Englisch („Biome“, „Becoming Forest“).

Baut auf `Requirement Regionale Rohstoffe.md` (Kapazitäten, Versorgung, Gebäude), `Requirement Gacha.md` (Wild Fire, Biome Shift, Drought, Fertile Blessing, Exhausted Soil), `Requirement Speichern und Laden.md` und `Requirement Kartenmodi.md` auf. **Dieses Requirement überschreibt** `Requirement Gacha.md` §7.9 „Kein Nachwachsen“ und die Aussage „Drought stuft Biome nicht neu ein“ (siehe Abschnitt 12).

## 1. Ziel

Die Landschaft ist nicht mehr nach der Weltbildung eingefroren: Biome wandern langsam, Wälder wachsen nach, Brachland und Ruinen werden wieder grün, Übernutzung und Abholzung verändern das Land. Der Spieler sieht über Jahrhunderte, wie seine Völker und der Gott die Karte prägen. Eine vom Gott gesetzte Biomänderung bleibt dagegen bestehen (Abschnitt 8).

## 2. Ist-Stand (Kurzfassung)

- Das Biom wird einmal bei der Weltbildung aus Höhe, Temperatur und Feuchtigkeit bestimmt (`landBiome(elevation, temperature, moisture)` in `world/classify.ts`) und ändert sich nur durch die Gacha-Fähigkeiten Wild Fire (verbrannt → Plains), Biome Shift und Great River (Senke → Lake) über `setBiome` (`society/gacha.ts`).
- Ressourcen (`world.resources`, `world.resourceCapacity`, je Hexfeld: Fruchtbarkeit, Wild, Fisch, Holz, Stein, Erz) sind Bestandswerte, die die Ernte **nicht** verbraucht; sie sinken heute nur durch Exhausted Soil, Wild Fire und Biome Shift und kommen nicht zurück (Gacha §7.9).
- `moisture` ändert sich nur durch Drought (Gott-Schicht, mit Rückbau); `temperature` und `elevation` sind fest.

## 3. Grundregel: Rückkehr zum Klimax mit Nachbardruck

- **Klimax** eines Landhexfelds = `landBiome(elevation, temperature, aktuelle moisture)`. Er folgt also einer Drought mit (Abschnitt 8) und wird beim Prüfen des Hexfelds neu berechnet.
- **Kette** (wie Biome Shift, Gacha §7.4): `Desert ↔ Savanna ↔ Plains ↔ Forest ↔ Jungle ↔ Swamp`; `Tundra ↔ Plains`; `Hills ↔ Plains`. Eine Änderung ist immer **ein Schritt** in der Kette.
- **Prüfung je Hexfeld** (Startwerte):
  1. **Rückkehr:** weicht das Biom vom Klimax ab, mit **~4 %** je Prüfung ein Schritt zum Klimax.
  2. **Nachbardruck:** je Nachbar (6 Hexfelder) mit anderem Biom **~+1 %** Chance auf einen Schritt in Richtung dieses Nachbarbioms, aber das Ergebnis muss **innerhalb Klimax ±1 Schritt** liegen (kein Wandern über den Klimax-Korridor hinaus).
  3. **Wasser in der Nähe** (Meer, See, **Fluss**): Schritte „wetter“ ×2. **Kein Desert direkt neben Wasser** (Meer, See; ein Schritt, der ein Desert-Hexfeld neben Wasser ergäbe, entfällt).
- **Takt:** rotierende Prüfung, je Jahr **1/10 der Landhexfelder** (z. B. Hexfeld-Index mod 10 = Jahr mod 10, über die 52 Ticks verteilt, damit kein Tick mehr als einige Hexfelder prüft). Das ergibt grob **~0,3 % der Landhexfelder je Jahr**, die wechseln (Messgröße der Simulation, Abschnitt 11).
- Ein Wechsel setzt über `setBiome` (bestehend): Kapazität (× `terrainVariation`), `danger`, `moveCost` neu aus der Biomtabelle. `moisture`/`temperature`, Straßen, Gebäude, Besitzer und Bewohner bleiben.

## 4. Welche Biome sich ändern

| Verhalten | Biome |
|---|---|
| ändern sich | Plains, Forest, Savanna, Desert, Jungle, Swamp, Tundra, Hills |
| fest | Mountains, Ice, Meer, See (Lake) und Hexfelder mit mystischem Sondervorkommen (`HolySpring`, `SacredGrove`, `Meteorite`, `AncientRuins`) |

Fest heißt: das Hexfeld wechselt nicht, zählt aber als Nachbar für den Druck der Nachbarn. Wild Fire: ein verbranntes Hexfeld wird Plains (Gacha §7.3) und kehrt über den Klimax („Rückkehr“) nach und nach zu Forest zurück, wo der Klimax Forest ist.

## 5. Ressourcen wachsen nach (entschieden)

- **Entschieden:** Ressourcen wachsen im selben Update **nach**: **2 % der Lücke zur Kapazität je Jahr** (Startwert). Das heilt auch Wild-Fire-Holzverlust und Exhausted Soil. Die **Kapazität folgt dem neuen Biom** (Abschnitt 3): bei einem Biomwechsel gilt sofort die neue Kapazität; der Bestand wächst oder sinkt mit derselben Rate dorthin (**kein Sprung**, ein Bestand über der neuen Kapazität sinkt mit 2 % der Lücke je Jahr), damit ein Biomwechsel die Versorgung nicht von einem Jahr aufs andere bricht.
- **Entschieden: Welche Ressourcen wachsen nach?** **Fruchtbarkeit, Wild, Fisch, Holz** (erneuerbar). **Stein und Erz nicht** (nicht erneuerbar; eine Exhausted-Soil-Wirkung auf Stein/Erz bleibt dauerhaft). **Sondervorkommen** (`deposit`, auch mystische) sind keine Ressourcen und bleiben unverändert.
- **Entschieden: Rate.** Einheitlich 2 % der Lücke je Jahr für alle nachwachsenden Ressourcen (Lücke halbiert sich in ~35 Jahren); Startwert, die Simulation kann je Ressource trennen.
- **Entschieden: keine Sperre bei Ernte.** Die Ernte verbraucht den Bestand heute nicht (Abschnitt 2); das Nachwachsen läuft immer.

- Technik: das Nachwachsen läuft in derselben rotierenden Prüfung wie die Biome (Abschnitt 3), mit dem Wert für 10 Jahre in einem Schritt (Lücke × (1 − 0,98^10) ≈ 18 %), damit es keinen eigenen Durchlauf über alle Hexfelder je Tick gibt.

## 6. Einflüsse der Zivilisation (Version 1)

Die vier Einflüsse wirken auf bewohnte und genutzte Hexfelder und gehen als Schubs in die Prüfung aus Abschnitt 3 ein (alle Zahlen Startwerte, Vorschlag):

| Einfluss | Auslöser | Wirkung (Vorschlag) |
|---|---|---|
| Abholzung | Holzfällerlager oder Sägewerk steht auf einem Forest- oder Jungle-Hexfeld | je Prüfung ~+3 % auf einen Schritt Forest → Plains (Jungle → Forest); solange sie stehen, keine Rückkehr zu Forest/Jungle |
| Überweidung | Fruchtbarkeit < 20 % der Kapazität seit **10 oder mehr Jahren** | ein Schritt trockener (Plains → Savanna → Desert), dann Zähler zurück |
| Bewässerung | Felder oder Brunnen auf Savanna/Desert neben Wasser | die Rückkehr zählt als „wetter“-Schritt (Wasser-Faktor ×2 aus Abschnitt 3 gilt auch ohne Wasser am Hexfeld), höchstens bis Plains |
| Ruinen, aufgegebenes Land | Hexfeld mit Ruine oder verlassene, einst besiedelte Fläche | Rückkehr zum Klimax ×3 (~12 % je Prüfung) |

- **Entschieden: Überweidung in Version 1 nur über Exhausted Soil** (selten, keine neue Regel). Die Ernte senkt die Fruchtbarkeit nicht (Abschnitt 2), und das Nachwachsen (2 %/Jahr) hebt sie nach Exhausted Soil in rund 6 Jahren über 20 %; der Einfluss greift also nur, wo Exhausted Soil die Fruchtbarkeit unter 20 % hält (z. B. wiederholt eingesetzt). Eine ernteabhängige Bodenerschöpfung ist eine neue Spielregel und wird später mit dem Nutzer abgestimmt.
- **Entschieden:** Stärken (+3 %, ×3, Wasser-Faktor der Bewässerung) und Prüfchancen (4 %, +1 %, ×2) sind Startwerte, in der Simulation einzustellen.

## 7. Siedlungs-Hexfelder (entschieden)

- **Entschieden:** Hexfelder mit Siedlung sind **nicht ausgenommen**; sie wechseln mit **halber Chance** (die Chance aus Abschnitt 3 und 6 ×0,5). Folge ist **Abwanderung** über die bestehenden Regeln (Versorgung und Platz neu aus dem neuen Biom).
- **Entschieden: Abwanderung ohne neue Regel.** Die bestehende Versorgung, Bauplätze und Wanderung (`supply.ts`, `simulation.ts`) reagieren auf die neue Kapazität und lassen die Bewohner abwandern; der Rückgang des Bestands (Abschnitt 5) verhindert einen Sprung. Eine Pauschale gibt es nicht.
- **Entschieden: nur biomgebundene Gebäude werden zu Ruinen** (Holzfällerlager und Sägewerk, wenn das Hexfeld nicht mehr Forest/Jungle ist; Steinbruch und Steinmetz, wenn es nicht mehr Hills/Mountains ist; Regeln aus `Requirement Regionale Rohstoffe.md` §3 „Baubeschränkung“), über das bestehende Ruinensystem (`ruins`, wie bei Wild Fire). Alle anderen Gebäude bleiben stehen.
- Ein Wechsel auf einem bewohnten Hexfeld bekommt einen stillen Chronik-Eintrag (Abschnitt 9).

## 8. Gott-Fähigkeiten

- **Biome Shift (fest gesetzt, entschieden):** das vom Gott gesetzte Biom bleibt **dauerhaft**, bis der Spieler es erneut ändert. Dafür bekommt jedes Hexfeld ein Flag **`pinned`** („vom Gott gesetzt“). Natürliche Übergänge (Abschnitt 3) überspringen ein fixiertes Hexfeld. Ein erneuter Biome Shift auf dem Hexfeld setzt weiter und bleibt fixiert; eine Fixierung hat kein Ablaufdatum und es gibt keine Aufhebung außer durch einen weiteren Einsatz (der es neu fixiert).
- **Einflüsse der Zivilisation auf fixierte Hexfelder (entschieden):** **übersprungen**, fixiert heißt voll fixiert (Abholzung, Überweidung, Bewässerung, Ruinen wirken nicht auf das Biom). **Das Nachwachsen der Ressourcen (Abschnitt 5) läuft auch auf fixierten Hexfeldern**, gegen die Kapazität des fixierten Bioms. Fixierte Hexfelder zählen weiter als Nachbarn für den Druck.
- **Wild Fire:** das verbrannte Hexfeld wird Plains, ist **nicht fixiert**, und Holz wächst mit dem Nachwachsen wieder (Gacha §7.3 geändert); Plains kehrt dort, wo der Klimax Forest ist, über die Rückkehr zu Forest zurück. Gebäude auf dem Hexfeld werden wie bisher zu Ruinen.
- **Drought:** `moisture` −0,25 für 20 Jahre bleibt (Gott-Schicht mit Rückbau). Der Klimax folgt der aktuellen `moisture` und **verschiebt sich trockener**: Hexfelder im Radius 3 wandern in den 20 Jahren über die natürliche Rückkehr (Abschnitt 3) zum trockeneren Klimax; nach Ende der Wirkung kehrt der Klimax zurück und sie wandern wieder zurück. (Überschreibt „Biome werden nicht neu eingestuft“.)
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

## 11. Performance, Benchmark, Simulation

- **Laufender Aufwand:** je Jahr 1/10 der Landhexfelder (bei 46 × 44 rund 200 Hexfelder), verteilt über 52 Ticks, also wenige Hexfelder je Tick; ein Wechsel ruft `setBiome` auf (bestehend).
- **Karte:** Neuzeichnung der Kacheln nur bei ruhender Karte (Abschnitt 9); jedes geänderte Hexfeld erhöht den Landzähler (`gacha.landTotal`/`landChanges` oder ein gleichwertiges Signal der Umsetzung).
- **Benchmark (Pflicht, `AGENTS.md`):** alle Szenarien laufen mit dynamischen Biomen und müssen grün bleiben (`aged` usw. altern 300 Jahre, mit Wechseln). Entschieden: **kein neues Szenario**, sondern ein Hook im Szenario `gacha`, der zusätzlich die natürliche Prüfung beschleunigt (alle Hexfelder alle 5 Ticks), damit die Kachel-Neuzeichnung bei Biomwechseln unter Last gemessen wird.
- **Simulation (`sim-analyst`, 12 Welten, 300 Jahre, vorher/nachher mit statischen Biomen):**
  1. Biomverteilung über die Zeit (Anteil je Biom), Wechsel je Jahr (Ziel ~0,3 % der Landhexfelder), Hin-und-Her-Wechsel (Flackern) und Stabilität des Klimax-Korridors.
  2. Wirkung auf Siedlungswachstum, Versorgung, Abwanderung, Städte und Handel; Siedlungs-Hexfelder mit halber Chance (Abschnitt 7).
  3. Nachwachsen: Erholung von Wild Fire und Exhausted Soil in Jahren; Auswirkung auf Holzvorräte und Wirtschaft.
  4. Zivilisationseinflüsse einzeln (Abholzung, Bewässerung, Ruinen) und Überweidung (Abschnitt 6).
- Tool: `tools/biomeStats.ts` (geplant).

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
- Stärken der Einflüsse und Prüfchancen: Startwerte bis zur Simulation.
- Benchmark: kein neues Szenario; der `gacha`-Hook beschleunigt die natürliche Prüfung (alle Hexfelder alle 5 Ticks).
- `climax` und `trend` werden mitgespeichert.
