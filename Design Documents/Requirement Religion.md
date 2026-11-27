# Requirement: Religion

Stand: **Entwurf; 6.4/6.4a (Heresy) auf Mandat umgestellt (Variante B „Mandate“, `Requirement Mandat.md`, Entscheidung Nutzer, noch nicht simuliert); Grundregeln vom Nutzer entschieden (Religion als eigenes Objekt, höchstens 16, eine Religion je Einwohner; Eigenschaften-Pool nach dem Muster der Anführer-Attribute; Ausbreitung, Spaltung und Verschmelzung auch für die Religion des Spielers; Tod; Rivalen-Götter als Schritt 2). Der Eigenschaften-Pool (Abschnitt 4), die neuen Fähigkeiten (Abschnitt 8) und alle Zahlen sind Startwerte, „vorläufig, wird simuliert“; die mit „Offen:“ markierten Punkte sind noch nicht entschieden. Neu: Heresy (6.4, vom Nutzer entschieden, Beitritt anderer Völker 6.4a), Glaube in der Diplomatie (6a, Verwandte je nach Eigenschaften freundlich oder feindlich, vom Nutzer entschieden) und Heiliger Krieg (6b, vom Nutzer angenommen). Bereit für die Simulation (`sim-analyst`); alle Zahlen dieser Abschnitte sind vorläufige Startwerte.** Ablauf: Design → Simulation (`sim-analyst`) → Umsetzung. Schritt 1 (Abschnitte 2–11): Religionen mit Eigenschaften. Schritt 2 (Abschnitt 12): Rivalen-Götter. Spieltexte sind Englisch („Faith“, „Faiths“, „Religion“, Namen der Eigenschaften).

Baut auf `Game Design Gott einer Zivilisation` (Abschnitte 5, 7, 8 und 9: Glaube, Gott, Rivalen, Spielende), `Requirement Anführer.md` (Hebelsatz, Attribute als Vorbild), `Requirement Gacha.md` (Faith, Pool, Gott-Schicht, Andacht §7.7), `Requirement Zufriedenheit.md`, `Requirement Diplomatie.md`, `Requirement Krieg.md`, `Requirement Kartenmodi.md` und `Requirement Speichern und Laden.md` auf.

## 1. Ziel

Heute ist Glaube ein Wert je Bewohner **an den Spieler-Gott** (`faith` 0..1, Gläubiger ab 0,5, `BELIEVER_FAITH`), ohne Inhalt: der Glaube macht nur Faith und das Spielende. Neu: Glaube ist der Glaube **an eine Religion**. Jede Religion ist ein eigenes Objekt mit **Eigenschaften** (Abschnitt 4), die wie die Attribute der Anführer **deutlich prägen**, wie ein Volk sich verhält (Krieg, Handel, Siedeln, Ordnung, Zufriedenheit, Ausbreitung). Religionen entstehen, wachsen, ändern ihre Eigenschaften, spalten sich, verschmelzen und sterben. Der Spieler ist der Gott **einer** Religion; er beeinflusst alle Religionen über neue Fähigkeiten (Abschnitt 8). In Schritt 2 bekommen Religionen ohne Spieler eigene Götter, die wie der Spieler Faith sammeln und Fähigkeiten einsetzen (Abschnitt 12).

Der Einfluss soll **spürbar** sein: zwei Völker mit gleicher Lage und verschiedener Religion verhalten sich verschieden, und eine Bekehrung oder Spaltung kann ein Volk kippen. Die Wirkung ist wie bei den Anführern stark gewollt, aber durch Deckel begrenzt (4.4).

## 2. Religion als Objekt

- **Höchstens 16 Religionen** zugleich (Index 0..15, `MAX_RELIGIONS`, vorläufig; Plätze toter Religionen werden wiederverwendet, wie `resetWarCiv` bei Völkern).
- **Eine Religion je Einwohner** (`religion`, `Uint8`, 255 = keine) plus der bestehende Glaubenswert `faith` (0..1) **an diese Religion**; Gläubiger = `faith ≥ 0,5`. Einwohner mit Glaube < 0,5 „schwanken“ (zählen nicht als Gläubige, behalten aber die Religion), unter 0,2 verlieren sie die Religion (255).
- **Religion 0 ist die Religion des Spielers** (sein Gott, Schritt 1 und 2). Sie ist keine Ausnahme der Regeln: sie kann Eigenschaften gewinnen und verlieren, sich spalten, verschmelzen (6) und hat Tod und Spielende wie bisher (Game Design Abschnitt 9: keine Gläubigen des Spieler-Gottes → Spielende; Tod der Religion: Abschnitt 7).
- Eine Religion hat: Name, Gründungsjahr, Gründervolk, Eigenschaften (4.1), Zähler der Gläubigen je Volk, Anspannung (6.1), Zustand (lebt/tot), Gott (Spieler, keiner, später Rivale).
- **Name (entschieden):** „Faith of the <Gründervolk>“ (bei Wiederholung römischer Zähler: „… II“), bis es eine Namensliste für Religionen gibt.
- **Gläubigenzählung:** je Religion und Volk (16 × 9 Zahlen), jährlich neu aus den Bewohnern (so oft wie `sim.believers` heute); der Faith-Zufluss des Spielers rechnet mit den Gläubigen von **Religion 0** (`Requirement Gacha.md` §2: 0,001 je Gläubigem und Tick).
- **Anbetung:** Ein Volk **folgt einer Religion** (`majorReligion`), sobald mindestens 55 % seiner Bevölkerung Gläubige dieser Religion sind, und verliert sie unter 45 % (Hysterese wie `Requirement Gacha.md` §7.7, jetzt für alle Religionen). Das ersetzt `worships(civ, god)`: Folgen, die an der Anbetung des Spielers hingen (Andacht des Anführers, Hebel `devotion`), hängen an „Volk folgt Religion 0“.

## 3. Entstehung

Eine Religion entsteht auf vier Wegen (Plätze vorausgesetzt, sonst entsteht nichts):

1. **Start:** Die Welt beginnt mit **Religion 0** (der Startstamm, 75–100 % Gläubige; Eigenschaften nach 4.5).
2. **Volksglaube:** Sind in einem Volk mit mindestens 100 Einwohnern **mindestens 30 %** der Bevölkerung ohne Religion oder schwankend, und das **5 Jahre in Folge**, gründet sich mit **5 % je Jahr** eine neue Religion: Alle ohne Religion und alle schwankenden Einwohner dieses Volks nehmen sie mit Glauben 0,6 an. Gründervolk = dieses Volk; Eigenschaften nach 4.5. (Zahlen vorläufig.)
3. **Spaltung** einer bestehenden Religion (Abschnitt 6.1).
4. **Fähigkeit** „Spark of a New Faith“ (Abschnitt 8).

**Entschieden (Nutzer):** Rebellenvölker gründen **keine** eigene Religion; der Glaube bleibt beim Aufstand unverändert (`Requirement Zufriedenheit.md`). Eine **Spaltung des Glaubens kann aber zu einer Rebellion führen** (Abschnitt 6.4, Heresy); die Rebellen behalten ihre Religion.

**Mindestgläubige bei Gründung (entschieden): 20**, für jeden Gründungsweg (sonst würde die Religion nach der Schonfrist sofort sterben, Abschnitt 7).

## 4. Eigenschaften (Traits)

Das Vorbild sind die 25 Attribute der Anführer (`Requirement Anführer.md` §4): ein **Pool**, aus dem jede Religion einige bekommt; jede Eigenschaft ändert Hebel; Ausschlusspaare; sie kommen aus Erlebtem oder Zufall; sie wachsen und gehen wieder.

### 4.1 Aufbau

| Regel | Startwert |
|---|---|
| Pool | **24 Eigenschaften** in 8 Themen zu je 3: War, Fertility, Order, Mission, Openness, Asceticism, Ancestors, Sea & Wandering |
| Plätze | **2 bei Gründung, dann +1 je 20 Jahre Alter** (Alter 20: 3, 40: 4, 60: 5); natürlich **höchstens 5**. Der Gott darf darüber hinaus bis **7** geben (Fähigkeiten, Abschnitt 8) |
| Stufen | jede Eigenschaft hat eine **Stufe 1–3**: Stufe 1 wirkt zu **×0,5**, Stufe 2 zu **×1,0**, Stufe 3 zu **×1,5** der Abweichung vom Grundwert (additiv: Abweichung × Faktor; multiplikativ: Faktor^Stufenfaktor, wie Honed Mind, `Requirement Gacha.md` §7.8). Die Tabelle 4.2 nennt die Wirkung bei **Stufe 2** |
| Fortschritt | je Eigenschaft ein Fortschritt 0..100 zur nächsten Stufe (4.5) |
| Ausschlusspaare | 4.3: eine Religion bekommt nie zwei einander ausschließende Eigenschaften (auch nicht über Spaltung, Verschmelzung oder Gott) |
| Anzahl im Mittel | zu Beginn 2, im Alter von 60 Jahren 5; Religionen sind also **verschieden, aber nie leer** |

