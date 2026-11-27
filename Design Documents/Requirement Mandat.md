# Requirement: Mandat (Loyalität, Legitimität, Aufstand und Vasallen)

Stand: **simuliert, freigegeben zur Umsetzung (Schritt 1)** (Variante B „Mandate“, vom Nutzer gewählt, Branch `feature/religions`; Satz „ab“, 24 Welten, Ergebnisse in `Requirement Religion.md` §16; Karten-Modus „Loyalty“, Fähigkeit Nr. 31 und Panels sind noch nicht simuliert und bleiben Entwurf). Ablauf: Design → Simulation → Umsetzung. Alle Zahlen dieses Dokuments sind der eingefrorene Satz „ab“; Feinschliff nur noch in der Umsetzung (Benchmark). Spieltexte sind Englisch.

Ersetzt die **Stärkeprüfung** der Rebellion (`Requirement Krieg.md` §8: Stärke der Unzufriedenen > Stärke des Mutterlands, Miliz 2,5 %); die **×0,1-Stärkeregel** der Religion (`Requirement Religion.md` §6.4) ist **verworfen**, ebenso eine eigene Heresy-Block-Regel und jede Zwangsbekehrung. Der **Rebellenkrieg** selbst (Krieg §8 „Erklärung“, „Krieg“, „Hilfe von außen“) bleibt, wird aber nur noch am Ende eines Countdowns ausgelöst. Neu: **Vasallen** (Autonomie ohne Krieg).

Baut auf Zufriedenheit (`Requirement Zufriedenheit.md`), Zentralregierung (`Requirement Zentralregierung.md`, Sitze, Bezirke, Straßen), Diplomatie (`Requirement Diplomatie.md`), Krieg (`Requirement Krieg.md`), Anführer (`Requirement Anführer.md`), Religion (`Requirement Religion.md`) und Gacha (`Requirement Gacha.md`) auf.

## 1. Idee

Ob ein Reich zerfällt, hängt nicht an der Armee, sondern am **Mandat**: wie weit die Macht des Herrschers reicht und wie sehr ihn die Menschen anerkennen. Jede Siedlung hat eine **Loyalität** (0..100) zum Reich. Fällt sie unter eine Schwelle, ist sie unruhig. Zusammenhängende unruhige Siedlungen bilden einen **Block**; wiegt der Block mehr als der treue Kern des Reichs, läuft ein **Countdown** (5 bis 10 Jahre): das **Zeitfenster des Spielers**. Am Ende steht, mit Würfel, **Unabhängigkeit** (Rebellenkrieg), **Autonomie** als Vasall (kein Krieg) oder **Versöhnung**.

Entschieden (Nutzer): Die **Hauptstadt geht nie verloren**. Ein Aufstand darf **friedlich** enden (Autonomie). **Lokale Anführer/Gouverneure** entfallen (Abschnitt 12, Zukunft). Der Ausgang hat **Zufall** (Abschnitt 5, eigener Generator).

## 2. Loyalität einer Siedlung

Jährlich neu berechnet (im Schritt des Volks, nach Zufriedenheit und Glaubenszählung). Je Siedlung ein Zielwert `T`, die Loyalität `L` folgt ihm mit Trägheit.

`T = 50 + Reichweite + Zufriedenheit + Glaube + Legitimität + Garnison + Gnade`, begrenzt auf 0..100.
`L(neu) = L + clamp(T − L, −6, +2)` (Absturz schneller als Erholung; Erholung vorher +4, Satz „ab“). Neue Siedlungen und neue Völker starten bei `L = T`.

**Die Hauptstadt** hat immer `L = 100` und wird nie unruhig. Siedlungen, die nicht zum Reich gehören (Vasallen haben ihr eigenes Reich), zählen nicht.

