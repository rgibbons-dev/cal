import test from 'node:test';
import assert from 'node:assert';
import { 
    hasContinuousSpan, 
    calculateAdditionalRoundTripsCost, 
    getAdditionalRoundTrips,
    findWeeklyWindow,
    isWeeklyPassApplicable,
    calculateOptimalTicket } from './tickets.mjs';

// Test cases for hasContinuousSpan
test('hasContinuousSpan with continuous dates', () => {
    const dates = [new Date(2023, 1, 1), new Date(2023, 1, 2), new Date(2023, 1, 3)];
    assert.strictEqual(hasContinuousSpan(dates, 3), true);
});

test('hasContinuousSpan with discontinuous dates', () => {
    const dates = [new Date(2023, 1, 1), new Date(2023, 1, 3), new Date(2023, 1, 5)];
    assert.strictEqual(hasContinuousSpan(dates, 3), false);
});

// Assuming the ticket prices and types are as follows:
// Round Trip: $10, Weekly Pass: $43.50, Flex Pass: $80

// Test cases for calculateOptimalTicket

// Test with a single day (expect Round Trip)
test('calculateOptimalTicket with one day', () => {
    const selectedDates = [new Date(2023, 1, 1)];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Round Trip']);
});

// Test across a month boundary (expect Weekly Pass if cheaper)
test('calculateOptimalTicket across month boundary', () => {
    const selectedDates = [new Date(2023, 10, 19), new Date(2023, 10, 20), new Date(2023, 10, 21), new Date(2023, 10, 22), new Date(2023, 10, 23)];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass']);
});

// Test with even more scattered dates (expect Flex Pass)
test('calculateOptimalTicket with many scattered dates (expect Flex Pass)', () => {
    const selectedDates = [];
    for (let i = 0; i < 15; i++) { // 15 scattered dates across a month
        selectedDates.push(new Date(2023, 0, i * 2 + 1)); // Every other day in a month
    }
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Flex Pass']);
});

test('calculateOptimalTicket when only Round Trips are cost-effective', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday
        new Date(2023, 0, 15) // Sunday of the next week
    ];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Round Trip', 'Round Trip']);
});

test('calculateOptimalTicket when Flex Pass is most cost-effective', () => {
    const selectedDates = [];
    for (let i = 0; i < 15; i++) {
        selectedDates.push(new Date(2023, 0, i + 1)); // 15 days in January
    }
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Flex Pass']);
});

test('calculateOptimalTicket with three Round Trips as most cost-effective', () => {
    const selectedDates = [
        new Date(2023, 0, 2), // Monday (Inside Weekly Window)
        new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
        new Date(2023, 0, 9), // Monday of the next week (Outside Weekly Window)
    ];
    // Assuming the Weekly Pass price is higher than the cost of three Round Trips
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Round Trip', 'Round Trip', 'Round Trip']);
});

// Combination of Weekly Pass and Round Trips
test('calculateOptimalTicket for a combination of Weekly Pass and Round Trips', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday (Inside Weekly Window)
        new Date(2023, 0, 2), // Monday (Inside Weekly Window)
        new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
        new Date(2023, 0, 4), // Wednesday (Inside Weekly Window)
        new Date(2023, 0, 5), // Wednesday (Inside Weekly Window)
        new Date(2023, 0, 10), // Tuesday (Outside Weekly Window)
        new Date(2023, 0, 11)  // Wednesday (Outside Weekly Window)
    ];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass', 'Round Trip', 'Round Trip']);
});

test('calculateOptimalTicket with all dates covered by a single Weekly Pass', () => {
    const selectedDates = [
        new Date(2023, 0, 2), // Monday
        new Date(2023, 0, 3), // Tuesday
        new Date(2023, 0, 4), // Wednesday
        new Date(2023, 0, 5), // Thursday
        new Date(2023, 0, 6)  // Friday
    ];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass']);
});

test('calculateOptimalTicket with dates 11/25/2023 - 11/29/2023 covered by a single Weekly Pass', () => {
    const selectedDates = [
        new Date(2023, 10, 25), // Saturday
        new Date(2023, 10, 26), // Sunday
        new Date(2023, 10, 27), // Monday
        new Date(2023, 10, 28), // Tuesday
        new Date(2023, 10, 29)  // Wednesday
    ];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass']);
});

test('calculateOptimalTicket with Weekly Pass plus a single Round Trip', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday (Inside Weekly Window)
        new Date(2023, 0, 2), // Monday (Inside Weekly Window)
        new Date(2023, 0, 3), // Tuesday (Inside Weekly Window)
        new Date(2023, 0, 4), // Wednesday (Inside Weekly Window)
        new Date(2023, 0, 5), // Thursday (Inside Weekly Window)
        new Date(2023, 0, 6), // Friday (Inside Weekly Window)
        new Date(2023, 0, 10) // Tuesday of the next week (Outside Weekly Window)
    ];
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass', 'Round Trip']);
});

test('calculateOptimalTicket with dates spanning two weekly windows', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 2), // Monday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 3), // Tuesday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 4), // Wednesday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 5), // Thursday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 6), // Friday of week 1 (Inside Weekly Window)
        new Date(2023, 0, 10), // Tuesday of week 2 (Outside Weekly Window)
        new Date(2023, 0, 11) // Wednesday of week 2 (Outside Weekly Window)
    ];
    // Depending on the cost, this could be two Weekly Passes or one Weekly Pass with additional Round Trips
    assert.deepStrictEqual(calculateOptimalTicket(selectedDates), ['Weekly Pass', 'Round Trip', 'Round Trip']);
});

