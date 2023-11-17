const ticketOptions = [
  { type: 'Round Trip', price: 10, period: 1 },
  { type: 'Weekly Pass', price: 43.50, period: 7 },
  { type: 'Flex Pass', price: 80, period: 30 },
];

function calculateOptimalTicket(selectedDays) {
  let minCost = Infinity;
  let optimalTicket = null;

  for (let ticket of ticketOptions) {
      let requiredTickets = Math.ceil(selectedDays.length / ticket.period);
      let totalCost = requiredTickets * ticket.price;

      if (totalCost < minCost) {
          minCost = totalCost;
          optimalTicket = ticket.type;
      }
  }

  return optimalTicket;
}

function displayOptimalTicket(ticketType) {
  const recommendationElement = document.getElementById('ticket-recommendation');
  recommendationElement.textContent = 'Recommended Ticket: ' + ticketType;
}

const selectedDays = [];

function updateSelectedDaysDisplay() {
  const displayElement = document.getElementById('selected-days');
  if (selectedDays.length > 0) {
    displayElement.textContent = 'Selected Days: ' + selectedDays.join(', ');
  } else {
    displayElement.textContent = 'Selected Days: None';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const daysContainer = document.querySelector('.days');
  let currentDate = new Date();
  const endDay = new Date(currentDate);
  endDay.setDate(endDay.getDate() + 30);

  init = true;

  while(currentDate < endDay) {
    if(init) {
      const startDay = currentDate.getDay();
      for(let i = 0; i < startDay; i++) {
        const span = document.createElement('span');
        daysContainer.appendChild(span);
      }
      init = false;
    }

    const span = document.createElement('span');
    span.textContent = currentDate.getDate();

    span.addEventListener('click', function() {
      this.classList.toggle('selected');

      const dayNumber = parseInt(this.textContent, 10);

      if (this.classList.contains('selected')) {
        selectedDays.push(dayNumber);
      } else {
        selectedDays = selectedDays.filter(day => day !== dayNumber);
      }
      
      updateSelectedDaysDisplay();
      let optimalTicket = calculateOptimalTicket(selectedDays);
      displayOptimalTicket(optimalTicket);
    });

    if (currentDate.toDateString() === new Date().toDateString()) {
      span.classList.add('today');
    }

    if(currentDate.getDay() === 6 || currentDate.getDay() === 0) {
      span.classList.add('weekend');
    }

    daysContainer.appendChild(span);

    const br = document.createElement('br');
    if(currentDate.getDay() === 6) {
      daysContainer.appendChild(br);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
});

