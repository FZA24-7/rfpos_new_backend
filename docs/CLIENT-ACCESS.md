# Client (brand) access and the opening splash

## What a "client" is

A client is one business using the software, for example **MTJ** or **J.**. Every client has a fixed **client code** (1-20 characters: letters, numbers, dot, dash; created by the Master Admin when the client is created) and a name. Each client's staff are created in that client's **Security File**.

## Sign-in

The sign-in screen has three fields: **Client**, **Login ID**, **Password**.

- The Client field is remembered on that computer, and the client code and name are shown in large letters above the form and on the opening splash (like the "MTJ" in the reference).
- The server finds the client from the **account**, never from the screen. If a client code is typed, the account must belong to exactly that client; otherwise the answer is the same "Invalid Login ID or password" as for a wrong password, so nothing reveals which clients or Login IDs exist.
- Leaving Client empty still works (needed for the platform Master Admin, who belongs to no client).
- After sign-in the header shows the client name and code, and the client is remembered for next time.

## How isolation is enforced (server and database, not screens)

1. **Server:** the client of a request comes only from the signed-in user's verified token, never from anything the browser sends. Every tenant route requires that tenant and every query filters by it. Another client's record is answered "not found" (read, change, delete).
2. **Database:** every business table carries a client id. Links between rows use composite foreign keys on (id, client id), so PostgreSQL itself refuses a row of client B that points at a record of client A. Login IDs and client codes are unique across the whole system.
3. **Tests:** two clients with many staff each - every staff member sees only their client's data and cannot read, change or link to the other client's records (fake repositories, and a real PostgreSQL test of the foreign-key rule).

Not included (stated plainly): PostgreSQL row-level security (the database would also need a non-superuser connection role and a per-request setting; it is a separate hardening step) and one-database-per-client.

## Opening animation

`apps/web/src/components/SplashScreen.tsx` plays once each time the software is launched: the logo image (`apps/web/src/assets/splash.webp`) pops in, glows, shows the remembered client name, then fades into the software (about 3 seconds; click or any key skips it; shortened when the computer asks for reduced motion). To change the picture, replace `splash.webp` and rebuild.

## Upgrading

No database change. Copy the files, run `pnpm --filter @mafk/shared --filter @mafk/validation run build`, redeploy the API, rebuild the web app and the desktop installer. Users sign in with the same Login IDs; typing the client code is optional but recommended.

## Limits

- A client code with a dot (such as `J.`) is accepted for new clients; existing codes are unchanged.
- The license user limit still applies per client (the Security File refuses a user beyond it).
