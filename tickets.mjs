// Define ticket options available for selection
const ticketOptions = [
    { type: 'Round Trip', price: 10, period: 1, continuous: false },
    { type: 'Weekly Pass', price: 43.50, period: 7, continuous: true },
    { type: 'Flex Pass', price: 80, period: 30, continuous: false },
];
  
// Function to check if there is a continuous span of days of a given length
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

function isNextDay(date1, date2) {
    const nextDay = new Date(date1);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.toDateString() === date2.toDateString();
}

export function calculateOptimalTicket(selectedDates) {
    // Prices for each ticket type
    const roundTripPrice = ticketOptions.find(ticket => ticket.type === 'Round Trip').price;
    const weeklyPassPrice = ticketOptions.find(ticket => ticket.type === 'Weekly Pass').price;
    const flexPassPrice = ticketOptions.find(ticket => ticket.type === 'Flex Pass').price;

    // Initially calculate cost for only Round Trip tickets
    let minCost = selectedDates.length * roundTripPrice;
    let optimalTickets = Array(selectedDates.length).fill('Round Trip');

     // Check for Weekly Pass
     if (isWeeklyPassApplicable(selectedDates, weeklyPassPrice, roundTripPrice)) {
        // Determine the cost of additional Round Trips outside the Weekly Pass
        const costWithWeekly = weeklyPassPrice + 
            calculateAdditionalRoundTripsCost(selectedDates, roundTripPrice, 'Weekly');

        if (costWithWeekly < minCost) {
            minCost = costWithWeekly;
            optimalTickets = ['Weekly Pass'];

            // Extracting just the ticket type (as a string) from each additional round trip
            const additionalTrips = getAdditionalRoundTrips(selectedDates, 'Weekly').map(trip => trip.type);
            optimalTickets.push(...additionalTrips);
        }
    }

    // Check for Flex Pass
    if (flexPassPrice < minCost) {
        minCost = flexPassPrice;
        optimalTickets = ['Flex Pass'];
    }

    return optimalTickets;
}

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
