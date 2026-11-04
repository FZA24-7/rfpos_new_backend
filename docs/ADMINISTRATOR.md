# Administrator module

An **Administrator** tab in the main app (tenant users only). A tile appears only for the forms the signed-in user holds `<form>.view` for. Each tile opens its own working screen; **Exit** returns to the menu.

| Form                         | What it does                                                                                                         | Permission prefix     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Security File                | The Security Panel: create/search/edit/delete users and set what each may open (below)                               | `security_file.*`     |
| Update User Location         | Move a user to another active location                                                                               | `user_location.*`     |
| Attribute Locking            | Lock product attributes so they cannot be changed on existing products (enforced in the product service)             | `attribute_locking.*` |
| Close Period for Transaction | Close all dates up to a day; sales, purchases, expenses, payments, stock changes and refunds dated in it are refused | `period_close.*`      |
| Log File                     | Audit trail of the business (date range + search)                                                                    | `log_file.view`       |
| Generate Overhead            | Overhead rate = expenses ÷ net sales × 100 (4 decimals, exact integer maths) for a date range; saved runs            | `overhead.*`          |
| Locations Status             | Activate/deactivate locations (the last active one cannot be deactivated)                                            | `location_status.*`   |
| SMS Log                      | Messages sent by the system. Empty until an SMS gateway is connected (none is in this build)                         | `sms_log.view`        |
| Bank Log                     | Card and bank-transfer receipts (sales) and payments (expenses)                                                      | `bank_log.view`       |
| User Category                | Categories used in the Security File "User Type" list (defaults are created on first open)                           | `user_category.*`     |

## Security Panel

Toolbar: Rights Detail, Search, Add, Edit, Save, Delete, Undo, Print, Exit. **Add** enables the User Details so a new User ID can be created; **Search** lists the business's User IDs; **Exit** closes the panel.

Three permission levels, all saved against the User ID and enforced by the **API** (not just hidden in the screen):

1. **Module access** — the Checks Approval tab. A module that is not ticked is inaccessible, whatever its forms say.
2. **Form / report access** — the Inputs and Reports grids of the selected module. They list only the forms and reports that exist in this software (for example ADMIN has no reports).
3. **Action rights** — Access / Add / Edit / Delete per form. Only rights the form supports are shown. Add, Edit and Delete need Access (ticking them ticks Access).

Nothing is granted unless explicitly ticked. A form that reads another form's data shows a warning if the user lacks Access to it; nothing is granted implicitly. Saving rights ends the user's sessions, so the change applies at their next sign-in.

Where it is defined: `packages/shared/src/admin-registry.ts` (modules → forms/reports → rights → permission keys). Add a new screen there and it appears in the Security File automatically.

## Upgrading an existing system

1. `pnpm db:generate`
2. `pnpm db:migrate:deploy` — adds the migration `20261103120000_administrator`.
3. `pnpm db:seed` — adds the new permissions and gives each business's owner role all of them (other roles are untouched; the step is repeatable).
4. Rebuild/redeploy the API and rebuild the web app / desktop installer. Sign out and in again.

## Known limits

- Users created before this module keep their shared role until they are saved once in the Security File, which gives them their own rights.
- Rights take effect at the user's next sign-in/refresh (access token lifetime ≤ 15 minutes).
- The FBR token is stored without encryption at rest and is never returned by the API (only a masked hint).
- "Get Serial" uses a per-browser/device identifier, not real hardware.
- The Login ID cannot be changed in the Security File (use the existing change-Login-ID flow).
- CSV export of reports still needs `reports.export`, which the Security File does not grant.
- Not verified here: Vercel, Supabase, Windows, the desktop installer, a real browser session.