| Teil | Startwert | Bemerkung |
|---|---|---|
| **Reichweite** | +15 bei Reisekosten ≤ 1, linear bis −25 ab 8 | Reisekosten über Straßen zur Hauptstadt (wie „Anbindung“, `Requirement Zufriedenheit.md` §2); **Regierungssitze verkürzen**: es zählt `min(Kosten zur Hauptstadt, Kosten zum nächsten Sitz + 1,5)`. Straßen senken die Kosten, eine abgeschnittene oder besetzte Straße hebt sie. **Doppelzählung mit „Anbindung“ (Zufriedenheit, `Requirement Zufriedenheit.md` §2) gelöst (Satz „ab“): solange das Mandat läuft, zählt der Zufriedenheitsteil „Anbindung“ nur ×0,5** (der Teil Reichweite hier trägt den Rest) |
| **Zufriedenheit** | `clamp(0,5 × Zufriedenheit, −30, +15)` | die Zufriedenheit der Siedlung (−100..+100) |
| **Glaube** (Heresy) | `−45 × Abweichung`, höchstens **−50** (vorher 30 / −35) | Abweichung = Anteil der Einwohner, deren Religion **nicht** die Staatsreligion ist (Abschnitt 8); Gefälle zu den Nachbarn: `0,7 × eigener Anteil + 0,3 × Mittel der Nachbarsiedlungen des Reichs im Umkreis von 3 Hexfeldern`; der Teil bewegt sich höchstens 5 Punkte je Jahr (§8). Heresy ist **kein Zufriedenheitsteil** mehr |
| **Legitimität** | `+Legit` des Reichs (−20..+20) | gleich in allen Siedlungen, Abschnitt 3 |
| **Garnison** | `+0,5 je 1 % Soldaten an der Bevölkerung des Hexfelds`, höchstens **+6** | nur Soldaten des Reichs, die dort stationiert sind (`hexMilitary`); klein und gedeckelt: Armeen kaufen nur Zeit, kein Mandat |
| **Gnade** | +6 einmal, klingt in 20 Jahren ab | Fähigkeit „Decree of Grace“ (Abschnitt 9) |

Beispiele (Start): zufriedene Siedlung nahe der Hauptstadt: 50 + 15 + 5 + 0 + 5 = 75. Ferne, unzufriedene Siedlung ohne Straße: 50 − 25 − 15 = 10.

**Unruhig** = `L < 45 / L.rebel` (Schwelle vorher 25; Hebel `L.rebel` der Anführer und Religionen, `Requirement Anführer.md` §9; Divine Mandate ×1,2 und Inquisition ×1,2 machen es also schwerer: Schwelle 37,5; Tyrant, Stubborn usw. senken sie). **Hysterese:** wieder ruhig ab `L ≥ Schwelle + 10`. Die Hauptstadt nie.

## 3. Legitimität des Reichs

Ein Wert je Volk, `Legit` −20..+20 (jährlich), Summe:

| Teil | Startwert |
|---|---|
| **Amtszeit** | +1 je 3 Jahre im Amt, höchstens +6 (gefestigt) |
| **Thronwechsel** | −8 beim Amtsantritt eines neuen Anführers, klingt über 10 Jahre ab; ein Erbe aus derselben Dynastie nur −4 (`Requirement Anführer.md` §6) |
| **Alter und Erfolg des Herrschers** | Anführer über 60 Jahre: −0,2 je Jahr über 60, höchstens −4; Ziel des Anführers erreicht: +4, klingt über 20 Jahre ab |
| **Kriege** | gewonnen +6, verloren −10, Rebellion niedergeschlagen +4, Abspaltung/Verlust von Siedlungen durch Unabhängigkeit −8; jeweils klingen sie über 20 Jahre ab (ein Ereigniswert `legitEvents`, der jährlich ×0,93 schrumpft) |
| **Götter** | Volk betet den Spieler an (`worshipsPlayer`): +3 (Segen); Fähigkeit „Decree of Grace“: +10 für 20 Jahre (Gott-Schicht, Abschnitt 9); Restless Spirits/Grateful Hearts wirken schon über Zufriedenheit |

Eigenschaften der Anführer (Tyrant, Oathkeeper, Merchant Prince usw.) wirken über ihre bestehenden Hebel (Zufriedenheit, Rebellionsschwelle), nicht über einen neuen Hebel. Legitimität ist **nur ein Wert je Volk**, nicht je Siedlung.

## 4. Block, Gewicht, Countdown

