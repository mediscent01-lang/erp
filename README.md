# MEDISCENT ERP — verified safety fixes (4.3)

Static GitHub Pages ERP. These changes are a tested source candidate; they have not been deployed to the live site.

## Local verification

Requires Node.js 20 or newer.

```sh
npm ci
npm run check
npm test
TZ=Asia/Seoul node --test tests/core.test.cjs
```

Tests load the actual HTML and scripts in jsdom with synthetic records and mocked authentication, CDN resources, and backend responses. They never write to Supabase. They cover production quantities/cost, QC gates, formula approval/snapshots, sale/return isolation, concurrent saves, failed saves, login/session failures, and destructive-operation guards. They do not replace real browser, real authentication, printing, or production database acceptance testing.

## Deployment

Use the entire source tree, including both new scripts `erp-core.js` and `erp-runtime.js`. Do not replace only `index.html`. Publish through the existing repository's GitHub Pages process after backup, access-policy review, and staging acceptance.

Do not import test fixtures into production. Do not overwrite `erp_data` manually with a downloaded JSON file.

## Changes in this candidate

- One conditional cloud-save engine with server-version checking. No force-overwrite action.
- No login-before-load writes, default-stock generation, or stale-cache auto upload.
- Shortage preflight and QC/expiry gates in main production and quick-record flows.
- Canonical raw-material stock/cost units in g and currency/g for goods receipt.
- Approved formula selection, immutable approved records, and production BOM snapshots.
- Return lots quarantined pending inspection; original good stock stays separate.
- Direct LOT editing cannot bypass QC, quantity adjustment, or stock transfer.
- Destructive full reset/wipe disabled in operational UI.
- Explicit weight/volume dilution bases and density requirements.

## Known release blockers

- Existing duplicate finished-goods IDs must be reviewed against locations and historical references. Affected operations fail closed; this patch does not rewrite IDs.
- Current backend policies allow every authenticated user to read/write all rows. UI guards are not server-side authorization. Decide admin/production/QC/warehouse/sales roles, then enforce them in server policies/functions.
- Data remains one JSON document. Move inventory postings, approval transitions, immutable audit records, and backups to server transactions for a full production ERP.
- Work-order result reporting is not yet an enforced one-to-one link to stock posting. Spreadsheet imports, purchasing, stock counts, invoice/payment reconciliation, browser layouts, and print forms require further acceptance tests.
