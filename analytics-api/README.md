# Analytics ingest API (PHP)

Tracked **templates** live in `templates/php/`. The **live** copy on your server (with `config.php` containing the database password) should live in a directory that is **gitignored** in this repo (`analytics-api/php/`), so credentials and your deployed files are never pushed.

## 1. SQL — create tables

Run the script (phpMyAdmin “SQL” tab, or `mysql` CLI):

**`db/analytics_init.sql`**

It runs `USE analytics;` and `CREATE TABLE page_visits ...`. Commented at the bottom: grant **INSERT** only on `page_visits` for `app_logger` (set the password in your hosting panel; do not put passwords in `.sql` files or Git).

## 2. Server database config (required — without this, the table stays empty)

The API **will not insert rows** until PHP can read credentials. Choose **one** layout:

**A. Same folder as `visit.php` (simplest)**  
`Apps/data/api/config.php`

**B. One level above `/api/` (slightly safer — not inside the public script folder)**  
`Apps/data/analytics-config.php`  
(sibling of the `api` folder)

Steps:

1. Copy `templates/php/config.example.php` to the chosen path as `config.php` or `analytics-config.php` as above.
2. Set `'pass'` and check `'dsn'` (`dbname=analytics`, host often `127.0.0.1` or `localhost` on shared hosting).
3. **Verify:** `curl -sS -X POST 'https://YOURDOMAIN/Apps/data/api/visit.php' -H 'Content-Type: application/json' -d '{"pageUrl":"https://test.com"}'` must return `{"ok":true,"id":"…"}`. If you see `"Server not configured"`, the config file is still missing or unreadable.

If this password was ever pasted into chat or a ticket, **rotate it** in the panel and update the config file only on the server.

## 3. Deploy files to `https://noyanov.com/Apps/data/api/`

From `analytics-api/templates/php/` copy to your host:

- `visit.php`
- `.htaccess` (optional if your host sets CORS elsewhere; PHP already sends CORS headers)

Plus **`config.php`** created on the server (not from a committed file with a real password).

Public URL should match what the frontend uses, e.g.  
`https://noyanov.com/Apps/data/api/visit.php`  

**PHP 7.4:** The ingest script must not use `catch (Throwable)` without a variable (that needs PHP 8+). This repo’s `visit.php` is PHP 7.4–compatible.

**Verify the live script:**

1. Upload **`ping.php`** and open `https://…/api/ping.php` — you should see JSON with `service` and `php` version.
2. `curl -sS -X POST 'https://…/api/visit.php' -H 'Content-Type: application/json' -d '{"pageUrl":"https://example.com/test"}'` should return `{"ok":true,"id":"…"}` or a JSON error. **Empty body + `text/html`** means the PHP file is missing, empty, or has a **parse error** (fix PHP version / re-upload).

**Optional:** upload **`ingest.php`** (copy of `visit.php`) and point the app to `…/ingest.php` if `visit.php` is stuck or cached wrong on the host.

**Debug in the browser:** add `?analytics_debug=1` to the telemetry page URL and open DevTools → Console; you will see `[analytics]` status and body for each POST.

## 4. Optional hardening

- Set `'ingest_token'` in `config.php` to a long random string and set `window.__ARTEMIS_ANALYTICS_TOKEN__` in a **deploy-only** inline script before `app.js` loads (do not commit the token).
- Tighten CORS: replace `Access-Control-Allow-Origin: *` with your real app origin in `.htaccess` or PHP.
- MySQL user `app_logger`: only **INSERT** on `analytics.page_visits` (see SQL comments).

## 5. Frontend

`public/analytics-client.js` posts one event per load. Override URL with `?analytics_endpoint=` or set `window.__ARTEMIS_ANALYTICS_URL__` before the module runs (recommended for deploy-specific URLs without editing tracked JS).

## Privacy

IPs and client metadata may be personal data; add notice/consent and retention where required.