- **Block:** die unruhigen Siedlungen eines Reichs, die durch Straßen oder Nachbarschaft zusammenhängen (wie die „Gruppen“ aus Krieg §8; je Reich höchstens 8 Blöcke, die größten). Ein Block hat mindestens **2 Siedlungen oder 15 % der Bevölkerung des Reichs**; sonst bleibt er ein bloßes Problem (Abwanderung, Zufriedenheit) und wird nie zum Countdown.
- **Gewicht:** Block `W_B = Σ Einwohner × (100 − L) / 100`; **treuer Kern** `W_K = Σ Einwohner × L / 100` über alle nicht unruhigen Siedlungen des Reichs (Hauptstadt mit `L = 100`). Der Block „wiegt mehr“, wenn `W_B > ratio × W_K` (`ratio = 0,5`, vorher 1,0: ein Block muss nur halb so viel wiegen wie der treue Kern; Satz „ab“).
- **Countdown:** Wird die Bedingung erfüllt, beginnt der Countdown des Blocks mit der Länge **5 + Wurf(0..5) Jahre** (gleichverteilt, Zufall, Abschnitt 5). Chronik: wichtiger Eintrag mit Dialog und Pause („Unrest threatens to split <Volk>“, mit „Go to“); das ist der Moment, in dem der Spieler eingreift (Abschnitt 9).
- **Dem Spieler gezeigt** wird nicht die gewürfelte Länge, sondern „at the latest in N years“ (N = 10 − vergangene Jahre).
- **Abbruch:** Fällt `W_B` auf `≤ 0,8 × ratio × W_K` (Hysterese), endet der Countdown in **Versöhnung** (Abschnitt 6). Wächst der Block, bleibt der Countdown (kein Neustart); jeder Block hat höchstens einen Countdown; Siedlungen eines Blocks im Countdown schließen sich keinem zweiten an.
- **Abgeschnittene Gebiete** (Regel der Zufriedenheit/Diplomatie: nach der Schonfrist direkt ein eigenes Volk, ohne Krieg) bleiben unverändert und ohne Countdown.

## 5. Zufall (Generator „mandate“, `sim.mandate.rng`, verschiebt keine anderen Folgen)

1. **Ansteckung (Block entsteht und wächst):** Jede unruhige Siedlung trifft jährlich jede Nachbarsiedlung desselben Reichs (angrenzend oder über eine Straße in ≤ 3 Hexfeldern) mit **20 %**, wenn deren `L < 45`; ein Treffer senkt deren `L` einmal um **8** („Agitation“, sie erholt sich über die Trägheit). So wandert die Grenze des Blocks mit Zufall, nicht allein nach Formel.
2. **Länge des Countdowns:** 5 bis 10 Jahre (Abschnitt 4).
3. **Ausgang am Ende:** Gewichte (Startwerte): Unabhängigkeit `wU = 1 + 2 × Glaubensanteil des Blocks (Abweichung > 50 %) + max(0, −Legit)/10 + 0,5 falls das Mutterland anderswo im Krieg ist`; Autonomie `wA = 1 + max(0, Legit)/10 + 0,5 falls Mutterland ≥ 2× stärker`; Auswahl nach Gewicht. **Autonomie-Gewicht ×0,5 (Satz „ab“): `wA = 0,5 × (1 + …)`, Unabhängigkeit ist damit etwa doppelt so wahrscheinlich wie Vasallenschaft.** Ist `W_B` am Ende nicht mehr `> ratio × W_K` (aber über der Hysterese), gilt Versöhnung.
4. **Vasall → Unabhängigkeit** (Abschnitt 7): jährlicher Wurf **1,5 %** (vorher 3 %).

Alle Würfe sind deterministisch je Seed (Generator wird gespeichert).

## 6. Ausgänge

**Unabhängigkeit.** Wie Krieg §8 „Erklärung“: Die Siedlungen des Blocks werden **sofort unabhängig**, aus jeder straßenzusammenhängenden Gruppe ein eigenes Volk (höchstens die 8 größten Gruppen), die Rebellenvölker sind verbündet, jedes mit eigener Hauptstadt (größter Sitz, sonst größte Siedlung), eigenem Anführer, **behält die Religion** (keine neue Religion). **Es läuft der bestehende Rebellenkrieg** (Krieg §8 „Krieg“ und „Hilfe von außen“, Miliz 2,5 % der Einwohner wie dort; Mutterland gibt nie auf, Erschöpfung 10 Jahre; Teilwerte „Neuer Stamm“, „Erfolgreiche/Verlorene Revolution“, „erobert“). Chronik wichtig („Rebellion“ bzw. **„Rebellion over faith“**, wenn die Abweichung (Glaube) im Block der größte negative Teil ist; dann gilt Religion §6.4a, Beitritt anderer Völker). Mutterland: Legitimität −8 (Abschnitt 3).

