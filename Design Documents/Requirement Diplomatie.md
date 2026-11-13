# Requirement: Diplomatie, Stufe 1 (Beziehungen, Grenzen, Außenhandel, Migration)

Status: **Stufe 1 umgesetzt; Stufe 2 (Krieg) ist in `Requirement Krieg.md` entworfen und ändert Abschnitt 6 (Krieg).** Stufe 1 war umgesetzt auf Branch `feature/diplomacy` mit den Startwerten** (siehe „Umsetzung und Kalibrierung“ am Ende; die Regeln stehen im Game-Design-Dokument, Abschnitt 5). Die Zahlen sind Startwerte. Vor der
Umsetzung werden sie an 12 Testwelten kalibriert und dir vorgelegt.
Spieltexte sind Englisch.

Baut auf dem internen Handel auf (`Requirement Handel.md`): Geld pro
Siedlung, Händler, Wege.

**Änderung durch Anführer (`Requirement Anführer.md`, entschieden, in Runde 3 gemessen):** Der Anführer eines Volks verschiebt die Schwellen dieses Dokuments (Grenzen öffnen und schließen, Startvertrauen, Vertrauen zu allen, Zoll, Abkommensschwellen, Abklingzeit der Ereignisse). Die Zahlen hier sind die Grundwerte.

Stufen:
- **Stufe 1 (dieses Dokument):** Beziehungen, Grenzen, Zoll, Außenhandel
  (Freihandels- und Handelsabkommen), Migrationsabkommen.
- **Stufe 2:** Krieg.
- **Danach:** Steuern und Geld des Volks, Wissen und Spionage.
- **Nicht auf der Roadmap:** Preise nach Knappheit. Es bleibt bei festen
  Preisen.

## 1. Beziehungen

- Jedes Volk bewertet jedes andere Volk, das es kennt, mit **Vertrauen** und
  **Gefahr**, je 0 bis 100.
- Die Bewertung ist gerichtet: A sieht B anders als B A.
- Wie bei der Zufriedenheit ist jeder Wert die Summe benannter Teilwerte,
  die das Diplomatie-Panel einzeln zeigt.
- Berechnet wird jährlich. Speicher: flache Arrays pro Volkspaar.

**Kontakt**
- Zwei Völker kennen sich, sobald zwei ihrer Siedlungen höchstens
  **10 Reisekosten** voneinander entfernt sind, die **Sichtweite** eines
  Volks (nach Test bestätigt; 20 war die Alternative). Gemessen wird über
  Land und Straßen, durch fremdes Land hindurch. Die Sichtweite wird später
  auch die natürliche Sichtweite eines Volks.
- Beim ersten Kontakt startet das Vertrauen bei **20**, und es gibt einen
  Chronik-Eintrag.

**Nähe**
- Reisekosten zwischen den nächsten Siedlungen beider Völker.
- 1 = Siedlungen grenzen aneinander, 0 = an der Kontaktgrenze.

**Vertrauen (Teilwerte)**

| Teilwert | Startwert |
|---|---|
| Grundwert | 20 |
| Friedliche Nachbarschaft | wächst pro Jahr um 1 × Nähe, höchstens +40; eine feindliche Aktion (Grenze gegen dieses Volk schließen) setzt sie auf 0 zurück |
| Abkommen (dauerhaft) | +5 je bestehendes Abkommen und offene Grenze zu ihm |
| Ereignisse (klingen in 10 Jahren linear ab) | Abkommen geschlossen oder Grenze geöffnet +10; Grenze geschlossen −20; Menschen ohne Migrationsabkommen abgewandert −5 je Gruppe (nur das Volk, das sie verliert) |

Gleiche Ereignisse erneuern sich, statt sich zu stapeln. Ausgenommen sind
Abwanderungen: Sie addieren sich, höchstens bis −20.

**Gefahr (Teilwerte)**

| Teilwert | Startwert |
|---|---|
| Größe | 50 × Bevölkerung des anderen ÷ eigene Bevölkerung, höchstens 100 |
| Nähe | × Nähe (fern = harmlos) |

