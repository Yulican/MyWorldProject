// Settlement growth, trade, diplomacy and uprisings over many worlds, to
// calibrate the economy (see "Design Documents/Requirement Regionale
// Rohstoffe.md").
// Usage: npx tsx tools/economyStats.ts [worlds=12] [years=300,500] [open=0]
//   open=1: from year 300 every people knows, trusts and trades freely with every other (the diplomacy benchmark scenario)
import { performance } from 'node:perf_hooks';
import { TICKS_PER_YEAR, createSimulation, generateWorld, stepSimulation, type Simulation } from '../src/sim';
import { openDiplomacy } from '../src/bench/openDiplomacy';
import { BUILDINGS, GOV_SLOT, SLOTS, SlotState } from '../src/sim/society/buildings';
import { ECON_TUNING, GOV_TUNING } from '../src/sim/society/taxes';
import { PRICE } from '../src/sim/society/trade';
import { PAIRS } from '../src/sim/society/diplomacy';
import { satisfactionTerms } from '../src/sim/society/satisfaction';
import { UPRISING_HOOK } from '../src/sim/society/simulation';

const worlds = Number(process.argv[2] ?? 12);
const checkpoints = (process.argv[3] ?? '300,500').split(',').map(Number);
const options = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=') as [string, string]));
const open = options.open === '1';
// Central government variants: gov=1 switches it on; goods=1 taxes goods too (variant B); mean=1 sets the rate by the district mean instead of the weakest settlement; margin, plus, minus, traders, capital tune it.
if (options.gov === '1') GOV_TUNING.on = true;
if (options.goods === '1') GOV_TUNING.goodsTax = true;
if (options.mean === '1') GOV_TUNING.weakest = false;
if (options.margin) GOV_TUNING.margin = Number(options.margin);
if (options.plus) GOV_TUNING.taxPlus = Number(options.plus);
if (options.minus) GOV_TUNING.taxMinus = Number(options.minus);
if (options.traders) GOV_TUNING.traders = Number(options.traders);
if (options.capital) GOV_TUNING.capitalTraders = Number(options.capital);
// queue: projects a seat can queue; minload: smallest load of a government trader; price: factor on all market prices; money: factor on the money adults earn.
if (options.queue) GOV_TUNING.queue = Number(options.queue);
if (options.minload) GOV_TUNING.minLoad = Number(options.minload);
if (options.price) for (let g = 0; g < PRICE.length; g++) PRICE[g] *= Number(options.price);
if (options.money) ECON_TUNING.money = Number(options.money);
// seattax: while a seat is to be paid for, 1 = its district, 2 = its whole people taxes with seatmargin instead of margin; seatcost, seatupkeep: factors on a government seat's cost and upkeep.
if (options.seattax) GOV_TUNING.seatTax = Number(options.seattax);
if (options.seatmargin) GOV_TUNING.seatMargin = Number(options.seatmargin);
if (options.seatcost) GOV_TUNING.seatCost = Number(options.seatcost);
if (options.seatupkeep) GOV_TUNING.seatUpkeep = Number(options.seatupkeep);
// secure: years of upkeep the treasury must cover before the government takes on a project (0 = no check).
if (options.secure) GOV_TUNING.secureYears = Number(options.secure);
// partners=1: government traders also buy from peoples whose merchants trade with theirs (free trade, trade agreements).
if (options.partners === '1') GOV_TUNING.buyPartners = true;
// district=1: one planned seat per government district instead of per people.
if (options.district === '1') GOV_TUNING.seatPerDistrict = true;
// start: seats' worth of starting money per new people's government; loan=1: queued seats take materials from their site's settlement on credit.
if (options.start) GOV_TUNING.startSeats = Number(options.start);
if (options.loan === '1') GOV_TUNING.seatLoan = true;
// alltraders=0/1 (default 1): every free government trader sets out each round, or one per round; reserve=1: project materials only from money above 2 years of upkeep; seatsfirst=1: no other projects while a seat is planned in the district.
if (options.alltraders) GOV_TUNING.allTraders = options.alltraders === '1';
if (options.reserve === '1') GOV_TUNING.reserveUpkeep = true;
if (options.seatsfirst === '1') GOV_TUNING.seatsFirst = true;
// income: share of last year's taxes the yearly upkeep may take (income check, seats first in the budget; 0 = check the treasury instead).
if (options.income) GOV_TUNING.incomeShare = Number(options.income);
// goodsneed=1: the goods tax is its own rate, set by the district's need for wood and stone, with its own "Goods taxes" term (goodsplus at 0 %, 0 at 10 %, -goodsminus at 50 %).
if (options.goodsneed === '1') GOV_TUNING.goodsByNeed = true;
if (options.goodsplus) GOV_TUNING.goodsPlus = Number(options.goodsplus);
if (options.goodsminus) GOV_TUNING.goodsMinus = Number(options.goodsminus);
// potential=1: the income check compares upkeep with what the district could raise at its loyalty limit instead of last year's taxes.
if (options.potential === '1') GOV_TUNING.potentialIncome = true;
// cash=1: a project also needs its construction and first reserve in hand (treasury and seat stock), besides the queue and 2 years of upkeep.
if (options.cash === '1') GOV_TUNING.cashCheck = true;
// Why settlements rise up: their satisfaction terms at the moment of the uprising.
const reasons = new Map<string, { sum: number; main: number }>();
let rebels = 0;
{
  UPRISING_HOOK.fn = (sim: Simulation, cells: readonly number[], parent: number) => {
    for (const c of cells) {
      rebels++;
      let worst = '';
      let worstValue = 0;
      for (const t of satisfactionTerms(sim, c, sim.civs[parent] ?? null)) {
        const label = t.label.replace(/[\d.]+/g, '#').replace(/^(Luxury|Comfort).*/, '$1');
        const r = reasons.get(label) ?? { sum: 0, main: 0 };
        r.sum += t.value;
        reasons.set(label, r);
        if (t.value < worstValue) {
          worstValue = t.value;
          worst = label;
        }
      }
      if (worst) reasons.get(worst)!.main++;
    }
  };
}

