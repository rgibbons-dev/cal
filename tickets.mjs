// Define ticket options available for selection
const ticketOptions = [
    { type: 'Round Trip', price: 10, period: 1, continuous: false },
    { type: 'Weekly Pass', price: 43.50, period: 7, continuous: true },
    { type: 'Flex Pass', price: 80, period: 30, continuous: false, limit: 10 }, // 10 round trips within 30 days
    { type: 'Monthly Pass', price: 145, period: 'month', continuous: true } // Unlimited for a calendar month
];
  
/**
 * Consolidates the optimal ticket types for the given selection of dates.
 * 
 * @param {string[]} optimalTickets - An array of strings representing the optimal ticket type for each selected date.
 * @returns {string[]} An array of strings representing the consolidated optimal ticket types for each selected date.
 */
export function hasContinuousSpan(days, spanLength) {
    if (days.length < spanLength) return false;

    // Sort days and check for a continuous span of the specified length
    const sortedDates = [...days].sort((a, b) => a - b);
    
    for (let i = 0; i <= sortedDates.length - spanLength; i++) {
        let continuous = true;
        for (let j = 0; j < spanLength - 1; j++) {
            // Check if each date is followed by the next date
            if (!isNextDay(sortedDates[i + j], sortedDates[i + j + 1])) {
                continuous = false;
                break;
            }
        }
        if (continuous) {
            return true;
        }
    }
    return false;
}

/**
 * Checks if the second date is the next day relative to the first date.
 *
 * @param {Date} date1 - The first date to compare.
 * @param {Date} date2 - The second date to check if it's the next day of date1.
 * @returns {boolean} Returns true if date2 is the next day of date1, otherwise false.
 */
function isNextDay(date1, date2) {
    const nextDay = new Date(date1);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.toDateString() === date2.toDateString();
}

/**
 * Calculates the optimal ticket type for the given selection of dates.
 * 
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @returns {string[]} An array of strings representing the optimal ticket type for each selected date.
 */
export function calculateOptimalTicket(selectedDates) {
    // Prices for each ticket type
    const roundTripPrice = ticketOptions.find(ticket => ticket.type === 'Round Trip').price;
    const weeklyPassPrice = ticketOptions.find(ticket => ticket.type === 'Weekly Pass').price;
    const flexPassPrice = ticketOptions.find(ticket => ticket.type === 'Flex Pass').price;
    const monthlyPassPrice = ticketOptions.find(ticket => ticket.type === 'Monthly Pass').price;
    
    // Initialize minimum cost to the cost of all dates as Round Trips
    let minCost = selectedDates.length * roundTripPrice;
    let optimalTicket = Array(selectedDates.length).fill('Round Trip');

    // Calculate the cost for using a Monthly Pass if applicable
    let costWithMonthlyPass = Infinity;
    let monthlyPassMonth = null;
    let daysOutsideMonthlyPass = 0;

    // Group dates by month-year and count the occurrences
    const monthYearCounts = selectedDates.reduce((acc, date) => {
        const monthYearKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthYearKey] = (acc[monthYearKey] || 0) + 1;
        return acc;
    }, {});

    // Find the month with the most selected dates
    for (const [monthYear, count] of Object.entries(monthYearCounts)) {
        if (count > selectedDates.length / 2) {
            monthlyPassMonth = monthYear;
            daysOutsideMonthlyPass = selectedDates.length - count;
            break;
        }
    }

    // Calculate the cost of using a Monthly Pass plus Round Trips for remaining days
    if (monthlyPassMonth !== null) {
        costWithMonthlyPass = monthlyPassPrice + daysOutsideMonthlyPass * roundTripPrice;
    }

    // Compare this cost with the current minimum cost
    if (costWithMonthlyPass < minCost) {
        minCost = costWithMonthlyPass;
        optimalTicket = ['Monthly Pass'];
        if (daysOutsideMonthlyPass > 0) {
            optimalTicket.push(...Array(daysOutsideMonthlyPass).fill('Round Trip'));
        }
    }

    // Check for Weekly Pass applicability
    if (isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice)) {
        let costWithWeekly = weeklyPassPrice + calculateAdditionalRoundTripsCost(selectedDates, roundTripPrice, 'Weekly');
        if (costWithWeekly < minCost) {
            minCost = costWithWeekly;
            optimalTicket = ['Weekly Pass', ...getAdditionalRoundTrips(selectedDates, 'Weekly').map(trip => trip.type)];
        }
    }

    // Check for Flex Pass applicability
    if (selectedDates.length <= 10 && flexPassPrice < minCost) {
        minCost = flexPassPrice;
        optimalTicket = ['Flex Pass'];
    }

    // Check for combination of Weekly Pass and Flex Pass
    if (selectedDates.length > 10) {
        let weeklyWindow = findWeeklyWindow(selectedDates);
        let datesOutsideWeekly = selectedDates.filter(date => 
            date < weeklyWindow.start || date > weeklyWindow.end
        );

        // Only consider Weekly + Flex combination if there are more than 10 dates in total
        // but not more than 10 dates outside the weekly window
        if (datesOutsideWeekly.length <= 10 && datesOutsideWeekly.length > 0) {
            let costWithWeeklyAndFlex = weeklyPassPrice + flexPassPrice;
            if (costWithWeeklyAndFlex < minCost) {
                minCost = costWithWeeklyAndFlex;
                optimalTicket = ['Weekly Pass', 'Flex Pass'];
            }
        }
    }

    // Check for combination of Monthly Pass with Weekly Pass or Flex Pass
    if (Object.keys(groupDatesByMonth(selectedDates)).length > 1 && selectedDates.length > 19) {
        // Calculate costs for Monthly + Weekly and Monthly + Flex combinations
        let costWithMonthlyAndWeekly = monthlyPassPrice + weeklyPassPrice;
        let costWithMonthlyAndFlex = monthlyPassPrice + flexPassPrice;

        // Determine the best combination
        if (costWithMonthlyAndWeekly < minCost) {
            minCost = costWithMonthlyAndWeekly;
            optimalTicket = ['Monthly Pass', 'Weekly Pass'];
        } else if (costWithMonthlyAndFlex < minCost) {
            minCost = costWithMonthlyAndFlex;
            optimalTicket = ['Monthly Pass', 'Flex Pass'];
        }
    }

    // Default to Round Trip tickets if no other pass is cost-effective
    if (minCost === selectedDates.length * roundTripPrice) {
        optimalTicket = Array(selectedDates.length).fill('Round Trip');
    }

    return optimalTicket;
}

