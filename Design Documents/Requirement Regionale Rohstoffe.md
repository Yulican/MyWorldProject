# Requirement: Regionale Rohstoffe und Handelsnetze

Stand: Schritte 1 und 2 umgesetzt mit den Zahlen aus der Simulation
(Ablauf: Design → Simulation → Umsetzung), Handelsspanne zurückgestellt. Baut auf dem
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
2. **Zwischenhandel, gezielter Luxusabbau, Ausbau der Ebene** (Abschnitt 6).
3. **Handelsspanne** (Abschnitt 5), zurückgestellt bis nach dem
   Zwischenhandel.

Jeder Schritt wird mit 12 Testwelten simuliert (Siedlungswachstum, Handel,
Diplomatie, Vergleich mit vorher) und vor der Umsetzung mit dem Nutzer
abgestimmt.

## 3. Regionale Rohstoffe (Schritt 1)

- **Grundsammeln:** Jedes Feld sammelt 2 Holz und 2 Stein im Jahr.
- **Holz aus Wäldern:** Nur Wald und Dschungel sammeln dazu Holz nach ihrem
  Holzvorkommen (5 × Vorkommen: Wald etwa 4,5, Dschungel 5; in Schritt 1
  noch 10 ×, in Schritt 2 gesenkt, weil Holz und Stein sich stapelten).
