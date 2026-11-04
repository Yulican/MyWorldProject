# Requirement: Zentralregierung

Stand: umgesetzt (Ablauf:
Design → Simulation → Umsetzung). Die Zahlen unten sind die vom Nutzer
gewählten aus der Simulation („Baseline + Abgabe vor Ort“). Baut auf
Zufriedenheit (`Requirement Zufriedenheit.md`), Handel
(`Requirement Handel.md`) und regionalen Rohstoffen
(`Requirement Regionale Rohstoffe.md`) auf.

## 1. Ziel

Neben den Siedlungen handelt eine Regierung für das ganze Volk. Sie hält
das Reich zusammen und erhöht die Steuern; dafür braucht sie Geld und
Baustoffe. Ihre Gebäude sollen dauerhaft unterhalten werden können, weil
sie später für den Krieg gebraucht werden. Später kommen weitere
Schwerpunkte dazu (Krieg und andere Mechaniken).

## 2. Bauplätze

- Jede Siedlung hat so viele **Regierungsplätze** wie Siedlungsplätze (4,
  in der Ebene 6).
- Über die Siedlungsplätze entscheidet die Siedlung, über die
  Regierungsplätze nur die Regierung.
- Ein Regierungsgebäude wirkt auf sein Feld wie jedes Gebäude.
- Straßen brauchen keinen Bauplatz.

## 3. Bezirke und Kassen

- Die Hauptstadt und jeder Regierungssitz bilden einen **Bezirk**: die
  Siedlungen des Volkes, für die dieser Sitz der nächste ist (Luftlinie in
  Hexfeldern).
- Jeder Sitz hat eine eigene **Kasse** und ein eigenes **Lager** (Holz,
  Stein). Steuern gehen direkt in Kasse und Lager des Bezirks.
- **Startgeld:** Ein neu entstandenes Volk (das erste Volk, neue Stämme)
  bekommt einmal den Preis eines Regierungssitzes in die Kasse der
  Hauptstadt. Abgespaltene und aufständische Völker bekommen keins, sie
  behalten ihre Siedlungen. (Wird beim Thema Krieg verfeinert.)

**Krieg (`Requirement Krieg.md`):**
- **Sold:** Der Sold der Soldaten kommt aus der Kasse des Bezirks, in dem sie ausgebildet sind, und zählt zur Einkommensprüfung (40 %-Regel, Abschnitt 5). Reicht sie nicht, decken die anderen Sitze des Volks die Lücke (gemeinsamer Topf); Soldaten werden nur ausgebildet, wenn der Sold des nächsten Jahres gedeckt ist. Die Regierung hält die Sold-Reserve zurück und gibt sie nicht für Vorhaben aus; ohne Sold werden Soldaten entlassen und kommen in die Bevölkerung zurück. Regierungshändler bringen fehlende strategische Güter (Eisen, Feuerstein, Pferde) von eigenen Siedlungen zu den Soldaten. Abgebautes Gold ist Geld der Siedlung und wird besteuert wie anderes erzeugtes Geld. Höhe: Startwert 0,1 je Soldat und Jahr, kalibrieren (Simulation).
- **Eroberte Sitze:** Der Eroberer übernimmt das Lager und die Hälfte der Kasse; Gebäude bleiben. Der ganze Bezirk wechselt den Besitzer. Auch die Hauptstadt kann Kriegsziel sein: Sie wechselt nur mit ihrem Bezirk den Besitzer (keine Annexion des ganzen Volks), das übrige Volk wählt eine neue Hauptstadt. Ein besetzter Sitz wechselt erst am Kriegsende und nur als Kriegsziel den Besitzer (`Requirement Krieg.md`, Abschnitt 5).
- Belagerte Sitze: Kapazitäten halbiert, Handel ruht.
- Das Startgeld für Abgespaltene bleibt vorerst unverändert; Rebellenvölker aus einem Krieg behalten ihre Siedlungen.

## 4. Steuern

Jeder Bezirk setzt einmal im Jahr zwei Steuersätze, so hoch, dass seine
**schwächste Siedlung** noch loyal bleibt, mit einem **Sicherheitsabstand
von 5** Zufriedenheitspunkten. Solange das Volk einen Regierungssitz
finanziert (ein Sitz steht in einer Bauliste), entfällt der
Sicherheitsabstand im ganzen Volk.

