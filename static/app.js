let db = { routes: {}, forecast: {} };
let currentChart = null;
let authTab = "login";

window.addEventListener("DOMContentLoaded", () => {
    initAuthGate();
    loadApplicationData();
});

function initAuthGate() {
    const user = sessionStorage.getItem("app_user");
    const modal = document.getElementById("gateModal");
    if (!user) {
        modal.classList.remove("hidden");
    } else {
        modal.classList.add("hidden");
        document.getElementById("userBadge").innerText = user;
    }
}

function openAuthModal() {
    document.getElementById("gateModal").classList.remove("hidden");
}

function switchAuthTab(tab) {
    authTab = tab;
    document.getElementById("tabLogin").classList.toggle("active", tab === "login");
    document.getElementById("tabRegister").classList.toggle("active", tab === "register");
    document.getElementById("authSubmitBtn").innerText = tab === "login" ? "Войти в систему" : "Зарегистрироваться";
    document.getElementById("authMsg").innerText = "";
}

function handleAuthSubmit() {
    const u = document.getElementById("authUsername").value.trim();
    const p = document.getElementById("authPassword").value.trim();
    const msg = document.getElementById("authMsg");

    if (!u || !p) {
        msg.innerText = "Введите логин и пароль";
        return;
    }

    fetch(authTab === "login" ? "/api/login" : "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
    })
    .then(r => r.json().then(data => ({ status: r.status, data })))
    .then(res => {
        if (res.status === 200) {
            completeLogin(res.data.username);
        } else {
            msg.innerText = res.data.error || "Ошибка авторизации";
        }
    })
    .catch(() => {
        completeLogin(u);
    });
}

function continueAsGuest() {
    completeLogin("Гость");
}

function completeLogin(name) {
    sessionStorage.setItem("app_user", name);
    document.getElementById("userBadge").innerText = name;
    document.getElementById("gateModal").classList.add("hidden");
}

function loadApplicationData() {
    fetch("dataset.json")
        .then(r => r.json())
        .then(bundle => {
            bundle.routes.forEach(r => {
                db.routes[r.route] = r;
            });
            db.forecast = bundle.forecast;
            populateRoutes();
        })
        .catch(() => {
            fetch("/api/routes")
                .then(r => r.json())
                .then(routes => {
                    routes.forEach(r => { db.routes[r.route] = r; });
                    populateRoutes();
                });
        });
}

function populateRoutes() {
    const sel = document.getElementById("routeSelect");
    sel.innerHTML = "";
    Object.values(db.routes).forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.route;
        opt.innerText = `${r.name} (${r.route})`;
        sel.appendChild(opt);
    });
    onRouteChanged();
}

function onRouteChanged() {
    const rKey = document.getElementById("routeSelect").value;
    const r = db.routes[rKey];
    if (!r) return;

    document.getElementById("rBasePrice").innerText = r.base_price.toLocaleString("ru-RU") + " ₽";
    document.getElementById("rCost").innerText = r.cost_per_passenger.toLocaleString("ru-RU") + " ₽";
    document.getElementById("rSens").innerText = r.price_sensitivity;

    const input = document.getElementById("priceInput");
    const slider = document.getElementById("priceSlider");

    input.min = r.price_min;
    input.max = r.price_max;
    slider.min = r.price_min;
    slider.max = r.price_max;

    input.value = r.base_price;
    slider.value = r.base_price;

    document.getElementById("priceDisplay").innerText = r.base_price.toLocaleString("ru-RU") + " ₽";
    document.getElementById("minPriceLbl").innerText = r.price_min.toLocaleString("ru-RU") + " ₽";
    document.getElementById("basePriceLbl").innerText = "Базовая: " + r.base_price.toLocaleString("ru-RU") + " ₽";
    document.getElementById("maxPriceLbl").innerText = r.price_max.toLocaleString("ru-RU") + " ₽";

    calculate();
}

function onPriceTyped() {
    const val = Number(document.getElementById("priceInput").value);
    document.getElementById("priceSlider").value = val;
    document.getElementById("priceDisplay").innerText = val.toLocaleString("ru-RU") + " ₽";
    calculate();
}

function onPriceSlid() {
    const val = Number(document.getElementById("priceSlider").value);
    document.getElementById("priceInput").value = val;
    document.getElementById("priceDisplay").innerText = val.toLocaleString("ru-RU") + " ₽";
    calculate();
}

