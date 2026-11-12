# Requirement: Krieg

Stand: **Phase 0 und 1 umgesetzt, Phase 2 (Schlacht) umgesetzt, Phasen 3 bis 5 vom Nutzer entschieden, aber noch nicht simuliert** (Branch `feature/war`). Ablauf: Design → Simulation → Umsetzung. Alle Zahlen sind Startwerte; was noch gerechnet werden muss, ist mit „kalibrieren (Simulation)“ markiert. Spieltexte sind Englisch.

Baut auf Diplomatie (`Requirement Diplomatie.md`, Stufe 2), Zufriedenheit (`Requirement Zufriedenheit.md`), Zentralregierung (`Requirement Zentralregierung.md`), regionalen Rohstoffen (`Requirement Regionale Rohstoffe.md`, strategische Güter) und Handel auf.

**Änderung durch Anführer (`Requirement Anführer.md`, entschieden, Zahlen vorläufig):** Jedes Volk wird von einem Anführer mit Attributen und Ziel regiert. Er verschiebt die Hebel dieses Dokuments: Kriegswurf (§6, Grundwert 10 %, höchstens 30 %), 2×-Schwelle (§6, nie unter 1,2×), Aufgabeschwelle und Erschöpfung (§6), Pakt- und Bündnisschwellen sowie Kriegsbeitritt (§7), Rebellionsschwelle (§8), Soldatenstärke und Sold (§2). Die Zahlen in diesem Dokument sind die Grundwerte.

## 1. Ziel

Völker rüsten auf, bedrohen einander, erklären Kriege um Regierungssitze und Bezirke, schließen Bündnisse. Aufstände laufen künftig ebenfalls als Krieg ab. Gebäude, Güter und Geld des Volks bekommen damit einen militärischen Zweck.

## 2. Soldaten und Stärke

Zahlen von Phase 0 und 1 sind simuliert und vom Nutzer gewählt (Abschnitt 14); die übrigen bleiben „kalibrieren (Simulation)“.

- **Ausbildung:** Militärgebäude bilden jährlich Soldaten aus der Bevölkerung aus: 25 % der Gebäudekapazität pro Jahr, nur wenn der Sold des nächsten Jahres gedeckt ist. Soldaten werden von der Bevölkerung abgezogen (sie kosten Wachstum und Ernte).
  - **Grenzen:** Höchstens 10 % der Bevölkerung einer Siedlung sind Soldaten; pro Jahr werden höchstens 50 % ihrer Erwachsenen ausgebildet.
  - **Rückkehr:** Soldaten über der Kapazität eines Gebäudes, oder deren Siedlung ihren Bezirk verliert, kommen in die Bevölkerung zurück.
- **Soldaten sterben nur durch Krieg** (kein Altern, keine Desertion).
- **Gebäude:** Kaserne = Nahkampf, Schießplatz = Fernkampf, Stall = Schock (nur mit Pferden im Lager). Kapazität: 20 Soldaten pro Gebäude. Kosten und Unterhalt: kalibrieren (Simulation).
- **Soldaten sind in der Siedlung**, können aber zu Armeen zusammengestellt und bewegt werden (Abschnitt 4).
- **Aufrüstung macht die Regierung** (Sitz, `Requirement Zentralregierung.md`, Abschnitt 5). Ein Sitz baut Militärgebäude, wenn
  - ein stärkeres Volk das Volk bedroht (Gefahr ≥ 50), oder
  - es unzufriedene Siedlungen (Zufriedenheit < 0) im Reich gibt, oder
  - die Kasse mindestens 5 Jahre Sold eines Gebäudes übrig hat.
  Die Einkommensprüfung (40 %) schließt den Sold ein. Höchstens ein Gebäude je Art und Siedlung, ab 40 Einwohnern. Die Art ist die, von der das Volk die wenigsten Soldaten hat; ein Stall nur mit Pferden im Lager.
- **Reihenfolge der Regierungsvorhaben:** Regierungssitz > Komfort > Militär > Wachstum (Sitz und Komfort zählen als Loyalität der Siedlungen).
- **Sold:** nur Geld, 0,1 pro Soldat und Jahr, aus der Kasse des Bezirks. Reicht sie nicht, deckt der Topf der übrigen Sitze des Volks die Lücke. Die Regierung hält die Sold-Reserve zurück und gibt sie nicht für Vorhaben aus.
- **Ohne Sold** werden Soldaten entlassen und kommen in die Bevölkerung ihrer Siedlung zurück (kein Verlust durch Desertion).
- **Strategische Güter:** Faktor ×1,5 je Truppenart und Gut. Verbrauch: 1 Einheit je 20 Soldaten und Jahr; fehlt das Gut, gilt der Faktor nicht. Zuordnung: Eisen → Nahkampf, Feuerstein → Fernkampf, Pferde → Schock (`Requirement Regionale Rohstoffe.md`, Abschnitt 10). Eisen und Feuerstein sind keine Luxusgüter und geben keinen Komfort.
- **Beschaffung:** Regierungshändler (der Sitze) kaufen fehlende strategische Güter bei eigenen Siedlungen und bringen sie zu den Soldaten. Ein Volk siedelt freie Eisen- und Feuerstein-Vorkommen nur, wenn es bedroht ist (ein Volk hat Gefahr ≥ 50 ihm gegenüber).
- **Handel:** Strategische Güter sind Teil der Handelsabkommen, mit starkem Wunsch (5-faches Gewicht). Verkauf nur, wenn die Gefahr des Käufers für den Verkäufer ≤ 40 ist, nie an Kriegsgegner und deren Verbündete. Ohne Abkommen gibt es über geschlossene Grenzen keinen Handel damit.
- **Gold:** Abgebautes Gold ist Geld, das in der Siedlung entsteht, und wird wie anderes erzeugtes Geld besteuert (der Steueranteil geht in die Kasse des Bezirks). 5 Geld je Einheit.
- **Stärke eines Volks:** Summe der Soldaten, gewichtet mit den Güterfaktoren. Verbündete zählen zur Stärke (Abschnitt 7).
- **Gefahr:** 50 × (Stärke des anderen + 20) ÷ (eigene Stärke + 20), höchstens 100, × Nähe. Die +20 verhindern 0 ÷ 0. Ersetzt die Bevölkerung in der Gefahr-Formel (`Requirement Diplomatie.md`, Abschnitt 1).