- Bis Wissen und Spionage kommen, sehen die Völker die echten Werte.
- Mit dem Krieg (`Requirement Krieg.md`, Abschnitt 2) gilt: Gefahr = 50 × Stärke des anderen ÷ eigene Stärke, höchstens 100, × Nähe. Die Stärke sind die Soldaten mit Güterfaktoren, Verbündete zählen zur Stärke. Offene Grenzen schließen so auch bei Aufrüstung des Nachbarn (Gefahr > 60); Schwellen kalibrieren (Simulation).

## 2. Grenzen, Zoll und Migration

**Grenzen**
- Jedes Volk entscheidet für sich, ob es seine Grenzen für ein anderes
  öffnet. Zu Beginn sind alle Grenzen geschlossen.
- **Öffnen:** Vertrauen ≥ 50 und Gefahr ≤ 40.
- **Schließen:** Vertrauen < 35 oder Gefahr > 60. Die Lücke zwischen den
  Schwellen verhindert ständiges Hin und Her.
- Schließen bricht alle Abkommen mit diesem Volk ab.
- **Offene Grenzen erlauben:**
  - Siedeln durch das Land des anderen: Expansion auf freies Land, das nur
    über dessen Land erreichbar ist. Es entsteht eine Straße durch das
    fremde Land.
  - Händlern, auf dessen Wegen durch sein Land zu eigenen Siedlungen zu
    reisen. Heute reisen sie nie durch fremdes Land.
  - Mit Freihandelsabkommen: Handel mit seinen Siedlungen (siehe 3).

**Zoll**
- Jede durchquerte fremde Siedlung verlangt Zoll von Siedlern und Händlern.
  Er geht an diese Siedlung.
- **Höhe** (Wert in Geld): steigt, je weniger diese Siedlung dem Volk der
  Reisenden vertraut und je knapper sie selbst ist.
  - Startwert: 2 Geld × (1 − Vertrauen/100) × (1 + Knappheit).
  - Knappheit: 1, wenn die Siedlung Waren verlangt (Handelsliste) oder
    weniger Geld als ein Jahreseinkommen hat, sonst 0.
- **Womit gezahlt wird:**
  - Zuerst mit Waren, die die durchquerte Siedlung verlangt, umgerechnet zu
    den festen Handelspreisen.
  - Händler zahlen aus ihrer Ladung, Siedler aus dem Vorrat der
    Herkunftssiedlung.
  - Den Rest zahlt die Herkunftssiedlung in Geld.
- Händler rechnen den Zoll in den Wert ihrer Fahrt ein. Lohnt sie sich
  nicht mehr, nehmen sie einen anderen Weg oder ein anderes Ziel.
- Kann die Herkunftssiedlung nicht zahlen, suchen Siedler ein anderes Ziel.
- Unter Partnern eines Freihandelsabkommens und für Lieferungen aus einem
  Handelsabkommen gilt der halbe Zoll (Startwert, siehe 3).

**Verbindung über fremdes Land**
- Eine Siedlung, die nur über offene Grenzen mit der Hauptstadt verbunden
  ist, gilt als verbunden.
- Wird eine Grenze dazwischen geschlossen, beginnt eine **Schonfrist von
  5 Jahren**. Erst wenn sie dann noch abgeschnitten ist, wird sie ein eigenes
  Volk (Regel für abgeschnittene Gebiete).

**Migrationsabkommen**
- Wird geschlossen, wenn beide Seiten einander mindestens 60 vertrauen.
- Abwandern in fremde Siedlungen geht weiterhin immer.
- **Ohne Abkommen** verliert das Volk, das die Menschen verliert, Vertrauen
  gegenüber dem Zielvolk (siehe 1).
- Der Glaube der Abwanderer bleibt unverändert.

## 3. Außenhandel

Baut auf dem internen Handel auf: dieselben Waren, festen Preise, Händler,
Wege und Verluste.

**Freihandelsabkommen**
- Wird geschlossen, wenn beide Seiten einander die Grenzen geöffnet haben
  und einander mindestens 55 vertrauen.
- Händler beider Völker dürfen dann Siedlungen des Partners als
  Handelsziel wählen, wie Siedlungen des eigenen Volks.
- Zwischen den Partnern gilt der halbe Zoll. Er geht weiter an die
  Siedlungen am Weg.
- Der Weg zu Partnersiedlungen geht über die Wege beider Völker. Durch
  dritte Völker geht er nur über deren offene Grenzen, gegen Zoll.

