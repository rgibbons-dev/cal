// ─── Fare Optimizer (pure logic, no DOM) ───
// This module is shared between the UI and the test suite.

export const FREQ_OPTIONS = [
  ["n-fare",  "N-fare"],
  ["n-day",   "N-day"],
  ["weekly",  "Weekly"],
  ["monthly", "Monthly"],
];

export const FIELD_ACTIVE = {
  "n-fare":  { trips: true,  days: true  },
  "n-day":   { trips: false, days: true  },
  "weekly":  { trips: false, days: false },
  "monthly": { trips: false, days: false },
};

export const FIELD_HINT = {
  "n-fare":  { trips: "n", days: "expiry" },
  "n-day":   { trips: "",  days: "days"   },
  "weekly":  { trips: "",  days: ""       },
  "monthly": { trips: "",  days: ""       },
};

export const DEFAULT_RULES = [
  { name: "1-Trip",       rate: "",  frequency: "n-fare",  trips: 1,  days: 0  },
  { name: "10-Trip",      rate: "",  frequency: "n-fare",  trips: 10, days: 30 },
  { name: "3-Day Pass",   rate: "",  frequency: "n-day",   trips: 0,  days: 3  },
  { name: "Weekly Pass",  rate: "",  frequency: "weekly",  trips: 0,  days: 0  },
  { name: "Monthly Pass", rate: "",  frequency: "monthly", trips: 0,  days: 0  },
];

// ─── Helpers ───

export function parseRate(val) {
  const n = parseFloat(String(val).replace(/\$/g, ""));
  return isNaN(n) ? 0 : n;
}

function compd(a, b) { return a.getTime() - b.getTime(); }

function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function activeRules(fareRules, freq) {
  return fareRules.filter(r =>
    r.frequency === freq && r.name && parseRate(r.rate) > 0
  );
}

function cheapestRule(rules) {
  return rules.reduce((best, r) =>
    parseRate(r.rate) < parseRate(best.rate) ? r : best
  );
}

// ─── Expand tripMap into flat rides ───
export function expandRides(tripMap) {
  const rides = [];
  for (const [, entry] of tripMap) {
    for (let i = 0; i < entry.trips; i++) {
      rides.push(new Date(entry.date));
    }
  }
  return rides.sort(compd);
}

// Cheapest per-ride cost from all n-fare rules
function getBaseRideCost(fareRules) {
  const nfRules = activeRules(fareRules, "n-fare");
  if (nfRules.length === 0) return Infinity;
  let min = Infinity;
  for (const r of nfRules) {
    const t = r.trips || 1;
    const cost = parseRate(r.rate) / t;
    if (cost < min) min = cost;
  }
  return min;
}

// ─── Weekly windows (Sat–Fri) ───
function satBefore(d) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const diff = (s.getDay() + 1) % 7;
  s.setDate(s.getDate() - diff);
  return s;
}

