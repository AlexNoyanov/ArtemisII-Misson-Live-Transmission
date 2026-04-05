/**
 * Optional deploy-only file: copy to analytics-endpoint.local.js (gitignored).
 * Load before app.js in index.html if you use this pattern:
 *   <script src="analytics-endpoint.local.js"></script>
 *   <script src="app.js" type="module"></script>
 *
 * Or set the same variables in an inline script on the server only (do not commit secrets).
 */
window.__ARTEMIS_ANALYTICS_URL__ = "https://noyanov.com/Apps/data/api/visit.php";
// window.__ARTEMIS_ANALYTICS_TOKEN__ = "long-random-token-if-ingest_token-is-set-in-config.php";