### 4.2 Pool (24)

„Wirkung“ nennt die Hebel (`L.*`, `Requirement Anführer.md` §9) bei Stufe 2 und volle Anhängerschaft (4.4 skaliert mit dem Anteil im Volk). **R-Hebel** sind Hebel der Religion selbst (4.4, Abschnitt 5): `pull` (Anziehung auf Nachbarn), `carry` (Glaube, den Siedler, Händler und Soldaten mitnehmen), `hold` (Widerstand gegen Bekehrung und Vergessen), `devotion` (Andacht je Jahr), `suppress` (Druck auf Fremdgläubige), `merge` und `schism` (Faktoren der Chancen in 6).

| Nr. | Name | Thema | Wirkung (Stufe 2) | Kommt dazu durch (60 % Erlebtes, 4.5) | Schließt aus |
|---|---|---|---|---|---|
| 1 | Holy War | War | Kriegswurf +10 Punkte; Stärke ×1,10; Zufriedenheit −1 | Kriege (erklärt oder geführt), gewonnener Krieg; Gründerkultur Warlike; Gründer-Attribut Warmonger | 2 |
| 2 | Peacemakers | War | Kriegswurf ×0,6; Grenze öffnen schon 5 Vertrauen früher; Vertrauen +5; Zufriedenheit +1 | Frieden (10 Jahre ohne Krieg); Gründer Pacifist | 1, 3 |
| 3 | Martyrs' Creed | War | Schlachtverluste ×0,8; Aufgabe bei 30 % statt 40 %; Sold ×0,9; Kriegsmüdigkeit +2 | verlorener Krieg, belagerter Sitz; Gründer Stubborn | 2 |
| 4 | Fertility Rites | Fertility | Geburtenrate ×1,08; Zufriedenheit +1 | Frieden, neue Siedlungen; Gründerkultur Farming | 16 |
| 5 | Harvest Covenant | Fertility | Nahrungsernte ×1,08 (`L.food`) | Hunger/Not; Gründerkultur Farming | – |
| 6 | Hearth Blessing | Fertility | Wegkosten des Siedelns ×1,2; Zufriedenheit +2; Geburtenrate ×1,03 | Hunger/Not, Frieden; Gründer Homebody | 23 |
| 7 | Divine Mandate | Order | Rebellionsschwelle ×1,4; Einkommensprüfung +5 Punkte; Zufriedenheit −1 | Aufstand im eigenen Reich; Gründer Tyrant/Iron Fist | – |
| 8 | Alms and Mercy | Order | Zufriedenheit +3; Sicherheitsabstand der Steuern +5 | Hunger/Not, Frieden; Gründer Beloved/Generous | 9 |
| 9 | Sacred Tithe | Order | Einkommensprüfung +10 Punkte; Zufriedenheit −2 | Handelserfolg, neue Gebäude; Gründer Tax Hawk | 8 |
| 10 | Missionary Zeal | Mission | `pull` ×1,5, `carry` ×2; Kriegswurf +3 Punkte | neue Siedlungen, Handelserfolg, Pakt, gewonnener Krieg; Gründer Devout | 12 |
| 11 | Inquisition | Mission | `suppress` 0,03 (Abschnitt 5); Rebellionsschwelle ×1,2; Zoll auf Fremde ×1,5; Zufriedenheit −3 | Aufstand, Fremdglaube ≥ 20 % im Volk, Krieg; Gründer Iron Fist | 13, 15 |
| 12 | Steadfast Flock | Mission | `hold` ×1,6; Grenze schließen 5 Vertrauen früher; Zufriedenheit +1 | Bedrängnis (Gläubige an andere Religionen verloren, verfolgt, erobert); Gründer Xenophobe | 10, 13 |
| 13 | Open Gates | Openness | Vertrauen +6; Grenze öffnen 5 Vertrauen früher; `hold` ×0,8; Fremdglaube wird nicht unterdrückt; Zufriedenheit +1 | Handelserfolg, Pakt, Frieden; Gründer Silver Tongue | 11, 12 |
| 14 | Pilgrim Roads | Openness | Händlerlast ×1,15, Fahrtweite ×1,15, Menge eines Handelsabkommens ×1,2; `carry` ×1,5 | Handelserfolg; Gründer Merchant Prince | – |
| 15 | Syncretic Spirit | Openness | `merge` ×3, `schism` ×0,5; Vertrauen +3; Zufriedenheit +1 | Fremdglaube ≥ 20 % im Volk, durchgeführte Verschmelzung | 11 |
| 16 | Ascetic Vows | Asceticism | Unterhalt aller Gebäude ×0,85; Reserve ×1,5; Geburtenrate ×0,95; `devotion` +0,01; Zufriedenheit −1 | Hunger/Not; Gründer Frugal | 4, 17 |
| 17 | Temple Splendor | Asceticism | Zufriedenheit +3; Unterhalt ×1,1; Hauptstadt zuerst ausbauen; `devotion` +0,01 | Handelserfolg, Stadtstufe der Hauptstadt steigt; Gründer Builder | 16 |
| 18 | Stoic Endurance | Asceticism | Kriegsmüdigkeit +3; Erschöpfung +3 Jahre; Rebellionsschwelle ×1,2 | Hunger/Not, verlorener Krieg | – |
| 19 | Ancestor Veneration | Ancestors | `hold` ×1,3; Erbe eines Attributs 50 → 80 % (Anführer, Nachfolge); Zufriedenheit +2 | Herrscherwechsel, Frieden | – |
| 20 | Spirit Guardians | Ancestors | Verteidigungsbonus im eigenen Land +20 %; Stärke +5 %; Zufriedenheit +1 | belagerter Sitz, Schlacht im eigenen Land | – |
| 21 | Ancestral Wisdom | Ancestors | Baukosten ×0,9, Bauzeit ×0,9 | Herrscherwechsel, Frieden, Religion älter als 40 Jahre | – |
| 22 | Sea Gods | Sea & Wandering | Fahrtweite ×1,15; Händlerverluste ×0,7 | Handelserfolg über Häfen; Gründerkultur Seafaring | – |
| 23 | Wayfarers' Faith | Sea & Wandering | Überlast-Faktor des Siedelns 1,0 → 0,97, Wegkosten ×0,85; `carry` ×1,5; Zufriedenheit −1 | neue Siedlungen; Gründerkultur Wandering; Gründer Pioneer | 6 |
| 24 | Omen Readers | Sea & Wandering | bei Katastrophe (Feuer, Dürre, Überflutung, Hunger) auf den Hexfeldern der Gläubigen: Glaube +0,05 statt Verlust; Doubt wirkt nur halb; Zufriedenheit +2 | Katastrophen, Eingriffe des Gottes auf das Land der Gläubigen | – |

Anmerkung: Die Wirkungen sind absichtlich **groß genug, um im Panel und im Verhalten sichtbar zu sein** (Kriegswurf 10 → 20 %, Geburtenrate ±8 %, Zufriedenheit ±3). Feinschliff in der Simulation (Abschnitt 11); die Zufriedenheitswerte sind der Teilwert „Creed“ (4.4).

### 4.3 Ausschlusspaare (10)

1/2, 2/3, 4/16, 6/23, 8/9, 10/12, 11/13, 11/15, 12/13, 16/17. Zusätzlich gilt für Gründung und Spaltung: die Eigenschaft einer Religion passt nie zu ihrer Gegenseite aus dem Gründer-Attribut (kein Holy War für einen Pacifist-Gründer).

### 4.4 Wirkung auf Völker (Hebel, Anteil, Deckel)

