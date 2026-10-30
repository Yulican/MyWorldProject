# Roadmap: Rohstoffe, Bewohner, Zivilisationen

Arbeitsstand der Anforderungen, bevor sie ins Game-Design-Dokument übernommen werden. Ist eine Stufe umgesetzt, kommen ihre Regeln ins Game-Design-Dokument, und hier bleibt nur der Status.

## Ziel

Zuerst werden Rohstoffe, Bewohner und Zivilisationen fertig ausgebaut. Am Ende soll die Simulation dynamisch und interessant sein. Gebete, Einflusspunkte und Gacha kommen erst danach.

Grundsätze für alle Stufen:

- **Bedürfnisorientiert:** Siedlungen und Zivilisationen handeln, weil ihnen etwas fehlt. Das knappste Gut entscheidet, was sie als Nächstes tun.
- **Abhängig von den Hexfeldern:** Jede Mechanik hängt von den Eigenschaften der Hexfelder ab: Biom, Fruchtbarkeit, Wild, Fisch, Holz, Stein, Erz, Feuchtigkeit, Flüsse, Gefahr. Dasselbe Verhalten fällt auf unterschiedlichem Land unterschiedlich aus.
- **Keine Mechanik ohne Anlass:** Es wird nur gebaut, was mit dem heutigen Stand der Welt etwas bewirkt. Speicher für schlechte Zeiten zum Beispiel kommen erst, wenn es schlechte Zeiten gibt (Ernteschwankungen, Katastrophen).
- **Einheit ist die Siedlung:** Bedarf, Vorräte und Gebäude werden pro Hexfeld geführt, in flachen Arrays, nicht pro Bewohner. Zivilisationen entscheiden anhand der Summe ihrer Siedlungen.

## Stufen

| Stufe | Inhalt | Status |
|---|---|---|
| 1 | Grundbedürfnisse: Nahrung, Wasser, Platz, Aussiedeln, Straßen | in Arbeit (Branch `ccr-ba68a483-8xlwdq`) |
| 2 | Holz und Stein, Gebäude | geplant, Anforderungen unten |
| 3 | Werkzeug | Idee |
| 4 | Glück | Idee |

### Stufe 1: Grundbedürfnisse (in Arbeit)

Umgesetzt auf dem Branch, aber noch nicht gemergt:

- Jedes Hexfeld liefert Nahrung, Wasser und Platz.
- Wird es knapp, siedeln 25 Menschen auf das beste freie Nachbarfeld aus, und zwischen beiden Feldern entsteht eine Straße.

Noch offen, bevor die Stufe fertig ist:

- **Benchmark:** Im letzten CI-Lauf ist 1 von 400 Wischern durchgefallen (Seed 27045684, Richtung NW, ein Frame mit 66,7 ms). Der Fehler muss behoben sein, bevor gemergt wird.
- **Gezielt aussiedeln:** Siedler suchen nicht nur unter den direkten Nachbarfeldern, sondern im Umkreis von einigen Hexfeldern. Bevorzugt werden Land an Flüssen und fruchtbares Land, das das knappe Gut der Herkunftssiedlung reichlich liefert. Wer weiter weg siedelt, baut die Straße über die ganze Strecke. Die Reichweite hängt von den Reisekosten ab, Straßen verlängern sie. Über Wasser geht es weiterhin nicht.

Zurückgestellt:

- **Ganze Siedlungen ziehen weg, wenn ihr Feld schlechter wird.** Das kommt erst, wenn Hexfelder schlechter werden können (Erschöpfung, Katastrophen).
- **Vorräte.** Die kommen erst mit schlechten Zeiten.

### Stufe 2: Holz und Stein, Gebäude

**Abbau**

- Siedlungen bauen Holz und Stein im eigenen Hexfeld und in den direkten Nachbarfeldern ab. Weiter entfernt geht das erst mit dem Handel.
- Holz wächst bis zur natürlichen Kapazität nach (`resourceCapacity`). Stein wächst nicht nach.
- Das Abgebaute kommt in einen Baustoffvorrat der Siedlung. Der Vorrat ist nur für Gebäude da, nicht für Nahrung.
- Abgebaut wird nur, wenn die Siedlung etwas bauen will. So bleibt die Rechenzeit klein und es wird nicht auf Vorrat gerodet.

