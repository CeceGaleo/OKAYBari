// ---- Navbar scroll ----
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });

    // ---- Hamburger menu ----
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        document.body.style.overflow = '';
      });
    });

    // ---- Menu tabs ----
    function switchTab(btn, id) {
      document.querySelectorAll('.menu-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.menu-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(id);
      if (panel) panel.classList.add('active');
    }

    // ---- Reveal on scroll ----
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // ---- Ticker: duplicate content for truly seamless loop ----
    // Already duplicated in HTML; animation handles loop via 50% translateX

    // ---- Booking form ----
    function todayLocalDate() {
      const date = new Date();
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      return date.toISOString().slice(0, 10);
    }

    const bookingForm = document.getElementById('booking-form');
    const bookingDate = document.getElementById('booking-date');
    const bookingStatus = document.getElementById('booking-status');

    if (bookingDate) {
      bookingDate.min = todayLocalDate();
      bookingDate.value = bookingDate.min;
    }

    if (bookingForm && bookingStatus) {
      bookingForm.addEventListener('submit', async event => {
        event.preventDefault();

        const button = bookingForm.querySelector('button[type="submit"]');
        const payload = Object.fromEntries(new FormData(bookingForm).entries());
        payload.people_count = Number(payload.people_count);

        bookingStatus.className = 'booking-status';
        bookingStatus.textContent = '';
        button.disabled = true;
        button.textContent = 'Invio in corso';

        try {
          const response = await fetch('/api/reservations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error?.message || 'Prenotazione non inviata');
          }

          bookingForm.reset();
          if (bookingDate) bookingDate.value = bookingDate.min;
          bookingStatus.classList.add('success');
          bookingStatus.textContent = 'Prenotazione ricevuta. Ti ricontatteremo per conferma.';
        } catch (error) {
          bookingStatus.classList.add('error');
          bookingStatus.textContent = error.message;
        } finally {
          button.disabled = false;
          button.textContent = 'Invia prenotazione';
        }
      });
    }
