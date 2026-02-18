# cal-alpha1 Manual Test Scenarios

Each scenario specifies the fare rules to configure, the calendar selections to make, and the expected recommendation. Focus is on edge cases over happy path. Real fare data sourced from NJ Transit (NJT), STM/ARTM Montréal (STM), and MTA New York where noted.

---

## Fare rule reference for tests

Unless a scenario specifies otherwise, use these baseline configs. Swap in the specific agency fares listed per-scenario.

**NJT zones 1–6 (approx):** 1-Trip $5.50, 10-Trip $44.00 (30-day expiry), Weekly $62.00, Monthly $205.00

**STM Zone A regular:** 1-Trip $3.75, 10-Trip $34.25 (no expiry), 3-Day Pass $21.75, Weekly $32.00, Monthly $104.50

**MTA subway/bus:** 1-Ride $2.90, 7-Day Unlimited $34.00, 30-Day Unlimited $132.00

---

## Scenarios

### 1 — Single trip, single day
**Agency:** Any
**Rules:** 1-Trip only ($3.75)
**Selection:** 1 tap on any day
**Expected:** 1-Trip ×1, $3.75
**Tests:** Minimal viable input produces output.

### 2 — Single day, 4 trips
**Agency:** STM
**Rules:** 1-Trip $3.75, 10-Trip $34.25 (no expiry)
**Selection:** Tap one day to 4
**Expected:** 1-Trip ×4, $15.00 (4 singles beats a 10-trip at $34.25)
**Tests:** Multi-trip per day expands correctly into individual rides; doesn't wastefully suggest a bulk ticket.

### 3 — Exact 10-trip fit across scattered days
**Agency:** NJT
**Rules:** 1-Trip $5.50, 10-Trip $44.00 (30-day expiry)
**Selection:** 10 different days, 1 trip each, all within a 30-day window
**Expected:** 10-Trip ×1, $44.00
**Tests:** n-fare grouping packs exactly N rides; cheaper than 10 × $5.50 = $55.00.

### 4 — 10-trip expiry breaker
**Agency:** NJT
**Rules:** 1-Trip $5.50, 10-Trip $44.00 (30-day expiry)
**Selection:** 5 trips in the first week of the calendar, 5 trips in the last week (>30 days apart)
**Expected:** 1-Trip ×10, $55.00 (expiry prevents a single 10-trip from covering both clusters)
**Tests:** Expiry enforcement splits what would otherwise be a perfect 10-trip.

### 5 — 11 trips in 30 days
**Agency:** NJT
**Rules:** 1-Trip $5.50, 10-Trip $44.00 (30-day expiry)
**Selection:** 11 days, 1 trip each, within 30 days
**Expected:** 10-Trip ×1 + 1-Trip ×1, $49.50 (not 10-Trip ×2 at $88.00, not 11 singles at $60.50)
**Tests:** Partial fill of a bulk ticket falls back to singles for the remainder.

### 6 — Bulk overkill: 3 trips with an expensive 10-trip
**Agency:** STM
**Rules:** 1-Trip $3.75, 10-Trip $34.25 (no expiry)
**Selection:** 3 days, 1 trip each
**Expected:** 1-Trip ×3, $11.25 (3 singles beats one 10-trip at $34.25)
**Tests:** Optimizer doesn't wastefully buy a bulk ticket when singles are cheaper.

### 7 — Weekly break-even (MTA)
**Agency:** MTA
**Rules:** 1-Ride $2.90, 7-Day Unlimited $34.00
**Selection:** Mon–Fri of one Sat–Fri window, 2 trips per day (10 rides in a week)
**Expected:** Weekly Pass ×1, $34.00 (vs 10 × $2.90 = $29.00... weekly should NOT be recommended)
**Tests:** Weekly pass only wins when rides × single fare > weekly cost. At 10 rides this is $29 < $34, so singles should win. Validates that the optimizer doesn't blindly prefer passes. **Adjust to 12+ rides/week to flip it.**

### 8 — Weekly pass worth it
**Agency:** MTA
**Rules:** 1-Ride $2.90, 7-Day Unlimited $34.00
**Selection:** Mon–Fri, 3 trips each day (15 rides in a Sat–Fri window)
**Expected:** Weekly Pass ×1, $34.00 (vs 15 × $2.90 = $43.50)
**Tests:** Weekly pass correctly wins when ride volume is high enough.

### 9 — Monthly vs weekly competition
**Agency:** STM
**Rules:** 1-Trip $3.75, Weekly $32.00, Monthly $104.50
**Selection:** Every weekday (Mon–Fri) for the full month, 1 trip each (~20–22 days)
**Expected:** Monthly ×1, $104.50 (vs ~4 weeklies at $128.00, vs ~21 singles at $78.75... wait, singles are cheapest here)
**Tests:** Actually 21 × $3.75 = $78.75 < $104.50. Monthly should NOT be recommended. Singles win. **This validates that monthly isn't auto-selected just because it exists.** Increase to 2 trips/day to flip it.

### 10 — Monthly wins with volume
**Agency:** STM
**Rules:** 1-Trip $3.75, Weekly $32.00, Monthly $104.50
**Selection:** Every weekday, 2 trips each (~42 rides)
**Expected:** Monthly ×1, $104.50 (vs 42 × $3.75 = $157.50)
**Tests:** Monthly correctly wins at high volume.

### 11 — 3-day pass vs singles (STM)
**Agency:** STM
**Rules:** 1-Trip $3.75, 3-Day Pass $21.75 (3 days)
**Selection:** 3 consecutive days, 2 trips each (6 rides)
**Expected:** 3-Day Pass ×1, $21.75 (vs 6 × $3.75 = $22.50)
**Tests:** N-day pass barely edges out singles. Tight margin.

