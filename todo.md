# Plan: Orderly POS Admin UI (Yellow Theme + Orderly Branding)

## Summary
Implement the admin dashboard shell and dashboard page based on the provided Blink-style designs. Replace all purple accents with brand yellow `#FACC15`, and replace Blink branding with Orderly logo and name. The admin scope is dashboard + shell only, with stub pages for nav routes.

## Design Analysis (from images + ZIP)
- Layout: Left sidebar navigation, topbar with timezone/branch/search/profile, main content with cards and charts.
- Visuals: White/light gray surfaces, soft shadows, rounded cards, purple accent on active nav and buttons.
- Tables: Clean grid lines and light headers.
- Branding: Replace Blink logo/text with Orderly logo and name.
- Backgrounds: Use `pos_bg/*.png` as optional hero/cover/banner backgrounds.

## Implementation Steps
1. Create brand tokens in Tailwind.
   - `brandYellow: #FACC15`
   - `brandYellowDark: #EAB308`
   - Neutrals: `#111827`, `#6B7280`, `#F8FAFC`, `#FFFFFF`
   - Add card shadows and border radius utilities.
2. Add branding assets.
   - Use `frontend/src/assets/orderly-logo.png`.
   - Create reusable `Logo` component.
3. Build admin shell.
   - Create `AdminLayout` with sidebar + topbar + content area.
4. Sidebar navigation.
   - Items: Dashboard, Orders, Products Catalogue, Discounts, Customers, SMS Campaigns, Reporting, Settings.
   - Active state uses yellow background + dark text.
5. Topbar.
   - Left: timezone pill (UTC +05:00 Asia/Karachi).
   - Center: branch selector.
   - Right: search input, user badge, small logo.
6. Dashboard page (static).
   - Summary cards row (orders/sales/etc).
   - Charts section with placeholders.
   - Table section with sample rows.
7. Stub pages.
   - Simple header + “Coming soon” for Orders, Products, Discounts, Customers, SMS, Reporting, Settings.
8. Replace purple across UI.
   - Buttons, nav, highlights, chart accents use yellow.
9. Route wiring.
   - Wrap admin routes with `AdminLayout`.
   - `/home` maps to dashboard.
10. Visual QA.
   - Check responsive breakpoints (sm, md, lg).
   - Confirm yellow accents, Orderly branding, clean light surfaces.

## Interfaces / Public API Changes
- `/home` → Admin Dashboard (Orderly theme).
- New routes for Orders, Products, Discounts, Customers, SMS, Reporting, Settings.
- New components: `AdminLayout`, `Sidebar`, `Topbar`, `Logo`.

## Tests / QA Scenarios
1. Visual check for yellow replacements (no purple).
2. Orderly logo in sidebar and topbar.
3. Dashboard layout matches reference structure.
4. Responsive layout at 640px, 768px, 1024px.
5. No console errors.

## Assumptions
- Primary brand color is `#FACC15`.
- Logo asset exists at `frontend/src/assets/orderly-logo.png`.
- Dashboard is static for now (no API wiring).
