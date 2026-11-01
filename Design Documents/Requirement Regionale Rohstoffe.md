# Requirement: Regionale Rohstoffe und Handelsnetze

Stand: Schritt 1 umgesetzt mit den Zahlen aus der Simulation (Ablauf:
Design → Simulation → Umsetzung), Schritte 2 und 3 entworfen. Baut auf dem
internen Handel (`Requirement Handel.md`) und der Diplomatie
(`Requirement Diplomatie.md`) auf. Zahlen mit „?“ werden in der Simulation
bestimmt.

## 1. Ziel

Zivilisationen bilden Handelsnetze: Güter aus fremden Regionen werden in
andere gehandelt. Ein Volk kann Waren auch einführen, nur um sie in ein
anderes Land weiterzuverkaufen, wo es etwas gibt, das es selbst braucht.
Geld wird dadurch mehr wert.

## 2. Schritte

1. **Regionale Rohstoffe** (Abschnitt 3) und **verlässliche
   Handelsabkommen** (Abschnitt 4).
2. **Handelsspanne:** Geld über dem festen Preis als Gegenware (Abschnitt 5).
3. **Zwischenhandel** (Abschnitt 6).

Jeder Schritt wird mit 12 Testwelten simuliert (Siedlungswachstum, Handel,
Diplomatie, Vergleich mit vorher) und vor der Umsetzung mit dem Nutzer
abgestimmt.

## 3. Regionale Rohstoffe (Schritt 1)

- **Grundsammeln:** Jedes Feld sammelt 2 Holz und 2 Stein im Jahr.
- **Holz aus Wäldern:** Nur Wald und Dschungel sammeln dazu Holz nach ihrem
  Holzvorkommen (10 × Vorkommen: Wald etwa 9, Dschungel 10).
- **Stein aus Bergen:** Nur Hügel und Gebirge sammeln dazu Stein nach ihrem
  Steinvorkommen (10 × Vorkommen: Hügel etwa 6, Gebirge 9; Marmor-Vorkommen
  zählen dazu).
- Andere Gebiete bekommen kein zusätzliches Holz oder Stein aus ihrem
  Vorkommen.
- **Baubeschränkung:** Holzfällerlager und Sägewerk nur in Wald und
  Dschungel; Steinbruch und Steinmetz nur auf Hügeln und im Gebirge.
- **Teurere Gebäude:** Die Grundgebäude einer neuen Siedlung kosten wie
  bisher: Hütte, Felder, Brunnen, Holzfällerlager, Steinbruch,
  Versammlungsplatz, Handelszentrum, Hafen, Kornspeicher, Wasserträger. Alle
  anderen kosten in Bau und Unterhalt das 1,5-Fache an Holz und Stein.
- Damit können viele Siedlungen der Ebene zusammen eine Stadt versorgen,
  ein Wald aber mehrere Städte, und er kann ausführen. Große Städte werden
  seltener; das ist gewollt.

## 4. Verlässliche Handelsabkommen (Schritt 1)

Völker setzen viel daran, ihre Abkommen zu halten.

1. **Annahmepflicht:** Der Abnehmer hat zugestimmt und nimmt alles an, was
   das Abkommen schuldet, auch wenn seine Siedlungen es gerade nicht
   verlangen. Eine Siedlung des Lieferanten mit geschuldeter Ware auf Lager
   schickt dafür Händler los.
2. **Vorrang zum Ausfuhrort:** Fahrten im eigenen Volk, die dem Ausfuhrort
   geschuldete Ware bringen, haben denselben Vorrang wie die Lieferung, und
   mehr, je weiter das Volk im Rückstand ist.
3. **Bewertung alle 2 Jahre:** Lange Wege zählen nicht gegen ein
   Abkommen. Der erste Zeitraum ist zum Anlaufen und zählt nicht. Ware
   zählt als geliefert, sobald der Händler mit ihr aufbricht.
4. **Wer ist schuld:**
   - **Lieferant wollte nicht:** Die Ware lag am Ausfuhrort bereit, und
     trotzdem ging weniger als die Hälfte los. Nach 2 solchen Zeiträumen in
     Folge bricht das Abkommen, −20 Vertrauen beim Abnehmer wie bisher.
   - **Lieferant konnte nicht:** Am Ausfuhrort lag zu wenig. Eine andere
     Siedlung des Lieferanten mit der Ware auf Lager wird Ausfuhrort. Gibt es
     keine, wird die Menge nach 2 knappen Zeiträumen in Folge halbiert, ohne
     Vertrauensverlust. Unter der Mindestmenge (2) endet das Abkommen still.
