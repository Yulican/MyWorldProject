# Requirement: Speichern und Laden

Stand: Entwurf, Grundregeln mit dem Nutzer abgestimmt (Abschnitte 1-7); Abschnitt 9 „Offene Punkte“ wartet auf Entscheidungen.
Grundlage: Diskussion mit dem Nutzer. Betrifft alle Teilsysteme, die Zustand halten (Gesellschaft, Handel, Diplomatie, Regierung,
Anführer, Krieg, Gacha; siehe Abschnitt 8). Es gibt noch keine Zahlen aus der Simulation; alle Zeiten sind Startwerte.

## 1. Ziel

Der Spieler setzt seine Welt nach dem Schließen der App genau dort fort, wo er aufgehört hat. Es gibt genau einen Spielstand.
Die Welt läuft nach dem Laden so weiter, wie sie ohne Unterbrechung weitergelaufen wäre.

## 2. Spielstand

- Genau **ein Speicherplatz** („Spielstand“). Manuelles Speichern und Autospeichern schreiben denselben Platz.
- Speichern überschreibt den Spielstand ohne Rückfrage; eine Sicherheitsabfrage gibt es nur beim Laden und bei „New World“ (Abschnitt 4).
- Inhalt: der **vollständige Simulationszustand** einschließlich des Zufallsgenerator-Zustands (alle benannten Generatoren, z. B. Welt,
  Anführer, Gacha), damit eine geladene Welt **deterministisch** exakt weiterläuft wie die gespeicherte (gleiche Folge von Ereignissen).
- Außerdem: die **Spielgeschwindigkeit** (Einstellung) und der **Zustand des Gottes** (Faith, Inventar an Ladungen/Fähigkeiten,
  laufende Effekte der Götterebene mit ihrer Restdauer).
- Nicht gespeichert: reine Anzeige (Kartenposition, Zoom, offene Panels, Auswahl, Ziel-Modus eines Gacha-Einsatzes). Beim Laden startet die
  Karte in der Standardansicht.
- Chronik-Meldungen, die noch auf Bestätigung warten, gehören zum Simulationszustand und bleiben erhalten (offen: Abschnitt 9, Punkt 5).
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
- Ein Speichervorgang schreibt zuerst in eine temporäre Datei und ersetzt den Spielstand erst, wenn sie vollständig und gültig ist
  (atomar). Ein Absturz mitten im Speichern darf den bisherigen Spielstand nicht zerstören.
- Ist das Speichern nicht möglich (z. B. Speicher voll), bleibt der alte Spielstand erhalten; der Spieler sieht eine kurze Meldung
  „Could not save“ (bei Autospeichern stumm bis auf einen kleinen Hinweis im Menü-Panel, siehe Offen 7).

## 4. Menü und Panel

- Auf der Karte gibt es eine Schaltfläche **„Menu“**. Sie öffnet ein Panel mit drei Aktionen:

| Aktion | Wirkung |
|---|---|
| **Save** | überschreibt den Spielstand mit dem aktuellen Zustand; bestätigt kurz („Saved“) |
| **Load** | stellt den gespeicherten Zustand wieder her; **fragt vorher nach**, weil nicht gespeicherter Fortschritt verloren geht; deaktiviert, wenn kein gültiger Spielstand existiert |
| **New World** | erzeugt eine neue Welt; **fragt vorher nach**, die aktuelle Welt geht verloren, wenn sie nicht gespeichert ist |

- Das Panel zeigt den gespeicherten Stand: **Alter der Welt in Jahren** und **Speicherzeitpunkt** (Datum und Uhrzeit); ohne Spielstand
  „No saved world“.
- **Die Simulation pausiert, solange das Panel offen ist** und läuft beim Schließen mit der vorherigen Geschwindigkeit weiter.
- Die Rückfragen sind Dialoge mit „Cancel“ und einer Bestätigung („Load“ bzw. „New World“). Der Text sagt, dass nicht gespeicherter
  Fortschritt verloren geht (z. B. „Unsaved progress will be lost.“).
- Beim Laden und bei „New World“ werden offene Panels, Auswahl und Gacha-Einsatz-Modus geschlossen; die Karte wird neu aufgebaut.
- „New World“ überschreibt den Spielstand **nicht**; erst Speichern oder Autospeichern (Hintergrund, 2 Minuten) tun das. (Offen: Punkt 1.)

## 5. App-Start und Fehlerfälle

- Beim Start: existiert ein **gültiger** Spielstand, wird diese Welt automatisch fortgesetzt; sonst wird eine neue Welt erzeugt.
- Der Spielstand trägt eine **Versionsnummer** des Formats. Ein Spielstand mit unbekannter (z. B. neuerer oder inkompatibler) Version
  oder ein beschädigter Spielstand (nicht lesbar, Prüfsumme/Struktur falsch) wird **nicht geladen**: der Spieler sieht eine kurze Meldung
  (z. B. „Saved world could not be loaded. A new world was started.“) und eine neue Welt startet.
