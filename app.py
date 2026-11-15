import http.server
import socketserver
import json
import csv
import os
import sqlite3
import hashlib

PORT = 8000
DB_FILE = os.path.join(os.path.dirname(__file__), "users.db")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT
        )
    """)
    conn.commit()
    conn.close()

def hash_pw(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

def load_data():
    routes = {}
    r_path = os.path.join(os.path.dirname(__file__), "data", "routes.csv")
    with open(r_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            routes[row["route"]] = {
                "route": row["route"],
                "name": row["name"],
                "base_price": float(row["base_price"]),
                "cost_per_passenger": float(row["cost_per_passenger"]),
                "price_sensitivity": float(row["price_sensitivity"]),
                "price_min": float(row["price_min"]),
                "price_max": float(row["price_max"])
            }

    forecast = {}
    f_path = os.path.join(os.path.dirname(__file__), "data", "seasonal_forecast.csv")
    with open(f_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = (row["route"], row["date"])
            forecast[key] = row

    return routes, forecast

ROUTES, FORECAST = load_data()

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/api/routes":
            self.send_json(200, list(ROUTES.values()))
            return

        if self.path.startswith("/api/dates"):
            from urllib.parse import parse_qs, urlparse
            query = parse_qs(urlparse(self.path).query)
            route = query.get("route", [""])[0]
            dates = sorted(list(set(d for r, d in FORECAST.keys() if r == route)))
            self.send_json(200, dates)
            return

        return super().do_GET()

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len).decode("utf-8")
        data = json.loads(body) if body else {}

        if self.path == "/api/register":
            username = data.get("username", "").strip()
            password = data.get("password", "").strip()
            if not username or not password:
                self.send_json(400, {"error": "Заполните логин и пароль"})
                return

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            try:
                c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, hash_pw(password)))
                conn.commit()
                self.send_json(200, {"status": "ok", "username": username})
            except sqlite3.IntegrityError:
                self.send_json(400, {"error": "Пользователь уже существует"})
            finally:
                conn.close()
            return

        if self.path == "/api/login":
            username = data.get("username", "").strip()
            password = data.get("password", "").strip()
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE username = ? AND password_hash = ?", (username, hash_pw(password)))
            row = c.fetchone()
            conn.close()
            if row:
                self.send_json(200, {"status": "ok", "username": username})
            else:
                self.send_json(401, {"error": "Неверный логин или пароль"})
            return

        if self.path == "/api/calculate":
            route = data.get("route")
            date = data.get("date")
            try:
                price = float(data.get("price"))
            except (ValueError, TypeError):
                self.send_json(400, {"error": "Некорректная цена"})
                return

            if route not in ROUTES:
                self.send_json(404, {"error": "Маршрут не найден"})
                return

            key = (route, date)
            if key not in FORECAST:
                self.send_json(404, {"error": "Рейс на указанную дату не найден"})
                return

            r_info = ROUTES[route]
            f_info = FORECAST[key]

            seats = float(f_info["seats"])
            base_p = r_info["base_price"]
            sens = r_info["price_sensitivity"]
            cost = r_info["cost_per_passenger"]

            quantiles = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]
            q_results = []
            for q in quantiles:
                base_d = float(f_info[f"{q}_base_demand"])
                q_desired = max(0.0, base_d - sens * (price - base_p))
                q_sold = min(seats, q_desired)
                q_price_opt = float(f_info[f"{q}_price"])
                q_results.append({
                    "quantile": q,
                    "base_demand": round(base_d),
                    "desired": round(q_desired),
                    "sold": round(q_sold),
                    "optimal_price": round(q_price_opt)
                })

            med_base_d = float(f_info["0.5_base_demand"])
            desired = max(0.0, med_base_d - sens * (price - base_p))
            sold = min(seats, desired)
            revenue = sold * price
            profit = (price - cost) * sold
            load_factor = (sold / seats) * 100 if seats > 0 else 0

            response = {
                "route": route,
                "name": r_info["name"],
                "date": date,
                "seats": round(seats),
                "price": round(price),
                "base_price": round(base_p),
                "cost_per_passenger": round(cost),
                "desired": round(desired),
                "sold": round(sold),
                "revenue": round(revenue),
                "profit": round(profit),
                "load_factor": round(load_factor, 1),
                "price_min": r_info["price_min"],
                "price_max": r_info["price_max"],
                "quantiles": q_results
            }
            self.send_json(200, response)
            return

        self.send_json(404, {"error": "Not found"})

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    init_db()
    with socketserver.TCPServer(("", PORT), RequestHandler) as httpd:
        print(f"Сервер запущен: http://localhost:{PORT}")
        httpd.serve_forever()
