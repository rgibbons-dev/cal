import test from "node:test";
import assert from "node:assert";
import { calculateOptimalTicket } from "./tickets.js";

// Assuming the ticket prices and types are as follows:
// Round Trip: $10, Weekly Pass: $43.50, Flex Pass: $80, Monthly Pass: $145

// Test cases for calculateOptimalTicket

// Test with a single day (expect Round Trip)
test("calculateOptimalTicket with one day", () => {
  const selectedDates = [new Date(2023, 1, 1)];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ["Round Trip"]);
});

// Test across a month boundary (expect Weekly Pass if cheaper)
test("calculateOptimalTicket across month boundary", () => {
  const selectedDates = [
    new Date(2023, 10, 19),
    new Date(2023, 10, 20),
    new Date(2023, 10, 21),
    new Date(2023, 10, 22),
    new Date(2023, 10, 23),
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
  ]);
});

test("calculateOptimalTicket when only Round Trips are cost-effective", () => {
  const selectedDates = [
    new Date(2023, 0, 1), // Sunday
    new Date(2023, 0, 15), // Sunday of the next week
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Round Trip",
    "Round Trip",
  ]);
});

test("calculateOptimalTicket with three Round Trips as most cost-effective", () => {
  const selectedDates = [
    new Date(2023, 0, 2), // Monday (Inside Weekly Window)
    new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
    new Date(2023, 0, 9), // Monday of the next week (Outside Weekly Window)
  ];
  // Assuming the Weekly Pass price is higher than the cost of three Round Trips
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Round Trip",
    "Round Trip",
    "Round Trip",
  ]);
});

// Combination of Weekly Pass and Round Trips
test("calculateOptimalTicket for a combination of Weekly Pass and Round Trips", () => {
  const selectedDates = [
    new Date(2023, 0, 1), // Sunday (Inside Weekly Window)
    new Date(2023, 0, 2), // Monday (Inside Weekly Window)
    new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
    new Date(2023, 0, 4), // Wednesday (Inside Weekly Window)
    new Date(2023, 0, 5), // Wednesday (Inside Weekly Window)
    new Date(2023, 0, 10), // Tuesday (Outside Weekly Window)
    new Date(2023, 0, 11), // Wednesday (Outside Weekly Window)
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
    "Round Trip",
    "Round Trip",
  ]);
});

test("calculateOptimalTicket with all dates covered by a single Weekly Pass", () => {
  const selectedDates = [
    new Date(2023, 0, 2), // Monday
    new Date(2023, 0, 3), // Tuesday
    new Date(2023, 0, 4), // Wednesday
    new Date(2023, 0, 5), // Thursday
    new Date(2023, 0, 6), // Friday
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
  ]);
});

test("calculateOptimalTicket with dates 11/25/2023 - 11/29/2023 covered by a single Weekly Pass", () => {
  const selectedDates = [
    new Date(2023, 10, 25), // Saturday
    new Date(2023, 10, 26), // Sunday
    new Date(2023, 10, 27), // Monday
    new Date(2023, 10, 28), // Tuesday
    new Date(2023, 10, 29), // Wednesday
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
  ]);
});

test("calculateOptimalTicket with Weekly Pass plus a single Round Trip", () => {
  const selectedDates = [
    new Date(2023, 0, 1), // Sunday (Inside Weekly Window)
    new Date(2023, 0, 2), // Monday (Inside Weekly Window)
    new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
    new Date(2023, 0, 4), // Wednesday (Inside Weekly Window)
    new Date(2023, 0, 5), // Thursday (Inside Weekly Window)
    new Date(2023, 0, 6), // Friday (Inside Weekly Window)
    new Date(2023, 0, 10), // Tuesday of the next week (Outside Weekly Window)
  ];
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
    "Round Trip",
  ]);
});