**Autonomie (Vasall).** Die Siedlungen des Blocks werden ein **Vasallenvolk** des Mutterlands, **ohne Krieg** (Abschnitt 7); höchstens die 3 größten Gruppen, je ein Vasall. Chronik wichtig („<Volk> becomes a vassal of <Mutter>“). Mutterland: Legitimität −3. Kein Zufriedenheitsabzug „Verlorene Revolution“.

**Versöhnung.** Der Block löst sich auf: Loyalität im Block einmalig +10 („Reconciled“, klingt über 10 Jahre ab), Legitimität +2 einmalig. Chronik still.

## 7. Vasallen

Entschieden (Nutzer): Ein Vasall **zahlt Tribut an das Mutterland**, ist mit ihm **automatisch verbündet**, darf **keine Diplomatie außer mit dem Mutterland** führen, hat **eigenen Anführer** und **eigene Religion** (unabhängig). Die folgenden Einzelheiten sind **mein Vorschlag (Startwerte, Offen: Nutzer bestätigt)**.

**Entstehung und Stellung.** Ein Vasall ist ein **eigenes Volk** (eigener Slot, zählt nicht zum Limit von 9 Völkern wie ein Rebellenvolk), Datenfeld `vassalOf` (Mutterland, −1 keins). Eigene Hauptstadt, eigene Bezirke, Kassen und Lager, eigener Anführer (`Requirement Anführer.md`, Start mit Amtsantritt), „Neuer Stamm“ +10 Zufriedenheit. **Tiefe 1:** ein Vasall hat selbst keine Vasallen (sein eigener Block kann nur Unabhängigkeit oder Versöhnung ergeben, Abschnitt 6, ohne Autonomie). Alle Beziehungen des Vasallen zu Dritten (Abkommen, Pakte, Bündnisse, offene Grenzen) enden mit der Entstehung; Vertrauen/Gefahr zum Mutterland starten bei 70/0.

**Tribut.** **15 %** der Steuern, die die Sitze des Vasallen jährlich einnehmen (Geld und Güter, `Requirement Zentralregierung.md` §4), gehen als Geld und Lager in die **Kasse der Hauptstadt des Mutterlands**. Ist die Kasse des Vasallen knapp (weniger als ein Jahreseinkommen), wird der Tribut halbiert; sein eigener Sold geht vor. Der Tribut wird im Panel beider Völker als Posten gezeigt.

**Bündnis, in beide Richtungen.** Mutterland und Vasall sind dauerhaft verbündet, **unabhängig von Vertrauen** (keine Herabstufung, Krieg §7 „Bruch“ gilt nicht zwischen ihnen).
- Mutterland → Vasall: tritt Kriegen des Vasallen **immer** bei (Verteidiger-Seite, 1 Armee mit 50 % der Soldaten, Krieg §7).
- Vasall → Mutterland: tritt Kriegen des Mutterlands **immer** bei, auch auf der Angreifer-Seite (keine Stärkeregel, 1 Armee mit 50 %). Obergrenzen (4 je Volk, 32 auf der Karte) und „keine Beute“ wie Krieg §7. Die Stärke des Vasallen zählt für das Mutterland bei Gefahr und 2×-Prüfung als Bündnis.
- **Kriegserklärung:** Ein Vasall **erklärt nie selbst** einen Krieg und beginnt keine Eroberung; er führt keinen Krieg gegen das Mutterland außer in der Unabhängigkeit (unten). Wird er angegriffen, gilt Krieg §6 für den Angreifer unverändert (der Angreifer schätzt Vasall + Mutterland als Gegenseite, Krieg §7).

