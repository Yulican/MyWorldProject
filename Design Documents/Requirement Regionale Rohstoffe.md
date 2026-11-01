# Requirement: Regionale Rohstoffe und Handelsnetze

Stand: Design vom Nutzer freigegeben, Simulation läuft (Ablauf: Design →
Simulation → Umsetzung). Baut auf dem internen Handel
(`Requirement Handel.md`) und der Diplomatie (`Requirement Diplomatie.md`)
auf. Zahlen mit „?“ werden in der Simulation bestimmt.

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

- **Grundsammeln bleibt:** Jedes Feld sammelt 1 Holz und 1 Stein im Jahr.
- **Holz aus Wäldern:** Nur Wald und Dschungel sammeln dazu Holz nach ihrem
  Holzvorkommen (10 × Vorkommen: Wald 9, Dschungel 10).
- **Stein aus Bergen:** Nur Hügel und Gebirge sammeln dazu Stein nach ihrem
  Steinvorkommen (10 × Vorkommen: Hügel 6, Gebirge 9; Marmor-Vorkommen
  zählen dazu).
- Andere Gebiete bekommen kein zusätzliches Holz oder Stein aus ihrem
  Vorkommen (bisher z. B. Ebene 1 Holz und 1,5 Stein mehr).
- **Baubeschränkung:** Holzfällerlager und Sägewerk nur in Wald und
  Dschungel; Steinbruch und Steinmetz nur auf Hügeln und im Gebirge.
- **Gebäude werden wesentlich teurer:** Baukosten und Unterhalt in Holz und
  Stein × Faktor ? (Simulation: 1,5; 2; 3).
- Damit können viele Siedlungen der Ebene zusammen eine Stadt versorgen,
  ein Wald aber mehrere Städte, und er kann ausführen.
- **Lagerplatz:** In der Simulation wird zusätzlich getestet, den Vorrat
  pro Siedlung und Ware zu begrenzen (?).

## 4. Verlässliche Handelsabkommen (Schritt 1)

Völker setzen viel daran, ihre Abkommen zu halten. Brechen soll selten
sein (Ziel: deutlich unter 10 % der Abkommen).

1. **Machbare Menge:** Vereinbart wird höchstens, was die Siedlungen des
   Abnehmers verlangen, die Händler vom Ausfuhrort aus erreichen.
2. **Vorrang zum Ausfuhrort:** Fahrten im eigenen Volk, die dem Ausfuhrort
   geschuldete Ware bringen, haben denselben Vorrang wie die Lieferung.
3. **Anlaufjahr:** Das erste Vertragsjahr zählt nicht für einen Bruch.
   Ware zählt als geliefert, sobald der Händler mit ihr aufbricht.
4. **Nachverhandeln statt brechen:** Kommt weniger als die Hälfte an, wird
   die Menge auf das Gelieferte gesenkt, ohne Vertrauensverlust; unter der
   Mindestmenge läuft das Abkommen aus. Als Bruch zählt nur, wenn die Ware
   am Ausfuhrort bereitlag und trotzdem nicht geliefert wurde (2 Jahre in
   Folge, −20 wie bisher).

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