test("calculateOptimalTicket with dates spanning two weekly windows", () => {
  const selectedDates = [
    new Date(2023, 0, 1), // Sunday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 2), // Monday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 3), // Tuesday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 4), // Wednesday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 5), // Thursday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 6), // Friday of week 1 (Inside Weekly Window)
    new Date(2023, 0, 10), // Tuesday of week 2 (Outside Weekly Window)
    new Date(2023, 0, 11), // Wednesday of week 2 (Outside Weekly Window)
  ];
  // Depending on the cost, this could be two Weekly Passes or one Weekly Pass with additional Round Trips
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
    "Round Trip",
    "Round Trip",
  ]);
});

// Monthly Pass
test("calculateOptimalTicket with all dates covered by a single Monthly Pass", () => {
  const selectedDates: Date[] = [];
  for (let i = 1; i <= 30; i++) {
    selectedDates.push(new Date(2023, 4, i)); // All days in May 2023
  }
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Monthly Pass",
  ]);
});

test("calculateOptimalTicket with Monthly Pass plus additional Round Trips in preceding month", () => {
  const selectedDates = [
    new Date(2023, 3, 29), // April 29, 2023 (Round Trip)
    new Date(2023, 3, 30), // April 30, 2023 (Round Trip)
  ];

  // Automatically add all dates in May 2023
  for (let day = 1; day <= 31; day++) {
    selectedDates.push(new Date(2023, 4, day)); // Dates in May 2023
  }
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Monthly Pass",
    "Round Trip",
    "Round Trip",
  ]);
});

test("calculateOptimalTicket with Monthly Pass plus additional Round Trips in following month", () => {
  const selectedDates = [
    new Date(2023, 5, 1), // June 1, 2023 (Round Trip)
    new Date(2023, 5, 2), // June 2, 2023 (Round Trip)
  ];

  // Automatically add all dates in May 2023
  for (let day = 1; day <= 31; day++) {
    selectedDates.push(new Date(2023, 4, day)); // Dates in May 2023
  }
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Monthly Pass",
    "Round Trip",
    "Round Trip",
  ]);
});

test("calculateOptimalTicket with Weekly Pass and Flex Pass for three weeks of weekdays", () => {
  const selectedDates: Date[] = [];

  // Week 1: Dates for the Weekly Pass (e.g., January 3-7, 2023, assuming January 1 is Sunday)
  for (let i = 2; i <= 6; i++) {
    selectedDates.push(new Date(2023, 0, i)); // First week of January, weekdays
  }

  // Weeks 2 and 3: Additional 10 weekdays for the Flex Pass
  for (let i = 9; i <= 13; i++) {
    // Second week of January, weekdays
    selectedDates.push(new Date(2023, 0, i));
  }

  for (let i = 16; i <= 20; i++) {
    // Third week of January, weekdays
    selectedDates.push(new Date(2023, 0, i));
  }

  // Expectation: Weekly Pass for one week, Flex Pass for the 10 additional weekdays
  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Weekly Pass",
    "Flex Pass",
  ]);
});

test("calculateOptimalTicket with Monthly Pass and Weekly Pass", () => {
  const selectedDates: Date[] = [];
  for (let day = 1; day <= 31; day++) {
    selectedDates.push(new Date(2023, 0, day)); // January 2023
  }

  // Add a specific week in February (Monday to Friday)
  for (let day = 6; day <= 10; day++) {
    selectedDates.push(new Date(2023, 1, day)); // First week of February 2023
  }

  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Monthly Pass",
    "Weekly Pass",
  ]);
});

test("calculateOptimalTicket with Monthly Pass and Flex Pass", () => {
  const selectedDates: Date[] = [];
  // Add all days for January
  for (let day = 1; day <= 31; day++) {
    selectedDates.push(new Date(2023, 0, day)); // January 2023
  }

  // Add 9 days in February
  for (let day = 6; day <= 9; day++) {
    selectedDates.push(new Date(2023, 1, day)); // February 6 to 10, 2023
  }
  for (let day = 13; day <= 16; day++) {
    selectedDates.push(new Date(2023, 1, day)); // February 13 to 17, 2023
  }
  selectedDates.push(new Date(2023, 1, 20));

  assert.deepStrictEqual(calculateOptimalTicket(selectedDates), [
    "Monthly Pass",
    "Flex Pass",
  ]);
});
