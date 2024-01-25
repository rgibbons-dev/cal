import { calculateOptimalTicket, TicketType } from './tickets.js';

/**
 * Function to display the selected optimal ticket in the UI
 * 
 */
function displayOptimalTicket(ticketTypes: TicketType[]) {
    const recommendationElement = document.getElementById('ticket-recommendation');
    if (recommendationElement !== null) {
        recommendationElement.textContent = 'Recommended Ticket: ' + ticketTypes.join(', ');
    }
}

// Initialize an array to store the selected days
let selectedDates: Date[] = [];

// how can I make this type more specific?
// I want 'ticket in Ticket' instead of string,
// but it doesn't play nicely with the reduce function
type ticketCounts = { [ticket: string]: number };

/**
 * Function to update the display of selected days
 */
function consolidateTickets(optimalTickets: TicketType[]) {
    const ticketCounts: ticketCounts = optimalTickets.reduce((counts: ticketCounts, ticket) => {
        counts[ticket] = (counts[ticket] || 0) + 1;
        return counts;
    }, {});

    return Object.entries(ticketCounts).map(([ticket, count]) => {
        if (count > 1) {
            return `${ticket} x${count}`;
        } else {
            return ticket;
        }
    }) as TicketType[];
}

// Event listener for DOMContentLoaded to set up the calendar
document.addEventListener('DOMContentLoaded', () => {
    const daysContainer = document.querySelector('.days');
    let endDay;
    let currentDate = new Date();
    if (currentDate.getDate() <= 14) {
        // If the current day is 14th or earlier, show the next 30 days
        endDay = new Date(currentDate);
        endDay.setDate(endDay.getDate() + 30);
    } else {
        // If the current day is 15th or later, show until the end of the following month
        endDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
    }

    let init = true;

    // Loop to create calendar days
    while (currentDate < endDay) {
        let currentYear = currentDate.getFullYear();
        let currentMonth = currentDate.getMonth();
        if (init) {
            const startDay = currentDate.getDay();
            for (let i = 0; i < startDay; i++) {
                daysContainer?.appendChild(document.createElement('span'));
            }
            init = false;
        }

        const span = document.createElement('span');
        span.textContent = currentDate.getDate().toString();

        // Event listener for selecting/deselecting days
        span.addEventListener('click', function() {
            this.classList.toggle('selected');
            const dayNumber = parseInt(this.textContent || '', 10);
            const selectedDate = new Date(currentYear, currentMonth, dayNumber); // Ensure currentYear and currentMonth are correctly set

            if (this.classList.contains('selected')) {
                selectedDates.push(selectedDate);
            } else {
                selectedDates = selectedDates.filter(date => 
                date.getDate() !== selectedDate.getDate() || 
                date.getMonth() !== selectedDate.getMonth() ||
                date.getFullYear() !== selectedDate.getFullYear());
            }

            let optimalTickets = calculateOptimalTicket(selectedDates);
            const consolidatedTickets = consolidateTickets(optimalTickets);
            displayOptimalTicket(consolidatedTickets);
        });

        // Highlight today's date
        if (currentDate.toDateString() === new Date().toDateString()) {
        span.classList.add('today');
        }

        // Highlight weekends
        if (currentDate.getDay() === 6 || currentDate.getDay() === 0) {
        span.classList.add('weekend');
        }

        daysContainer?.appendChild(span);

        // Add a line break after each week
        if (currentDate.getDay() === 6) {
        daysContainer?.appendChild(document.createElement('br'));
        }

        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
});
