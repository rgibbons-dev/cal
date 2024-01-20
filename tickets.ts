export type TicketType = 'Round Trip' | 'Weekly Pass' | 'Flex Pass' | 'Monthly Pass';

/**
 * Calculates the optimal ticket type for the given selection of dates.
 */
export function calculateOptimalTicket(selectedDates: Date[]) {  
    console.log('herehere')  
    // Group selected dates by month
    type DatesByMonth = { [key: string]: Date[] };
    const datesByMonth: DatesByMonth = selectedDates.reduce((acc: DatesByMonth, date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        acc[monthKey] = (acc[monthKey] || []).concat(date);
        return acc;
    }, {});

    let optimalTicket: TicketType[] = [];
    const firstMonthDates = datesByMonth[Object.keys(datesByMonth)[0]];
    let firstMonthValid, firstMonthNonEmpty = false;
    if(firstMonthDates !== undefined) {
        firstMonthValid = firstMonthDates.length > 17;
        firstMonthNonEmpty = firstMonthDates.length > 0;
    }

    console.log('here5');

    // check if the dates span two months
    if(Object.keys(datesByMonth).length > 1) {
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
            const lesserMonthKey = firstMonthDates.length <= secondMonthDates.length 
							? Object.keys(datesByMonth)[0] : Object.keys(datesByMonth)[1];
            const datesNotInMonthly = datesByMonth[lesserMonthKey];
            console.log(datesNotInMonthly);
            optimalTicket = ['Monthly Pass', ...decideLesserTickets(datesNotInMonthly)];
            return optimalTicket;
        }
        // the dates span two months but the monthly pass is not valid
        // so we need to check for other passes
        else {
            optimalTicket = decideLesserTickets(selectedDates);
            console.log('here3');
            return optimalTicket;
        }
    }
    // dates dont span two months
    else {
        // if the monthly pass is in play but the dates dont span two months
        // then we can just return the monthly pass
        if (firstMonthValid) {
            optimalTicket.push('Monthly Pass');
            console.log('here2');
            return optimalTicket;
        }
        // else the monthly pass is not in play, check for other passes
        else {
            optimalTicket = decideLesserTickets(selectedDates);
            console.log('here');
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
function decideLesserTickets(dates: Date[]): TicketType[] {
    // sort the dates
    let sortedDates = dates.sort();
    let all: Date[][] = [];
    let td = new Date();
    all = all.concat(
        decideFlex8(sortedDates),
        decideFlex9(sortedDates),
        decideFlex10(sortedDates),
        [[td]]
    );
    console.log(all);
    console.log('here');
    decideWeeklyPass(sortedDates);
    // return an array of 'Round Trip' strings
    return dates.map(() => 'Round Trip');
 }
 
 /**
 * A function that decides whether a Flex Pass is an optimal choice given the span of dates and number of days in it
 */
function decideFlexPass(dates: Date[], passes: number) {
	const numDays = dates.length;
	// sentinel
	if (numDays < 8) {
		return dates;
	}
	// use sliding window to search for all groupings of 8-10 days within 30 days
	let start = 0;
	let end = 0;
	let optimal: Date[] = [];
	const opOfOps: Date[][] = [];

	while (end < numDays) {
		optimal.push(dates[end]);
		// is last day within 30 days of first day in window?
		if (optimal[end].getDate() - optimal[start].getDate() > 30) {
            // then remove first elem
			optimal = optimal.slice(1);
            start++;
		}
        // is the current window at our current length?
        if(optimal.length === passes) {
            // add to list of valid windows
            opOfOps.push(optimal);
            // prune first elem and keep moving
            optimal = optimal.slice(1);
            start++;
        }
		end++;
	}
	return opOfOps;
}

function decideFlex8(dates: Date[]) {
    return decideFlexPass(dates, 8);
}
function decideFlex9(dates: Date[]) {
    return decideFlexPass(dates, 9);
}
function decideFlex10(dates: Date[]) {
    return decideFlexPass(dates, 10);
}

/**
* A function that decides whether a Weekly Pass is an optimal choice given the span of dates
*/
function decideWeeklyPass(dates: Date[]) {
	return dates;
}

function decideWeekly4() {}
function decideWeekly5() {}
function decideWeekly6() {}
function decideWeekly7() {}
