// Define ticket options available for selection
const ticketOptions = [
    { type: 'Round Trip', price: 10, period: 1, continuous: false },
    { type: 'Weekly Pass', price: 43.50, period: 7, continuous: true },
    { type: 'Flex Pass', price: 80, period: 30, continuous: false, limit: 10 }, // 10 round trips within 30 days
    { type: 'Monthly Pass', price: 145, period: 'month', continuous: true } // Unlimited for a calendar month
];

/**
 * Calculates the optimal ticket type for the given selection of dates.
 * 
 * @param {Date[]} selectedDates - An array of Date objects representing selected dates.
 * @returns {string[]} An array of strings representing the optimal ticket type for each selected date.
 */
export function calculateOptimalTicket(selectedDates) {    
    // Group selected dates by month
    const datesByMonth = selectedDates.reduce((acc, date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthKey] = (acc[monthKey] || []).concat(date);
        return acc;
    }, {});
    // there should only be two keys in the datesByMonth object
    // one for the current month and one for the next month
    // check if one of the two months has greater than 17 days selected
    // if so, then the optimal ticket includes a monthly pass
    let optimalTicket = [];
    const firstMonthValid = Object.keys(datesByMonth)[0] > 17;
    const firstMonthNonEmpty = datesByMonth[Object.keys(datesByMonth)[0]].length > 0;
    const secondMonthValid = Object.keys(datesByMonth)[1] > 17;
    const secondMonthNonEmpty = datesByMonth[Object.keys(datesByMonth)[1]].length > 0;
    const monthlyPassPossible = firstMonthValid || secondMonthValid;
    const monthlyPassSpanTwoMonths = monthlyPassPossible && firstMonthNonEmpty && secondMonthNonEmpty;

    // if the monthly pass is in play but the dates dont span two months
    // then we can just return the monthly pass
    if (monthlyPassPossible && !monthlyPassSpanTwoMonths) {
        optimalTicket.push('Monthly Pass');
        return optimalTicket;
    }
    // else if the dates span two months and a monthly pass is valid
    // then we need to check for other passes
    else if (monthlyPassSpanTwoMonths) {
        // isolate the dates for the lesser of the two months
        // by reassigning selectedDates to the value of the key corresponding to the lesser month
        const datesNotInMonthly = datesByMonth[Object.keys(datesByMonth).reduce((a, b) => a < b ? a : b)];
        optimalTicket = ['Monthly Pass', ...decideLesserTickets(datesNotInMonthly, ticketOptions)];
        return optimalTicket;
    }
    // else there are two cases:
    //  1) the dates span two months but the monthly pass is not valid
    //  2) the dates dont span two months but the monthly pass is not valid
    // in either case, we need to check for other passes
    else {
        optimalTicket = decideLesserTickets(selectedDates, ticketOptions);
        return optimalTicket;
    }

}

/**
 * A function that takes an array of dates as an argument and returns an array of strings representing the optimal ticket type for each date.
 * 
 * @param {Date[]} dates - An array of Date objects representing selected dates.
 * @returns {string[]} An array of strings representing the optimal ticket type for each selected date.
 * 
 * The optimal ticket type is determined by the following rules:
 *    a) a Round Trip ticket is a ticket that is valid for one day
 *    b) a Weekly Pass ticket is a ticket that is valid for seven consecutive days, starting on a Saturday and ending on a Friday
 *    c) a Flex Pass ticket is a ticket that is valid for 10 round trips within a 30 day period
 */
export function decideLesserTickets(dates, ticketOptions) {
    // handle case that it is a Flex Pass
    // check that between 8 and 10 days within dates are within the range of 30 days
    // optimal selection should maximize the days within this constraint
    if (dates.length > 8) {
        // sort dates in ascending order
        const sortedDates = dates.sort((a, b) => a - b);
        // iterate through dates and find the longest continuous span of dates
        // that is less than or equal to 30 days
        // and the span is either 9 or 10 days
        // if there is no such span, then return null
        // else return the span
        for (let i = 0; i < sortedDates.length; i++) {
            const subarray = [sortedDates[i]];
            let currentDate = sortedDates[i];
        
            for (let j = i + 1; j < sortedDates.length; j++) {
              const daysDifference = Math.abs((currentDate - sortedDates[j]) / (24 * 60 * 60 * 1000));
        
              if (daysDifference <= 30) {
                subarray.push(sortedDates[j]);
                currentDate = sortedDates[j];
              }
        
              if (subarray.length === 10) {
                return subarray;
              }
            }
          }
        
          return [];
    }
    // handle case that it is a Weekly Pass
    // check that between 4 and 7 days within dates are within the range of 7 days, Saturday to Friday
    // optimal selection should maximize the days within this constraint
    else if (dates.length > 4) {
        // sort dates in ascending order
        const sortedDates = dates.sort((a, b) => a - b);
        let currentWeek = [];
        let allWeeks = [];
        sortedDates.forEach(date => {
            const dayOfWeek = date.getDay();
            // we're at the end of the week covered by a weekly pass
            if(dayOfWeek === 5) {
                currentWeek.push(date);
                allWeeks.push(currentWeek);
                currentWeek = [];
            }
            // otherwise, just push the date
            else {
                currentWeek.push(date);
            }
        });
        const possibleWeeklyPassWeeks = allWeeks.filter(week => week.length >= 4);
        const roundTripWeeks = allWeeks.filter(week => week.length < 4);
        const weeksFlattened = possibleWeeklyPassWeeks.map(() => 'Weekly Pass');
        return [...weeksFlattened, ...roundTripWeeks.flat().map(() => 'Round Trip')];
    }
    // handle case that it is a Round Trip
    else {
        // return an array of 'Round Trip' strings
        return dates.map(() => 'Round Trip');
    }
        
 }
