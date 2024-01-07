export type TicketType = 'Round Trip' | 'Weekly Pass' | 'Flex Pass' | 'Monthly Pass';

/**
 * Calculates the optimal ticket type for the given selection of dates.
 */
export function calculateOptimalTicket(selectedDates: Date[]) {    
    // Group selected dates by month
    type DatesByMonth = { [key: string]: Date[] };
    const datesByMonth: DatesByMonth = selectedDates.reduce((acc: DatesByMonth, date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthKey] = (acc[monthKey] || []).concat(date);
        return acc;
    }, {});

    let optimalTicket: TicketType[] = [];

    // check if the dates span two months
    if(Object.keys(datesByMonth).length > 1) {
        // there should only be two keys in the datesByMonth object
        // one for the current month and one for the next month
        // check if one of the two months has greater than 17 days selected
        // if so, then the optimal ticket includes a monthly pass
        const firstMonthValid = parseInt(Object.keys(datesByMonth)[0]) > 17;
        const firstMonthNonEmpty = datesByMonth[Object.keys(datesByMonth)[0]].length > 0;
        const secondMonthValid = parseInt(Object.keys(datesByMonth)[1]) > 17;
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
            optimalTicket = ['Monthly Pass', ...decideLesserTickets(datesNotInMonthly)];
            return optimalTicket;
        }
        // else the dates span two months but the monthly pass is not valid
        // so we need to check for other passes
        else {
            optimalTicket = decideLesserTickets(selectedDates);
            return optimalTicket;
        }
    }
    // else the dates dont span two months but the monthly pass is not valid
    else {
        optimalTicket = decideLesserTickets(selectedDates);
        return optimalTicket;
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
export function decideLesserTickets(dates: Date[]): TicketType[] {
    // return an array of 'Round Trip' strings
    return dates.map(() => 'Round Trip');
 }
