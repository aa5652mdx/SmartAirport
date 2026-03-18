const bookingForm = document.getElementById("bookingForm");
const bookingButton = document.getElementById("bookingButton");
const departureInput = document.getElementById("departureTime");
const returnInput = document.getElementById("returnTime");
const routeTypeInput = document.getElementById("routeType");

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit"
});

function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value));
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function formatPercentage(value) {
  return `${Number(value).toFixed(1)}%`;
}

function setDateMinimums() {
  const now = new Date();
  const baseLeadHours = routeTypeInput.value === "international" ? 4.25 : 3.25;
  const soonestDeparture = new Date(now.getTime() + baseLeadHours * 60 * 60 * 1000);
  const soonestReturn = new Date(soonestDeparture.getTime() + 8 * 60 * 60 * 1000);

  departureInput.min = soonestDeparture.toISOString().slice(0, 16);
  returnInput.min = soonestReturn.toISOString().slice(0, 16);

  if (!departureInput.value || new Date(departureInput.value) < soonestDeparture) {
    departureInput.value = soonestDeparture.toISOString().slice(0, 16);
  }

  if (!returnInput.value || new Date(returnInput.value) < soonestReturn) {
    returnInput.value = soonestReturn.toISOString().slice(0, 16);
  }
}

function updateReturnMinimum() {
  if (!departureInput.value) {
    return;
  }

  const departureDate = new Date(departureInput.value);
  const minimumReturn = new Date(departureDate.getTime() + 3 * 60 * 60 * 1000);
  const minimumValue = minimumReturn.toISOString().slice(0, 16);
  returnInput.min = minimumValue;

  if (!returnInput.value || new Date(returnInput.value) <= minimumReturn) {
    returnInput.value = minimumValue;
  }
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function renderTimeline(timeline) {
  const chart = document.getElementById("timelineChart");
  chart.innerHTML = "";

  timeline.forEach((point) => {
    const bar = document.createElement("article");
    bar.className = "timeline-bar";
    const height = Math.max(point.occupancyRate, 10);

    bar.innerHTML = `
      <div class="timeline-bar-meter">
        <div class="timeline-bar-fill" style="height: 0%" data-target="${height}"></div>
      </div>
      <div class="timeline-meta">
        <strong>${point.label}</strong>
        <span>${point.congestionLabel}</span>
      </div>
    `;

    chart.appendChild(bar);
  });

  requestAnimationFrame(() => {
    chart.querySelectorAll(".timeline-bar-fill").forEach((fill) => {
      fill.style.height = `${fill.dataset.target}%`;
    });
  });
}

function renderZones(zones) {
  const zoneList = document.getElementById("zoneList");
  zoneList.innerHTML = "";

  zones.forEach((zone) => {
    const item = document.createElement("article");
    item.className = "zone-row";
    item.innerHTML = `
      <div class="zone-row-head">
        <strong>${zone.name}</strong>
        <span>${zone.available} spaces free</span>
      </div>
      <p>${zone.description}</p>
      <div class="meter-track" aria-hidden="true">
        <div class="meter-fill" style="width: 0%" data-target="${zone.utilisation}"></div>
      </div>
    `;
    zoneList.appendChild(item);
  });

  requestAnimationFrame(() => {
    zoneList.querySelectorAll(".meter-fill").forEach((fill) => {
      fill.style.width = `${fill.dataset.target}%`;
    });
  });
}

function renderPeakDays(days) {
  const peakList = document.getElementById("peakList");
  peakList.innerHTML = "";

  days.forEach((day) => {
    const item = document.createElement("article");
    item.className = "peak-row";
    item.innerHTML = `
      <strong>${day.label}</strong>
      <span>Demand score ${day.demandScore} 路 ${formatPercentage(day.utilisationRate)}</span>
    `;
    peakList.appendChild(item);
  });
}

function renderRecentBookings(bookings) {
  const bookingList = document.getElementById("recentBookingList");
  bookingList.innerHTML = "";

  if (bookings.length === 0) {
    bookingList.innerHTML = '<article class="booking-row"><p>No bookings available yet.</p></article>';
    return;
  }

  bookings.forEach((booking) => {
    const item = document.createElement("article");
    item.className = "booking-row";
    item.innerHTML = `
      <div class="booking-row-head">
        <strong>${booking.flightNumber}</strong>
        <small>${booking.terminal} 路 ${booking.zoneName}</small>
      </div>
      <p>
        ${booking.fullName} 路 Slot ${booking.slotCode} 路 Arrival window
        ${formatTime(booking.arrivalWindow.start)} - ${formatTime(booking.arrivalWindow.end)}
      </p>
      <p>Departure ${formatDateTime(booking.departureTime)}</p>
    `;
    bookingList.appendChild(item);
  });
}

function renderInsights(insights) {
  const insightList = document.getElementById("insightList");
  insightList.innerHTML = "";

  insights.forEach((text) => {
    const item = document.createElement("article");
    item.className = "insight-row";
    item.innerHTML = `<p>${text}</p>`;
    insightList.appendChild(item);
  });
}

function renderOverview(data) {
  setText("storageMode", data.storageMode);
  setText("heroCongestion", `${data.stats.congestionLabel} (${data.stats.congestionScore})`);
  setText("heroPeakWindow", data.stats.nextPeakWindow);
  setText("bookingsToday", data.stats.bookingsToday);
  setText("liveOccupancy", formatPercentage(data.stats.liveOccupancy));
  setText("availableSpaces", data.stats.availableSpaces.toLocaleString("en-GB"));
  setText("expectedDelay", `${data.stats.expectedDelayMinutes} mins`);

  renderTimeline(data.timeline);
  renderZones(data.zoneStatus);
  renderPeakDays(data.peakDays);
  renderRecentBookings(data.recentBookings);
  renderInsights(data.insights);
}

function renderBookingResult(payload, hasError = false) {
  const resultStatus = document.getElementById("resultStatus");
  const resultTitle = document.getElementById("resultTitle");
  const resultCopy = document.getElementById("resultCopy");
  const arrivalWindowValue = document.getElementById("arrivalWindowValue");
  const allocationValue = document.getElementById("allocationValue");
  const slotValue = document.getElementById("slotValue");
  const congestionValue = document.getElementById("congestionValue");

  if (hasError) {
    resultStatus.textContent = "Submission issue";
    resultTitle.textContent = "The booking could not be completed.";
    resultCopy.textContent = payload.message;
    arrivalWindowValue.textContent = "--";
    allocationValue.textContent = "--";
    slotValue.textContent = "--";
    congestionValue.textContent = "--";
    return;
  }

  resultStatus.textContent = "Booking confirmed";
  resultTitle.textContent = `${payload.allocation.zoneName} allocated for ${payload.booking.flightNumber}`;
  resultCopy.textContent = `${payload.recommendation.summary} ${payload.allocation.explanation}`;
  arrivalWindowValue.textContent = `${formatDateTime(payload.recommendation.windowStart)} - ${formatTime(
    payload.recommendation.windowEnd
  )}`;
  allocationValue.textContent = payload.allocation.zoneName;
  slotValue.textContent = payload.allocation.slotCode;
  congestionValue.textContent = `${payload.prediction.label} (${payload.prediction.score})`;
}

async function loadOverview() {
  try {
    const response = await fetch("/api/overview");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "The dashboard could not be loaded.");
    }

    renderOverview(data);
  } catch (error) {
    renderInsights([error.message]);
  }
}

async function handleBookingSubmit(event) {
  event.preventDefault();

  bookingButton.disabled = true;
  bookingButton.textContent = "Allocating slot...";

  const formData = new FormData(bookingForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "The booking could not be created.");
    }

    renderBookingResult(data);
    await loadOverview();
  } catch (error) {
    renderBookingResult({ message: error.message }, true);
  } finally {
    bookingButton.disabled = false;
    bookingButton.textContent = "Book parking slot";
  }
}

function initialiseReveals() {
  const revealItems = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15
    }
  );

  revealItems.forEach((item) => observer.observe(item));
}

departureInput.addEventListener("change", updateReturnMinimum);
routeTypeInput.addEventListener("change", () => {
  setDateMinimums();
  updateReturnMinimum();
});
bookingForm.addEventListener("submit", handleBookingSubmit);

setDateMinimums();
updateReturnMinimum();
initialiseReveals();
loadOverview();
script.js