- Gleiches gilt für „Load“ im Menü: bei ungültigem Spielstand bleibt die laufende Welt unverändert und es erscheint die Meldung
  „Saved world could not be loaded.“ (kein Ersatz durch eine neue Welt).
- Ob der ungültige Spielstand danach gelöscht oder überschrieben wird: Offen, Punkt 2.
- Die Benchmark-Szenarien (`myworld://benchmark?...`) erzeugen immer eigene Welten und laden und überschreiben nie den Spielstand.

## 6. Performance

- Die Simulation läuft ohne React; der Zustand liegt in flachen typisierten Arrays. Gespeichert wird deshalb als **Binärabbild** dieser
  Arrays (nicht als JSON je Einwohner), das gilt als Richtung, die Umsetzung entscheidet `sim-engineer`.
- Autospeichern darf keinen Frame über 25 ms verursachen und keinen Swipe unter 60 fps drücken. Kopieren und Schreiben werden deshalb auf
  Teile verteilt oder zwischen Ticks/Frames ausgeführt (wie der Spieluhr-Tick in Teilen); der Schreibvorgang selbst läuft nicht auf dem
  UI-Thread. Beim Wechsel in den Hintergrund darf der Vorgang dagegen am Stück erfolgen.
- Der Zustand wird zum Zeitpunkt eines **Tick-Rands** festgehalten (nie mitten in einem Tick), damit die Kopie konsistent ist. Ein Tick,
  der gerade in Teilen läuft, wird erst fertig berechnet oder der Spielstand zeigt den letzten Tick-Rand (Umsetzung offen, Punkt 6).
- Benchmark: neues Szenario `save` (gealterte Welt, Autospeichern während der Swipes mit verkürztem Intervall, plus Laden einer
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
- Zufriedenheit §5 (Chronik-Dialog pausiert das Spiel): Verhältnis zur Pause beim Menü-Panel (Abschnitt 4).
- Benchmark: neues Szenario `save` (Abschnitt 6).

## 9. Offene Punkte (zu entscheiden)

1. **„New World“ und Spielstand.** Der alte Spielstand bleibt, bis die neue Welt gespeichert wird; das Autospeichern (2 Minuten oder
   Hintergrund) überschreibt ihn dann ohne Rückfrage. Empfehlung: so lassen, aber die Rückfrage bei „New World“ nennt es nicht;
   alternativ Autospeichern erst, wenn der Spieler die neue Welt einmal manuell gespeichert hat (schützt die alte Welt vor einem
   versehentlichen „New World“ plus Hintergrundwechsel). Empfehlung: Autospeichern der neuen Welt sofort (einfach, erwartbar).
2. **Ungültiger Spielstand** nach der Meldung: löschen oder bis zum nächsten Speichern liegen lassen? Empfehlung: liegen lassen, bis
   der Autospeicher der neuen Welt ihn ersetzt (nichts geht vorher verloren, falls ein Update das Format wieder lesen kann).
3. **Altes Format nach App-Update.** Nur ablehnen (wie beschlossen) oder später Migrationen? Empfehlung: ablehnen, solange das Spiel in
   Entwicklung ist; Migration erst bei einer veröffentlichten Version.
4. **Autospeichern bei Pause.** Alle 2 Minuten nur bei laufender Simulation (hier so beschrieben). Soll auch bei Pause nach einer
   Änderung (z. B. Gacha-Ziehung/Einsatz im Pausenzustand) gespeichert werden? Empfehlung: nein, der Wechsel in den Hintergrund deckt es ab.
5. **Chronik-Dialog.** Wartende Meldungen mitspeichern (hier so) oder beim Laden verwerfen? Empfehlung: mitspeichern; beim Laden bleibt
   das Spiel pausiert, bis sie bestätigt sind.
6. **Zustand mitten im Tick.** Der Spieluhr-Tick läuft in Teilen über mehrere Frames. Empfehlung: Spielstand nur an Tick-Rändern ziehen
   (beim Hintergrund-Wechsel den laufenden Tick vorher fertigrechnen, falls kurz genug).
7. **Rückmeldung beim Autospeichern.** Empfehlung: keine Meldung bei Erfolg; im Menü-Panel steht der Speicherzeitpunkt, der sich
   aktualisiert. Bei Fehlschlag nur ein kleiner Hinweis im Panel.
8. **Spielstand-Anzeige im Panel.** Reichen Alter (Jahre) und Zeitpunkt, oder zusätzlich z. B. Zahl der Völker/Einwohner? Empfehlung: nur
   die beiden beschlossenen Angaben.
9. **Pause nach dem Laden/Start.** Startet die fortgesetzte Welt sofort oder pausiert, bis der Spieler tippt? Empfehlung: pausiert bis zum
   ersten Tipp (kein Überraschungs-Fortschritt nach dem App-Start), Laden über das Menü läuft sofort mit der gespeicherten Geschwindigkeit weiter.
10. **Sicherung bei Laden.** „Load“ könnte den aktuellen Zustand vorher still als Rückfall behalten (Undo). Empfehlung: nein, ein Platz.