**Diplomatie, Handel, Zoll.**
- Zwischen Mutterland und Vasall: Grenzen offen, Freihandel, **ohne Zoll**, freie Migration.
- **Zu Dritten:** Der Vasall verhandelt nicht. Seine Grenzen und der Handel mit Dritten **folgen der Beziehung des Dritten zum Mutterland** (offene Grenze/Freihandel zwischen Drittem und Mutterland gilt auch zum Vasallen; Zoll und Händler wie `Requirement Diplomatie.md` §2 und §3 mit dem Vertrauen des Dritten zum Mutterland). Zölle in Vasallensiedlungen gehen an den Vasallen. Ein Dritter, der mit dem Mutterland im Krieg ist, ist es auch mit dem Vasallen.
- Vertrauen und Gefahr des Vasallen zu Dritten werden nicht geführt (kein Eintrag im Diplomatie-Panel des Vasallen, nur „Vassal of <Mutter>“).

**Glaube.** Der Vasall hat seine **eigene Religion** (Mehrheit seiner Bevölkerung); er hat keine Staatsreligion des Mutterlands, Heresy gilt in seinen Siedlungen nicht gegenüber dem Mutterland. Der Teilwert „Faith“ im Vertrauen (Religion §6a) wirkt, ändert aber das Bündnis nicht.

**Waffenstillstand (Entscheidung Nutzer, Satz „ab“):** Die Entstehung eines Vasallen gilt als **Frieden**: **20 Jahre Waffenstillstand mit dem Mutterland** (Krieg §6, wie nach jedem Frieden). In dieser Zeit sind **weder ein Unabhängigkeitskrieg noch eine friedliche Unabhängigkeit** möglich (der Wurf unten läuft erst danach). Der Vasall tritt den Kriegen des Mutterlands weiter bei (Bündnis oben). Der Aufstand eines Blocks im Vasallen (Punkt 3) ist davon unberührt.

**Ende eines Vasallenstatus.**
1. **Unabhängigkeit:** erst nach Ablauf des Waffenstillstands (20 Jahre ab Entstehung); jährlicher Wurf `1,5 % × (1 + max(0, −Legit des Mutterlands)/10 + 1 falls andere Mehrheitsreligion + 1 falls der Vasall stärker als das Mutterland ist)`. Bei Treffer: ist das Mutterland **schwach** (Legitimität ≤ −5 oder im Krieg und schwächer als der Vasall), wird der Vasall **friedlich** unabhängig (Vertrauen −10, 20 Jahre Waffenstillstand, Bündnis endet, Chronik wichtig). Sonst **Rebellenkrieg** wie Abschnitt 6 (der Vasall als Rebellenvolk, seine Siedlungen unverändert).
2. **Wiedereingliederung:** frühestens nach **20 Jahren** (Entscheidung Nutzer; Satz „ab“); jährlich **1,5 %**, wenn Legitimität des Mutterlands ≥ +5, Vertrauen des Vasallen ≥ **60** (vorher 70) und seine Bevölkerung ≤ **70 %** (vorher < 40 %) der des Mutterlands ist. Die Siedlungen werden Siedlungen des Mutterlands (Bezirke, Kasse und Lager gehen mit), Loyalität startet bei `T`, der Vasall endet, sein Anführer endet (Chronik still).
3. **Eigener Aufstand:** Blöcke im Vasallen wie Abschnitt 4 (Unabhängigkeit der Gruppe vom Vasallen: der Rebellenkrieg richtet sich gegen den Vasallen, **das Mutterland tritt als dessen Verbündeter bei**).
4. **Das Mutterland stirbt oder verliert alles** (keine Siedlung mehr, Eroberung der letzten Sitze): Alle Vasallen werden **friedlich unabhängige Völker** (kein Krieg, Vertrauen zum früheren Mutterland bleibt, Chronik still). Verliert das Mutterland nur seine Hauptstadt, ändert sich nichts (neue Hauptstadt, Tribut dorthin).
5. **Der Vasall wird erobert** (Sitze an einen Dritten): Bezirk wechselt wie Krieg §5; ist der letzte Sitz verloren, endet das Volk.

**Anzeige.** Karte: das Vasallenland in **eigener Farbe**, die Grenze zum Mutterland und zur Außenwelt **doppelt gezeichnet, die äußere Linie in der Farbe des Mutterlands** (die Grenze zum Mutterland selbst nur gestrichelt in dessen Farbe, wie „offen“). Völker-Panel: „Vassal of <X>“ bzw. „Vassals ›“ (Liste mit Tribut), Tribut als Posten. Diplomacy-Panel: nur das Mutterland.

## 8. Glaube und Mandat

Plug-in für `Requirement Religion.md` §5, §6.4, §6.4a (dort angepasst):

