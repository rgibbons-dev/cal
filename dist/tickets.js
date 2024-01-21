/**
 * Calculates the optimal ticket type for the given selection of dates.
 *
 * @param selectedDates a list of user-selected Dates
 * @returns an array containing the optimal ticket selection
 *
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
function decideLesserTickets(dates) {
    // sort the dates
    const sortedDates = dates.sort(compd);
    let all = [];
    all = all.concat(decideWeekly4(sortedDates), decideWeekly5(sortedDates), decideWeekly6(sortedDates), decideWeekly7(sortedDates), decideFlex8(sortedDates), decideFlex9(sortedDates), decideFlex10(sortedDates));
    //console.log(all);
    // for each array in all,
    // convert to a set
    // then take set difference from sortedDates
    // and map the array in all to it
    const m = new Map();
    const universe = new Set(sortedDates);
    for (const a of all) {
        const A = new Set(a);
        const complement = difference(universe, A);
        const c = Array.from(complement);
        // N.B. all keys should be unique in theory
        m.set(a, c);
    }
    // it's possible that a value in the map can be another key
    // but that's an edge case
    // for now we are going to compute the cost of each key and value
    // then we will compute the sum of each respective mapping
    // once we have the minimum cost,
    // then we convert each pairing to respective string literals
    // each value array will be considered to be round trips
    const rt = 10;
    const wp = 43.5;
    const fp = 80;
    let min = Infinity;
    for (const [k, v] of m.entries()) {
        console.log('k,v', k, v);
        let cur = 0;
        if (k.length === 8 || k.length === 9 || k.length === 10) {
            cur = fp;
        }
        else if (k.length === 4 || k.length === 5 || k.length === 6 || k.length === 7) {
            cur = wp;
        }
        // TODO: want to identify any valid windows within the complement
        console.log(Array.from(m.keys()).every(arr => arr.every(d => v.includes(d))));
        if (Array.from(m.keys()).every(arr => arr.every(d => v.includes(d)))) {
            if (v.length === 8 || v.length === 9 || v.length === 10) {
                cur += fp;
            }
            else if (v.length === 4 || v.length === 5 || v.length === 6 || v.length === 7) {
                cur += wp;
            }
        }
        else {
            cur += v.length * rt;
        }
        if (cur < min) {
            min = cur;
        }
    }
    console.log('min', min);
    // return an array of 'Round Trip' strings
    return dates.map(() => 'Round Trip');
}
/**
 * Utility function for sorting dates
 * @param a a Date object
 * @param b a Date object
 * @returns the difference in time
 */
function compd(a, b) {
    return a.getTime() - b.getTime();
}
/**
 * Utility function due to lack of browser support for
 * Set.prototype.difference()
 *
 * @param a set that contains elements we want
 * @param b set that contains elements we don't want
 */
function difference(a, b) {
    return new Set(Array.from(a).filter(item => !b.has(item)));
}
/**
* A function that decides whether a Flex Pass is an optimal choice given the span of dates and number of days in it
*/
function decideFlexPass(dates, passes) {
    const numDays = dates.length;
    // sentinel
    if (numDays < passes) {
        return [];
    }
    // use sliding window to search for all groupings of 8-10 days within 30 days
    let start = 0;
    let end = 0;
    const optimal = [];
    const opOfOps = [];
    while (end < numDays) {
        optimal.push(dates[end]);
        const cur = optimal.slice(start, end + 1);
        // is last day not within 30 days of first day in window?
        if ((cur[cur.length - 1].getDate() - cur[0].getDate()) > 30) {
            // then move window forward
            start++;
        }
        // is the current window at our current length?
        else if (cur.length === passes) {
            // add to list of valid windows
            opOfOps.push([...cur]);
            // and keep moving
            start++;
        }
        else {
            end++;
        }
    }
    return opOfOps;
}
function decideFlex8(dates) {
    return decideFlexPass(dates, 8);
}
function decideFlex9(dates) {
    return decideFlexPass(dates, 9);
}
function decideFlex10(dates) {
    return decideFlexPass(dates, 10);
}
/**
 * A function that decides whether a Weekly Pass is an optimal choice given the span of dates
 *
 * @param dates list of selected dates
 * @param passes number of passes that would constitute a weekly pass
 * @returns a list of possible lists with length of the amount of passes
 */
function decideWeeklyPass(dates, passes) {
    const numDays = dates.length;
    // sentinel
    if (numDays < passes) {
        return [];
    }
    // use sliding window to search for all groupings of 4-7 days within Sat-Fri
    let start = 0;
    let end = 0;
    const optimal = [];
    const opOfOps = [];
    while (end < numDays) {
        // in the case we find a successful window, we might add a duplicate
        if (!optimal.includes(dates[end])) {
            optimal.push(dates[end]);
        }
        // get current window
        const cur = optimal.slice(start, end + 1);
        // is the last day not within 7 days of the first day?
        const eDate = cur[cur.length - 1].getDate();
        const bDate = cur[0].getDate();
        const range = eDate - bDate;
        const notWithin7Days = range > 7;
        // ok, but is it in a Saturday - Friday window?
        // d + 1 % 7 ensures Saturday is the start day
        // if the end day is less than the start day,
        // then the end day is in the following window
        const eDay = (cur[cur.length - 1].getDay() + 1) % 7;
        const bDay = (cur[0].getDay() + 1) % 7;
        const notWithinSatFriWindow = (eDay < bDay);
        if (notWithin7Days || notWithinSatFriWindow) {
            // then we know a window is impossible, keep movin
            start++;
        }
        // then we can check the window size
        else if (cur.length === passes) {
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
function decideWeekly4(dates) {
    return decideWeeklyPass(dates, 4);
}
function decideWeekly5(dates) {
    return decideWeeklyPass(dates, 5);
}
function decideWeekly6(dates) {
    return decideWeeklyPass(dates, 6);
}
function decideWeekly7(dates) {
    return decideWeeklyPass(dates, 7);
}