### 12 — 3-day pass NOT worth it
**Agency:** STM
**Rules:** 1-Trip $3.75, 3-Day Pass $21.75 (3 days)
**Selection:** 3 consecutive days, 1 trip each (3 rides)
**Expected:** 1-Trip ×3, $11.25 (vs $21.75 for the pass)
**Tests:** N-day pass correctly rejected when ride density is low.

### 13 — Rides straddle two Sat–Fri windows
**Agency:** MTA
**Rules:** 1-Ride $2.90, 7-Day Unlimited $34.00
**Selection:** Thu, Fri, Sat, Sun, Mon — 3 trips each (15 rides spanning two weekly windows)
**Expected:** Should split into two windows. Window 1 (Thu–Fri): 6 rides at $17.40 < $34 → singles. Window 2 (Sat–Mon): 9 rides at $26.10 < $34 → singles. Total: 1-Ride ×15, $43.50.
**Tests:** Weekly window boundary alignment. Optimizer doesn't merge across windows.

### 14 — Cross-month boundary
**Agency:** STM
**Rules:** 1-Trip $3.75, Monthly $104.50
**Selection:** Last 3 days of month + first 3 days of next month, 4 trips each (24 rides)
**Expected:** 1-Trip ×24, $90.00 (12 rides per month × $3.75 = $45 per month, each below $104.50)
**Tests:** Monthly evaluation is per-calendar-month, not a rolling window. Neither month has enough rides to justify a pass.

### 15 — Zero-trip tap regression
**Agency:** Any
**Rules:** 1-Trip $3.75
**Selection:** Tap a day to 1, then tap it 4 more times back to 0
**Expected:** "Select travel days above" (no recommendation)
**Tests:** State machine 0→1→2→3→4→0 returns to empty. No ghost rides.

### 16 — Reset button clears everything
**Agency:** Any
**Rules:** 1-Trip $3.75
**Selection:** Select 5 days with various trip counts, then hit Reset
**Expected:** Calendar clears visually, recommendation resets to "Select travel days above"
**Tests:** Full state wipe — tripMap, visuals, and recommendation display.

### 17 — No rules configured
**Agency:** N/A
**Rules:** Delete all default rules (or leave rates blank)
**Selection:** Tap any day
**Expected:** Alert: "Configure at least one fare rule with a name and rate first."
**Tests:** Guard against empty/unconfigured rules.

### 18 — Only a monthly pass configured (no single-ride rule)
**Agency:** Custom
**Rules:** Monthly $100 only (no 1-trip, no 10-trip)
**Selection:** 1 day, 1 trip
**Expected:** Monthly ×1, $100.00 (only option available)
**Tests:** Optimizer handles absence of a per-ride baseline. Falls back to cheapest available rule.

### 19 — N-day with multi-trip days at boundary
**Agency:** STM
**Rules:** 1-Trip $3.75, 3-Day Pass $21.75 (3 days)
**Selection:** Day 1: 4 trips, Day 2: 0, Day 3: 4 trips (8 rides, days 1 and 3 only, gap in middle)
**Expected:** 3-Day Pass ×1, $21.75 (days 1 and 3 are within the 3-day window even with a gap; vs 8 × $3.75 = $30.00)
**Tests:** N-day pass covers calendar days from anchor, not consecutive selected days.

### 20 — Competing n-fare rules
**Agency:** STM
**Rules:** 1-Trip $3.75, 2-Trip $7.00, 10-Trip $34.25 (no expiry on any)
**Selection:** 7 days, 1 trip each
**Expected:** Best combo: 2-Trip ×3 + 1-Trip ×1 = $22.00 OR 10-Trip ×1 at $34.25 OR 7 singles at $26.25. **Singles win at $26.25.** (2-Trip is $3.50/ride which is cheaper than $3.75, so: 2-Trip ×3 + 1-Trip ×1 = $22.00 should actually win.)
**Tests:** Multiple n-fare rules with different per-ride economics. Optimizer should prefer the combination that minimizes total cost.

### 21 — Weekend-only rider
**Agency:** MTA
**Rules:** 1-Ride $2.90, 7-Day Unlimited $34.00, 30-Day Unlimited $132.00
**Selection:** Every Sat and Sun for the full calendar window, 2 trips each (~8–10 days, 16–20 rides)
**Expected:** With 16 rides: $46.40 singles vs $132 monthly. Singles win. Weeklies: ~4 windows of 4 rides each = $11.60/window, all below $34. Singles still win.
**Tests:** Low-density spread across many weeks doesn't trigger pass purchases.

### 22 — All fare types active simultaneously
**Agency:** STM full stack
**Rules:** 1-Trip $3.75, 10-Trip $34.25 (no expiry), 3-Day Pass $21.75, Weekly $32.00, Monthly $104.50
**Selection:** Every weekday, 2 trips/day for full month (~42 rides)
**Expected:** Monthly ×1, $104.50 (cheapest blanket option vs 42 × $3.75 = $157.50)
**Tests:** With all rule types present, the layered optimizer correctly identifies monthly as optimal for high-volume commuting.

### 23 — Edge: exactly the break-even ride count for weekly
**Agency:** MTA
**Rules:** 1-Ride $2.90, 7-Day Unlimited $34.00
**Selection:** 12 rides in one Sat–Fri window (e.g., Mon–Fri 2 trips + Sat 2 trips)
**Expected:** 12 × $2.90 = $34.80 > $34.00 → Weekly Pass ×1, $34.00
**Tests:** Break-even boundary: 11 rides = $31.90 (singles win), 12 rides = $34.80 (weekly wins). Test both sides if thorough.
