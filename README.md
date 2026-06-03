# OKAY Bari

Sito pubblico e pannello admin con backend locale JSON.

## Avvio

```powershell
.\start.ps1
```

Poi apri:

- Sito pubblico: `http://127.0.0.1:5600/`
- Admin: `http://127.0.0.1:5600/admin`

Al primo avvio vengono create le credenziali admin in `data/first-admin.txt`.

## Variabili utili

- `PORT`: porta del server, default `5600`
- `HOST`: host del server, default `0.0.0.0`
- `DATA_DIR`: cartella dove salvare `db.json`, `.jwt-secret` e `first-admin.txt`
- `OKAY_ADMIN_EMAIL`: email del primo admin
- `OKAY_ADMIN_PASSWORD`: password del primo admin
- `JWT_SECRET`: segreto token, consigliato in produzione

I dati locali finiscono in `data/db.json`.
