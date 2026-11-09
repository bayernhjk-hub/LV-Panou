# Panou LV – listă de membri din Discord

## Pornire locală
1. Instalează Node.js 18 sau mai nou.
2. În acest folder: `npm install`
3. Setează tokenul: pe Windows (PowerShell) `$env:DISCORD_BOT_TOKEN="tokenul_tau"`, pe Mac/Linux `export DISCORD_BOT_TOKEN=tokenul_tau`
4. `npm start`, apoi deschide http://localhost:3000

## Pe Render (gratuit)
1. Pune folderul pe GitHub (fără token în el).
2. Render → New → Web Service → alege repository-ul.
3. Build Command: `npm install` • Start Command: `npm start`
4. La Environment adaugă `DISCORD_BOT_TOKEN` cu tokenul botului.

Botul trebuie să fie pe server și să aibă „Server Members Intent” activat.
Apar doar membrii care au cel puțin un grad LV. Lista se reîmprospătează la 60 de secunde.