## 3. Schlacht

Simuliert und vom Nutzer gewählt (Abschnitt 14).

- Armeen bestehen aus Nahkampf, Fernkampf und Schock. Stärke einer Truppe = Soldaten × Güterfaktor.
- **Schaden:** Jeder Angriff entzieht dem Ziel 10 % × Angriffsstärke. Das Ziel verliert Soldaten = Schaden ÷ sein Faktor.
- **Ziel:** Fernkampf und Schock treffen nur die vorderste Linie des Gegners: Nahkampf, sonst Schock, sonst Fernkampf.
- **Vorderste Linie ohne Nahkampf:** Kämpft mit −50 % und nutzt in dieser Runde nicht ihre eigene Rolle.
- **Ablauf je Runde:** Fernkampf → Nahkampf → Schock. Innerhalb einer Phase wirken beide Seiten gleichzeitig, zwischen den Phasen nacheinander.
- **Dauer:** höchstens 5 Runden.
- **Rückzug:** Eine Seite zieht ab, wenn ihre Stärke zu Beginn einer Runde unter 50 % der Anfangsstärke liegt (geprüft am Rundenanfang, nicht nach jeder Phase; vom Nutzer bestätigt).
- **Sieger:** Die Seite, die den größeren Anteil ihrer Anfangsstärke behält.
- Gerechnet wird pro Schlacht mit Zählern, nicht pro Soldat (Rechenzeit).

## 4. Armeen

Entschieden (Nutzer), Phase 3; Zahlen sind Startwerte (kalibrieren (Simulation)).

- Eine Armee ist ein Zähler (Nahkampf / Fernkampf / Schock) mit Position und Volk. Die Soldaten werden aus der Heimatsiedlung abgezogen.
- **Wer marschiert:** Bei Kriegsbeginn stellen alle Siedlungen des Volks 70 % ihrer Soldaten für die Armeen, 30 % bleiben zu Hause.
- **Sammeln** (entschieden): Die Soldaten marschieren aus ihren Siedlungen zu einem Sammelpunkt. Die Armee bricht auf, wenn alle Kontingente angekommen sind, spätestens nach 8 Wochen; spätere Kontingente gehen heim.
  - **Angreifer:** Sammelpunkt ist der eigene Sitz, der dem Kriegsziel am nächsten liegt (eine Hauptarmee).
  - **Verteidiger:** Sammelpunkte sind seine nächsten anderen Sitze (nicht der belagerte Zielsitz), bis zu 3 Entsatzarmeen aus verschiedenen Sitzen. Sie marschieren zum Ziel und greifen an, sobald sie (mit der Besatzung) gewinnen können, sonst im Zwangsmonat (Abschnitt 5). Hat der Verteidiger keinen anderen Sitz, sammelt er sich als Besatzung im Zielsitz.
- **Rückzug** (entschieden): Geschlagene Armeen und abziehende Belagerer ziehen mit den Soldaten, die nach der 50-%-Rückzugsregel (Abschnitt 3) übrig sind, zum nächsten eigenen Sitz, mit normaler Geschwindigkeit. Gibt es keinen innerhalb von 25 Reisekosten, gehen sie sofort heim. Auf dem Weg können sie angegriffen werden, greifen aber selbst nicht an. Am Kriegsende gehen alle Armeen heim.
- **Soldaten sind nur dort verfügbar, wo sie wirklich sind** (entschieden): Sie zählen erst, wenn sie mit Armeegeschwindigkeit angekommen sind. (a) Wird ein Mutterland in einer Rebellion angegriffen, marschieren die Soldaten, die ihre Rebellenarmee verlassen, zu seiner Verteidigung und zählen dort erst bei der Ankunft. (b) Erreicht eine geschlagene Armee ihren Sitz, schickt sie ihre Soldaten zu Fuß heim; sie gelten bis zur Ankunft als abwesend. (c) Das Auffüllen der Rebellenarmee des Mutterlands nach seinem äußeren Krieg wird als normale Armee aufgestellt, die sich sammelt und marschiert; sie kämpft neben der alten, nicht mit ihr verschmolzen.
- **Zahl der Armeen:** höchstens 4 je Volk (1 Hauptarmee, 3 Entsatzarmeen), höchstens 32 Armeen auf der Welt.
- **Marsch:** 1 Reisekosteneinheit pro Woche (ein Straßenhex kostet meist 0,5). Der Weg geht über Straßen und freies Gelände, durch feindliches Land immer, durch befreundetes nur bei offener Grenze. Keine Schiffe. Der Weg wird nur bei Zielwechsel neu berechnet.
- **Versorgung:** keine; der Sold läuft weiter aus der Heimatkasse (Entlassung bei leerer Kasse wie in Abschnitt 2). Hat eine Armee 2 Jahre lang kein Ziel, kehrt sie heim.
- **Schlachten:** Treffen sich Armeen auf einem Hex, kämpfen sie (Abschnitt 3). Eine Entsatzarmee greift bei der Ankunft an. Ausweichen gibt es nicht.
- Anzeige und Grenzen: Abschnitte 9 und 11.

## 5. Belagerung und Besetzung

Entschieden (Nutzer), Phase 3b.

