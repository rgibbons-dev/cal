export type TicketType = 'Round Trip' | 'Weekly Pass' | 'Flex Pass' | 'Monthly Pass';

/**
 * Calculates the optimal ticket type for the given selection of dates.
 * 
 * @param selectedDates a list of user-selected Dates
 * @returns an array containing the optimal ticket selection
 * 
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
    const firstMonthDates = datesByMonth[Object.keys(datesByMonth)[0]];
    let firstMonthValid, firstMonthNonEmpty = false;
    if(firstMonthDates !== undefined) {
        firstMonthValid = firstMonthDates.length > 17;
        firstMonthNonEmpty = firstMonthDates.length > 0;
    }

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
 * @param dates a list of user-selected Dates
 * @returns an array containing the optimal ticket selection
 * 
 * The optimal ticket type is determined by the following rules:
 *    a) a Round Trip ticket is a ticket that is valid for one day
 *    b) a Weekly Pass ticket is a ticket that is valid for seven consecutive days, starting on a Saturday and ending on a Friday
 *    c) a Flex Pass ticket is a ticket that is valid for 10 round trips within a 30 day period
 */
function decideLesserTickets(dates: Date[]): TicketType[] {
    // short circuit
    if (dates.length < 5) {
        return dates.map(() => 'Round Trip');
    }
    // sort the dates
    const sortedDates = dates.sort(compd);
    let all: Date[][] = [];
    all = all.concat(
        decideWeekly5(sortedDates),
        decideWeekly6(sortedDates),
        decideWeekly7(sortedDates),
        decideFlex9(sortedDates),
        decideFlex10(sortedDates)
    );
    // there's more than 5 days but there's no weekly or flex
    if (all.length === 0) {
        return dates.map(() => 'Round Trip');
    }
    // for each array in all,
    // convert to a set
    // then take set difference from sortedDates
    // and map the array in all to it
    const m: Map<Date[], Date[]> = new Map();
    const universe = new Set(sortedDates);
    for (const a of all) {
        const A = new Set(a);
        const complement = difference(universe, A);
        const c = Array.from(complement);
        // N.B. all keys should be unique in theory
        m.set(a, c);
    }
    // we are going to compute the cost of each key and value
    // then we will compute the sum of each respective mapping
    // once we have the minimum cost,
    // then we convert each pairing to respective string literals
    // each value array will be considered to be round trips
    const rt = parseFloat((document.querySelector('#fare') as HTMLInputElement).value);
    const wp = parseFloat((rt * 4.35).toFixed(2));
    const fp = parseFloat((rt * 8).toFixed(2));
    let min = Infinity;
    let minK: Date[] = [];
    let minV: Date[] = [];
    let flag = false;
    for (const [k, v] of m.entries()) {
        let cur = 0
        // check if flex pass
        if (k.length === 9 || k.length === 10) {
            cur = fp;
        }
        // check if weekly pass 
        else if (k.length === 5 || k.length === 6 || k.length === 7) {
            cur = wp;
        }
        // check if there exists a value that is also a valid window
        const vw = Array.from(m.keys())
                        // filter out non-empty lengths that don't equal v
                        .filter(arr => arr.length === v.length && v.length > 0)
                        // for all k arrays matching v, find at least one
                        .some(
                            // for all dates in this k
                            arr => arr.every(
                                // for some date vd in v
                                d => v.some(
                                    // d from k matches a vd in v
                                    vd => vd.getDate() === d.getDate()
                                ) 
                            )
                        );
        // so if there is a matching key to our value
        if (vw) {
            // check if it's a flex pass
            if (v.length === 9 || v.length === 10) {
                cur += fp;
            }
            // or a weekly pass 
            else if (v.length === 5 || v.length === 6 || v.length === 7) {
                cur += wp;
            }
        } else {
            cur += v.length * rt;
        }
        if (cur < min) {
            min = cur;
            minK = k;
            minV = v;
            // this should ensure that we know whether
            // or not the last one is a valid window
            if (vw) {
                flag = true;
            } else {
                flag = false;
            }
        }
    }
    // map our optimal key to a ticket type
    let withK: TicketType[] = [];
    if (minK.length === 9 || minK.length === 10) {
        withK = ['Flex Pass'];
    } else if (minK.length === 5 || minK.length === 6 || minK.length === 7) {
        withK = ['Weekly Pass'];
    } else {
        withK = minK.map(() => 'Round Trip');
    }
    // now for the optimal value
    let withV: TicketType[] = [];
    if (flag) {
        if (minV.length === 9 || minV.length === 10) {
            withV = ['Flex Pass'];
        } else if (minV.length === 5 || minV.length === 6 || minV.length === 7) {
            withV = ['Weekly Pass'];
        }
    } else {
        withV = minV.map(() => 'Round Trip');
    }
    return withK.concat(withV);
 }