type Row = Record<string, number>;
const rows = new Map<number, Row[]>();

for (let seed = 1; seed <= worlds; seed++) {
  const sim = createSimulation(generateWorld({ seed }));
  let ms = 0;
  for (const year of checkpoints) {
    const t0 = performance.now();
    while (sim.tick < year * TICKS_PER_YEAR && !sim.gameOver) {
      stepSimulation(sim);
      if (open && sim.tick === 300 * TICKS_PER_YEAR) openDiplomacy(sim);
    }
    ms += performance.now() - t0;
    let settlements = 0;
    let towns = 0;
    let cities = 0;
    let standing = 0;
    let ruins = 0;
    let crowded = 0;
    let woodStock = 0;
    let stoneStock = 0;
    let luxuryShops = 0;
    let luxuryCovered = 0;
    let seats = 0;
    let travel = 0;
    let farFromSeat = 0;
    let govBuildings = 0;
    let govRuins = 0;
    let govSeats = 0;
    let rateSum = 0;
    let goodsRateSum = 0;
    for (let c = 0; c < sim.world.cellCount; c++) {
      const pop = sim.cellPop[c];
      if (pop > 0) {
        settlements++;
        if (pop > sim.cellCapacity[c]) crowded++;
        woodStock += sim.economy.stock[c * 2];
        stoneStock += sim.economy.stock[c * 2 + 1];
        if (sim.economy.luxuryCovered[c]) luxuryCovered++;
        travel += Math.min(sim.seatCost[c], 5);
        if (!(sim.seatCost[c] <= 2)) farFromSeat++;
        rateSum += sim.government.cellRate[c];
        goodsRateSum += sim.government.cellGoodsRate[c];
      }
      if (pop >= 50) towns++;
      if (pop >= 150) cities++;
      for (let s = c * SLOTS; s < (c + 1) * SLOTS; s++) {
        if (sim.economy.state[s] === SlotState.Standing) standing++;
        if (sim.economy.state[s] === SlotState.Standing && BUILDINGS[sim.economy.type[s]].deposit !== undefined) luxuryShops++;
        if (sim.economy.state[s] === SlotState.Ruin) ruins++;
        if (sim.economy.state[s] === SlotState.Standing && BUILDINGS[sim.economy.type[s]].name === 'Seat of government') seats++;
        if (s - c * SLOTS >= GOV_SLOT) {
          if (sim.economy.state[s] === SlotState.Standing) govBuildings++;
          if (sim.economy.state[s] === SlotState.Ruin) govRuins++;
          if (sim.economy.state[s] === SlotState.Standing && BUILDINGS[sim.economy.type[s]].name === 'Seat of government') govSeats++;
        }
      }
    }
    const text = (s: string) => sim.chronicle.filter((e) => e.text.includes(s)).length;
    let abroad = 0;
    for (const v of sim.trade.abroad) abroad += v;
    let money = 0;
    for (const v of sim.economy.money) money += v;
    const row: Row = {
      people: sim.pop.count,
      peoples: sim.civs.filter(Boolean).length,
      settlements,
      'towns (50+)': towns,
      'cities (150+)': cities,
      buildings: standing,
      ruins,
      'crowded %': (100 * crowded) / Math.max(1, settlements),
      'wood stock/settlement': woodStock / Math.max(1, settlements),
      'stone stock/settlement': stoneStock / Math.max(1, settlements),
      luxuryWorkshops: luxuryShops,
      'luxury covered %': (100 * luxuryCovered) / Math.max(1, settlements),
      seats,
      'settlements/seat': settlements / Math.max(1, seats + sim.civs.filter(Boolean).length),
      'mean travel to seat': travel / Math.max(1, settlements),
      'far from seat (>2) %': (100 * farFromSeat) / Math.max(1, settlements),
      woodTraded: sim.trade.delivered[0],
      stoneTraded: sim.trade.delivered[1],
      allTraded: sim.trade.delivered.reduce((s, v) => s + v, 0),
      deliveredAbroad: abroad,
      transit: sim.trade.transit,
      freeTrade: countFreeTrade(sim),
      money,
      known: sim.chronicle.filter((e) => e.text.endsWith(' met.')).length,
      openBorders: text('opened their borders'),
      agreementsOneSided: text('agreed to deliver'),
      agreementsTwoSided: text('agreed to trade'),
      broken: text('broke: too little'),
      endedTooLittle: text('too little could be delivered'),
      running: sim.diplomacy.agreements.length,
      ranOut: text('ran out.'),
      uprisings: text('rose up'),
      'tax rate % (mean)': (100 * rateSum) / Math.max(1, settlements),
      'goods tax % (mean)': (100 * goodsRateSum) / Math.max(1, settlements),
      'taxes collected': sim.government.collected,
      'goods taxed': sim.government.collectedGoods,
      'gov spent': sim.government.spent,
      'gov built': sim.government.built,
      'gov buildings': govBuildings,
      'gov seats': govSeats,
      'gov ruins': govRuins,
      treasuries: sim.government.treasury.reduce((a, v) => a + v, 0),
      'gov trips running': sim.government.trips.length,
      'tax changes': text('the taxes'),
      'gov trips sent': sim.government.sent,
      'trader home: no need': sim.government.stayNoNeed,
      'trader home: no seller': sim.government.stayNoSource,
      'trader home: no money': sim.government.stayNoMoney,
      'money transfers': sim.government.transfers,
      'rejected: income check': sim.government.rejectBudget,
      'rejected: money in hand': sim.government.rejectCash,
      'money transferred': sim.government.transferred,
      'no seat could help': sim.government.noRichSeat,
      'starting money': sim.government.startMoney,
      'seat loans': sim.government.loaned,
      'loans repaid': sim.government.repaid,
      msPerYear: ms / year,
    };
    if (!rows.has(year)) rows.set(year, []);
    rows.get(year)!.push(row);
  }
}