- **Belagert werden können Regierungssitze.** Eine Belagerung beginnt, wenn eine feindliche Armee den Sitz-Hex erreicht hat.
- **Während der Belagerung:** alle Kapazitäten (Ernte, Bau, Bevölkerung) der Siedlung des Sitzes sind halbiert, nicht die des Bezirks. Der Handel mit der Siedlung ruht. Die Siedlung bekommt den Teilwert „Besieged“ −40 (`Requirement Zufriedenheit.md`).
- **Verteidiger müssen nicht sofort kämpfen:** Die Armee am Sitz darf warten, bis genug Armeen aus Nachbarsiedlungen angekommen sind, und kämpft dann gemeinsam. Nach der Besetzung des Zielsitzes werden die Verteidiger im Monat vor jeder jährlichen Besetzungsprüfung zum Kampf gezwungen. Verteidiger und Entsatzarmeen greifen an, sobald sie nach der Schlachtrechnung gewinnen können, sonst spätestens im letzten Monat vor der Besetzung (entschieden).
- **Entsatz:** Armeen des Volks (und von Verbündeten) können die Belagerung brechen, ohne Entfernungsgrenze; sie müssen den Weg zurücklegen. Greift die Entsatzarmee an, kämpft sie bei der Ankunft.
- **Verteidigerbonus:** +25 % in einem belagerten Sitz, +50 % mit eigener Armee im Sitz (entschieden).
- **Besetzung** (bestätigt): Der Sitz wird besetzt, wenn die Belagerung mindestens 2 Jahre gedauert hat und die Siedlung des Sitzes Zufriedenheit < 0 hat; ab da wird jährlich geprüft. Das ersetzt die 5-Jahres-Regel für die Besetzung. Der Teilwert „Besieged“ −40 wirkt wegen der Trägheit (25 % des Abstands pro Jahr) erst nach und nach; in der Simulation prüfen, ob Sitze in 2 Jahren tatsächlich unter 0 fallen.
- **Beute:** Der Eroberer übernimmt das Lager und die Hälfte der Kasse; Gebäude bleiben stehen.
- **Besetzt heißt nicht erobert:** Ein besetzter Sitz wechselt den Besitzer erst am Ende des Krieges, und nur, wenn er das Kriegsziel war; unterwegs besetzte andere Sitze werden nach dem Krieg zurückgegeben.
- **Ein Kriegsziel je Krieg** (ein Zielsitz). Ausnahme Rebellenkrieg: Ziel sind alle Sitze der Rebellen (Abschnitt 8).
- **Volk mit nur einem Bezirk:** Ist der Bezirk des Zielsitzes das ganze Volk, wird es beim Verlust ganz annektiert (bewusst angenommen; der Unterschied zur Hauptstadtregel liegt nur darin, dass der Zielbezirk das ganze Volk ist).
- **Neue Hauptstadt** (entschieden): Verliert ein Volk seine Hauptstadt, wird sein einwohnerreichster verbliebener Sitz die neue Hauptstadt, sonst seine einwohnerreichste Siedlung.
- **Hauptstadt** (entschieden): keine Annexion des ganzen Volks, wenn das Volk weitere Bezirke hat. Die Hauptstadt wechselt nur mit ihrem Bezirk den Besitzer, wenn sie das Kriegsziel war; das übrige Volk wählt eine neue Hauptstadt (nach den Regeln für Sitze in `Requirement Zentralregierung.md`).

## 6. Kriegserklärung, Frieden, Eroberung

Entschieden (Nutzer), Phase 3a.

- **Erklärung:** Ein Volk darf nur gegen **Nachbarn** erklären (Völker, die eine gemeinsame Grenze haben), wenn seine Stärke ≥ 2× ist. Jährlich wird mit 10 % gewürfelt. Ist die Stärke des Angreifers 0, darf er nicht erklären (keine Kriege „0 ≥ 2 × 0“). Nicht während des Waffenstillstands und nicht, wenn das Volk schon Krieg führt; als Verbündeter darf es dagegen vielen Kriegen beitreten (Abschnitt 7).
- **Zielsitz:** Unter den Sitzen, deren Bezirke Siedlungen an der Grenze des Angreifers enthalten, wählt er den mit dem größten Nutzen bei Eroberung. **Nutzen** (entschieden) = gewichtete Summe aus Einwohnern und Ressourcen des Bezirks (strategische Güter und Luxusvorkommen zählen doppelt), geteilt durch die Verteidiger im Bezirk. Es gibt ein Kriegsziel je Krieg.
- **Aufgabe** (entschieden): Vor der Besetzung des Kriegsziels (Zielsitz) gibt der Verteidiger nie auf. Ist der Zielsitz besetzt, gibt er nur auf, wenn er weniger als 40 % der Stärke des Gegners hat; sonst geht der Krieg (mit besetztem Sitz) weiter bis zur Aufgabe, zur Erschöpfung (10 Jahre) oder bis zum Entsatz. Für den Angreifer gilt die einfache 40-%-Regel. Geprüft wird jährlich, ohne dass eine Schlacht nötig ist.
- **Kriegsbeginn:** Abkommen und offene Grenzen enden, Handel mit dem Gegner ruht.
- **Erschöpfung:** Nach 10 Jahren ohne Besetzung oder Sieg endet der Krieg ohne Gebietsänderung (Frieden).
- **Nach dem Krieg:** Vertrauen −30 (klingt in 10 Jahren ab), Grenzen geschlossen, alle Abkommen aufgehoben, 20 Jahre Waffenstillstand (keine neue Erklärung zwischen diesen Völkern).
- **Eroberung:** Der ganze Bezirk des Sitzes wechselt den Besitzer (am Kriegsende, Abschnitt 5). Am Grenzübergang zum Eroberer entsteht eine Straße, damit der eroberte Bezirk nicht sofort abgeschnitten ist. Zufriedenheit dort: Teilwert „erobert“ −15, klingt über 10 Jahre ab.
- Chronik (alle mit „Go to“): Kriegserklärung und Frieden (jedes Kriegsende, auch das Ende einer Rebellion, mit Ausgang) öffnen einen Dialog mit Pause (Entscheidung Nutzer); Belagerung und Besetzung stehen nur still in der Chronik-Liste. Annexion des ganzen Volks gibt es nicht.

