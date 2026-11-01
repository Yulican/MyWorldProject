# Requirement: Zentralregierung

Stand: Design vom Nutzer freigegeben, Simulation in Vorbereitung (Ablauf:
Design → Simulation → Umsetzung). Baut auf Zufriedenheit
(`Requirement Zufriedenheit.md`), Handel (`Requirement Handel.md`) und
regionalen Rohstoffen (`Requirement Regionale Rohstoffe.md`) auf. Zahlen
mit „?“ werden in der Simulation bestimmt.

## 1. Ziel

Neben den Siedlungen handelt eine Regierung für das ganze Volk. Sie hält
das Reich zusammen und erhöht die Steuern; dafür braucht sie Geld. Später
kommen weitere Schwerpunkte dazu (Krieg und andere Mechaniken).

## 2. Bauplätze

- Jede Siedlung hat so viele **Regierungsplätze** wie Siedlungsplätze (4,
  in der Ebene 6).
- Über die Siedlungsplätze entscheidet die Siedlung, über die
  Regierungsplätze nur die Regierung; die Siedlung kann daran nichts ändern.
- Ein Regierungsgebäude wirkt auf sein Feld wie jedes Gebäude (z. B.
  Felder der Regierung tragen mehr Menschen dort).
- Straßen brauchen keinen Bauplatz.

## 3. Was die Regierung baut

- Alle Gebäude und Straßen.
- Schwerpunkt: das Reich zusammenhalten und die Steuern erhöhen, z. B.
  Regierungssitze und ihre Straßen, Komfort und Luxus für Siedlungen, die
  abzufallen drohen, Gebäude, die Bevölkerung und damit Steuern wachsen
  lassen.
- Regierungssitze stehen in Regierungsplätzen. Die Regel „der Sitz geht
  vor“ für Siedlungen entfällt damit.

## 4. Bezirke und Kassen

- Die Hauptstadt und jeder Regierungssitz bilden einen **Bezirk**: die
  Siedlungen, für die dieser Sitz der nächste ist.
- Jeder Sitz hat eine eigene **Kasse**. Die Steuern gehen direkt in die
  Kasse des Bezirks (ohne Transport).
- Regierungshändler gleichen die Kassen zwischen den Sitzen aus.

## 5. Steuern

Zwei Varianten werden simuliert:
- **A:** Nur Geld wird besteuert; die Regierung kauft, was sie braucht.
- **B:** Geld und Güter, mit getrennten Sätzen je Gruppe (Geld, Baustoffe
  Holz/Stein, Versorgung Getreide/Wasser, Luxusgüter); kaufen kann die
  Regierung auch hier.

Höhe: Jeder Bezirk setzt den höchsten Satz, bei dem seine Siedlungen noch
loyal bleiben, mit einem Sicherheitsabstand (?), damit keine sofort
abfällt. Simuliert wird, ob dafür die schwächste Siedlung des Bezirks oder
der Durchschnitt zählt. Große Änderungen des Satzes kommen in die Chronik.

## 6. Zufriedenheit

Neuer Teilwert „Taxes“: 0 bei einem mittleren Satz, darunter positiv,
darüber negativ. Startwerte: +5 bei 0 %, 0 bei 10 %, −10 bei 50 % (?).

## 7. Regierungshändler

- Nur die Regierung schickt sie: je Sitz 2, die Hauptstadt 4 (?).
- Sie kaufen Baustoffe für Regierungsgebäude und bringen sie hin, liefern
  deren Unterhalt und gleichen die Kassen aus.
- Simuliert wird, ob sie reichen, um alle Regierungsgebäude zu versorgen.

## 8. Anzeige

- Eigenes Untermenü **„Government ›“** (wie die Diplomatie): Bezirke,
  Steuersätze, Kassen, Regierungsgebäude, Händler unterwegs.
- Regierungssitze sind auf der Karte sichtbar.
- Die Hexfeld-Info zeigt den Bezirk und die Regierungsplätze.

## 9. Benchmark

Neues Szenario `government`: viele Sitze, Regierungsgebäude und
Regierungshändler unterwegs.

## 10. Simulation

Varianten: Steuern A gegen B, schwächste Siedlung gegen Durchschnitt,
Sicherheitsabstand, Stärke des Teilwerts „Taxes“, Zahl der
Regierungshändler. Kennzahlen gegen den heutigen Stand: Wachstum,
Aufstände und Völker, Handel und Diplomatie, Regierungssitze und
-gebäude, Kassen und Steuersätze, Rechenzeit.
