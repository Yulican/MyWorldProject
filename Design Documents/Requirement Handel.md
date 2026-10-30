# Requirement: Interner Handel

Stand: Entwurf zur Freigabe. Grundlage: Diskussion mit dem Nutzer; baut auf
dem Gebäude-Feature und der Zufriedenheit (`Requirement Zufriedenheit.md`)
auf. Zahlen sind Startwerte aus dem Prototyp (Abschnitt 9).

## 1. Ziel

Siedlungen eines Volks tauschen, was sie übrig haben, gegen das, was ihnen
fehlt. Händler bringen Holz, Stein, Getreide, Wasser und Luxusgüter über
Wege von Siedlung zu Siedlung und werden in Geld bezahlt. Handel mit
anderen Völkern gehört zur späteren Außenpolitik.

## 2. Waren

| Ware | Gewicht/Einheit | Preis | Herkunft |
|---|---|---|---|
| Holz | 1 | 1 | Ernte (Gebäude-Feature) |
| Stein | 1,5 | 1,5 | Ernte |
| Geld | 0,1 | – | 0,1 je Erwachsenem (ab 16) und Jahr |
| Getreide | 1 | 1 | Kornspeicher |
| Wasser (Fässer) | 1 | 1 | Wasserträger |
| Luxusgüter (6) | 0,5 | 5 | Abbaugebäude (Zufriedenheit) |

- Ein Händler trägt 20 Gewichtseinheiten.
- Feste Preise; Preise nach Knappheit kommen mit dem Außenhandel.
- Geld für Unterhalt, Steuern und Tribut kommt später.

## 3. Getreide und Wasser als Ware

- **Kornspeicher:** −25 Nahrung, dafür +25 Getreide pro Jahr.
  Kosten 15 Holz + 5 Stein, Unterhalt 1 Holz, 1 Jahr Bauzeit.
- **Wasserträger:** −25 Wasser, dafür +25 Fässer pro Jahr.
  Kosten 10 Holz + 5 Stein, Unterhalt 1 Holz, 1 Jahr Bauzeit.
- Gebaut nur aus Überschuss: wenn das Feld mindestens 25 mehr Nahrung bzw.
  Wasser hat, als es Menschen trägt, und sein Volk mehr verlangt, als es
  auf Vorrat hat und herstellt. Der Exporteur verliert so keine Menschen.
- **Verbrauch:** Getreide und Fässer im Vorrat zählen als Nahrung bzw.
  Wasser, höchstens 50 Menschen („Grain in stock“ als eigene Zeile). Am
  Jahresende essen und trinken die Menschen davon, was ihnen fehlt.
- Bleiben Lieferungen aus, sinkt die Tragfähigkeit, und die Mangelregel
  greift.

## 4. Händler, Handelszentrum, Hafen

- **Handelszentrum:** 2 Händler. Kosten 25 Holz + 15 Stein, Unterhalt
  1 Holz + 1 Stein, 2 Jahre Bauzeit.
- **Hafen:** nur an Meer oder See, 2 Händler, öffnet das Wasser für den
  Handel. Kosten 30 Holz + 10 Stein, Unterhalt 1 Holz + 1 Stein, 2 Jahre.
  Jeder Hafen des Volks steht allen Händlern dieses Volks offen.
- Ein Handelsgebäude auf einer Seite reicht.
- Händler sind keine Bewohner, sondern Fahrten (flache Arrays). Sie werden
  auf der Karte nicht gezeigt; die Info-Leiste zeigt Händler, Lieferungen
  und Ein- und Ausfuhr.

## 5. Was gehandelt wird

Jedes Quartal kennt jede Siedlung, was sie verlangt und was sie übrig hat:

| Ware | verlangt | übrig |
|---|---|---|
| Holz, Stein | was dem Gebäude fehlt, auf das sie spart | was über dem Sparziel und 2 Jahren Unterhalt (mindestens 10) liegt |
| Getreide, Wasser | wenn das die knappste Versorgung ist und das Feld halb voll: bis zur nächsten Grenze, höchstens 50 | was die eigenen Leute nicht brauchen |
| Luxusgüter | 2 Jahre Bedarf (0,05 je Person) | was darüber liegt |

- Ein freier Händler wählt unter allen erreichbaren Siedlungen seines Volks
  die Fahrt mit dem meisten Wert pro Woche Hin- und Rückweg:
  - **Hinweg:** was daheim übrig ist und dort verlangt wird, teuerste Ware
    pro Gewicht zuerst.
  - **Rückweg:** was daheim verlangt wird und dort übrig ist, soweit das
    Geld von daheim reicht.
- Eine Fahrt muss mindestens 5 Geld wert sein.
- Bezahlt wird bei Ankunft in Geld. Reicht das Geld des Käufers nicht,
  zahlt er mit Waren, die daheim verlangt werden.

## 6. Wege

Händler reisen nur auf Wegen, nie durch Land eines anderen Volks:

| Weg | Reisezeit (× Geländekosten) |
|---|---|
| Straße | × 0,5 |
| Fluss flussabwärts | × 0,25 |
| Fluss flussaufwärts | × 0,75 |
| vom Ufer auf den Fluss und zurück | × 0,5 |
| Wasser zwischen zwei Häfen | 1 pro Feld, höchstens 12 Felder |