## 7. Bündnisse

Entschieden (Nutzer), Phase 4. Aufgeteilt: **4a** Pakte und Bündnisse entstehen und enden, zählen zu Gefahr und Stärke, Vertrauen, Anzeige, Chronik; **4b** Verbündete treten Kriegen bei. Zahlen sind Startwerte (kalibrieren (Simulation)).

**Entstehen und enden**
- **Verteidigungspakt:** Vertrauen ≥ 40 und gemeinsame Bedrohung (beide haben Gefahr ≥ 50 durch dasselbe dritte Volk). Endet bei Vertrauen < 30 oder wenn die Gefahr durch den Dritten bei einem Partner unter 35 fällt.
- **Bündnis:** Vertrauen ≥ 80 (in der Simulation von 70 angehoben, siehe Abschnitt 14). Fällt das Vertrauen unter 65, wird es zum Pakt herabgestuft (nicht gleich aufgelöst).
- **Keine Grenze** für die Zahl von Pakten und Bündnissen je Volk; große Blöcke sind erlaubt.
- **Vertrauen:** Pakt +5, Bündnis +10 dauerhaft; beim Abschluss einmalig +10 (klingt in 10 Jahren ab). Diese Boni zählen weiter für das Öffnen von Grenzen und den Freihandel (bestätigt).
- **Bruch:** Erklärt ein Volk einem Verbündeten eines Bündnispartners den Krieg, endet das Bündnis mit diesem Partner sofort (−30 Vertrauen). Verbündete greifen einander nie an. Bei der Kriegserklärung (2×-Prüfung, Abschnitt 6) zählt der Angreifer keinen Partner mit, den er durch die Erklärung verlöre; dieser Partner kann auf der Gegenseite landen.
- Ein Krieg bricht alle Abkommen zwischen den Kriegsparteien ab.

**Stärke**
- Gefahr und Stärke (Abschnitt 2): Verbündete zählen zur Stärke, wie bei der 2×-Prüfung: Die Seite des Gegners mit Pakten und Bündnissen, die eigene Seite nur mit Bündnissen (entschieden).
- **2×-Prüfung der Erklärung und 40-%-Aufgabe** (Abschnitt 6): Die eigene Stärke zählt nur Bündnisse mit, die Stärke des Gegners dagegen seine Pakte und Bündnisse.

**Kriegsbeitritt (4b)**
- Ein Volk **beginnt** einen Krieg nur, wenn es nicht schon im Krieg ist; es kann aber vielen Kriegen als Verbündeter **beitreten**.
- **Beitritt nur bei Kriegsbeginn.** Ein Volk, das als Verbündeter kämpft, erklärt keinen eigenen Krieg, kann aber weiteren Kriegen als Verbündeter beitreten. Im Krieg zählen für die 40-%-Aufgabe und die Stärke der Seiten in Schlachten nur Verbündete, die wirklich beigetreten sind (Kriegserklärung abgegeben). Bestätigt: Für die Kriegserklärung (2×-Prüfung) und die Gefahr, also vor jedem Beitritt, werden mögliche Verbündete wie oben geschätzt (Gegenseite mit Pakten und Bündnissen, eigene Seite mit Bündnissen).
- **Verbündete auf beiden Seiten:** Es kann Verbündete auf beiden Seiten eines Krieges geben.
  - **Verteidiger-Seite:** Pakt-Partner (wenn ein Partner angegriffen wird) und Bündnispartner des Angegriffenen treten immer bei, außer der Angreifer ist ihr eigener Verbündeter (dann gilt die Bruchregel oben).
  - **Angreifer-Seite:** Bündnispartner des Angreifers treten nur bei, wenn die gemeinsame Stärke ihrer Seite (Angreifer + alle beitretenden Verbündeten) größer ist als die der Gegenseite (Verteidiger + dessen Pakte und Bündnisse). „Größer“ = eigene Seite > Gegenseite; kalibrieren (Simulation).
  - **Sonderfälle** (bestätigt): Ein Volk, das mit dem Angreifer verbündet ist (Bündnis) und mit dem Verteidiger nur einen Verteidigungspakt hat, tritt keiner Seite bei. Ein Volk, das mit dem Verteidiger verbündet ist, verliert mit der Erklärung sein Bündnis mit dem Angreifer (Bruchregel) und tritt dem Verteidiger bei.
  - Rote gestrichelte Kriegsgrenzen gelten auch zwischen Verbündeten und der Seite, gegen die sie kämpfen (akzeptiert).
- **Armeen:** Jeder Verbündete schickt 1 Armee mit 50 % seiner Soldaten, Sammelpunkt ist sein Sitz, der dem Ziel am nächsten liegt. Obergrenzen: 4 Armeen je Volk, 32 auf der Karte. Verbündete versuchen auch, belagerte Sitze ihrer Verbündeten zu entsetzen oder zurückzuerobern.
- **Ein Kriegsziel je Krieg;** der Frieden der Hauptparteien beendet den Krieg für alle.
- **Beute:** Verbündete bekommen keine Beute, aber +10 Vertrauen beim Partner. Verbündete des Verlierers verlieren 10 Vertrauen beim Sieger.
- **Durchmarsch:** Armeen von Verbündeten dürfen durch das Land des Partners ziehen. Der Handel bleibt unverändert.

**Anzeige:** Auf der Karte nichts Neues. Das Diplomatie-Panel zeigt Pakt und Bündnis, die Chronik Abschluss, Auflösung und Kriegsbeitritt eines Verbündeten, das Kriegs-Panel die Seiten. Nur ein neues Bündnis öffnet einen Dialog mit Pause (Entscheidung Nutzer); Verteidigungspakt geschlossen oder beendet, Bündnis herabgestuft oder beendet und Kriegsbeitritt eines Verbündeten stehen nur still in der Chronik-Liste.

