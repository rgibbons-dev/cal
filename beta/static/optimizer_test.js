// ─── Programmatic test suite for fare optimizer ───
// Runs in Node.js against the extracted optimizer module.
// Usage: node --experimental-vm-modules optimizer_test.js
//   (or simply: node optimizer_test.js  — if using dynamic import)

import { calculateOptimalTicket, consolidateTickets } from "./optimizer.js";

// ─── Helpers ───

function makeTripMap(entries) {
  // entries: [{ date: Date, trips: number }, ...]
  const m = new Map();
  for (const e of entries) {
    const key = e.date.toDateString();
    m.set(key, { date: new Date(e.date), trips: e.trips });
  }
  return m;
}

function dateDays(year, month, day) {
  return new Date(year, month - 1, day);
}

// Generate N weekday dates starting from a given date
function weekdaysFrom(start, count) {
  const dates = [];
  const d = new Date(start);
  while (dates.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Generate all weekdays in a month
function allWeekdays(year, month) {
  const dates = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Generate all Sat/Sun in a range
function allWeekends(year, month) {
  const dates = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 0 || d.getDay() === 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, scenario, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${detail}`);
  } else {
    failed++;
    const msg = `  FAIL: ${detail}`;
    console.log(msg);
    failures.push(`Scenario ${scenario}: ${detail}`);
  }
}

function assertCost(result, expected, scenario, label) {
  const actual = Math.round(result.cost * 100) / 100;
  const exp = Math.round(expected * 100) / 100;
  assert(actual === exp, scenario, `${label} cost: expected $${exp.toFixed(2)}, got $${actual.toFixed(2)}`);
}

function assertTickets(result, expectedConsolidated, scenario, label) {
  const actual = consolidateTickets(result.tickets).sort();
  const expected = [...expectedConsolidated].sort();
  const match = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  assert(match, scenario, `${label} tickets: expected [${expected}], got [${actual}]`);
}

// ─── Test Scenarios ───

console.log("\n=== Fare Optimizer Test Suite ===\n");

// ── Scenario 1: Single trip, single day ──
console.log("Scenario 1 — Single trip, single day");
{
  const rules = [{ name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 }];
  const trips = makeTripMap([{ date: dateDays(2026, 2, 10), trips: 1 }]);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 3.75, 1, "single trip");
  assertTickets(r, ["1-Trip"], 1, "single trip");
}

// ── Scenario 2: Single day, 4 trips ──
console.log("\nScenario 2 — Single day, 4 trips");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "34.25", frequency: "n-fare", trips: 10, days: 0 },
  ];
  const trips = makeTripMap([{ date: dateDays(2026, 2, 10), trips: 4 }]);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 15.00, 2, "4 singles");
  assertTickets(r, ["1-Trip \u00d74"], 2, "4 singles");
}

// ── Scenario 3: Exact 10-trip fit ──
console.log("\nScenario 3 — Exact 10-trip fit across scattered days");
{
  const rules = [
    { name: "1-Trip", rate: "5.50", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "44.00", frequency: "n-fare", trips: 10, days: 30 },
  ];
  // 10 days within 30-day window
  const dates = [];
  for (let i = 1; i <= 10; i++) dates.push({ date: dateDays(2026, 2, i), trips: 1 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 44.00, 3, "10-trip bundle");
  assertTickets(r, ["10-Trip"], 3, "10-trip bundle");
}

// ── Scenario 4: 10-trip expiry breaker ──
console.log("\nScenario 4 — 10-trip expiry breaker");
{
  const rules = [
    { name: "1-Trip", rate: "5.50", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "44.00", frequency: "n-fare", trips: 10, days: 30 },
  ];
  // 5 trips in first week, 5 trips in last week (>30 days apart)
  const dates = [];
  for (let i = 1; i <= 5; i++) dates.push({ date: dateDays(2026, 2, i), trips: 1 });
  for (let i = 15; i <= 19; i++) dates.push({ date: dateDays(2026, 3, i), trips: 1 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 55.00, 4, "expiry splits");
  assertTickets(r, ["1-Trip \u00d710"], 4, "expiry splits");
}

// ── Scenario 5: 11 trips in 30 days ──
console.log("\nScenario 5 — 11 trips in 30 days");
{
  const rules = [
    { name: "1-Trip", rate: "5.50", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "44.00", frequency: "n-fare", trips: 10, days: 30 },
  ];
  const dates = [];
  for (let i = 1; i <= 11; i++) dates.push({ date: dateDays(2026, 2, i), trips: 1 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 49.50, 5, "10+1 combo");
  assertTickets(r, ["10-Trip", "1-Trip"], 5, "10+1 combo");
}

// ── Scenario 6: Bulk overkill ──
console.log("\nScenario 6 — Bulk overkill: 3 trips with expensive 10-trip");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "34.25", frequency: "n-fare", trips: 10, days: 0 },
  ];
  const dates = [
    { date: dateDays(2026, 2, 3), trips: 1 },
    { date: dateDays(2026, 2, 5), trips: 1 },
    { date: dateDays(2026, 2, 7), trips: 1 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 11.25, 6, "singles beat bulk");
  assertTickets(r, ["1-Trip \u00d73"], 6, "singles beat bulk");
}

// ── Scenario 7: Weekly break-even (MTA) — weekly should NOT win ──
console.log("\nScenario 7 — Weekly break-even (MTA), singles should win");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
  ];
  // Mon-Fri of one week, 2 trips/day = 10 rides; 10 * 2.90 = 29.00 < 34.00
  // Use a week where Mon = Feb 9 2026 (Mon)
  const dates = [];
  for (let i = 9; i <= 13; i++) dates.push({ date: dateDays(2026, 2, i), trips: 2 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 29.00, 7, "singles win over weekly");
  assertTickets(r, ["1-Ride \u00d710"], 7, "singles win over weekly");
}

// ── Scenario 8: Weekly pass worth it ──
console.log("\nScenario 8 — Weekly pass worth it");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
  ];
  // Mon-Fri, 3 trips each = 15 rides; 15 * 2.90 = 43.50 > 34.00
  const dates = [];
  for (let i = 9; i <= 13; i++) dates.push({ date: dateDays(2026, 2, i), trips: 3 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 34.00, 8, "weekly wins");
  assertTickets(r, ["7-Day Unlimited"], 8, "weekly wins");
}

// ── Scenario 9: Monthly vs weekly — singles win ──
console.log("\nScenario 9 — Monthly vs weekly, singles should win");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "Weekly", rate: "32.00", frequency: "weekly", trips: 0, days: 0 },
    { name: "Monthly", rate: "104.50", frequency: "monthly", trips: 0, days: 0 },
  ];
  // Every weekday in Feb 2026, 1 trip each
  const dates = allWeekdays(2026, 2).map(d => ({ date: d, trips: 1 }));
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  const singlesCost = dates.length * 3.75;
  // Singles should be cheaper than monthly ($104.50)
  assert(r.cost <= singlesCost + 0.01, 9, `cost $${r.cost.toFixed(2)} <= singles $${singlesCost.toFixed(2)}`);
  assert(r.cost < 104.50, 9, `cost $${r.cost.toFixed(2)} < monthly $104.50`);
}

// ── Scenario 10: Monthly wins with volume ──
console.log("\nScenario 10 — Monthly wins with volume");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "Weekly", rate: "32.00", frequency: "weekly", trips: 0, days: 0 },
    { name: "Monthly", rate: "104.50", frequency: "monthly", trips: 0, days: 0 },
  ];
  // Every weekday, 2 trips each
  const dates = allWeekdays(2026, 2).map(d => ({ date: d, trips: 2 }));
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 104.50, 10, "monthly wins");
  assertTickets(r, ["Monthly"], 10, "monthly wins");
}

// ── Scenario 11: 3-day pass vs singles ──
console.log("\nScenario 11 — 3-day pass edges out singles");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "3-Day Pass", rate: "21.75", frequency: "n-day", trips: 0, days: 3 },
  ];
  // 3 consecutive days, 2 trips each = 6 rides: 6 * 3.75 = 22.50 > 21.75
  const dates = [
    { date: dateDays(2026, 2, 10), trips: 2 },
    { date: dateDays(2026, 2, 11), trips: 2 },
    { date: dateDays(2026, 2, 12), trips: 2 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 21.75, 11, "3-day pass wins");
  assertTickets(r, ["3-Day Pass"], 11, "3-day pass wins");
}

// ── Scenario 12: 3-day pass NOT worth it ──
console.log("\nScenario 12 — 3-day pass not worth it");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "3-Day Pass", rate: "21.75", frequency: "n-day", trips: 0, days: 3 },
  ];
  // 3 consecutive days, 1 trip each = 3 rides: 3 * 3.75 = 11.25 < 21.75
  const dates = [
    { date: dateDays(2026, 2, 10), trips: 1 },
    { date: dateDays(2026, 2, 11), trips: 1 },
    { date: dateDays(2026, 2, 12), trips: 1 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 11.25, 12, "singles win");
  assertTickets(r, ["1-Trip \u00d73"], 12, "singles win");
}

// ── Scenario 13: Rides straddle two Sat–Fri windows ──
console.log("\nScenario 13 — Rides straddle two weekly windows");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
  ];
  // Thu Feb 12, Fri Feb 13, Sat Feb 14, Sun Feb 15, Mon Feb 16 — 3 trips each
  // Sat-Fri window: Sat Feb 7 - Fri Feb 13 contains Thu,Fri (6 rides)
  // Next window: Sat Feb 14 - Fri Feb 20 contains Sat,Sun,Mon (9 rides)
  // 6 * 2.90 = 17.40, 9 * 2.90 = 26.10 — both less than 34.00
  const dates = [
    { date: dateDays(2026, 2, 12), trips: 3 },
    { date: dateDays(2026, 2, 13), trips: 3 },
    { date: dateDays(2026, 2, 14), trips: 3 },
    { date: dateDays(2026, 2, 15), trips: 3 },
    { date: dateDays(2026, 2, 16), trips: 3 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 43.50, 13, "all singles across windows");
  assertTickets(r, ["1-Ride \u00d715"], 13, "all singles across windows");
}

// ── Scenario 14: Cross-month boundary ──
console.log("\nScenario 14 — Cross-month boundary");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "Monthly", rate: "104.50", frequency: "monthly", trips: 0, days: 0 },
  ];
  // Last 3 days of Feb + first 3 days of Mar, 4 trips each = 24 rides
  // 12 per month * $3.75 = $45 per month, both < $104.50
  const dates = [
    { date: dateDays(2026, 2, 26), trips: 4 },
    { date: dateDays(2026, 2, 27), trips: 4 },
    { date: dateDays(2026, 2, 28), trips: 4 },
    { date: dateDays(2026, 3, 1), trips: 4 },
    { date: dateDays(2026, 3, 2), trips: 4 },
    { date: dateDays(2026, 3, 3), trips: 4 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 90.00, 14, "singles across months");
  assertTickets(r, ["1-Trip \u00d724"], 14, "singles across months");
}

// ── Scenario 15: Zero-trip tap regression ──
console.log("\nScenario 15 — Zero-trip tap regression");
{
  const rules = [{ name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 }];
  // Simulate tapping to 0 — empty tripMap
  const trips = new Map();
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 0, 15, "empty trips");
  assert(r.tickets.length === 0, 15, "no tickets for empty trips");
}

// ── Scenario 16: Reset clears everything ──
console.log("\nScenario 16 — Reset clears everything (same as empty state)");
{
  const rules = [{ name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 }];
  // After reset, tripMap is empty
  const trips = new Map();
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 0, 16, "reset state");
  assert(r.tickets.length === 0, 16, "no tickets after reset");
}

// ── Scenario 17: No rules configured ──
console.log("\nScenario 17 — No rules configured");
{
  const rules = [];
  const trips = makeTripMap([{ date: dateDays(2026, 2, 10), trips: 1 }]);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 0, 17, "no rules = no cost");
  assert(r.tickets.length === 0, 17, "no rules = no tickets");
}

// ── Scenario 18: Only monthly pass, 1 ride ──
console.log("\nScenario 18 — Only monthly pass configured, 1 ride");
{
  const rules = [{ name: "Monthly", rate: "100.00", frequency: "monthly", trips: 0, days: 0 }];
  const trips = makeTripMap([{ date: dateDays(2026, 2, 10), trips: 1 }]);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 100.00, 18, "only option");
  assertTickets(r, ["Monthly"], 18, "only option");
}

// ── Scenario 19: N-day with gap ──
console.log("\nScenario 19 — N-day with multi-trip days at boundary");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "3-Day Pass", rate: "21.75", frequency: "n-day", trips: 0, days: 3 },
  ];
  // Day 1: 4 trips, Day 2: 0, Day 3: 4 trips = 8 rides in 3-day window
  // 8 * 3.75 = 30.00 > 21.75
  const dates = [
    { date: dateDays(2026, 2, 10), trips: 4 },
    { date: dateDays(2026, 2, 12), trips: 4 },
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 21.75, 19, "3-day pass covers gap");
  assertTickets(r, ["3-Day Pass"], 19, "3-day pass covers gap");
}

// ── Scenario 20: Competing n-fare rules ──
console.log("\nScenario 20 — Competing n-fare rules");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "2-Trip", rate: "7.00", frequency: "n-fare", trips: 2, days: 0 },
    { name: "10-Trip", rate: "34.25", frequency: "n-fare", trips: 10, days: 0 },
  ];
  // 7 days, 1 trip each = 7 rides
  // Options: 7 singles = $26.25, 3x 2-trip + 1 single = $22.00, 1x 10-trip = $34.25
  // Best: 2-Trip x3 + 1-Trip x1 = $22.00 (if optimizer can mix)
  const dates = [];
  for (let i = 10; i <= 16; i++) dates.push({ date: dateDays(2026, 2, i), trips: 1 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  // The optimizer should find <= $26.25 (singles) — ideally $22.00 with mixing
  assert(r.cost <= 26.25, 20, `cost $${r.cost.toFixed(2)} <= $26.25 (singles baseline)`);
}

// ── Scenario 21: Weekend-only rider ──
console.log("\nScenario 21 — Weekend-only rider");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
    { name: "30-Day Unlimited", rate: "132.00", frequency: "monthly", trips: 0, days: 0 },
  ];
  // All weekends in Feb 2026, 2 trips each
  const weekends = allWeekends(2026, 2);
  const dates = weekends.map(d => ({ date: d, trips: 2 }));
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  const singlesCost = weekends.length * 2 * 2.90;
  // Singles should win — low density per week
  assert(r.cost <= singlesCost + 0.01, 21, `cost $${r.cost.toFixed(2)} <= singles $${singlesCost.toFixed(2)}`);
  assert(r.cost < 132.00, 21, `cost $${r.cost.toFixed(2)} < monthly $132.00`);
}

// ── Scenario 22: All fare types active ──
console.log("\nScenario 22 — All fare types active, high volume commuter");
{
  const rules = [
    { name: "1-Trip", rate: "3.75", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "34.25", frequency: "n-fare", trips: 10, days: 0 },
    { name: "3-Day Pass", rate: "21.75", frequency: "n-day", trips: 0, days: 3 },
    { name: "Weekly", rate: "32.00", frequency: "weekly", trips: 0, days: 0 },
    { name: "Monthly", rate: "104.50", frequency: "monthly", trips: 0, days: 0 },
  ];
  // Every weekday in Feb, 2 trips each (~42 rides)
  const dates = allWeekdays(2026, 2).map(d => ({ date: d, trips: 2 }));
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 104.50, 22, "monthly wins with all types");
  assertTickets(r, ["Monthly"], 22, "monthly wins with all types");
}

// ── Scenario 23: Break-even boundary for weekly ──
console.log("\nScenario 23 — Break-even boundary for weekly");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
  ];
  // 12 rides in one Sat-Fri window: 12 * 2.90 = 34.80 > 34.00 → weekly wins
  // Mon-Fri 2 trips + Sat 2 trips = 12 rides
  // Feb 9 Mon - Feb 14 Sat is within Sat Feb 7 - Fri Feb 13 window...
  // Actually Sat Feb 14 starts a new window. Let's use Sat Feb 7 week:
  // Sat Feb 7, Mon Feb 9 - Fri Feb 13: 2 trips each on Mon-Fri (10) + Sat 2 = but Sat is in same window
  // Use: Mon Feb 9 (2), Tue Feb 10 (2), Wed Feb 11 (2), Thu Feb 12 (2), Fri Feb 13 (2), Sat Feb 7 (2) = 12 rides
  const dates = [
    { date: dateDays(2026, 2, 7), trips: 2 },  // Sat
    { date: dateDays(2026, 2, 9), trips: 2 },   // Mon
    { date: dateDays(2026, 2, 10), trips: 2 },  // Tue
    { date: dateDays(2026, 2, 11), trips: 2 },  // Wed
    { date: dateDays(2026, 2, 12), trips: 2 },  // Thu
    { date: dateDays(2026, 2, 13), trips: 2 },  // Fri
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 34.00, 23, "weekly wins at 12 rides");
  assertTickets(r, ["7-Day Unlimited"], 23, "weekly wins at 12 rides");
}

// Also test 11 rides (should be singles: 11 * 2.90 = 31.90)
console.log("\nScenario 23b — Below break-even (11 rides)");
{
  const rules = [
    { name: "1-Ride", rate: "2.90", frequency: "n-fare", trips: 1, days: 0 },
    { name: "7-Day Unlimited", rate: "34.00", frequency: "weekly", trips: 0, days: 0 },
  ];
  // 11 rides in one window
  const dates = [
    { date: dateDays(2026, 2, 7), trips: 1 },   // Sat - 1 ride
    { date: dateDays(2026, 2, 9), trips: 2 },   // Mon
    { date: dateDays(2026, 2, 10), trips: 2 },  // Tue
    { date: dateDays(2026, 2, 11), trips: 2 },  // Wed
    { date: dateDays(2026, 2, 12), trips: 2 },  // Thu
    { date: dateDays(2026, 2, 13), trips: 2 },  // Fri
  ];
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 31.90, "23b", "singles at 11 rides");
  assertTickets(r, ["1-Ride \u00d711"], "23b", "singles at 11 rides");
}

// ─── Summary ───
console.log("\n" + "=".repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log("");

process.exit(failed > 0 ? 1 : 0);