// JSDoc annotation block for the function
/**
 * Groups an array of Date objects by month-year.
 * 
 * @param {Date[]} dates - An array of Date objects to group by month-year.
 * @returns {Object} An object with keys representing month-year and values representing an array of Date objects for that month-year.
 **/
export function groupDatesByMonth(dates) {
    return dates.reduce((acc, date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthKey] = (acc[monthKey] || []).concat(date);
        return acc;
    }, {});
}

/**
 * Groups an array of Date objects by month-year.
 * 
 * @param {Date[]} dates - An array of Date objects to group by month-year.
 * @returns {Object} An object with keys representing month-year and values representing an array of Date objects for that month-year.
 **/
export function isDateWithinWeeklyWindow(date, weeklyWindow) {
    return date >= weeklyWindow.start && date <= weeklyWindow.end;
}

/**
 * Checks if the total cost of round trips within the weekly window is greater than the weekly pass price.
 *
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @param {number} weeklyPassPrice - The price of a weekly pass.
 * @param {number} roundTripPrice - The price of a single round trip ticket.
 * @returns {boolean} Returns true if the total cost of round trips within the weekly window is greater than the weekly pass price, otherwise false.
 */
export function isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice) {
    let weeklyWindow = findWeeklyWindow(selectedDates);
    let totalRoundTripCost = 0;

    selectedDates.forEach(date => {
        if (date >= weeklyWindow.start && date <= weeklyWindow.end) {
            totalRoundTripCost += roundTripPrice;
        }
    });

    return totalRoundTripCost > weeklyPassPrice;
}


/**
 * Calculates the additional cost for round trips outside the weekly window, given a specific pass type.
 *
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @param {number} roundTripPrice - The price of a single round trip ticket.
 * @param {string} passType - The type of pass being considered, currently only 'Weekly' is handled.
 * @returns {number} The total additional cost for round trips outside the weekly window. 
 *                   Returns 0 for pass types other than 'Weekly'.
 */
export function calculateAdditionalRoundTripsCost(selectedDates, roundTripPrice, passType) {
    if (passType !== 'Weekly') {
        return 0; // Currently only handling additional costs for Weekly Pass
    }

    let additionalCost = 0;
    let weeklyWindow = findWeeklyWindow(selectedDates);

    selectedDates.forEach(date => {
        if (date < weeklyWindow.start || date > weeklyWindow.end) {
            additionalCost += roundTripPrice;
        }
    });

    return additionalCost;
}

/**
 * Finds the weekly window (Saturday to Friday) based on the earliest date in the given selection.
 *
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @returns {Object} An object with two properties, 'start' and 'end', representing the 
 *                  start (Saturday) and end (Friday) of the weekly window. 
 *                  Both properties are Date objects.
 */
export function findWeeklyWindow(selectedDates) {
    // Find the earliest date in the selected dates
    let firstDate = new Date(Math.min(...selectedDates));
    
    // Calculate the start of the week (previous Saturday before the earliest date)
    let startOfWeek = new Date(firstDate);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 1) % 7));

    // Calculate the end of the week (Friday of the same week)
    let endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6); // Set to Friday of the same week

    return { start: startOfWeek, end: endOfWeek };
}

/**
 * Calculates the additional round trips outside the weekly window, given a specific pass type.
 *
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @param {string} passType - The type of pass being considered, currently only 'Weekly' is handled.
 * @returns {Object[]} An array of objects with two properties, 'type' and 'date', representing the 
 *                      type of additional trip and the date of the trip. 
 *                      The 'type' property is a string and the 'date' property is a Date object.
 */
export function getAdditionalRoundTrips(selectedDates, passType) {
    if (passType !== 'Weekly') {
        return []; // Currently only handling additional trips for Weekly Pass
    }

    let additionalTrips = [];
    let weeklyWindow = findWeeklyWindow(selectedDates);

    selectedDates.forEach(date => {
        if (date < weeklyWindow.start || date > weeklyWindow.end) {
            additionalTrips.push({ type: 'Round Trip', date: date });
        }
    });

    return additionalTrips;
}
