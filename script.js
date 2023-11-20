import { calculateOptimalTicket } from './tickets.mjs';

// Function to display the selected optimal ticket in the UI
function displayOptimalTicket(ticketType) {
    const recommendationElement = document.getElementById('ticket-recommendation');
    recommendationElement.textContent = 'Recommended Ticket: ' + ticketType;
}

// Initialize an array to store the selected days
let selectedDates = [];

// Function to update the display of selected days
function updateselectedDatesDisplay() {
    const displayElement = document.getElementById('selected-days');
    if (selectedDates.length > 0) {
        const dayNumbers = selectedDates.map(date => date.getDate());
        displayElement.textContent = 'Selected Days: ' + dayNumbers.join(', ');
    } else {
        displayElement.textContent = 'Selected Days: None';
    }
}

function consolidateRoundTrips(optimalTickets) {
    const ticketCounts = optimalTickets.reduce((counts, ticket) => {
        counts[ticket] = (counts[ticket] || 0) + 1;
        return counts;
    }, {});

    return Object.entries(ticketCounts).map(([ticket, count]) => {
        return count > 1 && ticket === 'Round Trip' ? `${ticket} x${count}` : ticket;
    });
}

// Event listener for DOMContentLoaded to set up the calendar
document.addEventListener('DOMContentLoaded', () => {
    const daysContainer = document.querySelector('.days');
    let currentDate = new Date();
    const endDay = new Date(currentDate);
    endDay.setDate(endDay.getDate() + 30);

    let init = true;

    // Loop to create calendar days
    while (currentDate < endDay) {
        let currentYear = currentDate.getFullYear();
        let currentMonth = currentDate.getMonth();
        if (init) {
            const startDay = currentDate.getDay();
            for (let i = 0; i < startDay; i++) {
                daysContainer.appendChild(document.createElement('span'));
            }
            init = false;
        }

        const span = document.createElement('span');
        span.textContent = currentDate.getDate();

        // Event listener for selecting/deselecting days
        span.addEventListener('click', function() {
            this.classList.toggle('selected');
            const dayNumber = parseInt(this.textContent, 10);
            const selectedDate = new Date(currentYear, currentMonth, dayNumber); // Ensure currentYear and currentMonth are correctly set

            if (this.classList.contains('selected')) {
                selectedDates.push(selectedDate);
            } else {
                selectedDates = selectedDates.filter(date => 
                    date.getDate() !== selectedDate.getDate() || 
                    date.getMonth() !== selectedDate.getMonth() ||
                    date.getFullYear() !== selectedDate.getFullYear());
            }
            
            updateselectedDatesDisplay();
            let optimalTickets = calculateOptimalTicket(selectedDates);
            const consolidatedTickets = consolidateRoundTrips(optimalTickets);
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

        daysContainer.appendChild(span);

        // Add a line break after each week
        if (currentDate.getDay() === 6) {
        daysContainer.appendChild(document.createElement('br'));
        }

        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
});