- Eine Kosteneinheit ist eine Woche. Eine Fahrt geht höchstens 26 Wochen
  weit.
- **Ufer:** Die Nachbarfelder eines Flussfelds gelten als angebunden.
- **Seewege:** Auch eine Meerengstelle braucht an beiden Ufern einen Hafen.
- **Straßenbau:** Wäre der Weg zum letzten Handelspartner auf einer Straße
  über eigenes oder freies Land um mindestens 25 % kürzer, baut die
  Siedlung jedes Quartal das nächste fehlende Stück. Ein Stück kostet
  3 Holz + 3 Stein × Geländekosten, ohne das Sparziel anzugreifen.
- **Flüsse:** Flüsse fließen jetzt garantiert bergab. Das Flussbett wird
  eingegraben, wo die Generierung eine Senke aufgefüllt hatte (vorher
  9 bis 22 Flussschritte pro Welt bergauf, bis zu 250 m).

## 7. Verlust

- Für jedes durchquerte Feld besteht eine Chance, ein Viertel der Ladung
  zu verlieren: 0,5 % an Land, 1,5 % auf Wasser, jeweils plus 1 % ×
  Gefahr des Felds.
- Die Würfe sind deterministisch (eigener Zufallsgenerator „trade“).

## 8. Bauentscheidung

- Handelsgebäude kommen nach Wachstum und Zufriedenheit. Einmal im Jahr,
  wenn eine Siedlung (mindestens 25 Einwohner) nichts anderes baut, prüft
  sie:
  - **Handelszentrum:** wenn eine Fahrt mit mindestens 15 Geld Wert
    erreichbar ist.
  - **Hafen:** wenn Häfen hier und an allen Küstensiedlungen des Volks die
    beste Fahrt um mindestens 25 % verbessern würden.
  - **Kornspeicher, Wasserträger:** siehe Abschnitt 3.
- Gebaut wird nur, wenn die Kosten im Vorrat liegen und die Ernte den
  Unterhalt dauerhaft trägt.

## 9. Prototyp-Ergebnisse (12 Welten, je 300 Jahre)

| | ohne Handel | mit Handel |
|---|---|---|
| Menschen | 57.111 | 65.321 (+14 %) |
| besiedelte Felder | 784 | 878 (+12 %) |
| Rechenzeit | 15,5 s | 19,3 s (+24 %) |

- **Fahrten:** 8.257, also etwa 2,3 pro Welt und Jahr.
- **Straßenstücke:** 210, etwa 17 pro Welt.
- **Geliefert:** Getreide 44.600, Wasser 43.400, Holz 3.400, Stein 760,
  Salz 300; andere Luxusgüter 0.
- **Verloren:** etwa 0,4 % der Ware.
- **Gebäude:** 170 Handelszentren (19 % der Siedlungen), 39 Kornspeicher,
  61 Wasserträger, 0 Häfen. Eine frühere Fassung ohne Grenze für
  Kornspeicher und Wasserträger baute 352 Wasserträger.
- **Geld:** liegt fast ungenutzt im Vorrat (333.000, etwa 380 je
  Siedlung). Es entsteht, wird aber nirgends verbraucht.

## 10. Offene Punkte zur Entscheidung

1. **Geld ohne Senke:** Geld sammelt sich an, weil nur gekauft wird, was
   fehlt. Bis Unterhalt, Steuern und Tribut kommen, schlage ich vor, das so
   zu lassen.
2. **Verlust kaum spürbar (0,4 %):** Die meisten Fahrten sind kurz. Für
   spürbare Verluste die Chancen etwa vervierfachen (2 % an Land, 6 % auf
   Wasser), dann gehen um 2 % verloren.
3. **Häfen werden nie gebaut:** Ein Volk siedelt nie übers Wasser, sein
   Land hängt immer über Land zusammen. Seewege sind deshalb nur
   Abkürzungen. Nach 300 Jahren lohnt sich in 3 Testwelten nur für 4 von
   91 Küstensiedlungen überhaupt eine Fahrt. Optionen:
   - so lassen (Häfen werden wichtig mit Außenhandel oder Besiedlung über
     Wasser)
   - die Hürde senken, z. B. Hafen schon, wenn die beste Fahrt übers Wasser
     kürzer ist
4. **Kaum Luxushandel:** Abbaugebäude für Luxusgüter baut nur eine
   unzufriedene Siedlung für sich selbst (2 in 12 Welten). Vorschlag: Ein
   Feld mit Vorkommen baut sein Abbaugebäude auch, wenn sein Volk das Gut
   verlangt (wie Kornspeicher). Das macht den Luxushandel der
   Zufriedenheit erst lebendig.

## 11. Benchmark und Darstellung

- Neues Szenario `trade`: 300 Jahre, danach bekommt jede Siedlung ein
  Handelszentrum und jede Küstensiedlung einen Hafen.
- Die Info-Leiste zeigt Geld, Getreide, Fässer, Händler daheim und
  unterwegs, die Ein- und Ausfuhr; „Grain in stock“ erscheint als Zeile
  bei der Nahrung.
- Häfen bekommen ein Icon auf der Karte.
