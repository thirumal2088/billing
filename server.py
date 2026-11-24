"""Rainbow Sports shared billing server. Run behind an HTTPS reverse proxy."""
import argparse
import base64
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import uuid

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get("RAINBOW_DB", ROOT / "billing.sqlite3"))
ACCOUNTS = {}
MAX_REQUEST = 8 * 1024 * 1024


class Conflict(Exception):
    pass


def connect():
    return sqlite3.connect(DB, timeout=15)


def setup():
    with closing(connect()) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS bills (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS metadata (revision INTEGER NOT NULL)")
        db.execute("INSERT INTO metadata SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM metadata)")


def snapshot(db):
    return {
        "revision": db.execute("SELECT revision FROM metadata").fetchone()[0],
        "bills": [
            dict(json.loads(body), sequence=number, version=version)
            for number, version, body in db.execute(
                "SELECT sequence, version, body FROM bills ORDER BY sequence"
            )
        ],
    }


def validate(bill):
    if str(uuid.UUID(bill["id"])) != bill["id"]:
        raise ValueError("Invalid bill ID")
    if bill["type"] not in ("order", "direct"):
        raise ValueError("Invalid bill type")
    if not isinstance(bill["items"], list) or not isinstance(bill["payments"], list):
        raise ValueError("Invalid items or payments")


INDIA_TIME = timezone(timedelta(hours=5, minutes=30))
MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def next_invoice_number(db, now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(INDIA_TIME)
    prefix = f"INV-{MONTHS[local.month - 1]}-{local.year % 100:02d}-"
    latest = db.execute(
        """SELECT max(CAST(substr(invoice, ?) AS INTEGER))
           FROM (SELECT json_extract(body, '$.no') AS invoice FROM bills)
           WHERE invoice LIKE ?""",
        (len(prefix) + 1, prefix + "%"),
    ).fetchone()[0]
    return f"{prefix}{(latest or 0) + 1:04d}"


def validate_receipts(payments, previous):
    if payments[:len(previous)] != previous:
        raise ValueError("Existing payment receipts must be retained")
    seen = {entry.get("receiptId") for entry in previous}
    groups = {}
    for entry in payments[len(previous):]:
        receipt_id = entry["receiptId"]
        if receipt_id in seen or str(uuid.UUID(receipt_id)) != receipt_id:
            raise ValueError("Invalid receipt ID")
        payer = entry["payer"].strip()
        if not payer or len(payer) > 120:
            raise ValueError("Enter the name of the person who paid")
        date = entry["date"]
        if datetime.fromisoformat(date.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("Invalid payment date")
        details = (payer, date)
        if groups.setdefault(receipt_id, details) != details:
            raise ValueError("Entries on a receipt must share a payer and date")


def save(changes, importing=False):
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        changed = False
        for change in changes:
            bill = dict(change["bill"])
            validate(bill)
            bill.pop("sequence", None)
            bill.pop("version", None)
            existing = db.execute(
                "SELECT version, body FROM bills WHERE id=?", (bill["id"],)
            ).fetchone()
            version = change["version"]
            if existing and version is None:
                # Retrying a create with the same ID must keep its original number.
                continue
            previous = {}
            if existing:
                if version != existing[0]:
                    raise Conflict("Another staff member updated this bill. Reopen it and retry.")
                previous = json.loads(existing[1])
                bill["no"] = previous["no"]
                bill["type"] = previous["type"]
            elif version is not None:
                raise Conflict("This bill is no longer available.")
            if not importing:
                validate_receipts(bill["payments"], previous.get("payments", []))
            rack = bill.get("rackNo")
            if rack and bill.get("status") == "Ready in Rack":
                for (body,) in db.execute("SELECT body FROM bills WHERE id<>?", (bill["id"],)):
                    other = json.loads(body)
                    if other.get("status") == "Ready in Rack" and str(other.get("rackNo")) == str(rack):
                        raise Conflict("This rack is already occupied. Choose another rack.")
            if existing:
                db.execute(
                    "UPDATE bills SET version=version+1, body=? WHERE id=?",
                    (json.dumps(bill), bill["id"]),
                )
            else:
                db.execute(
                    "INSERT INTO bills (id, version, body) VALUES (?,1,'{}')",
                    (bill["id"],),
                )
                if not importing:
                    bill["no"] = next_invoice_number(db)
                db.execute("UPDATE bills SET body=? WHERE id=?", (json.dumps(bill), bill["id"]))
            changed = True
        if importing and changed:
            legacy_numbers = [
                bill["no"].split("-")[-1]
                for bill in snapshot(db)["bills"]
                if bill["no"].startswith("RS-")
            ]
            floor = max((int(n) for n in legacy_numbers if n.isdecimal()), default=0)
            db.execute("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='bills'", (floor,))
        if changed:
            db.execute("UPDATE metadata SET revision=revision+1")
        return snapshot(db)


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        try:
            scheme, token = self.headers.get("Authorization", "").split(" ", 1)
            if scheme.lower() != "basic":
                return False
            user, password = base64.b64decode(token, validate=True).decode().split(":", 1)
            return user in ACCOUNTS and hmac.compare_digest(
                password.encode(), ACCOUNTS[user].encode()
            )
        except (ValueError, UnicodeError):
            return False

    def reply(self, status, content, content_type="application/json"):
        self.send_response(status)
        if status == 401:
            self.send_header("WWW-Authenticate", 'Basic realm="Rainbow Sports Billing", charset="UTF-8"')
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def json_reply(self, status, data):
        self.reply(status, json.dumps(data).encode())

    def do_GET(self):
        if not self.authorized():
            return self.json_reply(401, {"error": "Staff login required"})
        if self.path == "/api/bills":
            with closing(connect()) as db:
                db.execute("BEGIN")
                return self.json_reply(200, snapshot(db))
        if self.path in ("/", "/index.html"):
            return self.reply(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        qr = ROOT / "assets/bharatpe-fixed-qr.png"
        if self.path == "/assets/bharatpe-fixed-qr.png" and qr.is_file():
            return self.reply(200, qr.read_bytes(), "image/png")
        self.json_reply(404, {"error": "Page not found"})

    def do_POST(self):
        if not self.authorized():
            return self.json_reply(401, {"error": "Staff login required"})
        if self.path != "/api/bills":
            return self.json_reply(404, {"error": "Page not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < size <= MAX_REQUEST:
                raise ValueError
            changes = json.loads(self.rfile.read(size))["changes"]
            if not isinstance(changes, list):
                raise ValueError
            return self.json_reply(200, save(changes))
        except Conflict as error:
            self.json_reply(409, {"error": str(error)})
        except (ValueError, KeyError, TypeError, AttributeError):
            self.json_reply(400, {"error": "Invalid bill data"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--import-backup", type=Path)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    options = parser.parse_args()
    setup()
    if options.import_backup:
        old = json.loads(options.import_backup.read_text(encoding="utf-8-sig"))["bills"]
        result = save([{"bill": bill, "version": None} for bill in old], importing=True)
        print(f"{len(result['bills'])} bills in shared history.")
    else:
        ACCOUNTS = json.loads(os.environ.get("RAINBOW_STAFF", "{}"))
        if not isinstance(ACCOUNTS, dict) or not ACCOUNTS or any(
            not user or ":" in user or not isinstance(password, str) or not password
            for user, password in ACCOUNTS.items()
        ):
            parser.error("Set RAINBOW_STAFF to a JSON object of staff usernames and passwords.")
        ThreadingHTTPServer((options.bind, options.port), Handler).serve_forever()
