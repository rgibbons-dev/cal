/**
 * Calculates the optimal ticket type for the given selection of dates.
 */
export function calculateOptimalTicket(selectedDates) {
    const datesByMonth = selectedDates.reduce((acc, date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthKey] = (acc[monthKey] || []).concat(date);
        return acc;
    }, {});
    let optimalTicket = [];
    const firstMonthDates = datesByMonth[Object.keys(datesByMonth)[0]];
    let firstMonthValid, firstMonthNonEmpty = false;
    if (firstMonthDates !== undefined) {
        firstMonthValid = firstMonthDates.length > 17;
        firstMonthNonEmpty = firstMonthDates.length > 0;
    }
    // check if the dates span two months
    if (Object.keys(datesByMonth).length > 1) {
        // there should only be two keys in the datesByMonth object
        // one for the current month and one for the next month
        // check if one of the two months has greater than 17 days selected
        // if so, then the optimal ticket includes a monthly pass
        const secondMonthDates = datesByMonth[Object.keys(datesByMonth)[1]];
        let secondMonthValid, secondMonthNonEmpty = false;
        if (secondMonthDates !== undefined) {
            secondMonthValid = secondMonthDates.length > 17;
            secondMonthNonEmpty = secondMonthDates.length > 0;
        }
        const monthlyPassPossible = firstMonthValid || secondMonthValid;
        const monthlyPassSpanTwoMonths = monthlyPassPossible && firstMonthNonEmpty && secondMonthNonEmpty;
        // if the dates span two months and a monthly pass is valid
        // then we need to check for other passes
        if (monthlyPassSpanTwoMonths) {
            // isolate the dates for the lesser of the two months
            // by reassigning selectedDates to the value of the key corresponding to the month with fewer dates
            const lesserMonthKey = firstMonthDates.length <= secondMonthDates.length ? Object.keys(datesByMonth)[0] : Object.keys(datesByMonth)[1];
            const datesNotInMonthly = datesByMonth[lesserMonthKey];
            console.log(datesNotInMonthly);
            optimalTicket = ['Monthly Pass', ...decideLesserTickets(datesNotInMonthly)];
            return optimalTicket;
        }
        // the dates span two months but the monthly pass is not valid
        // so we need to check for other passes
        else {
            optimalTicket = decideLesserTickets(selectedDates);
            return optimalTicket;
        }
    }
    // dates dont span two months
    else {
        // if the monthly pass is in play but the dates dont span two months
        // then we can just return the monthly pass
        if (firstMonthValid) {
            optimalTicket.push('Monthly Pass');
            return optimalTicket;
        }
        // else the monthly pass is not in play, check for other passes
        else {
            optimalTicket = decideLesserTickets(selectedDates);
            return optimalTicket;
        }
    }
}
/**
 * A function that takes an array of dates as an argument and returns an array of strings representing the optimal ticket type for each date.
 *
 * The optimal ticket type is determined by the following rules:
 *    a) a Round Trip ticket is a ticket that is valid for one day
 *    b) a Weekly Pass ticket is a ticket that is valid for seven consecutive days, starting on a Saturday and ending on a Friday
 *    c) a Flex Pass ticket is a ticket that is valid for 10 round trips within a 30 day period
 */
export function decideLesserTickets(dates) {
    // return an array of 'Round Trip' strings
    return dates.map(() => 'Round Trip');
}