## 8. Aufstände als Krieg

Entschieden (Nutzer), Phase 5. Aufgeteilt: **5a** Rebellion statt Abspaltung, **5b** Hilfe von außen und Verbündete des Mutterlands. Zahlen sind Startwerte (kalibrieren (Simulation)).

**Auslöser**
- Gilt nur für **echte Aufstände**. Abgeschnittene Gebiete bleiben unverändert (sie werden direkt ein neues Volk, ohne Krieg). Die direkte Abspaltung durch Unzufriedenheit entfällt (`Requirement Zufriedenheit.md`, Abschnitt „Abspaltung“).
- **Unzufrieden** = Zufriedenheit der Siedlung aktuell < 0. Keine 5-Jahres-Regel, keine Mindestgröße. Die Hauptstadt wird nie unzufrieden im Sinn der Rebellion. Unzufriedene Siedlungen müssen nicht zusammenhängen und bleiben bis zur Erklärung normaler Teil des Reichs.
- **Prüfung:** jährlich, ohne Zufallswurf. Die Rebellion beginnt, wenn die Stärke aller unzufriedenen Siedlungen des Reichs zusammen **größer ist als die Stärke des Mutterlands**.
- **Rebellenstärke:** die Soldaten in den Rebellensiedlungen plus eine **Miliz von 2,5 % der Einwohner** der Rebellensiedlungen (Nahkampf, ohne Güterfaktor; entschieden nach der Simulation, Abschnitt 14).
- **Mutterland:** Seine Stärke zählt Bündnisse und Pakte (wie die 2×-Prüfung), ohne die Soldaten der Rebellensiedlungen. Die Rebellen zählen nur Bündnisse.

**Erklärung**
- Alle unzufriedenen Siedlungen beginnen die Rebellion gemeinsam und werden mit der Erklärung **sofort unabhängig**; aus jeder durch Straßen zusammenhängenden Gruppe wird ein eigenes Volk; höchstens die 8 größten Gruppen rebellieren. Die Rebellenvölker sind miteinander verbündet (Phase 4: bei Vertrauen < 65 werden sie wie jedes Bündnis auf Pakt herabgestuft). Sie kämpfen als eine Seite, jedes stellt eigene Armeen (je höchstens 4, 32 auf der Karte gesamt).
- Die Rebellensiedlungen wechseln mit der Erklärung den Besitzer; ihre spätere Zufriedenheit ist für den Krieg ohne Belang. Siedlungen in einem laufenden Rebellenkrieg (auf beiden Seiten) können sich keiner weiteren Rebellion anschließen.
- **Hauptstadt und Sitze:** Die Hauptstadt jeder Gruppe ist der Sitz mit den meisten Einwohnern, sonst die größte Siedlung (sie bekommt Sitz-Status ohne Gebäude und kann wie ein Sitz belagert werden).
- Das Mutterland kann gleichzeitig anderswo im Krieg sein (zwei Fronten); die Obergrenze von 4 Armeen gilt für das Mutterland insgesamt (3 + 1 für die Rebellen, kalibrieren (Simulation)). Soldaten zählen nicht doppelt. Die Rebellion ist keine Kriegserklärung des Mutterlands.
- Teilwerte: „Neuer Stamm“ +10 ab der Erklärung; „Erfolgreiche Revolution“ +20 bei Sieg der Rebellen; „Verlorene Revolution“ −5 für das Mutterland bei Rebellensieg; „erobert“ −15 für annektierte Rebellensiedlungen (klingt über 10 Jahre ab) (`Requirement Zufriedenheit.md`, Abschnitt 2).

**Krieg**
- Es gelten die Regeln der Abschnitte 3 bis 6 mit einer Ausnahme vom einen Kriegsziel: Das Mutterland muss **alle Sitze der Rebellen** erobern, der Reihe nach, der nächste Sitz zuerst (ein aktuelles Ziel). Besetzte Sitze bleiben bis Kriegsende besetzt. Verliert eine Gruppe ihren Sitz, kämpft der Rest weiter; erst alle Sitze zusammen zählen.
- **Mutterland gewinnt:** Alle Rebellensitze sind besetzt. Die Rebellensiedlungen werden annektiert (Bezirke wechseln) und bekommen „erobert“.
- **Rebellen gewinnen:** nur durch Erschöpfung: Der Krieg endet nach 10 Jahren ohne Besetzung oder Sieg, die Rebellen bleiben unabhängig. **Das Mutterland gibt in einem Rebellenkrieg nie auf** (entschieden). Die Rebellen geben vor der Besetzung eines ihrer Sitze nie auf (bestätigt). Geben sie nach der Besetzung eines Sitzes auf, zählt das als Sieg des Mutterlands: Alle Rebellen werden annektiert.
- Nach dem Krieg wie jeder Krieg: Vertrauen −30, Grenzen geschlossen, Abkommen aufgehoben, 20 Jahre Waffenstillstand (auch gegenüber unabhängigen Rebellen).
- **Ein Mutterland in einer Rebellion** kann von Dritten weiter angegriffen werden (es erklärt dabei selbst nichts) und kämpft dann an zwei Fronten innerhalb seiner 4 Armeen.
  - 1 Armee kämpft gegen die Rebellen, mit einem Viertel des Marschanteils (17,5 % der Soldaten); bis zu 3 Entsatzarmeen verteidigen gegen den äußeren Angreifer. Beide Kriege enden unabhängig voneinander; endet der äußere Krieg, wird die Armee gegen die Rebellen wieder auf volle Größe gebracht.
  - Rebellengruppen selbst können während des Rebellenkriegs nicht von Dritten angegriffen werden.
  - Simulation (12 Welten, Jahr 500): ca. 0,1 Kriege gegen ein Mutterland in einer Rebellion je Welt.