- **Staatsreligion** = der **Glaube des Anführers** (Entscheidung Nutzer: die Staatsreligion folgt dem Anführer; `Requirement Anführer.md` §6a). Sie wechselt grundsätzlich nur bei der **Nachfolge** (der Glaube des Erben wird nach den Anteilen in Hauptstadt und Reich gezogen, so dass eine sich ausbreitende Tochterreligion beim nächsten Thronwechsel die Krone gewinnen kann) und in Ausnahmen über Anführer-Attribute (Opportunist, Weak Hand) während der Amtszeit. Hat der Anführer keinen Glauben (255) oder stirbt seine Religion: Mehrheitsreligion der Hauptstadt. Bei einem Wechsel kippt der Teilwert „Glaube“ (alte Staatsreligion wird zur Abweichung, die neue nicht mehr), gedämpft: der Teilwert bewegt sich höchstens **5 Punkte je Jahr** zum neuen Zielwert (Startwert, kalibrieren). Das Gefälle 0,7/0,3 bleibt. Die Teilwerte „Heresy“ der Zufriedenheit entfallen **als Zufriedenheitsteil**; Heresy wirkt nur noch als Loyalitätsteil „Glaube“ (Abschnitt 2, kein doppelter Abzug). „Creed“ (±8, Zufriedenheit) bleibt.
- **Ansteckung (Entscheidung Nutzer: Start in EINER Siedlung, Religion §6.1/§6.1a):** Die Tochterreligion entsteht in einer Siedlung (Saat 50 %, nicht in der Hauptstadt) und breitet sich von dort aus; der **Anteil der Tochterreligion** je Siedlung (jährlich) bewegt sich zum **Mittel der Nachbarsiedlungen** mit `κ ≈ 0,10`, gebremst durch `hold` der herrschenden Religion; **Missionary Zeal** ×1,5; **Inquisition** (`suppress`) und **Open Gates** heilen (gegenläufig, wie Religion §5). Die Tochterreligion breitet sich dadurch auch über Reichsgrenzen in fremde Siedlungen aus; die genaue Formel (nur Zufluss, Radius 8, Verlöschen unter 5 %) steht in Religion §6.1a. Ein Block mit Glaubensabweichung, der siegt (Unabhängigkeit/Autonomie), macht die Tochter zur Religion des neuen Volks bzw. Vasallen; bei Versöhnung bleibt sie, bis die Heilung sie zurückdrängt.
- **Skalierung** des Gewichts `45` der Abweichung durch Religions-Eigenschaften (nach Anhängeranteil gemischt, wie vorher): Inquisition ×0,5, Open Gates ×0,5, Syncretic Spirit ×0,5, Holy War ×1,3, Steadfast Flock ×1,2; Divine Mandate (×1,2) und Inquisition (×1,2) wirken zusätzlich über die Schwelle (`L.rebel`, Abschnitt 2).
- **Beitritt anderer Völker** (Religion §6.4a): gilt beim Ausgang „Unabhängigkeit“ mit Rebellion over faith. Beim Ausgang „Autonomie“ gibt es keinen Beitritt.
- Eine **Vasallen-Tochterreligion** (Vasall in anderer Religion) erhöht dessen Unabhängigkeitswurf (Abschnitt 7).

## 9. Spieler: Anzeige und Fähigkeiten

**Karten-Modus „Loyalty“** (Runde 2, `Requirement Kartenmodi.md`): Loyalität `L` je Siedlungs-Hexfeld, divergierend, 8 Stufen (untere Grenzen 10, 25, 35, 50, 65, 80, 90; unruhig = unter der Schwelle 45 (bei `L.rebel` 1) rot, Rest bis grün; Stufengrenzen bei der Umsetzung an die Schwelle 45 anpassen), **Zahl** im Hexfeld; **Marker:** unruhige Siedlungen roter Rand, Blöcke im Countdown ein Ring um den ganzen Block (wie der „May rebel“-Marker aus Zufriedenheit, der dorthin umzieht). Buckets aus `tools/modeBucketStats.ts`. Vasallenland wird mit dem Mutterland-Rand gezeigt (Abschnitt 7).