function getWeeklyWindows(rides) {
  if (rides.length === 0) return [];
  const sorted = [...rides].sort(compd);
  const windows = [];
  let current = [sorted[0]];
  let windowStart = satBefore(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i];
    if (daysBetween(windowStart, d) < 7) {
      current.push(d);
    } else {
      windows.push(current);
      current = [d];
      windowStart = satBefore(d);
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

// ─── N-fare grouping ───
function getNFareGroups(rides, n, expiry) {
  if (rides.length === 0) return [];
  const sorted = [...rides].sort(compd);
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    const anchor = sorted[i];
    let j = i + 1;
    while (j < sorted.length && group.length < n) {
      const span = daysBetween(anchor, sorted[j]);
      if (expiry > 0 && span >= expiry) break;
      group.push(sorted[j]);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}

// ─── N-day grouping ───
function getNDayGroups(rides, duration) {
  if (rides.length === 0 || duration <= 0) return [];
  const sorted = [...rides].sort(compd);
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    const anchor = sorted[i];
    const group = [anchor];
    let j = i + 1;
    while (j < sorted.length) {
      if (daysBetween(anchor, sorted[j]) >= duration) break;
      group.push(sorted[j]);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}

// ─── Index-aware helpers for optimizer ───
function mapGroupToIdx(group, remWithIdx) {
  const idxs = [];
  const pool = [...remWithIdx];
  for (const ride of group) {
    const found = pool.findIndex(r =>
      r.ride.getTime() === ride.getTime() && !idxs.includes(r.idx)
    );
    if (found !== -1) {
      idxs.push(pool[found].idx);
      pool.splice(found, 1);
    }
  }
  return idxs;
}

// ─── Optimizer ───
//
// Layered greedy on individual rides:
//   1. Monthly  – calendar months (unlimited rides)
//   2. N-day    – consecutive-day pass from first use (unlimited rides)
//   3. Weekly   – calendar Sat–Fri (unlimited rides)
//   4. N-fare   – multi-ride tickets covering remaining rides
//
// Passes (monthly, n-day, weekly) are compared against the base per-ride
// cost derived from the cheapest n-fare rule (rate / trips).

export function calculateOptimalTicket(fareRules, tripMap) {
  const rides = expandRides(tripMap);
  if (rides.length === 0) return { tickets: [], cost: 0 };

  const weeklyRules  = activeRules(fareRules, "weekly");
  const monthlyRules = activeRules(fareRules, "monthly");
  const nFareRules   = activeRules(fareRules, "n-fare");
  const nDayRules    = activeRules(fareRules, "n-day");

  const allActive = [...weeklyRules, ...monthlyRules, ...nFareRules, ...nDayRules];
  if (allActive.length === 0) return { tickets: [], cost: 0 };

  const baseRideCost = getBaseRideCost(fareRules);

  let tickets = [];
  let totalCost = 0;
  let coveredIdx = new Set();

  function remWithIdx() {
    return rides
      .map((r, idx) => ({ ride: r, idx }))
      .filter(({ idx }) => !coveredIdx.has(idx));
  }

  // ── 1. Monthly ──
  if (monthlyRules.length > 0) {
    const rule = cheapestRule(monthlyRules);
    const rate = parseRate(rule.rate);

    const months = {};
    rides.forEach((r, idx) => {
      if (coveredIdx.has(idx)) return;
      const k = monthKey(r);
      if (!months[k]) months[k] = [];
      months[k].push(idx);
    });

    for (const [, idxs] of Object.entries(months)) {
      const altCost = idxs.length * (baseRideCost === Infinity ? rate : baseRideCost);
      if (rate < altCost) {
        tickets.push(rule.name);
        totalCost += rate;
        idxs.forEach(i => coveredIdx.add(i));
      }
    }
  }

  // ── 2. N-day ──
  if (nDayRules.length > 0) {
    for (const rule of nDayRules) {
      const rate = parseRate(rule.rate);
      const duration = rule.days || 1;
      const rem = remWithIdx();
      if (rem.length === 0) break;

      const groups = getNDayGroups(rem.map(r => r.ride), duration);
      let pool = [...rem];
      for (const group of groups) {
        const gIdx = mapGroupToIdx(group, pool);
        pool = pool.filter(r => !gIdx.includes(r.idx));

        const altCost = gIdx.length * (baseRideCost === Infinity ? rate : baseRideCost);
        if (rate < altCost) {
          tickets.push(rule.name);
          totalCost += rate;
          gIdx.forEach(i => coveredIdx.add(i));
        }
      }
    }
  }

  // ── 3. Weekly ──
  if (weeklyRules.length > 0) {
    const rule = cheapestRule(weeklyRules);
    const rate = parseRate(rule.rate);

    const rem = remWithIdx();
    const windows = getWeeklyWindows(rem.map(r => r.ride));

    let pool = [...rem];
    for (const win of windows) {
      const wIdx = mapGroupToIdx(win, pool);
      pool = pool.filter(r => !wIdx.includes(r.idx));

      const altCost = wIdx.length * (baseRideCost === Infinity ? rate : baseRideCost);
      if (rate < altCost) {
        tickets.push(rule.name);
        totalCost += rate;
        wIdx.forEach(i => coveredIdx.add(i));
      }
    }
  }

  // ── 4. N-fare (covers all remaining rides) ──
  if (nFareRules.length > 0) {
    const rem = remWithIdx();
    if (rem.length > 0) {
      let bestPlan = null;
      let bestCost = Infinity;

      for (const rule of nFareRules) {
        const rate = parseRate(rule.rate);
        const n = rule.trips || 1;
        const expiry = rule.days || 0;

        const groups = getNFareGroups(rem.map(r => r.ride), n, expiry);
        let planTickets = [];
        let planCost = 0;

        for (const group of groups) {
          planTickets.push(rule.name);
          planCost += rate;
        }

        if (planCost < bestCost) {
          bestCost = planCost;
          bestPlan = { tickets: planTickets, cost: planCost };
        }
      }

      // Try mixing: bulk + singles
      if (nFareRules.length > 1 || (nFareRules[0] && (nFareRules[0].trips || 1) > 1)) {
        const singleRule = nFareRules.find(r => (r.trips || 1) === 1);
        const bulkRules = nFareRules.filter(r => (r.trips || 1) > 1);

        if (singleRule && bulkRules.length > 0) {
          for (const bulk of bulkRules) {
            const bulkRate = parseRate(bulk.rate);
            const bulkN = bulk.trips || 1;
            const bulkExpiry = bulk.days || 0;
            const singleRate = parseRate(singleRule.rate);

            const groups = getNFareGroups(rem.map(r => r.ride), bulkN, bulkExpiry);
            let planTickets = [];
            let planCost = 0;

            for (const group of groups) {
              const singlesCost = group.length * singleRate;
              if (bulkRate < singlesCost) {
                planTickets.push(bulk.name);
                planCost += bulkRate;
              } else {
                group.forEach(() => planTickets.push(singleRule.name));
                planCost += singlesCost;
              }
            }

            if (planCost < bestCost) {
              bestCost = planCost;
              bestPlan = { tickets: planTickets, cost: planCost };
            }
          }
        }
      }

      if (bestPlan) {
        tickets.push(...bestPlan.tickets);
        totalCost += bestPlan.cost;
        // Mark all remaining rides as covered
        rem.forEach(r => coveredIdx.add(r.idx));
      }
    }
  }

  // ── Fallback: any rides still uncovered ──
  const finalRem = remWithIdx();
  if (finalRem.length > 0) {
    const fallback = allActive.reduce((best, r) =>
      parseRate(r.rate) < parseRate(best.rate) ? r : best
    );
    const fbRate = parseRate(fallback.rate);
    if (fallback.frequency === "monthly" || fallback.frequency === "weekly" || fallback.frequency === "n-day") {
      tickets.push(fallback.name);
      totalCost += fbRate;
    } else {
      const n = fallback.trips || 1;
      const expiry = fallback.days || 0;
      const groups = getNFareGroups(finalRem.map(r => r.ride), n, expiry);
      for (const g of groups) {
        tickets.push(fallback.name);
        totalCost += fbRate;
      }
    }
  }

  return { tickets, cost: totalCost };
}

// ─── Display helper ───
export function consolidateTickets(ticketList) {
  const counts = ticketList.reduce((acc, t) => {
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([name, count]) =>
    count > 1 ? `${name} \u00d7${count}` : name
  );
}