console.log(`${worlds} worlds`, process.argv.slice(4).join(' '));
for (const [year, list] of rows) {
  const keys = Object.keys(list[0]);
  const mean = (k: string) => list.reduce((s, r) => s + r[k], 0) / list.length;
  const range = (k: string) => `${Math.min(...list.map((r) => r[k])).toFixed(0)}..${Math.max(...list.map((r) => r[k])).toFixed(0)}`;
  console.log(`\nYear ${year}: mean [min..max]`);
  for (const k of keys) console.log(`  ${k.padEnd(26)} ${mean(k).toFixed(1).padStart(9)}  [${range(k)}]`);
}

if (rebels > 0) {
  console.log(`\nUprisings: ${rebels} rebel settlements in ${worlds} worlds. Their satisfaction terms (mean per rebel settlement; main = the term that weighed worst):`);
  for (const [label, r] of [...reasons].sort((a, b) => a[1].sum - b[1].sum)) {
    console.log(`  ${label.padEnd(40)} ${(r.sum / rebels).toFixed(2).padStart(7)}  main for ${Math.round((100 * r.main) / rebels)} %`);
  }
}

function countFreeTrade(sim: ReturnType<typeof createSimulation>): number {
  let n = 0;
  for (let a = 1; a < sim.civs.length; a++) for (let b = a + 1; b < sim.civs.length; b++) n += sim.diplomacy.freeTrade[a * PAIRS + b];
  return n;
}
