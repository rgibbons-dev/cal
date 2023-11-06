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

        if (currentDate.toDateString() === new Date().toDateString()) {
            span.classList.add('today');
        }

        daysContainer.appendChild(span);

        const br = document.createElement('br');
        if(currentDate.getDay() === 6) {
          daysContainer.appendChild(br);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
});

