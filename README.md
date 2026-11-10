# Panou LV – membri, conectare Discord, pontaj și activități

## Variabile de mediu (Render → Environment)
- DISCORD_BOT_TOKEN – tokenul botului (Bot)
- DISCORD_CLIENT_ID – ID-ul aplicației (OAuth2)
- DISCORD_CLIENT_SECRET – Client Secret (OAuth2)
- SESSION_SECRET – un text lung și aleator (minim 32 de caractere)
- BASE_URL – adresa site-ului, fără „/” la final, de ex. https://lv-panou.onrender.com
- DATABASE_URL – adresa bazei de date Postgres (de ex. din Neon). Fără ea, Pontajul și Activitățile nu pornesc.

## Baza de date
Pe planul gratuit Render fișierele se pierd la repornire, deci pontajul are nevoie de o bază de date externă.
Tabelele se creează singure la prima pornire.

## Discord Developer Portal
OAuth2 → Redirects → exact: BASE_URL + /api/auth/discord/callback

## Reguli
- Pontaj și Activități: doar membrii cu cel puțin un grad LV, conectați cu Discord.
- Administrare (ștergere ture): Lider LV și Lider Secundar LV (lista LEADERS din server.js).
- Săptămâna merge de luni 00:00 până duminică, ora României.
- O tură uitată deschisă se închide automat după 8 ore (MAX_H din server.js).

## Pornire locală
npm install, setezi variabilele, apoi npm start (http://localhost:3000).
