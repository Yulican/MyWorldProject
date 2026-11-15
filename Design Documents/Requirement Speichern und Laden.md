# Requirement: Speichern und Laden

Stand: mit dem Nutzer abgestimmt (alle Entscheidungen eingearbeitet); keine offenen Punkte.
Grundlage: Diskussion mit dem Nutzer. Betrifft alle Teilsysteme, die Zustand halten (Gesellschaft, Handel, Diplomatie, Regierung,
Anführer, Krieg, Gacha; siehe Abschnitt 8). Es gibt noch keine Zahlen aus der Simulation; alle Zeiten sind Startwerte.

## 1. Ziel

Der Spieler setzt seine Welt nach dem Schließen der App genau dort fort, wo er aufgehört hat. Es gibt genau einen Spielstand.
Die Welt läuft nach dem Laden so weiter, wie sie ohne Unterbrechung weitergelaufen wäre.

## 2. Spielstand

- Genau **ein Speicherplatz** („Spielstand“). Manuelles Speichern und Autospeichern schreiben denselben Platz.
- Manuelles Speichern („Save“) überschreibt den Spielstand ohne Rückfrage. Rückfragen gibt es beim Laden, bei „New World“ und vor dem ersten Autospeichern einer neuen Welt (Abschnitt 4).
- Inhalt: der **vollständige Simulationszustand** einschließlich des Zufallsgenerator-Zustands (alle benannten Generatoren, z. B. Welt,
  Anführer, Gacha), damit eine geladene Welt **deterministisch** exakt weiterläuft wie die gespeicherte (gleiche Folge von Ereignissen).
- Außerdem: die **Spielgeschwindigkeit** (Einstellung) und der **Zustand des Gottes** (Faith, Inventar an Ladungen/Fähigkeiten,
  laufende Effekte der Götterebene mit ihrer Restdauer).
- **Kartenmodus (`Requirement Kartenmodi.md`):** Der aktive Kartenmodus (mit Untermodus) und das ausgewählte Volk (Diplomacy/War) werden im Text-Trailer der App gespeichert (nicht im Simulationszustand) und beim Laden wiederhergestellt; fehlt das Feld, gilt „Political“.
- Nicht gespeichert: reine Anzeige (Kartenposition, Zoom, offene Panels, Auswahl, Ziel-Modus eines Gacha-Einsatzes). Beim Laden startet die
  Karte in der Standardansicht.
- Chronik-Meldungen, die noch auf Bestätigung warten, gehören zum Simulationszustand und werden mitgespeichert; nach dem Laden bleibt das Spiel pausiert, bis sie bestätigt sind.
- Angaben zum Spielstand für das Panel (Alter der Welt in Jahren, Speicherzeitpunkt) werden mitgespeichert und sind ohne Laden des
  ganzen Spielstands lesbar.

## 3. Wann gespeichert wird

| Auslöser | Wirkung |
|---|---|
| Spieler wählt „Save“ im Menü-Panel | Spielstand wird überschrieben |
| App geht in den Hintergrund oder wird geschlossen | Autospeichern |
| Alle 2 Minuten Echtzeit, solange die Simulation läuft | Autospeichern |

- „Solange die Simulation läuft“: nicht während einer Pause (Menü-Panel offen, Chronik-Dialog, Spieler hat pausiert). Seit dem letzten
  Speichern unveränderte Welt wird nicht erneut geschrieben.
- Autospeichern darf **kein sichtbares Ruckeln** verursachen (Abschnitt 6).
- Nach „New World“ läuft **kein Autospeichern** (weder periodisch noch beim Hintergrund-Wechsel), bis der Spieler die Rückfrage „Overwrite saved world?“ bejaht oder manuell speichert (Abschnitt 4). Pausen-Änderungen (z. B. Gacha-Einsatz bei Pause) lösen kein Autospeichern aus; der Hintergrund-Wechsel deckt sie ab.
- Gespeichert wird nur an Tick-Rändern (nie mitten in einem Tick); beim Wechsel in den Hintergrund wird ein laufender Tick vorher fertig gerechnet.
- Bei Erfolg des Autospeicherns erscheint keine Meldung (der Speicherzeitpunkt im Panel aktualisiert sich); bei Fehlschlag nur ein kleiner Hinweis im Menü-Panel.
- Ein Speichervorgang schreibt zuerst in eine temporäre Datei und ersetzt den Spielstand erst, wenn sie vollständig und gültig ist
  (atomar). Ein Absturz mitten im Speichern darf den bisherigen Spielstand nicht zerstören.