// Test cases for hasContinuousSpan
// Test case for continuous span across month boundary
test('hasContinuousSpan across month boundary', () => {
    const dates = [new Date(2023, 0, 31), new Date(2023, 1, 1), new Date(2023, 1, 2)]; // Jan 31, Feb 1, Feb 2
    assert.strictEqual(hasContinuousSpan(dates, 3), true);
});

// Test case for non-continuous span with Date objects
test('hasContinuousSpan with non-continuous dates', () => {
    const dates = [new Date(2023, 1, 1), new Date(2023, 1, 3), new Date(2023, 1, 5)]; // Feb 1, 3, 5
    assert.strictEqual(hasContinuousSpan(dates, 3), false);
});

// Additional Cost When Weekly Pass is Used
test('calculateAdditionalRoundTripsCost with dates outside the weekly window', () => {
    const selectedDates = [
        new Date(2023, 0, 7), // Saturday (Start of Weekly Window)
        new Date(2023, 0, 14) // Next Saturday (Outside Weekly Window)
    ];
    const roundTripPrice = 10;
    assert.strictEqual(calculateAdditionalRoundTripsCost(selectedDates, roundTripPrice, 'Weekly'), roundTripPrice);
});

// Identifying Specific Additional Round Trips:
test('getAdditionalRoundTrips for dates requiring extra Round Trips', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday (Inside Weekly Window)
        new Date(2023, 0, 2), // Monday (Inside Weekly Window)
        new Date(2023, 0, 8), // Next Sunday (Outside Weekly Window)
        new Date(2023, 0, 9)  // Next Monday (Outside Weekly Window)
    ];
    const expectedAdditionalTrips = [
        { date: new Date(2023, 0, 8), type: 'Round Trip' }, // Next Sunday
        { date: new Date(2023, 0, 9), type: 'Round Trip' }  // Next Monday
    ];
    assert.deepStrictEqual(getAdditionalRoundTrips(selectedDates, 'Weekly'), expectedAdditionalTrips);
});

// Finding the Weekly Window for a Set of Dates
test('findWeeklyWindow for a given set of dates', () => {
    const selectedDates = [
        new Date(2023, 0, 4), // Wednesday (Inside Weekly Window)
        new Date(2023, 0, 5), // Thursday (Inside Weekly Window)
        new Date(2023, 0, 6)  // Friday (Inside Weekly Window)
    ];
    const expectedWindow = { start: new Date(2022, 11 ,31), end: new Date(2023, 0, 6) };
    assert.deepStrictEqual(findWeeklyWindow(selectedDates), expectedWindow);
});

test('findWeeklyWindow with date at the beginning of the week', () => {
    const selectedDates = [new Date(2023, 10, 25)]; // Saturday
    const expectedWindow = { start: new Date(2023, 10, 25), end: new Date(2023, 11, 1) }; // Saturday to next Friday
    assert.deepStrictEqual(findWeeklyWindow(selectedDates), expectedWindow);
});

test('findWeeklyWindow with date at the end of the week', () => {
    const selectedDates = [new Date(2023, 10, 24)]; // Friday
    const expectedWindow = { start: new Date(2023, 10, 18), end: new Date(2023, 10, 24) }; // Previous Saturday to Friday
    assert.deepStrictEqual(findWeeklyWindow(selectedDates), expectedWindow);
});

test('findWeeklyWindow with dates spanning two weeks', () => {
    const selectedDates = [new Date(2023, 10, 24), new Date(2023, 11, 1)]; // Friday and next Saturday
    const expectedWindow = { start: new Date(2023, 10, 18), end: new Date(2023, 10, 24) }; // Previous Saturday to Friday
    assert.deepStrictEqual(findWeeklyWindow(selectedDates), expectedWindow);
});

// When Weekly Pass is more cost-effective than Round Trip
test('isWeeklyPassApplicable when Weekly Pass is cost-effective', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday
        new Date(2023, 0, 2), // Monday
        new Date(2023, 0, 3), // Tuesday
        new Date(2023, 0, 4), // Wednesday
        new Date(2023, 0, 5)  // Thursday
    ];
    const weeklyPassPrice = 43.50;
    const roundTripPrice = 10;
    assert.strictEqual(isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice), true);
});

// When Round Trip is more cost-effective than Weekly Pass
test('isWeeklyPassApplicable when Weekly Pass is not cost-effective', () => {
    const selectedDates = [
        new Date(2023, 0, 1), // Sunday
        new Date(2023, 0, 8), // Next Sunday
        new Date(2023, 0, 15) // Sunday of the next week
    ];
    const weeklyPassPrice = 43.50;
    const roundTripPrice = 10;
    assert.strictEqual(isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice), false);
});

test('isWeeklyPassApplicable when Weekly Pass is clearly cost-effective', () => {
    const selectedDates = [
        new Date(2023, 0, 2), // Monday
        new Date(2023, 0, 3), // Tuesday
        new Date(2023, 0, 4), // Wednesday
        new Date(2023, 0, 5), // Thursday
        new Date(2023, 0, 6)  // Friday
    ];
    const weeklyPassPrice = 43.50;
    const roundTripPrice = 10;
    assert.strictEqual(isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice), true);
});

test('isWeeklyPassApplicable when Weekly Pass is not cost-effective due to few trips', () => {
    const selectedDates = [
        new Date(2023, 0, 2), // Monday
        new Date(2023, 0, 4), // Wednesday
    ];
    const weeklyPassPrice = 43.50;
    const roundTripPrice = 10;
    assert.strictEqual(isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice), false);
});

test('isWeeklyPassApplicable when Weekly Pass is not cost-effective due to spread out dates', () => {
    const selectedDates = [
        new Date(2023, 0, 2), // Monday of week 1
        new Date(2023, 0, 9), // Monday of week 2
    ];
    const weeklyPassPrice = 43.50;
    const roundTripPrice = 10;
    assert.strictEqual(isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice), false);
});