function calculate() {
    const route = document.getElementById("routeSelect").value;
    const date = document.getElementById("dateInput").value;
    const price = Number(document.getElementById("priceInput").value);
    const rInfo = db.routes[route];
    if (!rInfo || !date || isNaN(price)) return;

    const fKey = `${route}_${date}`;
    const fInfo = db.forecast[fKey];
    if (!fInfo) return;

    const seats = Number(fInfo.seats);
    const baseP = rInfo.base_price;
    const sens = rInfo.price_sensitivity;
    const cost = rInfo.cost_per_passenger;

    const quantiles = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"];
    const qList = [];

    quantiles.forEach(q => {
        const baseD = Number(fInfo[`${q}_base_demand`]);
        const desired = Math.max(0, baseD - sens * (price - baseP));
        const sold = Math.min(seats, desired);
        const optPrice = Number(fInfo[`${q}_price`]);
        qList.push({
            quantile: q,
            base_demand: Math.round(baseD),
            desired: Math.round(desired),
            sold: Math.round(sold),
            optimal_price: Math.round(optPrice)
        });
    });

    const medBase = Number(fInfo["0.5_base_demand"]);
    const medDesired = Math.max(0, medBase - sens * (price - baseP));
    const medSold = Math.min(seats, medDesired);
    const revenue = medSold * price;
    const profit = (price - cost) * medSold;
    const loadFactor = seats > 0 ? (medSold / seats) * 100 : 0;
    const optMedPrice = Number(fInfo["0.5_price"]);

    document.getElementById("rSeats").innerText = seats + " мест";
    document.getElementById("kpiDesired").innerText = Math.round(medDesired);
    document.getElementById("kpiBaseComp").innerText = "при базовой: " + Math.round(medBase);
    document.getElementById("kpiSold").innerText = Math.round(medSold);
    document.getElementById("kpiLoad").innerText = loadFactor.toFixed(1) + "%";
    document.getElementById("kpiRev").innerText = Math.round(revenue).toLocaleString("ru-RU") + " ₽";
    document.getElementById("kpiProfit").innerText = Math.round(profit).toLocaleString("ru-RU") + " ₽";
    document.getElementById("optPriceBadge").innerText = "Оптимум медианы: " + optMedPrice.toLocaleString("ru-RU") + " ₽";

    renderChart(qList, seats);
    renderTable(qList);
}

function renderChart(qList, seats) {
    const ctx = document.getElementById("demandChart").getContext("2d");
    const labels = qList.map(q => q.quantile);
    const desiredData = qList.map(q => q.desired);
    const soldData = qList.map(q => q.sold);
    const seatsLine = qList.map(() => seats);

    if (currentChart) {
        currentChart.destroy();
    }

    currentChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Спрос при введённой цене",
                    data: desiredData,
                    backgroundColor: "rgba(144, 202, 249, 0.4)",
                    borderColor: "#90caf9",
                    borderWidth: 1,
                    borderRadius: 2
                },
                {
                    label: "Фактические продажи (до лимита мест)",
                    data: soldData,
                    backgroundColor: "rgba(144, 202, 249, 0.9)",
                    borderColor: "#64b5f6",
                    borderWidth: 1,
                    borderRadius: 2
                },
                {
                    type: "line",
                    label: `Вместимость ВС (${seats} мест)`,
                    data: seatsLine,
                    borderColor: "#ef5350",
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 180 },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#9e9e9e" },
                    title: { display: true, text: "Квантили вероятности", color: "#757575", font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#9e9e9e" },
                    title: { display: true, text: "Количество пассажиров", color: "#757575", font: { size: 10 } }
                }
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#e0e0e0", font: { size: 11 }, boxWidth: 12 }
                }
            }
        }
    });
}

function renderTable(qList) {
    const tbody = document.querySelector("#quantilesTable tbody");
    tbody.innerHTML = "";
    qList.forEach(q => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><b>${q.quantile}</b></td>
            <td class="num">${q.base_demand}</td>
            <td class="num">${q.desired}</td>
            <td class="num" style="color:var(--color-primary); font-weight:600;">${q.sold}</td>
            <td class="num" style="color:var(--color-accent);">${q.optimal_price.toLocaleString("ru-RU")} ₽</td>
        `;
        tbody.appendChild(tr);
    });
}