- **Wer an einer Rebellion beteiligt ist** (Rebellen, Helfer, Verbündete des Mutterlands), beginnt keinen eigenen Krieg.
- **Verbündete des Mutterlands** (Phase 4b: Verteidiger-Seite) treten immer bei, außer sie sind mit den Rebellen verbündet.

**Hilfe von außen (5b)**
- Ein Volk hilft den Rebellen als Verbündeter, wenn die Gefahr des Mutterlands für es ≥ 50 ist, sein Vertrauen zum Mutterland < 50 ist, es mit dem Mutterland keinen Pakt oder Bündnis hat und die Rebellenseite dadurch stärker ist als das Mutterland. Es tritt bei der Erklärung bei.

**Anzeige und Chronik:** Eintrag „Rebellion“ (statt „Abspaltung“) mit Zahl der Siedlungen; weitere Einträge: Rebellensitz besetzt, Rebellion niedergeschlagen, Rebellen bleiben unabhängig, Hilfe von Dritten. Karte: Rebellenvölker mit eigener Farbe, rote Kriegsgrenzen wie bisher; das Kriegs-Panel zeigt die Rebellenseite.

## 9. Anzeige

- Kriegs-Panel („War ›“ im Völker-Panel, wie Diplomatie und Government): Stärke, Armeen, Kriege, Belagerungen, Bündnisse, Gefahr in beide Richtungen mit Teilwerten.
- Karte: Armeen als Marker, belagerte Sitze mit Rahmen, Kriegsgrenzen farbig (kommt in Phase 3).

## 10. Phasen

0. **Vorstufe:** Abbaugebäude für Eisen und Feuerstein, beide als Handelswaren (Vorkommen bei der Weltgenerierung doppelt so häufig); Gold wird abgebaut und kommt direkt als Geld in die Siedlung (kein Luxusgut mehr, Luxusgüter 6 → 5). Simuliert, Zahlen gewählt (Abschnitt 14).
1. **Militär ohne Kampf:** Gebäude, Soldaten, Sold, strategische Güter und ihr Verkauf; Gefahr aus Stärke statt Bevölkerung; Anzeige. Simuliert, Zahlen gewählt (Abschnitt 14).
2. **Schlachtrechnung** als reine Funktion mit Tests und Stats-Tool (`warStats`). Simuliert, Zahlen gewählt (Abschnitt 14).
3. **Krieg auf der Karte** (aufgeteilt, vom Nutzer bestätigt):
   - **3a:** Kriegserklärung, Armeen, Marsch, Schlachten, Kriegsanzeige (Armee-Marker mit Flagge in Volksfarbe, rote gestrichelte Kriegsgrenzen, keine Marschlinie), Chronik, Kriegs-Panel, Ende durch Aufgabe oder Erschöpfung, Benchmark-Szenario `war`.
   - **3b:** Belagerung, Besetzung, Eroberung des Bezirks am Kriegsende; die Hauptstadt wechselt nur mit ihrem Bezirk (keine Annexion des ganzen Volks).
4. **Bündnisse und Verteidigungspakte** (aufgeteilt, vom Nutzer bestätigt):
   - **4a:** Pakte und Bündnisse entstehen und enden, zählen zu Gefahr und Stärke, Vertrauen, Anzeige, Chronik.
   - **4b:** Verbündete treten Kriegen bei (Armeen, Sammeln, Entsatz, Frieden).
5. **Aufstände als Krieg** (Abschnitt 8, aufgeteilt, vom Nutzer bestätigt):
   - **5a:** Rebellion statt Abspaltung (Stärkevergleich, Erklärung, neue Völker, Sitze, alle Sitze erobern, Aufgabe, Annexion, Erschöpfung).
   - **5b:** Hilfe von außen und Verbündete des Mutterlands.

Jede Phase wird mit 12 Welten simuliert (Kettenreaktionen von Aufständen, Kriege je Welt, Bevölkerung, Handel, Rechenzeit) und vor der Umsetzung mit dem Nutzer abgestimmt.

## 11. Performance und Benchmark

- Stärke und Gefahr jährlich pro Volkspaar (Zähler); Schlachten pro Schlacht, nicht pro Soldat; Armeen als wenige Zähler.
- Ziel: ein simuliertes Jahr höchstens 1,3-mal so teuer wie heute.
- **Benchmark (Phase 5):** `war` wird erweitert: 3 Reiche, in denen alle Siedlungen rebellieren (Rebellenkriege). `unrest` bleibt, die Siedlungen starten dort aber Rebellionskriege statt der direkten Abspaltung. Alle Szenarien müssen bestehen.
- **Benchmark `war` (Phase 4):** Das Setup wird erweitert: alle Völker sind in zwei Blöcken verbündet; kein neues Szenario.
- **Neues Benchmark-Szenario `war`:** 300 Jahre gealtert, danach Kriege überall: die Obergrenzen voll ausgeschöpft (4 Armeen je Volk, 32 auf der Karte), alle Völker im Krieg (ab 3b belagerte Sitze, ab Phase 5 Rebellenkriege). Marker und Rahmen erscheinen überall auf der Karte. Alle Szenarien müssen bestehen.

## 12. Abhängigkeiten

- `Requirement Diplomatie.md`: Gefahr aus Stärke, Kriegszustand, Bündnisse, Verkauf strategischer Güter.
- `Requirement Zufriedenheit.md`: Aufstand läuft über Krieg; „Verlorene Revolution“ neu definiert; Teilwert „erobert“.
- `Requirement Zentralregierung.md`: Sold aus der Bezirkskasse; eroberte Sitze.
- `Requirement Regionale Rohstoffe.md`: strategische Güter und Truppenfaktoren.
- Gebäudekatalog (`Requirement Regionale Rohstoffe.md`, Gebäude): Kaserne, Schießplatz, Stall.

## 13. Offene Punkte