5. Die frühere Grenze „höchstens, was die erreichbaren Abnehmer verlangen“
   entfällt durch die Annahmepflicht.

## 5. Handelsspanne (Schritt 2)

- Zwischen Völkern (nicht im eigenen Volk) verkaufen Händler über dem
  festen Preis: Spanne ? (Vorschlag +50 %).
- Die empfangende Siedlung zahlt. Kann sie nicht zahlen, wird nur
  geliefert, was sie bezahlen kann.
- Geld über dem Marktpreis zählt bei Handelsabkommen als Gegenware.

## 6. Zwischenhandel (Schritt 3)

- Eine Siedlung darf Waren einkaufen, die sie selbst nicht braucht, solange
  ein Handelspartner ihres Volks sie verlangt, und sie weiterverkaufen.
- Als Gegenware eines Handelsabkommens zählen auch Waren, die der Abnehmer
  selbst aus einem anderen Abkommen bezieht.
- Zwischenlager: getestet wird eine Grenze für den Vorrat pro Siedlung.

## 7. Simulation und Kalibrierung (Schritt 1)

Werkzeug: `npx tsx tools/economyStats.ts [Welten] [Jahre]`. 12 bzw. 24
Testwelten, im Mittel nach 500 Jahren.

**Kostenfaktor auf alle Gebäude** (verworfen, nach 300 Jahren, Grundsammeln 1):

| | vorher | ×1 | ×1,5 | ×2 | ×3 |
|---|---|---|---|---|---|
| Menschen | 5.621 | 4.980 | 4.231 | 4.007 | 3.880 |
| Gebäude | 192 | 134 | 60 | 58 | 45 |
| Gehandelt | 14.954 | 8.674 | 147 | 27 | 0 |

Ab 1,5 entsteht kein Handel mehr: Handelszentren sind auf der Ebene
unbezahlbar. Deshalb bleiben die Grundgebäude billig.

**Grundsammeln** (Grundgebäude billig, Rest ×1,5, 12 Welten):

| | vorher | 1 | 1,5 | **2** |
|---|---|---|---|---|
| Völker | 9,3 | 15,2 | 11,7 | 9,7 |
| Aufstände je Welt | 2,4 | 7,5 | 3,5 | 3,3 |
| Menschen | 14.012 | 12.710 | 12.981 | 13.922 |
| Gebäude | 554 | 437 | 465 | 563 |
| Holz / Stein gehandelt | 2.370 / 824 | 3.247 / 3.078 | 3.600 / 3.530 | 4.868 / 3.209 |
| Große Städte (150+) | 2,2 | 0,3 | 0,1 | 1,3 |

Mit Grundsammeln 1 fehlt Siedlungen ohne Wald das Holz für den
Versammlungsplatz: Ihr Komfort fällt (bei unzufriedenen Siedlungen von +5,5
auf +1,3), sie werden unzufrieden und spalten sich ab.

**Handelsabkommen** (Anteil der geschlossenen Abkommen, 24 Welten):

| | gebrochen | still beendet | regulär ausgelaufen | läuft noch |
|---|---|---|---|---|
| vor Schritt 1 | 71 % | – | 24 % | – |
| ohne Optionen | 13 % | 36 % | 42 % | 10 % |
| anderer Ausfuhrort | 17 % | 28 % | 46 % | 9 % |
| Bewertung alle 2 Jahre | 5 % | 34 % | 49 % | 11 % |
| beides | 8 % | 26 % | 54 % | 12 % |
| **beides, halbieren nach 2 Zeiträumen** | **8 %** | **16 %** | **63 %** | **13 %** |

Ursachen vorher: Der Abnehmer nahm nur, was seine Siedlungen gerade
verlangten (oft 1–2 Stück), und in 42 % der knappen Jahre lag am
Ausfuhrort nichts.

**Ergebnis mit den gewählten Werten** (24 Welten, 500 Jahre): 15.635
Menschen, 11,7 Völker, 221 Siedlungen, 641 Gebäude, 5.223 Holz und 3.319
Stein gehandelt, 4.604 Einheiten ins Ausland, 23 Handelsabkommen je Welt
(davon 3,9 zweiseitig), 4,4 Aufstände.
