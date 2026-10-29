# Simulations-Prototyp (MyWorldProject)

Reiner TypeScript-Simulationskern ohne React-Native-Bezug, gedacht für `src/sim/` im Projekt.

- `src/sim/`: Hexwelt, Bewohner (typisierte Arrays), Bedürfnisse, Glaube, Gebete, Lebenszyklus, Persönlichkeiten
- `bench/bench.ts`: Messung unter Node (V8)
- `bench/bench-hermes.ts`: dieselbe Messung für Hermes (muss gebündelt und auf ES5 transformiert werden)

Benchmark unter Node:
```bash
npm i -D tsx @types/node
npx tsx bench/bench.ts
```

Die Simulationsregeln sind Platzhalter zum Messen der Rechenlast, kein Spieldesign.