**Handelsabkommen** (gezielter Tausch zwischen zwei Völkern)
- **Anlass:** Ein Volk verlangt in Summe eine Ware, die es selbst nicht
  genug hat, und ein bekanntes Volk hat sie in Summe übrig. Beide Summen
  gibt es schon pro Volk (Handelsliste).
- **Inhalt:** A liefert jährlich X Einheiten der Ware an B. Zuerst wird
  eine Gegenware gesucht, die B übrig hat und A verlangt:
  - **Zweiseitig:** Gibt es eine, liefert B sie jährlich an A. Beide
    Lieferungen haben den gleichen Wert in festen Preisen und sind durch
    Bedarf und Überschuss beider Seiten begrenzt. Jede Richtung hat ihren
    eigenen Ausfuhrort.
  - **Einseitig:** Sonst liefert nur A. B bezahlt die Lieferungen wie im
    internen Handel in Geld.
- **Bedingungen:** Vertrauen beider Seiten ≥ 40 für ein zweiseitiges, ≥ 45
  für ein einseitiges Abkommen (Startwerte). Offene Grenzen sind nicht
  nötig: Die Lieferungen dürfen durch das Land des Partners, gegen den
  halben Zoll.
- **Lieferung:** Händler der liefernden Seite bringen die Waren von den
  Siedlungen mit dem größten Überschuss zu denen mit dem größten Bedarf.
  Diese Fahrten haben Vorrang vor freien Fahrten.
- **Laufzeit:** 10 Jahre. Danach wird neu verhandelt.
- **Bruch:** Liefert eine Seite weniger als die Hälfte, obwohl die Ware
  bereitlag, endet nach 2 solchen Zeiträumen das ganze Abkommen. Nur die
  Seite, die zu wenig bekam, verliert Vertrauen in die andere (wie beim
  Schließen der Grenze, −20, klingt in 10 Jahren ab). Konnte die Seite
  nicht liefern, wird nachverhandelt statt gebrochen. Einzelheiten
  (Annahmepflicht, Bewertung alle 2 Jahre, anderer Ausfuhrort, Halbieren):
  `Requirement Regionale Rohstoffe.md`, Abschnitt 4.
- Ein Volkspaar hat höchstens ein Handelsabkommen pro Ware.

**Vertrauen**
- Jedes Abkommen gibt beim Abschluss einmalig +10 (klingt in 10 Jahren ab)
  und +5, solange es besteht (siehe 1).
- Bei einem einseitigen Handelsabkommen vertraut der Empfänger dem Geber
  zusätzlich +5, solange es besteht („Delivers goods we lack“). Ein
  zweiseitiges gibt keinen Zusatz.
- Grenzen schließen bricht alle Abkommen mit diesem Volk ab: Freihandel,
  Handelsabkommen und Migrationsabkommen.

## 4. Anzeige

**Diplomatie-Panel**
- Liste der Völker. Ein Tipp auf ein Volk zeigt alles relativ zu ihm:
  - Vertrauen und Gefahr in beide Richtungen, mit Teilwerten
  - Grenzen offen oder geschlossen, je Richtung
  - Abkommen
- Der Spieler sieht alles.

**Karte**
- Offene Grenzen werden als gestrichelte Grenzlinie zwischen zwei Völkern
  gezeichnet.
- Kartenmodi kommen später.

**Chronik**
- Jedes diplomatische Ereignis kommt in die Chronik. Einen Dialog mit Pause
  (Zufriedenheit, Abschnitt 5) gibt es nur für den ersten Kontakt und für
  eine geschlossene Grenze, dazu (`Requirement Krieg.md`) für
  Kriegserklärung, Frieden und ein neues Bündnis. Still in der Liste stehen: Grenze geöffnet,
  Migrationsabkommen geschlossen oder beendet, Freihandel, Handelsabkommen
  geschlossen, gebrochen, beendet oder ausgelaufen, Schonfrist läuft ab.
  Es gibt keine Banner und keine Ungelesen-Markierung.
- Bei der Kalibrierung messe ich die Einträge pro Spieljahr. Sind es zu
  viele, melde ich mich, bevor ich etwas ändere.

## 5. Performance und Benchmark

- Jährliche Rechnung pro Volkspaar.
- Kontaktentfernungen über einen Dijkstra-Lauf pro Volk und Jahr.
- Ziel: ein simuliertes Jahr höchstens 1,3-mal so teuer wie heute.
- **Neues Benchmark-Szenario `diplomacy`:** 300 Jahre, danach alle Grenzen
  offen. Auf der Karte erscheinen gestrichelte Grenzen überall.