**Gebäude**

Gebäude wirken nur auf das, was es heute schon gibt: mehr Bewohner (Platz), mehr Nahrung, mehr Wasser. Wie stark sie wirken, hängt von den Eigenschaften des Hexfelds ab.

Vorschlag für die erste Auswahl, die Werte legt die Umsetzung fest:

| Gebäude | Baustoff | Wirkung | Abhängig von |
|---|---|---|---|
| Hütten | Holz | + Platz | Biom: Ebene viel, Gebirge wenig |
| Äcker | Holz | + Nahrung | Fruchtbarkeit des Felds |
| Fischersteg | Holz | + Nahrung aus Fisch | Fisch im Feld und im angrenzenden Wasser; nur an Küste und See |
| Brunnen | Stein | + Wasser | Feuchtigkeit (Grundwasser); in der Wüste wenig |

- **Bedürfnisorientiert:** Eine Siedlung baut, was ihr knappstes Gut erhöht, und zwar dort, wo das Feld es hergibt. Lohnt sich kein Gebäude, weil das Feld zum Beispiel keinen Fisch und keine Fruchtbarkeit hat, siedelt sie wie in Stufe 1 aus. Bauen und Aussiedeln konkurrieren also miteinander: Es soll Siedlungen geben, die in die Höhe wachsen, und solche, die in die Breite gehen.
- Gebäude haben Stufen oder Anzahlen pro Hexfeld und eine Obergrenze. Jedes weitere Gebäude derselben Art bringt weniger.
- Fehlt der Baustoff, wartet die Siedlung oder siedelt aus. Ein Waldfeld neben Gebirge hat zum Beispiel Holz, aber keinen Stein für einen Brunnen.
- Die Hexfeld-Info zeigt die Gebäude, den Baustoffvorrat und wie viel Holz und Stein im Feld noch vorhanden ist.

**Darstellung**

- Siedlungen mit Gebäuden sehen auf der Karte größer und dichter aus. Die Zeichnung bleibt Teil der Gebietsebene.
- Ein neues Benchmark-Szenario in `src/bench/` deckt Welten mit vielen bebauten Siedlungen ab. Es muss wie alle anderen bestehen.

**Abnahme**

- Tests für Abbau, Nachwachsen, Bauentscheidung und Gebäudewirkung (`npm test`).
- Kennzahlen aus mindestens 12 Testwelten nach 100, 200 und 300 Jahren, die ins Design-Dokument kommen:
  - Bevölkerung,
  - besiedelte Felder,
  - Anteil der Felder, die nach oben wachsen statt in die Breite,
  - verbrauchtes Holz und verbrauchter Stein.
- Die Rechenzeit pro simuliertem Jahr wird gemessen. Ziel: nicht mehr als 1,5-mal so viel wie in Stufe 1 (derzeit etwa 1,2 ms unter Node).
- Das Game-Design-Dokument ist aktualisiert (Abschnitte 4, 5, 6).
- Der CI-Job `test` ist grün, einschließlich des Benchmarks.

### Stufe 3: Werkzeug (Idee)

- Werkzeug erhöht, wie viel beim Abbau und bei der Nahrung herauskommt.
- Material: zuerst Stein (Feuerstein), dann Metalle aus Erz und Sondervorkommen (Kupfer, Zinn, Eisen).
- Offen: Werkzeugstufen, Verschleiß, ob Werkzeug eine Voraussetzung für bestimmte Gebäude ist.

### Stufe 4: Glück (Idee)

- Glück ergibt sich daraus, wie gut die Bedürfnisse einer Siedlung erfüllt sind.
- Wirkung: auf Geburten, Abwanderung und später auf Abspaltungen.
- Glück ist die Brücke zu Glauben und Gebeten: Laut Design entstehen Gebete aus Not und Dankbarkeit.
- Offen: welche Bedürfnisse über die Grundbedürfnisse hinaus zählen (Sicherheit, Gemeinschaft, Sinn).