Entschieden (Nutzer): „Unzufrieden“ = Zufriedenheit < 0; keine Mindestgröße; Rebellen müssen nicht zusammenhängen; bei Sieg ein Volk je zusammenhängender Gruppe, miteinander verbündet; Besetzung: Belagerung ≥ 2 Jahre und Zufriedenheit < 0 (ersetzt die 5-Jahres-Regel, Abschnitt 5); Rebellensiedlungen wechseln mit der Erklärung den Besitzer; annektierte Rebellensiedlungen bekommen „erobert“. Zuordnung der strategischen Güter, Gold, Beschaffung von Eisen und Feuerstein sowie die Zahlen von Phase 0 und 1: siehe Abschnitt 2 und 14.

Aufgabe nach Besetzung: entschieden (Abschnitt 6). Welt und Völker: Abschnitt 15.

Phase 3, entschieden (nach der Simulation, Abschnitt 14): keine Mindeststärke für Kriegsziele, Aufgabe unverändert, Annexion eines Ein-Bezirk-Volks, Eroberungsstraße; weniger Völker durch Annexionen und damit weniger Außenhandel und Abkommen sind eine bewusst akzeptierte Folge.

Phase 3, entschieden: siehe Abschnitte 4 bis 6 (Nutzen der Zielwahl, Besetzung, Hauptstadt ohne Annexion, ein Kriegsziel je Krieg, Zeitpunkt der Verteidigung).

Später (bewusste Vereinfachungen für jetzt):
- Heimkehr bei Kriegsende, verspätete Kontingente, Miliz und Verluste werden sofort verbucht (ohne Marsch).
- Belagert wird nur das Kriegsziel (nicht andere Sitze auf dem Weg).
- Die 30 %, die zu Hause bleiben, kämpfen nicht.
- Armeen werden jedes Jahr neu aufgestellt.

Phase 4, entschieden: siehe Abschnitt 7 (auch: Beitritt, wenn die Seite gewinnen kann; Gefahr zählt Verbündete wie die 2×-Prüfung; nach einem Rebellensieg verbündete Völker werden bei Vertrauen < 65 wie jedes Bündnis auf Pakt herabgestuft).

Phase 5, entschieden: siehe Abschnitt 8 (Mutterland gibt nie auf, Miliz 2,5 % der Einwohner, Rebellen geben vor Besetzung nie auf).

Offen:
- Zahlen mit „kalibrieren (Simulation)“ für die späteren Phasen: Erschöpfungsjahre, Auflösungsschwellen der Bündnisse, Kosten und Unterhalt der Militärgebäude.

## 14. Simulation Phase 0 und 1

24 Welten, Jahr 500, gegen den heutigen Stand:

| Kennzahl | heute | mit Phase 0+1 |
|---|---|---|
| Siedlungen | 207 | 226 |
| Einwohner | 17.699 | 17.952 |
| Soldaten | – | 589 (ca. 3,3 % der Bevölkerung) |
| Soldaten mit ihrem strategischen Gut | – | 22,5 % |
| Mangels Sold später entlassene Soldaten (zurück in die Bevölkerung) | – | ca. 44 % der ausgebildeten |
| Rechenzeit (ms pro Jahr, 12 Welten) | 9,1 | 8,7 (praktisch unverändert) |

Gemessen mit dem Produktionscode (endgültige Variante), 24 Welten, Jahr 500 (Rechenzeit auf 12 Welten).

Zusätzlich gewählt: Eisen- und Feuerstein-Vorkommen sind bei der Weltgenerierung doppelt so häufig.

### Schlacht (Phase 2)

24 Welten, 194 Nachbarpaare plus synthetische Fälle, mit 10 % Schaden, Rückzug bei 50 % und Verteidigerbonus +25 %:

| Stärkeverhältnis | Verlust des Verlierers | Verlust des Siegers |
|---|---|---|
| 1,5 : 1 | 50 % | 24 % |
| 2 : 1 | 55 % | 15 % |
| 3 : 1 | 64 % | 7 % |

- Ab 1,5-facher Stärke gewinnt fast immer die stärkere Seite; nur nahe Gleichstand entscheidet die Zusammensetzung. Die Stärkeformel (Soldaten × Faktoren) sagt den Ausgang gut voraus. Armeen ohne Nahkampf sind schwächer als ihre Stärke (bewusst akzeptiert).
- Die Kriegserklärung ab 2-facher Stärke gewinnt gegen jede Zusammensetzung, auch gegen +50 % Verteidigerbonus (mit dem Produktionscode gemessen: Gegen +50 % genügt 1,80-fach, im Feld 1,49-fach; gegen +25 % 1,62-fach).
- Rechenzeit ca. 0,13 µs pro Schlacht.
- Für Phase 3: Die echten Armeen sind klein (Ø 64 Soldaten je Volk) und nur etwa 1 % sind Schock (Pferde sind knapp).
- Für Phase 3: In den echten Armeen würde die schwächere Seite in 45 % der Nachbarpaare aufgeben (weniger als 40 % der Stärke des Gegners).

### Krieg auf der Karte (Phase 3)

24 Welten, Jahr 500, mit Annexion und Eroberungsstraße, gegen den Stand ohne Krieg:

| Kennzahl | Ergebnis |
|---|---|
| Kriege je Welt | ca. 4,3 (fast keine vor Jahr 300) |
| Dauer | meist kurz (ca. 0,6 Jahre), meist durch Aufgabe beendet |
| Annektierte Völker | ca. 3,5 je Welt |
| Siedlungen / Bevölkerung | unverändert |
| Aufstände | 0,5 → 2,0 |
| Außenhandel | −56 % |
| Abkommen | 4,6 → 1,1 |
| Rechenzeit (ms pro Jahr) | +5 % |
| Belagerung (Teilwert −40) | 75 % der Sitze nach 2 Jahren unter 0; am Ende alle besetzt |

## 15. Welt und Völker (Entscheidung nach der Simulation)