- Ist das Speichern nicht möglich (z. B. Speicher voll), bleibt der alte Spielstand erhalten; der Spieler sieht eine kurze Meldung
  „Could not save“ (bei Autospeichern nur der kleine Hinweis im Menü-Panel).

## 4. Menü und Panel

- Auf der Karte gibt es eine Schaltfläche **„Menu“**. Sie öffnet ein Panel mit drei Aktionen:

| Aktion | Wirkung |
|---|---|
| **Save** | überschreibt den Spielstand mit dem aktuellen Zustand; bestätigt kurz („Saved“) |
| **Load** | stellt den gespeicherten Zustand wieder her; **fragt vorher nach**, weil nicht gespeicherter Fortschritt verloren geht; deaktiviert, wenn kein gültiger Spielstand existiert |
| **New World** | öffnet einen Dialog mit drei Wahlmöglichkeiten (siehe unten): „Save & New World“, „New World“, „Cancel“ |

- Das Panel zeigt den gespeicherten Stand: **Alter der Welt in Jahren** und **Speicherzeitpunkt** (Datum und Uhrzeit); ohne Spielstand
  „No saved world“.
- **Die Simulation pausiert, solange das Panel offen ist** und läuft beim Schließen mit der vorherigen Geschwindigkeit weiter.
- Die Rückfrage bei „Load“ ist ein Dialog mit „Cancel“ und „Load“; der Text sagt, dass nicht gespeicherter Fortschritt verloren geht
  (z. B. „Unsaved progress will be lost.“). Nach dem Laden gibt es keinen Rückgängig-Schritt (ein Speicherplatz).
- **Dialog bei „New World“:**

| Schaltfläche | Wirkung |
|---|---|
| **Save & New World** | speichert zuerst die aktuelle Welt (überschreibt den Spielstand), erzeugt danach eine neue Welt |
| **New World** | erzeugt eine neue Welt ohne zu speichern; die aktuelle Welt geht verloren, wenn sie nicht gespeichert ist |
| **Cancel** | schließt den Dialog, nichts ändert sich |

- **Schutz des Spielstands nach „New World“:** Nach dem Start einer neuen Welt (mit oder ohne Speichern) läuft kein Autospeichern, bis
  der Spieler gefragt wurde. Der **erste Autospeicher-Zeitpunkt** der neuen Welt öffnet den Dialog **„Overwrite saved world?“** mit
  **„Overwrite“** und **„Keep old save“**:
  - „Overwrite“: der Spielstand wird mit der neuen Welt überschrieben, Autospeichern läuft ab jetzt normal.
  - „Keep old save“: der Spielstand bleibt unverändert; für diese Welt läuft kein Autospeichern mehr, bis der Spieler manuell speichert
    (Save im Panel überschreibt ohne Rückfrage und schaltet Autospeichern wieder ein); es gibt keine spätere Rückfrage, nur manuelles Speichern schaltet Autospeichern wieder ein.
  - Die Rückfrage kommt auch nach „Save & New World“ (der alte Spielstand ist dann die eben gespeicherte Welt), einmal je neuer Welt.
  - Solange die Rückfrage offen ist, pausiert die Simulation. Im Hintergrund kann kein Dialog erscheinen: ein Hintergrund-Wechsel speichert dann nicht, die Rückfrage kommt beim Zurückkehren in die App.
  - Nach „Load“ läuft Autospeichern sofort wieder normal, ohne Rückfrage (die geladene Welt ist der Spielstand).
  - Ein manuelles „Save“ nach „New World“ überschreibt ohne Rückfrage und schaltet Autospeichern ein.
- Beim Laden und bei „New World“ werden offene Panels, Auswahl und Gacha-Einsatz-Modus geschlossen; die Karte wird neu aufgebaut.
- „New World“ allein überschreibt den Spielstand nicht; das tun nur „Save“, „Save & New World“ und ein bejahtes „Overwrite“.

## 5. App-Start und Fehlerfälle

- Beim Start: existiert ein **gültiger** Spielstand, wird diese Welt automatisch fortgesetzt; sonst wird eine neue Welt erzeugt.
- Der Spielstand trägt eine **Versionsnummer** des Formats. Ein Spielstand mit unbekannter (z. B. neuerer oder inkompatibler) Version
  oder ein beschädigter Spielstand (nicht lesbar, Prüfsumme/Struktur falsch) wird **nicht geladen**: der Spieler sieht eine kurze Meldung
  (z. B. „Saved world could not be loaded. A new world was started.“) und eine neue Welt startet.