- **Anhängeranteil:** Für Volk *c* und Religion *r* ist `share(c, r)` = Gläubige von *r* in *c* geteilt durch die Bevölkerung von *c* (0..1). Eine Eigenschaft wirkt im Volk **mit diesem Anteil**: additive Hebel: Σ über Religionen `share × Abweichung`; multiplikative Hebel: Π `Faktor^share`. Ein Volk mit 30 % Holy War und 60 % Peacemakers bekommt also eine Mischung (und wird innerlich uneins: Zufriedenheit, 5).
- **Hebelsatz „Glaube“** (`faithLev`, Volk × Hebel, neutral 0 bzw. 1 wie `LEVERS`): eine **dritte Schicht** neben Anführer und Gott; `combineLevers` (`leaders.ts`) kombiniert sie (additiv addiert, multiplikativ multipliziert). Neu berechnet **jährlich** (nach der Gläubigenzählung) und bei jeder Änderung einer Eigenschaft, nie in der Entscheidung selbst.
- **Deckel:** Die harten Deckel aus `Requirement Anführer.md` §3 gelten auf dem **kombinierten** Satz (Kriegswurf höchstens 40 %, 2×-Schwelle nie unter 1,2×, „erklärt nie selbst Krieg“ schlägt jede Erhöhung). Die Zufriedenheitswirkung aller Religionen eines Volks bildet einen **eigenen Teilwert „Creed“** (`Requirement Zufriedenheit.md`, neben „Leader“ und „Divine“) mit **Grenze ±8** (entschieden; Wirkung **linear mit dem Anhängeranteil**, Simulation prüft), unabhängig von den ±8 des Anführers und den ±15 von „Divine“.
- **R-Hebel** wirken nicht auf Völker, sondern auf die Religion selbst (Ausbreitung, Spaltung): Grundwert 1 (`pull`, `carry`, `hold`, `merge`, `schism`) bzw. 0 (`devotion`, `suppress`); je Religion aus Stufen berechnet.
- **Andacht:** Der bisherige Andacht-Summand (0,02 × Kultur „Devout“ plus Hebel `devotion` des Anführers, nur für Anhänger des Spieler-Gottes) gilt jetzt für **die Anhänger jeder Religion in einem Volk, das ihr folgt**, plus `devotion` der Religion; Vergessen −0,005 gilt für Einwohner einer Religion, der das Volk nicht folgt (`Requirement Gacha.md` §7.7).

### 4.5 Entstehen und Wachsen der Eigenschaften

**Bei Gründung (2 Eigenschaften):**
- **1. Eigenschaft:** 50 % aus dem **Attribut des Anführers** des Gründervolks (Spalte „Gründer“ in 4.2; hat er keins, gilt die Kultur), sonst aus der **stärksten Kultur** des Gründervolks (`culture`: Warlike → War, Seafaring → Sea & Wandering, Farming → Fertility, Wandering → Sea & Wandering, Devout → Mission oder Asceticism), eine zufällige Eigenschaft des Themas.
- **2. Eigenschaft:** zu 60 % aus den **Ereignissen des Gründervolks** der letzten 10 Jahre (Ereignisart mit den meisten Ereignissen, Spalte „Kommt dazu durch“), sonst Zufall unter allen. Ausgeschlossene und vorhandene werden nie gezogen.
- Die erste Eigenschaft startet auf **Stufe 2**, die zweite auf **Stufe 1**.
- **Religion 0 (Start):** wie oben mit dem Startvolk (ohne Ereignisse: Zufall).
- **Gespaltene Religion:** erbt die Eigenschaften der Mutter (6.1).

**Erlebtes (Ereignisse je Religion):** Gezählt werden Ereignisse in Völkern, in denen die Religion mindestens 25 % Anteil hat: **War** (Krieg erklärt oder gegen das Volk erklärt), **WarWon**, **WarLost** (Krieg verloren, Sitz belagert, Bezirk verloren), **Uprising**, **Hardship** (Hunger, Zufriedenheit < 0), **Trade** (neues Handels-/Freihandelsabkommen, Hafen), **Pact**, **Settled** (neue Siedlung, ab 2 im Jahr), **Peace** (10 Jahre ohne Krieg), **Disaster** (Feuer, Dürre, Überflutung, Eingriffe des Gottes auf das Land), **Foreign** (Fremdglaube ≥ 20 % im Volk), **Pressure** (≥ 5 % der Gläubigen im Jahr an andere Religionen verloren, verfolgt oder erobert), **Succession** (Herrscherwechsel). Das entspricht den Ereignisarten der Anführer (`Ev`, `Requirement Anführer.md` §4 „Erlebtes“).

**Wachsen (jährlich je Eigenschaft):**
- Jedes Ereignis aus der Spalte „Kommt dazu durch“ gibt **+10 Fortschritt** (höchstens +25 je Jahr).
- Jedes Jahr ohne ein solches Ereignis **−2** (Eigenschaften müssen genährt werden); ein **Gegenereignis** gibt **−8**: Holy War: Peace; Peacemakers: War als Angreifer; Martyrs' Creed: Peace; Fertility Rites, Harvest Covenant: Hunger/Not; Divine Mandate: kein Aufstand seit 20 Jahren; Open Gates: Pressure; Missionary Zeal: Pressure; Sacred Tithe: Hunger/Not; Temple Splendor: Hunger/Not.
- Fortschritt ≥ 100: **Stufe +1** (höchstens 3), Fortschritt 40. Fortschritt < 0: **Stufe −1**, Fortschritt 60; auf Stufe 1 fällt die Eigenschaft **weg** (der Platz wird frei).

**Neue Eigenschaften (alle 10 Jahre je Religion, eigene Uhr):**
- Ist ein Platz frei (Plätze nach Alter, 4.1): Ziehung zu **60 % aus Erlebtem** der letzten 10 Jahre (Ereignisart mit den meisten Ereignissen, Gleichstand: die jüngste; Eigenschaft gleichverteilt aus deren Liste), zu 40 % Zufall unter allen. Ausschlüsse und vorhandene nie. Neue Eigenschaften starten auf Stufe 1, Fortschritt 0.
- Ist kein Platz frei: Hat eine Ereignisart **≥ 10 Ereignisse in 10 Jahren** und die Religion kein Thema dazu, ersetzt die neue Eigenschaft mit **50 %** die schwächste der Stufe 1 (mit dem geringsten Fortschritt). Sonst nichts.
- **Mehrere Völker:** Ein Ereignis wird jeder Religion mit ≥ 25 % Anteil im betroffenen Volk gutgeschrieben, so dass Religionen **verschiedene Geschichten** haben (eine Religion im Kriegsvolk wird kriegerisch, dieselbe im Handelsvolk handelsfreundlich). Das erzeugt auch Spannung für die Spaltung (6.1).
- **Chronik:** „… gains <Eigenschaft>“, „… loses <Eigenschaft>“ stille Einträge (kein Dialog), ein Eingriff des Gottes mit „by the god“.

## 5. Ausbreitung, Bekehrung, Unterdrückung

Heute folgt der Glaube den Nachbarn (`pull` = (Nachbarglaube − eigener Glaube) × 0,1 je Jahr, `simulation.ts`). Neu je Hexfeld: der örtliche Druck der Religionen.