**Panels.** Hexfeld-Info: Loyalität mit den Teilwerten Reichweite, Zufriedenheit, Glaube, Legitimität, Garnison, Gnade, „May rebel“ bei unruhig. Völker-Panel: Untermenü **„Mandate ›“**: Legitimität mit Teilen, Zahl unruhiger Siedlungen, Blöcke mit Gewicht gegen Kern und „at the latest in N years“, Vasallen und Tribut. Chronik: wichtig (Dialog mit Pause): Countdown beginnt, Unabhängigkeit, Autonomie, Vasall wird unabhängig; still: Versöhnung, Wiedereingliederung, Vasallenwechsel durch Tod des Mutterlands. Alle Texte Englisch.

**Fähigkeit Nr. 31 „Decree of Grace“** (Völker, **Rare**; Vorschlag, Zahlen vorläufig, Offen: Nutzer bestätigt): Ziel ein Volk (auch das eigene); **Legitimität +10 für 20 Jahre** (Gott-Schicht, Abschnitt 3) und **Loyalität aller Siedlungen +6 einmalig** (Teil „Gnade“, klingt in 20 Jahren ab). Ein laufender Countdown wird nicht verlängert (das Fenster bleibt der Spieler-Wurf). Zulässig bei jedem Volk mit mindestens einer unruhigen Siedlung **oder** einem Countdown, sonst unzulässiges Ziel. Anhängen an den Pool (`ABILITIES` append only, Id 30): dann 31 Fähigkeiten (Common 7, Rare 12, Epic 9, Legendary 3; `Requirement Gacha.md` §6, Religion §8). Weitere Eingriffe des Spielers über bestehende Fähigkeiten: Grateful Hearts/Restless Spirits (Zufriedenheit ±3 → Loyalität ±1,5), Prophet's Light/Doubt (Glaube), Gift of Trait, Reroll Destiny (Anführer), Covenant of One (verschmilzt Religionen, löst Heresy auf).

## 10. Daten (flache Arrays, portierbar)

- Je Hexfeld/Siedlung: `loyalty` (`Uint8`), `restless` (`Uint8`, Hysterese), `blocId` (`Int8`, −1 keiner), Agitations-Rest ist in `loyalty` enthalten (kein eigenes Feld). Die Teilwerte werden **bei Bedarf** für die Panels berechnet, nicht gespeichert.
- Je Volk: `legitEvents` (`Float32`, ×0,93 je Jahr), `vassalOf` (`Int8`), `vassalSince` (`Int16`), Tribut-Buchung des Jahres (`Float32`, nur Anzeige).
- Blöcke: bis 16 Plätze, `blocCiv`, `blocStart` (Jahr), `blocLen` (gewürfelte Länge), Zellen über `blocId`.
- Generator „mandate“ (`rngState` gespeichert). Gott-Schicht: Effekt „Decree“ (Liste ≤ 256 wie bisher), `grace` je Siedlung (`Int8`).
- **Speichern:** alles in den Spielstand, `SAVE_VERSION` erhöhen, `saveSchema.txt` aktualisieren (`Requirement Speichern und Laden.md` §8); ältere Spielstände werden abgelehnt.
- Kern ohne React. Laufende Kosten: eine jährliche Runde über alle Siedlungen (Hunderte), Nachbarschaft und Blockbildung klein; in einem Schritt des Volks (Teile des Kriegsjahrs), keine neue Karten-Neuzeichnung außer im Modus „Loyalty“ und an Vasallengrenzen.

## 11. Zu simulieren (`sim-analyst`, 12 Welten, 300 Jahre, gegen den Stand mit Stärkeprüfung)

