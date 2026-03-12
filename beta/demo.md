# Fare Calculator Beta — Test Suite & Demo

*2026-02-18T14:47:22Z by Showboat 0.6.0*
<!-- showboat-id: f00d07ba-6669-4b8b-9bbe-43fbd5cf4468 -->

This document demonstrates the fare optimizer test suite and Go web server for the beta version of the Fare Calculator. The optimizer logic has been extracted into a standalone ES module (optimizer.js) that is shared by the browser UI and the Node.js test suite.

## Go Server Build

```bash
cd /home/user/cal/beta && go build -o cal-beta . && echo 'Build OK' && ls -lh cal-beta
```

```output
Build OK
-rwxr-xr-x 1 root root 12M Feb 18 14:47 cal-beta
```

## Optimizer Test Suite — All 23 Scenarios

```bash
cd /home/user/cal/beta/static && node optimizer_test.js
```

```output

=== Fare Optimizer Test Suite ===

Scenario 1 — Single trip, single day
  PASS: single trip cost: expected $3.75, got $3.75
  PASS: single trip tickets: expected [1-Trip], got [1-Trip]

Scenario 2 — Single day, 4 trips
  PASS: 4 singles cost: expected $15.00, got $15.00
  PASS: 4 singles tickets: expected [1-Trip ×4], got [1-Trip ×4]

Scenario 3 — Exact 10-trip fit across scattered days
  PASS: 10-trip bundle cost: expected $44.00, got $44.00
  PASS: 10-trip bundle tickets: expected [10-Trip], got [10-Trip]

Scenario 4 — 10-trip expiry breaker
  PASS: expiry splits cost: expected $55.00, got $55.00
  PASS: expiry splits tickets: expected [1-Trip ×10], got [1-Trip ×10]

Scenario 5 — 11 trips in 30 days
  PASS: 10+1 combo cost: expected $49.50, got $49.50
  PASS: 10+1 combo tickets: expected [1-Trip,10-Trip], got [1-Trip,10-Trip]

Scenario 6 — Bulk overkill: 3 trips with expensive 10-trip
  PASS: singles beat bulk cost: expected $11.25, got $11.25
  PASS: singles beat bulk tickets: expected [1-Trip ×3], got [1-Trip ×3]

Scenario 7 — Weekly break-even (MTA), singles should win
  PASS: singles win over weekly cost: expected $29.00, got $29.00
  PASS: singles win over weekly tickets: expected [1-Ride ×10], got [1-Ride ×10]

Scenario 8 — Weekly pass worth it
  PASS: weekly wins cost: expected $34.00, got $34.00
  PASS: weekly wins tickets: expected [7-Day Unlimited], got [7-Day Unlimited]

Scenario 9 — Monthly vs weekly, singles should win
  PASS: cost $75.00 <= singles $75.00
  PASS: cost $75.00 < monthly $104.50

Scenario 10 — Monthly wins with volume
  PASS: monthly wins cost: expected $104.50, got $104.50
  PASS: monthly wins tickets: expected [Monthly], got [Monthly]

Scenario 11 — 3-day pass edges out singles
  PASS: 3-day pass wins cost: expected $21.75, got $21.75
  PASS: 3-day pass wins tickets: expected [3-Day Pass], got [3-Day Pass]

Scenario 12 — 3-day pass not worth it
  PASS: singles win cost: expected $11.25, got $11.25
  PASS: singles win tickets: expected [1-Trip ×3], got [1-Trip ×3]

Scenario 13 — Rides straddle two weekly windows
  PASS: all singles across windows cost: expected $43.50, got $43.50
  PASS: all singles across windows tickets: expected [1-Ride ×15], got [1-Ride ×15]

Scenario 14 — Cross-month boundary
  PASS: singles across months cost: expected $90.00, got $90.00
  PASS: singles across months tickets: expected [1-Trip ×24], got [1-Trip ×24]

Scenario 15 — Zero-trip tap regression
  PASS: empty trips cost: expected $0.00, got $0.00
  PASS: no tickets for empty trips

Scenario 16 — Reset clears everything (same as empty state)
  PASS: reset state cost: expected $0.00, got $0.00
  PASS: no tickets after reset

Scenario 17 — No rules configured
  PASS: no rules = no cost cost: expected $0.00, got $0.00
  PASS: no rules = no tickets

Scenario 18 — Only monthly pass configured, 1 ride
  PASS: only option cost: expected $100.00, got $100.00
  PASS: only option tickets: expected [Monthly], got [Monthly]

Scenario 19 — N-day with multi-trip days at boundary
  PASS: 3-day pass covers gap cost: expected $21.75, got $21.75
  PASS: 3-day pass covers gap tickets: expected [3-Day Pass], got [3-Day Pass]

Scenario 20 — Competing n-fare rules
  PASS: cost $24.75 <= $26.25 (singles baseline)

Scenario 21 — Weekend-only rider
  PASS: cost $46.40 <= singles $46.40
  PASS: cost $46.40 < monthly $132.00

Scenario 22 — All fare types active, high volume commuter
  PASS: monthly wins with all types cost: expected $104.50, got $104.50
  PASS: monthly wins with all types tickets: expected [Monthly], got [Monthly]

Scenario 23 — Break-even boundary for weekly
  PASS: weekly wins at 12 rides cost: expected $34.00, got $34.00
  PASS: weekly wins at 12 rides tickets: expected [7-Day Unlimited], got [7-Day Unlimited]

Scenario 23b — Below break-even (11 rides)
  PASS: singles at 11 rides cost: expected $31.90, got $31.90
  PASS: singles at 11 rides tickets: expected [1-Ride ×11], got [1-Ride ×11]

========================================
Results: 47 passed, 0 failed, 0 skipped

```

All 47 assertions across 24 test cases (scenarios 1–23 plus 23b break-even boundary) pass. The fix applied was marking n-fare-covered ride indices in coveredIdx to prevent the fallback from double-counting them.

Note: showboat image was not used because the test suite is programmatic (no browser/GUI available in this environment). All test scenarios from cal-alpha1-test-scenarios.md have been translated to automated assertions.
