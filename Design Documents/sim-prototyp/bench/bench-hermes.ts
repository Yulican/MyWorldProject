import { Simulation, TICKS_PER_YEAR } from '../src/sim';

declare const print: (s: string) => void;
const out = (s: string) => (typeof print === 'function' ? print(s) : console.log(s));

// Hermes hat keine hochauflösende Uhr im CLI: wir messen ganze Jahre (52 Ticks) mit Date.now().
function run(agentCount: number) {
  const sim = new Simulation({ seed: 42, agentCount, personalityCount: 300 });
  for (let i = 0; i < TICKS_PER_YEAR; i++) sim.step(); // Einlaufen
  const years = 5;
  const t0 = Date.now();
  for (let i = 0; i < TICKS_PER_YEAR * years; i++) sim.step();
  const ms = Date.now() - t0;
  const perTick = ms / (TICKS_PER_YEAR * years);
  out(
    '| ' + agentCount + ' | ' + sim.alive + ' | ' + perTick.toFixed(2) + ' | ' +
      (1000 / perTick).toFixed(0) + ' | ' + (sim.memoryBytes / 1048576).toFixed(1) + ' |',
  );
}

out('Runtime: Hermes');
out('| Agenten | Ende | Ø ms/Tick | Ticks/s max | Speicher MB |');
out('|---|---|---|---|---|');
[10000, 20000, 50000].forEach(run);