- **Warensteuer nach Bedarf:** Der Bezirk nimmt so viel Holz und Stein aus
  dem Überschuss seiner Siedlungen (Vorrat über ihrem eigenen Bedarf und
  ihrer Reserve), wie er im Jahr braucht: ein Jahr Unterhalt seiner
  Regierungsgebäude plus die noch fehlenden Baustoffe der Bauliste, abzüglich
  dessen, was im Lager des Sitzes liegt. Höchstens so viel, dass die
  schwächste Siedlung auch ohne Geldsteuer noch loyal bleibt.
- **Geldsteuer:** Sie nimmt den verbleibenden Spielraum.
- Teilwerte der Zufriedenheit, je Steuer gleich geformt:
  - **„Taxes“** (Geldsteuer): +5 bei 0 %, 0 bei 10 %, −10 bei 50 %.
  - **„Goods taxes“** (Warensteuer): +5 bei 0 %, 0 bei 10 %, −10 bei 50 %.
- **Abgabe vor Ort:** Einmal im Jahr, vor dem Unterhalt, nimmt jedes
  Hexfeld mit Regierungsgebäuden, was diesen für ein Jahr Unterhalt fehlt,
  direkt aus dem Überschuss der Siedlung auf demselben Feld. Das zählt als
  Warensteuer dieser Siedlung (ihr Teilwert „Goods taxes“ steigt) und geht
  nur so weit, dass sie selbst über dem Sicherheitsabstand bleibt. Was so
  nicht gedeckt ist, kommt wie gewohnt über die Händler.
- Große Änderungen des Geldsteuersatzes (ab 10 Prozentpunkten) kommen in
  die Chronik.

## 5. Was die Regierung baut

- Alle Gebäude; Schwerpunkt: das Reich zusammenhalten und die Steuern
  erhöhen.
- **Bauliste:** ein Vorhaben je Sitz. Reihenfolge:
  1. ein geplanter **Regierungssitz** (er verdrängt ein anderes Vorhaben),
  2. **Komfort** für Siedlungen unter dem Sicherheitsabstand,
  (Krieg, entschieden: Reihenfolge Regierungssitz > Komfort > **Militär** > Wachstum; Sitz und Komfort zählen als Loyalität der Siedlungen. Militärgebäude baut der Sitz, wenn ein Volk ihn bedroht (Gefahr ≥ 50), das Reich unzufriedene Siedlungen (Zufriedenheit < 0) hat oder die Kasse mindestens 5 Jahre Sold eines Gebäudes übrig hat; die Einkommensprüfung (40 %) schließt den Sold ein; höchstens ein Gebäude je Art und Siedlung, ab 40 Einwohnern, Art = die mit den wenigsten Soldaten, Stall nur mit Pferden im Lager; `Requirement Krieg.md`, Abschnitt 2.)
  3. **Wachstum** für Siedlungen ab 80 % ihrer Kapazität (Gewinn an
     Kapazität je Kosten).
- Ein Vorhaben, das 5 Jahre nicht beginnen konnte, wird gestrichen (Sitze
  ausgenommen, siehe Abschnitt 6).
- **Einkommensprüfung:** Ein Vorhaben kommt nur in die Bauliste, wenn der
  jährliche Unterhalt aller Regierungsgebäude des Bezirks (in Geld zu
  Marktpreisen) samt dem neuen höchstens **40 % des möglichen Einkommens**
  beträgt. Mögliches Einkommen: das größere von
  - Geldsteuer am Loyalitätslimit (Warensteuer 0 %),
  - Warensteuer am Loyalitätslimit (Geldsteuer 0 %), höchstens so viel,
    wie die Siedlungen im Jahr an Holz und Stein über ihren eigenen
    Unterhalt hinaus ernten (nicht ihr angesparter Vorrat).
- **Sitze** werden gegen das ganze Volk geprüft: Unterhalt aller Sitze des
  Volkes samt dem neuen gegen 40 % der möglichen Einkommen aller Bezirke.
- Ein Vorhaben beginnt, wenn seine Baustelle Baukosten plus zwei Jahre
  Unterhalt im Lager hat; es dauert seine Bauzeit (Sitz 3 Jahre).

## 6. Regierungssitze

- Sitze stehen nur noch in Regierungsplätzen; Siedlungen bauen keine Sitze
  mehr. Die Regel „der Sitz geht vor“ für Siedlungen entfällt.