- Gleiches gilt für „Load“ im Menü: bei ungültigem Spielstand bleibt die laufende Welt unverändert und es erscheint die Meldung
  „Saved world could not be loaded.“ (kein Ersatz durch eine neue Welt).
- Ein ungültiger Spielstand wird **nicht gelöscht**; er bleibt liegen, bis ihn ein Speichern der neuen Welt ersetzt. Alte Formatversionen werden nur abgelehnt (keine Migration, solange das Spiel in Entwicklung ist).
- Eine beim App-Start fortgesetzte Welt **pausiert bis zum ersten Tipp**; Laden über das Menü läuft dagegen sofort mit der gespeicherten Geschwindigkeit weiter. Eine fortgesetzte Welt löst keine Überschreib-Rückfrage aus.
- Die Benchmark-Szenarien (`myworld://benchmark?...`) erzeugen immer eigene Welten und laden und überschreiben nie den Spielstand.

## 6. Performance

- Die Simulation läuft ohne React; der Zustand liegt in flachen typisierten Arrays. Gespeichert wird deshalb als **Binärabbild** dieser
  Arrays (nicht als JSON je Einwohner), das gilt als Richtung, die Umsetzung entscheidet `sim-engineer`.
- Das Autospeichern ist ein **in Scheiben geteiltes Speichern**: der Abzug wird über etwa 20 Frames verteilt, die Spielzeit der Simulation steht in diesen Frames still (so bleibt der Zustand tick-konsistent).
- Autospeichern darf keinen Frame über 25 ms verursachen und keinen Swipe unter 60 fps drücken. Kopieren und Schreiben werden deshalb auf
  Teile verteilt oder zwischen Ticks/Frames ausgeführt (wie der Spieluhr-Tick in Teilen); der Schreibvorgang selbst läuft nicht auf dem
  UI-Thread. Beim Wechsel in den Hintergrund darf der Vorgang dagegen am Stück erfolgen.
- Der Zustand wird zum Zeitpunkt eines **Tick-Rands** festgehalten (nie mitten in einem Tick), damit die Kopie konsistent ist. Ein Tick,
  der gerade in Teilen läuft, wird vorher fertig berechnet.
- Benchmark: neues Szenario `save` (gealterte Welt, Autospeicher-Scheiben laufen während der Swipes (verkürztes Intervall, Spielzeit steht je Autospeichern ca. 20 Frames still), plus Laden einer
  gespeicherten Welt und Prüfung, dass sie unverändert weiterläuft). Alle bisherigen Szenarien bleiben unverändert und müssen bestehen.
- Messen vor der Freigabe: Größe des Spielstands und Schreibdauer für „young“ und die größte Welt (Szenarien `cities`, `war`).

## 7. Testbarkeit

- Test: Welt N Jahre simulieren, speichern, laden, weitere M Jahre simulieren; Ergebnis muss **identisch** sein zu einer ohne
  Unterbrechung auf N+M Jahre simulierten Welt (Zustandsvergleich).
- Test: unbekannte Version, abgeschnittene und verfälschte Spielstände werden abgelehnt, ohne zu werfen.
- Neue Zustandsfelder in der Simulation müssen im Spielstand ergänzt werden; ein Test soll auffallen, wenn ein Feld im Abbild fehlt.

## 8. Abhängigkeiten

- Alle Requirements mit eigenem Zustand: Gesellschaft/Regionale Rohstoffe, Zufriedenheit, Handel, Diplomatie, Zentralregierung,
  Anführer, Krieg, Gacha. Wer Zustand hinzufügt (Arrays, Zufallsgenerator, Zähler), muss ihn in den Spielstand aufnehmen und die
  Formatversion erhöhen.
- `Requirement Gacha.md` Abschnitt 9 „Datenhaltung“: Zustand des Gottes ist Teil des Spielstands (dort prüfen, ob eine Anpassung nötig ist).
- Zufriedenheit §5 (Chronik-Dialog pausiert das Spiel): wartende Meldungen werden mitgespeichert; ein Panel/Dialog dieses Requirements pausiert ebenfalls.
- Benchmark: neues Szenario `save` (Abschnitt 6).

## 9. Offene Punkte

Keine. Alle Entscheidungen sind in den Abschnitten 2-6 eingearbeitet.