/**
 * Utility function for sorting dates
 * @param a a Date object
 * @param b a Date object
 * @returns the difference in time
 */
function compd(a: Date, b: Date) {
    return a.getTime() - b.getTime();
}

 /**
  * Utility function due to lack of browser support for
  * Set.prototype.difference()
  * 
  * @param a set that contains elements we want
  * @param b set that contains elements we don't want
  */
 function difference<T>(a: Set<T>, b: Set<T>) {
    return new Set(Array.from(a).filter(item => !b.has(item)));
 }

 /**
  * Utility function that returns the distance between two Dates in days
  * 
  * @param beg start date
  * @param end end date
  * @returns the range of days in between
  */
 function getDist(beg: Date, end: Date) {
    const eDate = end.getDate();
    const eMonth = end.getMonth();
    const bDate = beg.getDate();
    const bMonth = beg.getMonth();
    let range: number;
    // check if the dates are in two separate months
    if (bMonth < eMonth) {
        const eom = new Date(end.getTime());
        // now we have the last day of the first month
        eom.setDate(eom.getDate() - eDate);
        // get number of days from start of window to end of month
        const toEom = eom.getDate() - bDate;
        // real difference
        range = toEom + eDate;
    }
    // else, we're ok to compare directly
    else {
        range = eDate - bDate;
    }
    return range;
 }
 
 /**
 * A function that decides whether a Flex Pass is an optimal choice given the span of dates and number of days in it
 */
function decideFlexPass(dates: Date[], passes: number) {
	const numDays = dates.length;
	// sentinel
	if (numDays < passes) {
		return [];
	}
	// use sliding window to search for all groupings of 9-10 days within 30 days
	let start = 0;
	let end = 0;
	const optimal: Date[] = [];
	const opOfOps: Date[][] = [];

	while (end < numDays) {
		optimal.push(dates[end]);
        const cur = optimal.slice(start, end + 1);
        const range = getDist(cur[0], cur[cur.length - 1]);
        // is last day not within 30 days of first day in window?
		if (range > 30) {
            // then move window forward
            start++;
		}
        // is the current window at our current length?
        else if (cur.length === passes) {
            // add to list of valid windows
            opOfOps.push([...cur]);
            // and keep moving
            start++;
        } else {
            end++;
        }
	}
	return opOfOps;
}

function decideFlex9(dates: Date[]) {
    return decideFlexPass(dates, 9);
}
function decideFlex10(dates: Date[]) {
    return decideFlexPass(dates, 10);
}

/**
 * A function that decides whether a Weekly Pass is an optimal choice given the span of dates
 * 
 * @param dates list of selected dates
 * @param passes number of passes that would constitute a weekly pass
 * @returns a list of possible lists with length of the amount of passes
 */
function decideWeeklyPass(dates: Date[], passes: number) {
    const numDays = dates.length;
    // sentinel
    if (numDays < passes) {
        return [];
    }
    // use sliding window to search for all groupings of 5-7 days within Sat-Fri
	let start = 0;
	let end = 0;
	const optimal: Date[] = [];
	const opOfOps: Date[][] = [];

    while (end < numDays) {
        // in the case we find a successful window, we might add a duplicate
        if (!optimal.includes(dates[end])) {
            optimal.push(dates[end]);
        }
        // get current window
        const cur = optimal.slice(start, end + 1);
        const range = getDist(cur[0], cur[cur.length - 1]);
        // is the last day not within 7 days of the first day?
        const notWithin7Days = range > 7;
        const within7Days = !notWithin7Days;
        // ok, but is it in a Saturday - Friday window?
        // d + 1 % 7 ensures Saturday is the start day
        // if the end day is less than the start day,
        // then the end day is in the following window
        const eDay = (cur[cur.length - 1].getDay() + 1) % 7;
        const bDay = (cur[0].getDay() + 1) % 7;
        const notWithinSatFriWindow = (eDay < bDay);
        const withinSatFriWindow = !notWithinSatFriWindow;
        if (notWithin7Days || notWithinSatFriWindow) {
            // then we know a window is impossible, keep movin
            start++;
        }
        // then we can check the window size
        else if (within7Days && withinSatFriWindow && cur.length === passes) {
            // add to list of valid windows
            opOfOps.push([...cur]);
            // and keep moving
            start++;
            // TODO: explore moving the end pointer forward here
            // it may make sense to do it
            // if this is a window, then moving the start window forward wont be
            // i won't have to deal with OOB issues because of loop invariant
        } 
        // else move rhs of window forward
        else {
            end++;
        }
    }
	return opOfOps;
}

function decideWeekly5(dates: Date[]) {
    return decideWeeklyPass(dates, 5);
}
function decideWeekly6(dates: Date[]) {
    return decideWeeklyPass(dates, 6);
}
function decideWeekly7(dates: Date[]) {
    return decideWeeklyPass(dates, 7);
}