Neues Tool (z. B. `tools/mandateStats.ts`, Varianten über `MANDATE`). Fragen: wie viele Countdowns/Blöcke je Welt, Ausgang (Unabhängigkeit/Autonomie/Versöhnung, Ziel: weder Dauerzerfall noch Stillstand; Rebellionen etwa so häufig wie bisher, Versöhnungen mindestens 20 %), Zahl und Dauer der Vasallen, Unabhängigkeit/Wiedereingliederung von Vasallen, Zahl lebender Völker (Limit 9), Wirkung auf Kriege, Handel, Diplomatie, Zufriedenheit und Siedlungswachstum, Doppelzählung Reichweite/Anbindung. **Rebellion over faith:** 10–30 % der Spaltungen (Religion §11 Punkt 4). **Parameter (Satz „ab“ eingefroren):** Basis 50, Reichweite (+15 / −25 / 1 / 8 / Sitz +1,5), Zufriedenheit 0,5 (−30/+15), Anbindung ×0,5 bei Mandat, Glaubensgewicht 45 (Deckel −50, ≤ 5 Punkte/Jahr) und Gefälle 0,7/0,3, Garnison 0,5 (+6), Schwelle 45 und Hysterese 10, Trägheit −6/+2, `ratio` 0,5, Autonomie-Gewicht ×0,5, Blockmindestgröße (2 Siedlungen/15 %), Countdown 5–10, Ansteckung 20 %/−8/< 45, Ausgangsgewichte, Legitimität (+6, −8, −10, +6, −8, ×0,93), Tribut 15 %, Vasallen-Unabhängigkeit 1,5 %/Jahr nach 20 Jahren Waffenstillstand, Wiedereingliederung 1,5 %/Jahr nach 20 Jahren (Vertrauen ≥ 60, Größe ≤ 70 %), `κ` 0,10, Decree (+10, +6).

## 12. Benchmark, Abhängigkeiten, Zukunft

- **Benchmark (Pflicht):** `unrest` setzt Loyalität und Blöcke (viele Countdowns, Vasallengrenzen), `war` die Unabhängigkeit mit Rebellenkriegen; `modes` bekommt „Loyalty“; `gacha` bekommt Ladungen der Nr. 31; alle Szenarien bleiben grün (60 fps, kein Frame über 25 ms).
- **Abhängigkeiten / Änderungen:** `Requirement Krieg.md` §8 (Auslöser und Prüfung ersetzt, Vasall: Krieg §7 Beitrittspflicht), `Requirement Zufriedenheit.md` (Abschnitt „Abspaltung“, Heresy, Teil „Anbindung“ ×0,5 bei Mandat), `Requirement Diplomatie.md` (Vasallen: Beziehungen, Handel), `Requirement Zentralregierung.md` §4 (Tribut), `Requirement Religion.md` §5, §6.4, §6.4a, §11, `Requirement Kartenmodi.md` (Modus „Loyalty“), `Requirement Gacha.md` (Fähigkeit 31), `Requirement Anführer.md` (Hebel `L.rebel` jetzt Loyalitätsschwelle, Thronwechsel/Alter in Legitimität), `Requirement Speichern und Laden.md`.
- **Code (später, `sim-engineer`):** `society/rebellion.ts` (Prüfung, Block, Countdown), neu `society/mandate.ts`, `satisfaction.ts` (Heresy raus), `diplomacy.ts`/`alliance.ts`/`war.ts` (Vasall), `government.ts`/`taxes.ts` (Tribut), `gacha.ts` (Nr. 31); App: Karte, Panels, Modus.
- **Zukunft (nicht in dieser Runde):** **Lokale Anführer/Gouverneure** je Bezirk (entfernt, Entscheidung Nutzer); Mehrfachstufen von Vasallen; Verhandlungen des Spielers mit Blöcken; Tributforderung durch den Spieler.

## 13. Offene Punkte (Empfehlung)

1. **Vasall: Ende** (Abschnitt 7): entschieden im Satz „ab“ (Unabhängigkeit 1,5 %/Jahr, Wiedereingliederung 1,5 %/Jahr nach 20 Jahren; friedlich nur bei schwachem Mutterland).
6. **Nachjustieren nach der Umsetzung:** Kriege (etwa 2×) und Zerfall einzelner Welten in 40–70 Völker nachjustieren (z. B. Obergrenze für Rebellen-/Vasallenvölker, längerer Waffenstillstand nach Unabhängigkeit); Empfehlung: erst messen, dann dem Nutzer Zahlen vorlegen.
2. **Tribut** 15 % der Steuern, halbiert bei knapper Kasse (Empfehlung: 15 %, Simulation).
3. **Handel/Diplomatie des Vasallen zu Dritten folgt dem Mutterland** (Empfehlung: ja, weniger Sonderfälle als eigene Beziehungen).
4. **Decree of Grace** (Rare, Legitimität +10 / Loyalität +6; Empfehlung: so).
5. **Countdown-Anzeige** „at the latest in N years“ statt der gewürfelten Länge (Empfehlung: ja).