- **Stein aus Bergen:** Nur Hügel und Gebirge sammeln dazu Stein nach ihrem
  Steinvorkommen (5 × Vorkommen: Hügel etwa 3, Gebirge 4,5; Marmor-Vorkommen
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

## 5. Handelsspanne (zurückgestellt)

Freigegeben: Spanne nur zwischen Völkern, die empfangende Siedlung zahlt,
Geld über dem Marktpreis zählt bei Handelsabkommen als Gegenware.
Vorgeschlagen: Spanne in beide Richtungen, eine fremde Siedlung bekommt nur,
was sie bezahlen kann; einseitige Abkommen zahlen mit Spanne, zweiseitige
tauschen zum festen Preis.

Nach der Simulation vom Nutzer zurückgestellt, bis der Zwischenhandel
steht; dann wird die Höhe neu kalibriert. Ergebnis (24 Welten, 500 Jahre,
Spanne 0 / 25 / 50 / 100 %): ins Ausland geliefert 4.033 / 5.122 / 4.435 /
4.630, gezahlte Spanne 0 / 2.113 / 3.748 / 7.225 Geld (bei rund 170.000
Geld aller Völker), Abkommen gebrochen 9 / 9 / 16 / 11 %. Die Unterschiede
liegen im Rauschen: Handel mit anderen Völkern ist nur gut 6 % des
Handels, die Spanne verschiebt vor allem Geld.

## 6. Zwischenhandel, Luxusabbau, Ausbau der Ebene (Schritt 2)

**Zwischenhandel**
- Zwischenhändler sind nur Siedlungen mit Händlern (Handelszentrum oder
  Hafen): für jeden Handelspartner des Volks (Freihandel, Abnehmer eines
  Handelsabkommens) die Siedlung, die ihn am schnellsten erreicht. Sie wird
  einmal im Jahr bestimmt, je Volk in der Woche seiner Nummer.
- Fehlt dem Partner eine Ware in Summe, verlangt der Zwischenhändler sie
  zusätzlich zum eigenen Bedarf, höchstens eine Händlerladung, und hält sie
  für den Partner bereit. Sie kommt aus dem eigenen Volk oder von einem
  anderen Partner (Weiterverkauf A → B → C).
- **Reserve:** Was er für den Partner hält, verbrauchen seine eigenen
  Bewohner nicht.
- Bezahlt wird zum festen Preis (ohne Spanne).
- **Gegenware über Dritte:** Bei Handelsabkommen zählt als Gegenware auch,
  was der Abnehmer von seinen anderen Partnern bekommen kann (was diese in
  Summe übrig haben).
- Eine Lagergrenze gibt es nicht. Getestet und verworfen: Mit 1.000 Einheiten
  pro Siedlung (Rest verdirbt) mehr Handel, aber etwa 5 % weniger Menschen
  und mehr Verderb als insgesamt gehandelt wird. Die Ernte bei vollem Lager
  zu drosseln, kann später als Rechenzeit-Verbesserung dienen.

**Gezielter Luxusabbau**
- Luxusgüter sind strategisch wichtig. Eine Siedlung auf einem
  Luxus-Vorkommen baut das Abbaugebäude, sobald ihr Volk oder einer seiner
  Handelspartner die Ware in Summe vermisst, auch wenn sie selbst zufrieden
  ist (bisher nur, wenn sie unzufrieden war; Pferde, Marmor und Edelsteine
  wurden so nie abgebaut).
- Deckt ihre Ernte den Unterhalt nicht, kommt er über den Handel, sofern
  ihr Volk Holz und Stein übrig hat.

**Ausbau der Ebene**
- Ebenen haben 6 statt 4 Bauplätze. Wälder und Gebirge liefern das Holz
  und den Stein dafür.
- Grundsammeln bleibt bei 2; mit 1,5 oder 1 werden Regierungssitze
  unbezahlbar (16 % weniger Menschen, Aufstände bis 8,5 je Welt).

**Händler**
- Ein Händler trägt 40 statt 20 Gewichtseinheiten. Mehr Händler pro Gebäude
  (6 oder 8 statt 4) brachten dagegen kaum etwas: Engpass war die Nachfrage,
  nicht die Zahl der Händler.

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

## 8. Simulation und Kalibrierung (Schritt 2)

24 Welten, 500 Jahre, alle mit Zwischenhandel und Reserve
(`npx tsx tools/economyStats.ts 24 500`).

| | heute | Faktor 5 + Ladung 40 | + Luxusabbau | **+ 6 Plätze Ebene, Grund 2** | … Grund 1,5 | … Grund 1 |
|---|---|---|---|---|---|---|
| Menschen | 15.375 | 16.074 | 15.154 | **16.793** | 12.935 | 13.011 |
| Völker | 10,7 | 12,3 | 10,8 | 13,4 | 14,3 | 17,2 |
| Gebäude | 629 | 654 | 612 | **722** | 481 | 458 |
| Große Städte | 1,0 | 0,8 | 0,9 | **1,9** | 0,3 | 0,6 |
| Holz / Stein auf Lager je Siedlung | 454 / 289 | 234 / 223 | 241 / 231 | 248 / 236 | 254 / 200 | 181 / 161 |
| Luxus-Abbaugebäude | 1,3 | 1,4 | 3,9 | 4,2 | 3,6 | 3,4 |
| Siedlungen mit Luxusgütern | 4,8 % | 5,2 % | 11,1 % | 10,6 % | 10,1 % | 9,0 % |
| Ins Ausland (davon Zwischenhandel) | 4.910 (1.485) | 9.559 (3.594) | 7.039 (3.062) | 7.652 (3.044) | 4.467 (2.191) | 7.948 (3.969) |
| Abkommen einseitig / zweiseitig | 21 / 4,4 | 36 / 9,5 | 39 / 7,8 | 47 / 9,3 | 40 / 3,2 | 52 / 7,1 |
| Aufstände je Welt | 3,6 | 4,3 | 3,4 | 5,3 | 5,7 | 8,5 |

Gewählt: Faktor 5, Ladung 40, gezielter Luxusabbau, 6 Bauplätze in der
Ebene, Grundsammeln 2 (fett). Ohne Zwischenhandel gegenüber mit: ins
Ausland 4.604 statt 5.148, davon 0 statt 1.304 im Zwischenhandel; die
Reserve hebt den Zwischenhandel um 14 %.

**Überproduktion vorher** (je Siedlung nach 500 Jahren): 499 Holz und 344
Stein auf Lager bei einem Bedarf unter 1; Wasser 110, Getreide 50. Holz
wurde nur verlangt, wenn eine Siedlung auf ein Gebäude sparte, und das tat
fast keine.

**Aufstandsgründe** (Teilwert, der bei den aufständischen Siedlungen am
schwersten wog): Enge rund 50 %, weiter Weg zum Regierungssitz rund 25 %,
keine Straße zum Regierungssitz 5–16 %, verlorene Revolution bis 10 %.
Fehlende Luxusgüter spielen keine Rolle. Mit 6 Bauplätzen steigen die
Aufstände von 3,6 auf 5,3 je Welt; das wird gesondert untersucht.

**Rechenzeit** (Node, 5 Welten nach 300 Jahren, je 5 Jahre): Ein Tick
belegt weniger Speicher als vorher (aged 13,8 statt 14,6 KB, diplomacy
20,0 statt 21,6 KB), der Median ist durch mehr Siedlungen und Gebäude etwa
25 % langsamer, der langsamste Tick 4,2 ms (aged) bzw. 6,3 ms (diplomacy).