## 6. Abnahme

- Tests für Kontakt, Teilwerte, Grenzentscheidung, Zoll in Waren und Geld
  (Siedler und Händler), Schonfrist, Freihandel, Handelsabkommen (Abschluss,
  Lieferung, Bruch) und Migrationsmalus.
- Kennzahlen aus 12 Testwelten nach 100, 200 und 300 Jahren:
  - Kontakte, offene Grenzen, Abkommen
  - Siedlungen über fremdes Land, Händlerfahrten durch fremdes Land
  - gezahlter Zoll in Waren und Geld
  - Außenhandel: Fahrten zu Partnern, Handelsabkommen, gelieferte Mengen,
    Brüche
  - Chronik-Einträge pro Jahr
  - Rechenzeit
- Das Design-Dokument wird aktualisiert.

## Stufe 2 (Krieg): Entscheidungen

Ausführlich in `Requirement Krieg.md`. Hier nur die Änderungen an der Diplomatie:
- **Gefahr aus Stärke** (siehe Abschnitt 1).
- **Kriegszustand:** Ein Krieg hebt alle Abkommen und offenen Grenzen zwischen den Kriegsparteien auf; Handel mit dem Gegner ruht. Nach dem Krieg: Vertrauen −30 (klingt in 10 Jahren ab), Grenzen zu, 20 Jahre Waffenstillstand.
- **Verteidigungspakt** (Vertrauen ≥ 40, gemeinsame Bedrohung durch ein drittes Volk, Gefahr ≥ 50; endet bei Vertrauen < 30 oder wenn die Gefahr beim Partner unter 35 fällt) und **Bündnis** (Vertrauen ≥ 80; unter 65 wird es zum Pakt herabgestuft). Keine Obergrenze. Vertrauen: Pakt +5, Bündnis +10 dauerhaft (zählen für offene Grenzen und Freihandel mit); Abschluss einmalig +10 (klingt in 10 Jahren ab). Erklärt ein Volk einem Verbündeten eines Bündnispartners den Krieg, endet das Bündnis mit diesem Partner (−30). Verbündete greifen einander nie an. Durchmarsch für Armeen von Verbündeten; Handel unverändert. Die Gefahr zählt Verbündete wie die 2×-Prüfung der Kriegserklärung: die Seite des anderen mit Pakten und Bündnissen, die eigene nur mit Bündnissen. Einzelheiten: `Requirement Krieg.md`, Abschnitt 7.
- **Verkauf strategischer Güter** (Handel und Handelsabkommen): nur an Völker, deren Gefahr für den Verkäufer ≤ X ist (40, in der Simulation von Phase 0 und 1 kalibriert), nie an Kriegsgegner und deren Verbündete.
- **Beziehung nach einer Revolution:** Rebellen sind Kriegsgegner des Mutterlands.

## Für Stufe 2 (Krieg) notiert, noch offen

- Stärke und Militär; die Gefahr wird dann aus der Stärke von
  Verteidigungs- und Angriffsbündnis berechnet statt aus der Bevölkerung.
- Bündnisse (Verteidigung und Angriff), Suche nach Verbündeten.
- Aufrüsten.
- Beziehung nach einer Revolution.
- Einfluss von Kultur und Glaubensunterschieden auf das Vertrauen.

## Für später notiert

**Nach dem Krieg:**
- Steuern und Geld des Volks.
- Wissen: Völker kennen von fremden Siedlungen nur angrenzende und
  Handelsgüter. Entscheidungen nutzen nur Wissen; Unbekanntes wird
  geschätzt.
- Spionage: dauerhaft, kostet Geld, deckt alle Eigenschaften der Felder
  auf. Bei Entdeckung weniger Vertrauen und mehr Gefahr.

## Entscheidungen

- Unter Freihandelspartnern bleibt der Zoll bestehen, aber günstiger
  (halber Zoll, Startwert).
- Lieferungen aus Handelsabkommen gehen auch ohne offene Grenzen.

Keine offenen Fragen.

## Umsetzung und Kalibrierung

Umgesetzt mit den Startwerten. Bei der Umsetzung entschieden bzw. ergänzt:

- **Handelsabkommen:**
  - Geschlossen wird nur, wenn eine Siedlung des Lieferanten mit Händlern
    einen Abnehmer auf Wegen erreicht. Das ist der Ausfuhrort.
  - Der Ausfuhrort verlangt die noch geschuldete Menge im eigenen Volk, so
    bringt der interne Handel die Ware dorthin.
  - Geschuldete Lieferungen haben Vorrang vor allen anderen Fahrten.
  - Bruch und Nachverhandeln: siehe `Requirement Regionale Rohstoffe.md`,
    Abschnitt 4 (ersetzt die frühere Regel, nach der ein Jahr nur zählte,
    solange der Abnehmer die Ware noch brauchte).
  - Nach Bruch oder Ablauf ruht dieselbe Ware 10 Jahre.
  - Bezahlt wird wie im internen Handel zu festen Preisen.
  - **Gegenware:** Fast alle Völker haben Holz und Stein übrig und es fehlen
    ihnen dieselben Luxusgüter. Würde A die Gegenware in Summe fehlen
    müssen, gäbe es so gut wie nie eine. Deshalb reicht es, dass
    Siedlungen von A sie verlangen.
  - Probiert werden die 2 wertvollsten Gegenwaren. Erreichen Händler von B
    für keine einen Abnehmer, wird das Abkommen einseitig.
  - Nach Ablauf werden beide Mengen neu verhandelt. Fehlt eine Seite, endet
    das Abkommen.
- **Migrationsabkommen:** endet, wenn das Vertrauen einer Seite unter 40
  fällt (vorher nicht festgelegt).
- **Händler und Zoll:** Händler zahlen den Zoll für Hin- und Rückweg beim
  Aufbruch.
- **Siedeln jenseits der Grenze:** durch höchstens 4 Felder offenes fremdes
  Land.
- **Anbindung an den Regierungssitz:** führt auch durch Land, das dem Volk
  offensteht.
- **Karte:** Jedes Volk zeichnet seine Seite der Grenze gestrichelt, wo es
  dem Nachbarn geöffnet hat. Einseitig offene Grenzen sind so erkennbar.
- **Diplomatie-Panel:** öffnet sich über „Diplomacy ›“ im Völker-Panel. Die
  untere Leiste hat auf Handybreite keinen Platz für einen dritten Knopf.

Kennzahlen aus 12 Testwelten (`npx tsx tools/diplomacyStats.ts`), nach
300 Jahren, im Mittel (Spanne):

| Kennzahl | Wert |
|---|---|
| Begegnungen pro Welt | 1,4 (0–6); die ersten nach etwa 200 Jahren |
| Volkspaare, die sich kennen | 17 % |
| Offene Grenzen / geschlossene | 1,0 / 0,3 |
| Freihandel / Migrationsabkommen | 0,1 / 0,9 |
| Handelsabkommen laufend (geschlossen einseitig / zweiseitig, gebrochen) | 0,4 (1,8 / 0,1; 0,4) |
| Vertrauen / Gefahr im Mittel | 38 / 23 |
| Ins Ausland geliefert / Zoll | 97 Einheiten / 45 Geld |
| Diplomatische Chronik-Einträge | 0,03 pro Spieljahr |
| Rechenzeit unter Node | 4,3 ms pro Jahr (ohne Diplomatie 3,4 ms, also 1,27-fach) |

Zweiseitige Handelsabkommen sind selten, weil die Völker meist nur Holz und
Stein übrig haben, die niemand braucht. Nach 500 Jahren (mehr Kontakte):
34 einseitige und 7 zweiseitige Abkommen je Welt geschlossen, 29 gebrochen,
10 ausgelaufen. Ohne Gegenware waren es 60 geschlossen und 46 gebrochen.
Auch wenn sich alle Völker kennen (Szenario `diplomacy`), findet sich bei
54 von 59 Versuchen keine Gegenware.

Geprüft und verworfen (der Nutzer bleibt nach dem Test bei 10): Mit 20 statt
10 Reisekosten Sichtweite gibt es etwa doppelt so viel Diplomatie:
- 3,5 Begegnungen
- 2,3 offene Grenzen
- 0,4 Freihandel
- 1,8 Migrationsabkommen

Die Rechenzeit liegt dann aber bei 4,7 ms, das 1,39-Fache und damit über
dem Ziel von 1,3.