- **Kosten** in Regierungsplätzen: 30 Holz, 45 Stein (halber Preis),
  **Unterhalt** 1,5 Holz und 1,5 Stein im Jahr.
- **Planung:** ein geplanter Sitz je Bezirk (statt je Volk), nach dem
  Nutzen für die Anbindung der Siedlungen wie bisher. In einem Bezirk, der
  gerade keine Geldsteuer erheben kann (0 %), zählt der Nutzen doppelt.
- Läuft die Planung eines Sitzes in der Bauliste ab (5 Jahre), wird der
  Platz neu gegen die anderen Kandidaten bewertet: bleibt er der beste, gilt
  die Planung weiter, sonst wird der bessere Platz geplant.

## 7. Regierungshändler

- Je Sitz 2, in der Hauptstadt 4; alle freien Händler können alle 4 Wochen
  aufbrechen. Ein Händler trägt bis zu 40 Einheiten und bricht ab 5
  Einheiten auf.
- **Unterhalt zuerst:** An jeder Baustelle mit Regierungsgebäuden halten
  sie drei Jahre Unterhalt vor; erst danach liefern sie Baustoffe für die
  Bauliste.
- Quelle: zuerst das Lager des eigenen Sitzes, sonst Kauf zu Marktpreisen
  bei der Siedlung des eigenen Volkes mit dem größten Überschuss, bezahlt
  aus der Kasse.
- Fehlt der Kasse Geld, schickt der reichste Sitz des Volkes die Hälfte
  seiner Kasse (ebenfalls per Händler).

## 8. Unterhalt und Verfall

- Jedes Regierungsgebäude nimmt seinen Unterhalt einmal im Jahr aus dem
  Lager der Regierung auf seinem Feld.
- Fehlt er zwei Jahre hintereinander, wird es zur Ruine.

## 9. Anzeige

- Eigenes Untermenü **„Government ›“** (wie die Diplomatie): Bezirke,
  Steuersätze (Geld und Waren), Kassen und Lager, Regierungsgebäude,
  Händler unterwegs.
- Regierungssitze sind auf der Karte sichtbar.
- Die Hexfeld-Info zeigt den Bezirk und die Regierungsplätze.

## 10. Benchmark

Neues Szenario `government`: gealterte Welten mit vielen Sitzen,
Regierungsgebäuden und Regierungshändlern unterwegs.

## 11. Ergebnis der Simulation

12 Welten, Jahr 500, gegen den Stand ohne Regierung (mit der Umsetzung,
also auch mit Regel R1 des Handels, siehe `Requirement Handel.md`):

| Jahr 500 | ohne Regierung | mit Regierung |
|---|---|---|
| Menschen | 14 622 | 16 837 |
| Siedlungen | 197 | 191 |
| Völker | 8,8 | 8,1 |
| Regierungssitze | 23,8 | 31,3 |
| Aufstände | 2,3 | 1,2 |
| Handel (Güter) | 67 500 | 48 400 |
| Geldsteuer (Mittel) | – | 27 % |
| Regierungsgebäude stehend / Ruinen | – | 294 / 56 |

Verworfen nach Simulation: längere Bauliste, mehr oder größere Händler,
niedrigere Preise, mehr Geld, Durchschnitt statt schwächster Siedlung,
Warensteuer im Satz der Geldsteuer, Kauf bei Handelspartnern, Baustoffe auf
Kredit, Bargeldprüfung, Rückzahlung der Baukosten über die Warensteuer,
Unterhalt vor neuen Vorhaben, gebündelte Lieferungen, gemeinsamer
Warensteuersatz des Volkes, Ausgleich von Waren und Geld zwischen Sitzen,
strengere Einkommensprüfungen.

## 12. Offene Punkte

- Handel liegt etwa 28 % unter dem Stand ohne Regierung (vor allem weniger
  Getreide und Wasser hin und her, Regel R1).
- Der Geldsteuersatz liegt im Mittel bei etwa 27 %.
- Etwas weniger Völker (weniger Abspaltungen).
- Rund 12 % der Regierungsgebäude verfallen, meist an Orten ohne eigenes
  Holz. Idee für später: Gebäude ohne Unterhalt werden stillgelegt statt
  zur Ruine (für den Krieg).