- **Druck:** Für Einwohner *i* auf Hexfeld *h* ist der Druck der Religion *r*: `Anteil von r auf h und den 6 Nachbarn × pull(r)`. Der Glaube des Einwohners an seine Religion folgt dem örtlichen Anteil seiner Religion (wie bisher mit 0,1 je Jahr), gebremst durch `hold` seiner Religion (Druck ÷ `hold`).
- **Bekehrung:** Schwankende und religionslose Einwohner (Glaube < 0,5 bzw. 255) nehmen die Religion mit dem höchsten Druck an (Glaube 0,5, wenn der Druck ≥ 0,2 ist; sonst bleiben sie ohne). Gläubige einer anderen Religion wechseln nur, wenn ihr Glaube durch Vergessen/Druck unter 0,2 fiel (dann religionslos, dann wie oben). Ein Wechsel ist also ein Weg über das Schwanken, nie ein Sprung.
- **Mission (Missionary Zeal, Pilgrim Roads, Wayfarers' Faith):** `pull` und `carry` der Religion. `carry` ist der Anteil des Glaubens, den **Siedler, Händler und Soldaten** am Zielort setzen: die Abwanderer behalten ihre Religion (`Requirement Diplomatie.md`: „der Glaube der Abwanderer bleibt unverändert“); Händler und heimkehrende Soldaten geben ihren Glauben mit `carry` auf das Hexfeld (Druck + 0,05 × `carry` je Besuch; vorläufig).
- **Standhaftigkeit (Steadfast Flock, Ancestor Veneration, Open Gates senkt):** `hold` der Religion.
- **Unterdrückung (Inquisition):** In einem Volk, das einer Religion mit `suppress` folgt (≥ 55 %), verlieren Einwohner anderer Religionen zusätzlich `suppress` Glauben je Jahr (0,03 bei Stufe 2); sie wechseln über das Schwanken zur herrschenden Religion. Folge über die Hebel: Zufriedenheit −3 und Rebellionsschwelle ×1,2 (Tabelle 4.2). Open Gates schließt es aus.
- **Zwischen Völkern:** Wirkt nur über Nachbarhexfelder, Siedler, Händler und Soldaten, nicht über Entfernung. Eine Eroberung (Krieg) ändert die Religion der Bewohner nicht sofort; die Bezirke des Siegers geben örtlichen Druck.
- **Ansteckung der Tochterreligion** zwischen Nachbarsiedlungen (κ ≈ 0,10, Missionary Zeal ×1,5, Inquisition/Open Gates heilen): siehe 6.4.
- Alle Zahlen Startwerte. **Jährliche** Rechnung im Schritt des Volks; je Einwohner nur wenige Operationen (nach dem Muster des bestehenden Glaubensschritts).

## 6. Spaltung und Verschmelzung

Gilt für **alle** Religionen, auch für die des Spielers.

### 6.1 Spaltung (Schisma)

- **Anspannung** je Religion (0..100, Anzeige „Calm / Uneasy / Tense“): wächst durch Gläubige in **Völkern, die miteinander im Krieg** sind (+5 je Jahr je Kriegspaar), durch Gläubige in Völkern, die **sich durch Aufstand abspalteten** (+10 einmal), durch **verschiedene Geschichten** (Ereignisse der Völker laufen auseinander: +2 je Jahr je Eigenschaft, die in einem Volk Stufe ≥ 2 hat und in dem anderen fehlt), durch Größe (+1 je Jahr ab 4 Völkern); sinkt −3 je Jahr sonst. Syncretic Spirit `schism` ×0,5, Steadfast Flock ×0,7, Inquisition ×0,7, Ancestor Veneration ×0,8.
- **Chance je Jahr:** `0,5 % + 1 Punkt je 10 Anspannung über 40`, × `schism`, höchstens 15 %. Nur Religionen mit **mindestens 2 Völkern** (je ≥ 20 Gläubige) und **nur, wenn ein Platz (16) frei ist**.
- **Ablauf:** Das Volk mit der **kleinsten** Verbindung zur Mehrheit (kriegführend gegen das Volk der Mehrheit, sonst abgespaltenes, sonst das kleinste) trennt sich: **alle Gläubigen der Religion in diesem Volk** wechseln zu einer **neuen Religion**. Eigenschaften: die der Mutter, **eine wird getauscht** (die schwächste fällt weg; eine neue nach der Ziehung 4.5 aus den Ereignissen dieses Volks, Stufe 1), die übrigen behalten Stufen. Gründungsjahr = heute, Gründervolk = dieses Volk. Chronik: wichtiger Eintrag („The <Religion> split: <Volk> founded <neue Religion>“), Dialog mit Pause.
- Die Fähigkeit „Sunder the Faith“ (Abschnitt 8) löst eine Spaltung sofort aus (die Mindestzahl Völker entfällt: auch die Gläubigen **eines** Volks, wenn es ≥ 20 sind und sie ≤ 70 % der Religion sind).

### 6.2 Verschmelzung (Synkretismus)

- Zwei Religionen verschmelzen, wenn sie in **mindestens einem Volk beide ≥ 25 % Anteil** haben, das **10 Jahre in Folge**; Chance **3 % je Jahr**, × `merge` beider (Syncretic Spirit ×3; Inquisition und Steadfast Flock blockieren: ×0). Nur zwischen Religionen, deren Völker nicht im Krieg miteinander sind.
- **Ergebnis:** Die **größere** (nach Gläubigen) bleibt bestehen, ihr Gott bleibt Gott (Schritt 2: der Gott der kleineren **stirbt**, seine Ladungen sind verloren, Abschnitt 7); alle Einwohner der kleineren wechseln mit ihrem Glauben. Eigenschaften: die der größeren plus **eine** der kleineren (Ziehung 4.5, ohne Ausschlüsse; Stufe 1; ist kein Platz frei, entfällt sie). Chronik: wichtiger Eintrag.
- Die Fähigkeit „Covenant of One“ (Abschnitt 8) verschmilzt zwei gewählte Religionen sofort (Ausschlüsse der Voraussetzungen entfallen).

### 6.3 Spaltung und Verschmelzung der Religion des Spielers

- **Spaltung der Religion 0:** Die **neue Religion hat den Spieler nicht als Gott**: Sie ist eine Religion ohne Gott (Schritt 1) bzw. mit der Chance auf einen Rivalen-Gott (Schritt 2, Abschnitt 12). Der Spieler **verliert diese Gläubigen** für Faith und für die Siegbedingung (Game Design Abschnitt 9: der Spieler-Gott stirbt nur, wenn Religion 0 keine Gläubigen mehr hat; ein Rest bleibt, sonst Spielende). Sein Faith-Zufluss sinkt entsprechend.
- Die Spaltung wird **angekündigt**: Anspannung „Tense“ (ab 70) erscheint im Faiths-Panel in der Religion 0 und als stiller Chronik-Eintrag („Unrest in your faith“), so dass der Spieler gegensteuern kann (Frieden zwischen den Völkern, Fähigkeiten wie Prophet's Light, Covenant of One, ein Eigenschafts-Eingriff). Die Spaltung selbst ist ein wichtiger Eintrag mit Dialog.
- **Verschmelzung der Religion 0:** Verschmilzt sie mit einer anderen, **bleibt Religion 0 immer bestehen** (auch wenn die andere größer ist): deren Gläubige werden Gläubige des Spielers, und deren Eigenschaft kommt dazu (6.2). Der Spieler gewinnt damit Faith.
- **Entschieden (Nutzer):** Der Spieler kann eine Spaltung seiner Religion **nur über Fähigkeiten** verhindern oder zurücknehmen (Covenant of One auf die abgespaltene Religion, Prophet's Light, Eigenschafts-Eingriffe); keine eigene Spielregel.

### 6.4 Ketzerei und Rebellion über den Glauben (Heresy)

Entschieden (Nutzer): eine Spaltung kann zu einer Rebellion führen, **ohne eigenen Rebellionsmechanismus**: Der Glaube wirkt als Teil der **Loyalität** der Siedlung (`Requirement Mandat.md` §2, §8). Gilt auch für die Spaltung der Religion des Spielers und für Spaltungen durch „Sunder the Faith“. **Ersetzt** den Teilwert „Heresy“ in der Zufriedenheit (relativ −15 bzw. −6 über 30 Jahre) **und** die ×0,1-Stärkeregel der Simulation: Beides entfällt (Entscheidung Nutzer).

- **Staatsreligion** = Religion mit dem größten Anteil im Reich. **Abweichung** einer Siedlung = Anteil ihrer Einwohner mit einer anderen Religion; Loyalitätsteil **„Glaube“ = −30 × Abweichung** (Gefälle: `0,7 × eigener Anteil + 0,3 × Mittel der Nachbarsiedlungen im Umkreis von 3 Hexfeldern`; Deckel −35). Er gilt in **jeder Siedlung, deren Einwohner eine fremde Religion tragen**, wem sie auch gehört, wirkt also vor allem dort, wo sich die Tochterreligion ausbreitet (Mutterland und Nachbarvölker), und nicht im Gründervolk selbst (dessen Gläubige alle wechseln, 6.1).
- **Ausbreitung (Ansteckung):** Der **Anteil der Tochterreligion** je Siedlung bewegt sich jährlich zum **Mittel der Nachbarsiedlungen** mit **κ ≈ 0,10**, gebremst durch `hold` der herrschenden Religion; **Missionary Zeal ×1,5** (`pull`); **Inquisition** (`suppress`) und **Open Gates** heilen (Bekehrung zurück bzw. ×0,5). Abschnitt 5 liefert `pull`/`hold`/`carry`, die Ansteckung ist die Regel für den Siedlungsanteil der Tochterreligion (in der Simulation Variante A, funktioniert).
- **Rebellion:** Es gibt **keine eigene Prüfung** mehr. Siedlungen mit Loyalität unter der Schwelle (`25 / L.rebel`) bilden Blöcke; Countdown und Ausgang (Unabhängigkeit mit Rebellenkrieg, Autonomie als Vasall, Versöhnung) laufen nach `Requirement Mandat.md` §4–§6, mit Zufall. **Die Rebellen behalten ihre Religion** (Tochterreligion, 3), es ist ein normaler Rebellenkrieg (Krieg §8). Chronik: wichtiger Eintrag **„Rebellion over faith“** (statt „Rebellion“), wenn „Glaube“ im Block der größte negative Teil ist. Ein Block mit überwiegend fremder Religion wählt häufiger Unabhängigkeit (Ausgangsgewicht, Mandat §5).
- **Skalierung durch Eigenschaften** (Faktoren auf das Gewicht 30, nach Anhängeranteil gemischt, 4.4; Deckel bleiben): **Inquisition ×0,5 und `suppress`**; **Open Gates ×0,5**; **Syncretic Spirit ×0,5**; **Holy War ×1,3**; **Steadfast Flock ×1,2**; **Divine Mandate** (Rebellionsschwelle ×1,4, Tabelle 4.2) wirkt über die Schwelle (`L.rebel`), kein eigener Faktor.
- **Endet** bei Verschmelzung der Tochter- mit der Mutterreligion (die Abweichung fällt mit dem Glaubenswechsel auf 0). Kein Sonderfall für Völker, die die Religion später übernehmen (die Abweichung folgt dem Anteil).
- **Simulationsziel:** 10–30 % der Spaltungen führen zu einer Rebellion (11, Punkt 4); Zahlen (30 / 0,7–0,3 / −35 / κ 0,10 / Faktoren) vorläufig.

### 6.4a Andere Völker treten der Glaubensrebellion bei

Entschieden (Nutzer): zusätzlich zum Gründervolk können **andere Völker der Glaubensrebellion beitreten**. Umsetzung (Auslegung, Startwerte) mit den **bestehenden Beitrittsregeln** (`Requirement Krieg.md` §7, Kriegsbeitritt 4b), nur bei Kriegsbeginn einer „Rebellion over faith“ (6.4), also beim Ausgang **Unabhängigkeit** (beim Ausgang Autonomie, `Requirement Mandat.md` §6, gibt es keinen Krieg und keinen Beitritt):

- **Auf der Seite der Rebellen:** ein Volk, das nicht im Krieg ist und dessen **Mehrheit (> 50 % der Bevölkerung) die Tochterreligion** der Rebellen hält, tritt bei, wenn sein **Vertrauen zum Rebellenvolk ≥ 40** ist und die **Angreifer-Seite-Stärkeregel** (Krieg §7: gemeinsame Stärke der Seite größer als die der Gegenseite) erfüllt ist.
- **Auf der Seite des Mutterlands:** ein Volk, dessen **Mehrheit die Mutterreligion** hält und dessen **Vertrauen zum Mutterland ≥ 40** ist, tritt bei (wie die Verteidiger-Seite, ohne Stärkeregel). Pakt- und Bündnispartner treten wie bisher bei (Krieg §7); ein Volk mit Bindung zu beiden Seiten tritt keiner Seite bei.
- Armee, Obergrenzen (4 je Volk, 32 auf der Karte), keine Beute, +10 Vertrauen beim Partner, Friede der Hauptparteien beendet den Krieg für alle: wie Krieg §7. Kein neuer Rebellionsmechanismus, nur eine zusätzliche Beitrittsbedingung (Glaube statt Bündnis).
- Chronik: stiller Eintrag „<Volk> joins the faith rebellion“. Gilt auch für die Religion des Spielers.

## 6a. Glaube in der Diplomatie

Entschieden (Nutzer, im Grundsatz): Glaubensunterschiede ändern das **Vertrauen** (`Requirement Diplomatie.md` §1), und Eigenschaften heben oder senken die Meinung über andere Religionen. **Die Einzelheiten dieses Abschnitts sind Entwurf und noch nicht vom Nutzer bestätigt.** Alle Zahlen vorläufig, wird simuliert.

- **Neuer Vertrauens-Teilwert „Faith“** (gerichtet: A über B, jährlich nach der Gläubigenzählung, nicht abklingend, sondern dauerhaft nach dem Stand). Er kommt in die Tabelle der Teilwerte neben „Abkommen“ und „Ereignisse“ und wird im Diplomatie-Panel einzeln gezeigt.
- **Basiswert je Religionspaar** *(r von A, s von B)*: **gleiche Religion +8**, **verwandte Religionen** (Mutter und Tochter, Schwestern aus derselben Mutter; dazu hält jede Religion die Mutter `parent`) **0 als Basis, durch Eigenschaften verschoben** (siehe `kin`: kann positiv oder negativ werden), **fremde Religion −8**. Einwohner ohne Religion zählen 0.
- **Anteile:** `Faith(A→B) = Σ_r Σ_s share(A,r) · share(B,s) · w(r,s)`; `share` wie 4.4 (Gläubige durch Bevölkerung). Zwei Völker mit je 100 % derselben Religion: +8; 60 % gleich, 40 % anders: ca. +2 bis +3. Das Gewicht `w(r,s)` für Verwandte ist `kin(A)` (nächster Punkt), nicht mehr fest.
- **Eigenschaften (Volk A, Hebel des Glaubens, nach Anteil gemischt, 4.4):** zwei multiplikative Hebel (neutral 1) und ein **additiver** Hebel: `bond` (×, auf den positiven Teil, gleiche Religion), `xeno` (×, auf den negativen Teil, Fremde) und **`kin`** (**additiv**, neutral 0, Gewicht für Verwandte; **Entschieden (Nutzer):** verwandte Religionen sind je nach Eigenschaften freundlich **oder** feindlich, als „Ketzer“ sogar feindlicher als Fremde). `kin(A) = Σ Anteil · Verschiebung der Eigenschaft`, Stufen skalieren wie 4.1, Grenze für `kin` **−16 bis +8**. Pro Eigenschaft (Stufe 2, Startwerte):

| Eigenschaft | `bond` | `kin` (additiv) | `xeno` |
|---|---|---|---|
| Open Gates | 1 | +3 | ×0,5 (Fremde −8 → −4) |
| Syncretic Spirit | 1 | +6 | ×0,5 |
| Peacemakers | 1 | +3 | ×0,7 |
| Pilgrim Roads | 1 | +1 | ×0,8 (Kontakt auf der Handelsstraße) |
| Inquisition | 1 | −14 (Ketzer, feindlicher als Fremde −12) | ×1,5 (−8 → −12) |
| Holy War | ×1,2 | −10 | ×1,5 |
| Steadfast Flock | ×1,3 | −6 | ×1,3 |
| Missionary Zeal, übrige | 1 | 0 | 1 |

  Gemischte Völker (tolerante und orthodoxe Eigenschaften zugleich) mitteln sich nach Anteil; Ausschlusspaare 4.3 verhindern die schlimmsten Widersprüche. Stufen skalieren die Abweichung wie 4.1; Missionary Zeal ändert hier bewusst nichts (er wirkt über `pull`, 5). **Keine neue Eigenschaft** im Pool (24 in 8 Themen zu je 3 bleiben, die Ausschlusspaare 4.3 reichen: Open Gates/Syncretic Spirit gegen Inquisition/Steadfast Flock; Holy War und Peacemakers schließen sich schon aus).
- **Deckel:** Teilwert „Faith“ **−16 bis +12** nach den Faktoren (unten −16, damit „Ketzer“ unter Inquisition feindlicher als Fremde bleiben können; vorläufig). Bündnisse (Vertrauen ≥ 80) und Pakte (≥ 40) werden damit unter gleichem Glauben leichter, unter fremdem Glauben schwerer; die Schwellen der Diplomatie ändern sich nicht (Kalibrierung, 11).
- **Eigenschaften mit eigener Wirkung bleiben:** Vertrauen +6 (Open Gates), +5 (Peacemakers), +3 (Syncretic Spirit) in Tabelle 4.2 gelten weiter für alle Völker; „Faith“ kommt dazu. Die Simulation prüft, ob das doppelt zählt (Doppelung ggf. abschwächen).
- **Nicht in dieser Regel:** Gefahr (bleibt Stärke), Zoll und Handelsmengen (nur über 4.2), Krieg (heiliger Krieg: siehe 6b, Beitritt zur Rebellion über den Glauben: 6.4a).

## 6b. Heiliger Krieg

Entschieden (Nutzer): angenommen. Alle Zahlen vorläufig, wird simuliert. Ergänzung in `Requirement Krieg.md` §6 (Kriegsziel „Holy war“).

- **Voraussetzung:** Die **Mehrheitsreligion des Angreifers** hat die Eigenschaft **Holy War oder Inquisition** (Stufe ≥ 1, nach Anhängeranteil gemischt, 4.4; zählt, wenn der Anteil der Anhänger mit der Eigenschaft ≥ 50 % ist). Entschieden (Nutzer).
- **Erklärung:** Neues Kriegsziel „Holy war“ in Krieg §6: über die normale jährliche Erklärung (10 %-Wurf, nur gegen Nachbarn, Waffenstillstand und „schon im Krieg“ gelten), aber die **Stärkeprüfung ist 1,5× statt 2×**, und nur gegen einen Nachbarn mit **fremder Mehrheitsreligion** (nicht gleicher Glaube). Zielsitz und Nutzen wie Krieg §6. **Abklingzeit 30 Jahre je Angreifer-Religion.**
- **Eroberung:** Die Eroberung gilt wie Krieg §6 (Bezirk wechselt den Besitzer, „erobert“ −15), dazu **Bekehrung mild**: Gläubige fremden Glaubens im Bezirk **−0,3 Glaube** (Glaubensverlust, 5), und der Besatzer bekommt **10 Jahre lang +0,15 Ausbreitungsdruck** (`pull`, 5) im Bezirk. Entschieden (Nutzer): mild, keine Zwangsbekehrung.
- **Beitritt:** Völker mit der **Mehrheitsreligion des Angreifers** und **Vertrauen ≥ 40** zum Angreifer dürfen dem Angreifer beitreten (**mit 50 % der Armee**, wie Krieg §7); Armee, Obergrenzen und Chronik wie dort. Sonst gelten die Beitrittsregeln von Krieg §7 unverändert.
- **Aufgabe:** Der Angreifer gibt erst auf, wenn er **unter 30 % statt 40 %** der Stärke des Gegners hat (er kämpft hartnäckiger); der Verteidiger wie Krieg §6.
- **Rückkopplung auf Eigenschaften:** jeder heilige Krieg des Angreifers gibt der Religion **Holy War +10** (Ereignis, wie 4.5; Gewinn und Obergrenze wie dort); ein **verlorener heiliger Krieg** gibt **Steadfast Flock oder Martyrs' Creed** (je +10, Wahl nach Zufall unter den nicht ausgeschlossenen, 4.3).
- **Religion des Spielers:** gleiche Regeln. Ein Volk des Spielers erklärt heilige Kriege nur, wenn die Mehrheitsreligion Holy War oder Inquisition hat (kein Sonderfall, wie jeder Krieg: der Spieler erklärt nicht selbst).
- **Zukunft (nicht in dieser Regel):** Kriegsziel „Befreiung von Glaubensgenossen“ (Kriegserklärung gegen ein Volk, das Gläubige der eigenen Religion unterdrückt).
- **Simulationsziele:** heilige Kriege sind selten und beeinflussen die Karte (z. B. höchstens 15–25 % aller Kriege); keine Dauerkriege einer Religion (Abklingzeit); Anspannung der Religion (Spaltung, 6.1) nicht außer Kontrolle.

## 7. Tod der Religion

- Eine Religion **stirbt**, wenn **weniger als 1 % aller Einwohner der Welt** oder **weniger als 20 Gläubige** ihr anhängen, und das **2 Jahre in Folge** (jährlich geprüft). Neu gegründete Religionen haben eine **Schonfrist von 5 Jahren** (in dieser Zeit wird nicht auf Tod geprüft) und brauchen **mindestens 20 Gläubige bei Gründung** (Abschnitt 3). Entschieden (Nutzer).
- **Folgen:** Alle Einwohner der Religion (Schwankende) verlieren sie (255). Der **Gott stirbt mit ihr** (Schritt 2), **sofort**, seine Ladungen sind **verloren** (Rivalen); Eintrag in der Chronik (wichtig bei Religion 0 und bei Religionen mit Gott, sonst still), der Platz wird frei. Die Religion des Spielers stirbt nur über die Siegbedingung: keine Gläubigen mehr = Spielende, unverändert.
- Der Tod der Religion ist **endgültig**; „vergessene Götter“ siehe Abschnitt 13.

## 8. Neue Fähigkeiten (5)

Neue Kategorie **Faiths** (Ziel: eine Religion; Wahl in der Liste „Faiths“ oder Antippen eines Hexfelds, dann die dort stärkste Religion, ggf. Wahl). Sie hängen **an den Pool des Gachas** (`Requirement Gacha.md` §6: **30 statt 25 Fähigkeiten**, jede einmal im Pool, Ids 26–30 angehängt: `ABILITIES` append only). Stufen mit den Gewichten 50/30/15/5: Pool danach **Common 7, Rare 11, Epic 9, Legendary 3**; erwarteter Anteil der Religions-Fähigkeiten an einer Ziehung ≈ 9 % (jede dritte Ziehung enthält ≈ eine). Alle Zahlen vorläufig.

| Nr. | Name | Stufe | Ziel | Wirkung |
|---|---|---|---|---|
| 26 | Blessed Doctrine | Epic | Religion | gibt der Religion eine **zufällige** Eigenschaft (Ausschlüsse gelten, nicht schon vorhandene) auf **Stufe 2**; über die natürlichen Plätze hinaus erlaubt (bis 7); ist die Religion die des Spielers, ist die Eigenschaft ebenso zufällig (kein Wählen). Unzulässig, wenn alle verfügbaren Eigenschaften vorhanden oder ausgeschlossen sind |
| 27 | Lost Doctrine | Rare | Religion | entfernt eine **zufällige** Eigenschaft der Religion (nicht die einzige: unzulässig bei 1 Eigenschaft); der Platz wird frei |
| 28 | Sunder the Faith | Epic | Religion | löst **sofort eine Spaltung** aus (6.1, Mindestzahl Völker entfällt); auch auf die eigene Religion erlaubt (der Spieler wirft selbst); unzulässig ohne freien Religionsplatz oder ohne Volk mit ≥ 20 Gläubigen, die ≤ 70 % der Religion sind |
| 29 | Spark of a New Faith | Epic | Volk | gründet in dem Volk **sofort eine neue Religion** (Eigenschaften nach 4.5 aus dem Gründervolk); **25 %** der Einwohner nehmen sie an (zuerst die religionslosen und schwankenden, dann Hexfelder um die Hauptstadt) mit Glauben 0,6; unzulässig ohne freien Religionsplatz oder bei weniger als 80 Einwohnern (25 % müssen mindestens 20 Gläubige ergeben, Abschnitt 3). Die Religion hat **keinen Gott** (Schritt 2: Kandidat für einen Rivalen-Gott) |
| 30 | Covenant of One | Legendary | zwei Religionen | **verschmilzt** zwei gewählte Religionen sofort (6.2: die größere bleibt; mit Religion 0 bleibt Religion 0); zwei Zielwahlen nacheinander; unzulässig bei weniger als zwei Religionen |

- Die bestehenden **Prophet's Light** (Glaube der Einwohner +0,15, Andacht +0,03) und **Doubt** (−0,15 an alle Religionen) wirken jetzt auf den Glauben an die **jeweilige** Religion: Light auf Religion 0 (bzw. die des wirkenden Gottes, Schritt 2), Doubt auf alle Religionen im Volk.
- **Stapelregel:** Einmal-Wirkungen wirken jedes Mal; ein Eingriff erzeugt einen stillen Chronik-Eintrag („You cast … on …“, mit „by the god“ bei Eigenschaften).
- **Kosten und Pool:** unverändert (`pullPrice`, 3 je Ziehung, Dubletten erlaubt). `gachaStats` und der Benchmark `gacha` werden um die 5 Fähigkeiten erweitert (Abschnitt 11).

## 9. Anzeige (Schritt 1)

- **Faiths-Panel:** Knopf „Faiths“ (neben Gacha und Map). Liste der lebenden Religionen: Name, Gläubige (Zahl und Anteil an der Bevölkerung), Völker, Alter, **Eigenschaften mit Stufe und Wirkung in Zahlen** (wie „Leader ›“, `Requirement Anführer.md` §8; Fortschritt zur nächsten Stufe, „Years to next trait“), Anspannung (Calm/Uneasy/Tense), Gott („You“, „None“, später „Rival god“). Antippen einer Religion: Karte hebt ihre Hexfelder hervor.
- **Peoples-Panel:** Untermenü **„Faith ›“**: die Religionen im Volk mit Anteil, die folgende Religion, die **tatsächlichen Hebelwirkungen** („War chance +4 points from Holy War 40 %“) und der Teilwert „Creed“. Hexfeld-Info: Religion und Anteil im Hexfeld, Zufriedenheit mit dem Teilwert „Creed“ neben „Leader“ und „Divine“.
- **Karten-Modus „Faith“** (`Requirement Kartenmodi.md`, Runde 2): Untermodi **„Religions“** (Farbe je Religion, Schattierung nach Anteil im Hexfeld; 16 Farben, Religion 0 in Gold) und **„Your faith“** (Anteil der Religion 0 in Stufen, Zahl in Prozent, wie die Zufriedenheitsmodi). Liest nur vorhandene Werte (Anteil je Hexfeld aus den Bewohnern, jährlich aktualisiert).
- **Chronik** (`Requirement Zufriedenheit.md` §5): wichtig (Dialog mit Pause): Gründung einer Religion, Spaltung, Verschmelzung, Tod einer Religion, Spaltung/Tod der Religion 0, Spaltung angekündigt (nur Religion 0: still). Still: Eigenschaft gewonnen/verloren/Stufe, Volk folgt einer Religion, Einsatz der Fähigkeiten. Mit „Go to“ auf das Gründervolk.
- Alle Texte Englisch.

## 10. Datenhaltung

- Je Einwohner: `religion` (`Uint8`) neben `faith` (`Float32`). Je Hexfeld: Gläubige je Religion nicht gespeichert (aus den Bewohnern, jährlich neu; nur Anzeige und Druck).
- Je Religion (16 Plätze, flache Typed Arrays): Zustand, Name-Index, Gründungsjahr, Gründervolk, Eigenschaften (Slots 7 × Id/Stufe/Fortschritt, `Uint8`/`Int8`), Ereigniszähler (je Ereignisart, 13), Anspannung, Alter-Uhr für neue Eigenschaften, Gott (Spieler/keiner, später Rivale). Je Religion × Volk: Gläubige (16 × 9 `Int32`). Hebelsatz `faithLev` (Volk × Hebel, `Float32`), R-Hebel je Religion.
- Eigener Zufallsgenerator „faith“ (deterministisch, verschiebt keine anderen Folgen; Schritt 2 „gods“).
- **Speichern/Laden:** Neue Felder gehören in den Spielstand, die Formatversion `SAVE_VERSION` wird erhöht (`Requirement Speichern und Laden.md` §8); ältere Spielstände werden abgelehnt. Der Zustand der Anzeige (Panel, Modus) siehe `Requirement Kartenmodi.md` §7.
- Kern ohne React, portierbar (flache Arrays), wie die Anführer.

## 11. Performance, Benchmark, Simulation

- Laufende Kosten: eine jährliche Zählung der Gläubigen je Religion und Volk (ein Durchlauf über die Einwohner, wie `believers` heute), Hebelrechnung je Volk (16 Religionen × 24 Eigenschaften, nur bei Änderung), Ereigniszähler (kleine Zähler), Druck je Hexfeld im bestehenden jährlichen Glaubensschritt. Keine neue Karten-Neuzeichnung außer im Modus „Faith“ (Neuzeichnen nur, wenn die Karte ruht, `modes`-Szenario).
- **Benchmark (Pflicht):** `modes` bekommt die neuen Untermodi; `gacha` bekommt Ladungen der 5 neuen Fähigkeiten; `unrest` und `war` prüfen Spaltungen und viele Religionen (16 aktive, jede in mehreren Völkern: Setup `spreadFaiths.ts`); alle Szenarien bleiben grün (60 fps, kein Frame über 25 ms).
- **Simulation (`sim-analyst`, 12 Welten, 300 Jahre, gegen den Stand ohne Religionen; Tool geplant: `tools/religionStats.ts`):**
  1. **Zahl der Religionen** über die Zeit, Gründungswege (Volksglaube, Spaltung, Fähigkeit), Tod, Lebensdauer (Ziel: 3–8 lebende Religionen, keine dauerhafte 16/16, Religion 0 überlebt in ≥ 90 % der Welten bis Jahr 300).
  2. **Eigenschaftsverteilung**: wie viele je Religion, Stufen, Verteilung der 24 (keine fehlende, keine dominante), Abschluss der Ereigniswege.
  3. **Wirkung auf Völker**: Kriege, Bündnisse, Handel, Siedlungswachstum, Rebellionen gegen den Stand ohne Eigenschaften (Warmonger-/Pacifist-artige Völker sichtbar verschieden; Deckel wirken); Zufriedenheit „Creed“ (Spanne ±8 erreicht?).
  4. **Spaltung und Verschmelzung**: Häufigkeit, Anteil der Religion 0 (Spaltung der Spielerreligion in ≤ 30 % der Welten bis Jahr 300 und Spielende-Risiko; Anspannung als Warnung brauchbar); **Heresy** (jetzt Loyalitätsteil, Mandat): 10–30 % der Spaltungen enden in einer Rebellion (Unabhängigkeit oder Autonomie, 6.4); **Faith-Vertrauen (6a):** Verteilung des Teilwerts, Bündnisse und Pakte nach gleichem/fremdem Glauben, Doppelung mit den Vertrauens-Eigenschaften.
  5. **Parameter** (Startwerte siehe Abschnitte 3–7): Volksglaube-Schwellen (30 % / 5 Jahre / 5 %), Fortschrittspunkte (+10/−2/−8), Plätze (2 + Alter/20), Spaltungschance, Verschmelzungschance, Todesschwelle (1 % / 20 Gläubige / 2 Jahre / Schonfrist 5), Druck und Bekehrung (0,1 / 0,2), `suppress` 0,03, Stufenfaktoren (0,5/1/1,5), Faith-Verlust bei Spaltung der Religion 0.
  6. Gacha: Verteilung der Ziehungen mit 30 Fähigkeiten, Wirkung der 5 neuen (Eingriffe auf Eigenschaften, Spaltung, Verschmelzung).

## 12. Schritt 2: Rivalen-Götter

Schritt 2 setzt Schritt 1 voraus (Religionen mit Eigenschaften laufen). Entscheidungen des Nutzers: Rivalen werden **wie der Spieler** behandelt, ohne Sonderregel gegen den Spieler.

### 12.1 Erwachen

- Eine Religion **ohne Gott** bekommt einen **Rivalen-Gott**, wenn sie **mindestens `AWAKE_BELIEVERS` Gläubige** hat und das **`AWAKE_YEARS` Jahre in Folge**, und höchstens **`MAX_RIVALS`** Rivalen leben. **Zu simulierende Parameter (nicht entschieden):** Startwerte **150 Gläubige, 15 Jahre, höchstens 3 Rivalen**; die Simulation prüft, wie oft Götter erwachen, wie viel sie wirken und wie das Spiel dadurch kippt.
- Religion 0 hat den Spieler als Gott, auch nach einer Spaltung bekommt die Abspaltung keinen Gott automatisch (6.3), sondern nur nach den Regeln hier.
- **Tod:** Ein Rivale **stirbt sofort mit seiner Religion** (7); seine Ladungen sind **verloren**. Bei einer Verschmelzung stirbt der Gott der kleineren Religion ebenso. Das Spielende bleibt unverändert: keine Gläubigen des Spieler-Gottes → Ende.

### 12.2 Faith und Ladungen

- Ein Rivale sammelt **Faith wie der Spieler** (0,001 je Gläubigem seiner Religion und Tick) und zieht Fähigkeiten zum **selben Preis** (Preis steigt je Ziehung des Gottes: `75 · n^1,8`, eigener Zähler `pulls` je Gott) aus **demselben Pool** (alle 30 Fähigkeiten, auch die neuen, Abschnitt 8). Die Ladungen liegen im Zustand des Gottes (`charges` je Gott).
- Zähler und Faith je Gott (Gott-Index, `Requirement Gacha.md` §2 „Für spätere Rivalen-Götter wird die Zählung je Gott geführt“).
- Ein Rivale **hält sich an dieselben Regeln** (Zielprüfer, Gott-Schicht, Dauerstapeln). Er darf auf **alle** Völker wirken, auch auf die des Spielers, **ohne Sonderregel** (Entscheidung des Nutzers); der Spieler sieht die Einsätze in der Chronik (still, „A rival god cast … on …“ bei wichtigen Folgen).

### 12.3 Verhalten aus den Eigenschaften

Das Verhalten folgt **aus den Eigenschaften** der Religion des Gottes (der Gott „ist“ seine Eigenschaften), wie der Anführer aus seinen Attributen. Je Fähigkeit und Zielwahl gibt jede Eigenschaft Gewichte; Grundgewicht jeder Fähigkeit 1; die Gewichte der Eigenschaften werden **multipliziert** (Stufe skaliert die Abweichung wie 4.1), Zufall nach Gewicht (RNG „gods“). **Eigene Völker** = Völker mit ≥ 40 % Anteil der Religion; **Feindvölker** = Völker im Krieg mit eigenen Völkern, sonst Völker mit dem höchsten Anteil einer anderen Religion.

| Thema | Bevorzugte Fähigkeiten (Gewicht ×2–×4) | Zielwahl |
|---|---|---|
| War | Wild Fire, Restless Spirits, Mark of Weakness, Doubt; Gift of Trait für eigene Anführer | Feindvölker, deren Land; eigene Anführer |
| Fertility | Fertile Blessing, Fruitful Waters; Lean Years, Exhausted Soil auf Fremde | eigene Völker; Fremde mit dem höchsten Anteil anderer Religionen |
| Order | Grateful Hearts, Honed Mind, Young Heir, Wide Foundations | eigene Völker und Anführer, Hauptstädte |
| Mission | Prophet's Light, Doubt, Spark of a New Faith, Blessed Doctrine, Sunder the Faith | Völker mit hohem religionslosem Anteil bzw. mit fremder Mehrheit; Spaltung fremder Religionen |
| Openness | Golden Harvest, Wanderlust, Covenant of One | eigene Völker; Verschmelzung mit Nachbarreligionen |
| Asceticism | Prophet's Light auf eigene Völker, Lost Doctrine auf fremde Religionen | eigene Gläubige; Religionen mit vielen Eigenschaften |
| Ancestors | Long Life, Dynasty's Heir, Brittle Crown auf Feinde | eigene und feindliche Anführer |
| Sea & Wandering | Great River, Wanderlust, Biome Shift, Rich Vein | Küsten- und Handelsvölker; Land zwischen eigenen Völkern |

Mehrere Eigenschaften mischen die Gewichte. Die genaue Tabelle (je Eigenschaft × Fähigkeit) legt die Umsetzung an einer Stelle ab (`GOD_WEIGHTS`); **Offen:** Tabellenwerte und Zauberrate (Einsatz höchstens 1 Ladung je Jahr je Gott?) werden in der Simulation gesetzt (Parameter markiert: `GOD_CAST_RATE`, Gewichtsfaktoren).

### 12.4 Anzeige und Simulation

- Faiths-Panel zeigt „Rival god“ mit Faith und Zahl der Ladungen? **Entschieden (Nutzer):** nur „Rival god“ (dass es einen Gott gibt), nicht seine Ladungen oder sein Faith; die Karte zeigt nichts Neues. Chronik wie oben.
- Simulation: Häufigkeit des Erwachens, Zahl der Rivalen, Einsätze je Gott, Wirkung auf Völker des Spielers, Spielende durch Rivalen (Doubt, Restless Spirits in Serie auf den Spieler: Deckel prüfen), Verhältnis zu den Eigenschaften.

## 13. Zukunft (nicht in Schritt 1 und 2)

- **Vergessene Götter:** Ein toter Gott soll später nicht endgültig verschwinden: Spuren (Ruinen, heilige Stätten wie `HolySpring`, `SacredGrove`, `AncientRuins`) könnten eine Religion wieder erwecken; eigene Regeln folgen später.
- **Einfluss von Religion auf Diplomatie:** Vertrauen jetzt in Abschnitt 6a (Entwurf); **heilige Kriege** als Kriegsgrund bleiben Zukunft (Vorschlag liegt dem Hauptprozess vor, nicht eingetragen).
- **Tempel und heilige Stätten** als Gebäude, Pilger als Händlerart.
- Duelle der Götter, Bündnisse zwischen Göttern, Eigenschaften mit mehr als 3 Stufen, Religionsnamen aus einer Liste.

## 14. Abhängigkeiten

- `Requirement Gacha.md`: §6 (30 statt 25 Fähigkeiten), §7.7 (Anbetung, Light/Doubt je Religion), §13 (Rivalen-Götter jetzt hier); Hebelsatz „Gott“ und Glaube (3 Schichten).
- `Requirement Anführer.md`: Hebelsatz `L`, Attribute als Vorbild und Gründer-Eigenschaften (4.2), Erbe 50 → 80 % (Ancestor Veneration), Hebel `devotion`.
- `Requirement Zufriedenheit.md`: Teilwerte „Creed“ und „Heresy“, Chronik, Völker ohne eigene Religion.
- `Requirement Mandat.md`: Rebellion über den Glauben (6.4) läuft über Loyalität, Block und Countdown (Stärkeprüfung entfällt); `Requirement Krieg.md` §8: Rebellenkrieg bei Unabhängigkeit; §7: Beitritt anderer Völker über den Glauben (6.4a); §6: Kriegsziel „Holy war“ (6b).
- `Requirement Diplomatie.md`: Hebel Vertrauen/Grenzen/Zoll, Glaube der Abwanderer, Teilwert „Faith“ im Vertrauen (6a).
- `Requirement Krieg.md`: Hebel Kriegswurf, Aufgabe, Verluste, Erschöpfung, Verteidigung; Ereignisse (Krieg gewonnen/verloren).
- `Requirement Handel.md`, `Requirement Zentralregierung.md`: Hebel Händlerlast, Fahrtweite, Unterhalt, Einkommensprüfung.
- `Requirement Kartenmodi.md`: neuer Modus „Faith“ (Runde 2).
- `Requirement Speichern und Laden.md`: neue Felder, `SAVE_VERSION`.
- Game Design Abschnitte 5, 7, 8, 9 (Glaube, Gott, Rivalen, Spielende; .docx/.pdf, im Entwurf noch nicht nachgetragen).

## 15. Entschieden und offen

Entschieden (Nutzer): Religion als eigenes Objekt, höchstens 16, eine je Einwohner; Eigenschaften-Pool statt fester Werte (Muster der Anführer-Attribute); alle Religionen, auch die des Spielers, können sich spalten und verschmelzen; Ausbreitung, Bekehrung, Unterdrückung über Eigenschaften; Tod bei < 1 % der Einwohner oder < 20 Gläubigen 2 Jahre in Folge, der Gott stirbt mit; Schritt 1 ohne Götter, Schritt 2 Rivalen; Rivalen mit Faith, Preis, Pool und Fähigkeiten wie der Spieler; Verhalten aus den Eigenschaften; kein Sonderfall für die Völker des Spielers; Spielende unverändert; ein toter Gott stirbt sofort, Ladungen verloren; vergessene Götter in die Zukunft.

Ebenfalls entschieden (Nutzer, später): Schonfrist neuer Religionen 5 Jahre und mindestens 20 Gläubige bei Gründung (3, 7); Rebellenvölker gründen keine eigene Religion (3); Spaltung der Spielerreligion nur über Fähigkeiten verhinderbar/rücknehmbar (6.3); Creed-Deckel ±8, linear mit dem Anteil, Simulation prüft (4.4); Rivalen-Anzeige nur „Rival god“ (12.4); Namen „Faith of the <Volk>“ (2).

Ebenfalls entschieden (Nutzer): Spaltung kann zu einer Rebellion führen, jetzt über die Loyalität (Teil „Glaube“, Mandat), nicht mehr über Zufriedenheit und Stärkeprüfung; die Ansteckung der Tochterreligion (κ 0,10) breitet sie über Nachbarsiedlungen aus; Inquisition und Open Gates heilen (6.4). Glaubensunterschiede ändern das Vertrauen, Eigenschaften heben oder senken die Meinung über andere Religionen (6a, im Grundsatz).

Ebenfalls entschieden (Nutzer, jüngste Runde): Verwandte Religionen sind je nach Eigenschaften freundlich oder feindlich (additiver Hebel `kin`, auch negativ, 6a); bei Heresy treten zusätzlich andere Völker der Rebellion bei (6.4a); Heiliger Krieg mit allen Punkten von 6b, nur mit Holy War oder Inquisition, Bekehrung bei Eroberung mild.

Offen (vor oder in der Simulation, alle mit Empfehlung):
1. **Einzelne Zahlen von 6a** (Basiswerte +8 / −8, Deckel −16/+12, `kin`-Verschiebungen der Tabelle) und die Doppelung mit den Vertrauens-Boni aus 4.2: die Simulation entscheidet.
2. **Heresy** wirkt jetzt in jeder Siedlung mit fremdem Glaubensanteil (6.4, Mandat); die Beitrittsschwellen in 6.4a (Mehrheit > 50 %, Vertrauen ≥ 40; Empfehlung: Startwerte).
3. **Heiliger Krieg:** alle Zahlen von 6b (1,5×, 30 %, −0,3 / +0,15 über 10 Jahre, Abklingzeit 30 Jahre, +10) sind Startwerte; „Befreiung von Glaubensgenossen“ ist Zukunft.