Die Regeln für Kartengröße und neue Stämme stehen im Game-Design-Dokument (`Game Design Gott einer Zivilisation.docx/.pdf`, Welt und Zivilisationen); dort sind sie nachgezogen. Neu:

- **Karte:** 46 × 44 Hexfelder statt 64 × 64 (etwa halb so groß).
- **Völker:** bis zu 9 lebende Völker (weiche Grenze) statt 6. Abspaltungen dürfen darüber hinausgehen.
- **Neue Stämme:** 3 % pro Jahr statt 2 %. Unverändert: ab Jahr 25, mindestens 8 Hexfelder von jeder Siedlung, Splitter zählen nicht.
- **Simulation** (24 Welten, Jahr 500, vor der Änderung der Aufgaberegel):

| Kennzahl | vorher | nachher |
|---|---|---|
| Kriege gegen gewachsene Völker | 2,8 | 11,0 |
| Belagerungen | 5,0 | 11,8 |
| Annektierte Völker | 3,8 | 10,3 |
| Siedlungen | 226 | 240 |
| Aufstände | 2,1 | 6,9 |
| Rechenzeit (ms pro Jahr) | – | +9 % |

### Welt, Völker und Aufgaberegel (Runde 3)

24 Welten, Jahr 500, neue Welt 46 × 44 / 9 Völker / 3 %, mit der Aufgaberegel „erst nach Besetzung, dann < 40 %“:

| Kennzahl | Ergebnis (heute) |
|---|---|
| Kriege je Welt | 11,3 (davon 8,1 gegen gewachsene Völker) |
| Dauer | 3,9 Jahre |
| Schlachten | 5,7 |
| Besetzungen | 8,0 |
| Annektierte Völker | 6,8 |
| Siedlungen, die den Besitzer wechseln | 33 |
| Siedlungen | 237 (226) |
| Aufstände | 4,4 (0,5) |
| Abkommen | 2,8 (4,6) |
| Rechenzeit | etwas niedriger als heute (kleinere Karte) |
| Schlimmste Kriegswoche | ca. 2 ms |

### Sammeln, Rückzug und Entsatz (Phase 3)

12 Welten, Jahr 500: Kriege 7,5, Schlachten 3,8, Besetzungen 7,1, annektierte Völker 5,6, höchstens 5 Armeen gleichzeitig, Rechenzeit ca. 9,6 ms pro Jahr.

- Verteidiger gewinnen praktisch keine Schlachten: Die meisten haben nur einen Sitz und damit keine Entsatzarmee. Der Nutzer akzeptiert das so.
- Benchmark `war`: An den Obergrenzen entstehen 11 bis 13 echte Armeen je Welt; bis zu den 32 Armeen auf der Karte füllen reine Karten-Marker (Attrappen), die weitermarschieren.

### Bündnisse (Phase 4)

24 Welten, Jahr 500:

| Variante | Ergebnis |
|---|---|
| Bündnis ab Vertrauen 70 | ca. 13 Bündnisse je Welt, Pakte selten, größter Block ca. 4,4 Völker; Kriege 9,8 → 4,8 |
| Bündnis ab Vertrauen 80, Herabstufung unter 65 (gewählt) | Kriege ca. 9,0, davon ca. 3,4 mit Verbündeten |

Außenhandel ×3, Abkommen deutlich mehr, Aufstände etwa halbiert, Rechenzeit +3 % pro Jahr.

Die höhere Zahl von Aufständen mit Bündnissen (12 Welten: 4,6 gegen 2,8) ist vom Nutzer akzeptiert; keine weitere Prüfung.

### Verbündete auf beiden Seiten (Phase 4b)

12 Welten, Jahr 500, Verbündete des Verteidigers treten immer bei: Kriege 6,3, davon mit Verbündeten 2,2 (auf beiden Seiten 0,4), Beitritte 3,8, Schlachten 7,3, Besetzungen 5,8, annektierte Völker 4,7, Aufstände 3,5, Rechenzeit ca. 11 ms pro Jahr.

### Aufstände als Krieg (Phase 5, erste Simulation)

24 Welten, Jahr 500, mit 10 % Miliz:
- **Mutterland gibt bei 40 % auf:** ca. 4,8 Rebellionen je Welt; das Mutterland gab in ca. 90 % sofort auf (es hatte nur ca. 12 % der Rebellenstärke), echte Kriege nur in 10 bis 15 %.
- **Mutterland gibt nie auf (gewählt):** 6,3 Rebellionen, 3,9 niedergeschlagen, 2,3 unabhängig durch Erschöpfung, 7,2 Jahre Dauer, 3,1 Schlachten, 4,1 Besetzungen je Welt.

**Endgültige Simulation** (24 Welten, Jahr 500, das Mutterland gibt nie auf), Miliz 0 % / 2,5 % / 5 % / 10 %: Rebellionen 0,3 / 1,8 / 3,0 / 6,3 (heutige direkte Abspaltungen: 5,3).

Gewählt 2,5 % (heute in Klammern):
- Rebellionen 1,8: 1,0 niedergeschlagen, 0,8 unabhängig durch Erschöpfung
- Dauer 6,8 Jahre, 4,2 Schlachten, 1,5 Besetzungen
- Kriege gesamt 5,9 (8,2), Völker 10,5 (12,8)
- langfristig unzufriedene Siedlungen 0,7 (0,6; bei 0 % Miliz 2,6)
- Außenhandel 2333 (4055), Abkommen 3,1 (6,8)
- Rechenzeit unverändert

Produktionsstand (24 Welten, Jahr 500, Miliz 2,5 %): Rebellionen 1,83, niedergeschlagen 0,79 plus Aufgabe der Rebellen 0,13, Erschöpfung 0,83, Dauer 6,0 Jahre, Kriege 5,6, Völker 10,2, langfristig unzufriedene Siedlungen 0,71, Rechenzeit ca. 11,4 ms pro Jahr.
