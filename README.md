# Adrian Barber

Aplicación de reservas y administración. La configuración de producción usa GitHub Pages para los archivos estáticos y Supabase Edge Functions/Postgres para la API y los datos. El frontend no contiene la clave `service_role`.

## Preparar Supabase

1. En Supabase, aplica [`supabase/migrations/20261112000000_create_barberia_state.sql`](./supabase/migrations/20261112000000_create_barberia_state.sql) desde el SQL Editor o, tras vincular el proyecto, ejecuta `supabase db push`.
2. Crea un archivo local `.env.supabase` (ignorado por Git) con:

   ```text
   SUPABASE_SERVICE_ROLE_KEY=tu_clave_service_role
   BARBERIA_ANON_KEY=tu_clave_publica_anon
   BARBERIA_JWT_SECRET=un_secreto_aleatorio_largo
   ```

3. En PowerShell, carga esos secretos en el proceso y publícalos en Supabase:

   ```powershell
   Get-Content .env.supabase | ForEach-Object {
     $name, $value = $_ -split "=", 2
     [Environment]::SetEnvironmentVariable($name, $value, "Process")
   }
   supabase secrets set --env-file .env.supabase
   ```

   `BARBERIA_ANON_KEY` debe coincidir con `supabaseAnonKey` en `supabase-config.js`. `SUPABASE_URL` y la clave pública/anon se obtienen del proyecto Supabase. La clave pública/anon puede estar en el frontend; `service_role` y `BARBERIA_JWT_SECRET` no.

4. Publica las funciones:

   ```powershell
   supabase link --project-ref wsjqinjdailusnvrgace
   supabase functions deploy state
   supabase functions deploy login
   supabase functions deploy booking
   supabase functions deploy cancel
   ```

5. Configura [`supabase-config.js`](./supabase-config.js) con la clave pública/anon del proyecto y cambia `enabled` a `true`. Ese archivo es público; nunca pongas ahí la clave `service_role`.

## Migrar los datos existentes

La migración es explícita para evitar sobrescribir accidentalmente la base de datos. En la misma sesión de PowerShell donde cargaste `.env.supabase`, configura la URL pública y solicita una contraseña inicial segura:

```powershell
$env:SUPABASE_URL = "https://wsjqinjdailusnvrgace.supabase.co"
$securePassword = Read-Host "Contraseña inicial del administrador" -AsSecureString
$env:BARBERIA_ADMIN_PASSWORD = (New-Object System.Net.NetworkCredential("", $securePassword)).Password
node scripts/migrate-data-to-supabase.js
```

El script importa `data.json` y establece la contraseña inicial. Puede ejecutarse de nuevo, pero reemplaza el estado de citas y barberos existente. Conserva `data.json` localmente: contiene información de clientes, está ignorado por Git y no forma parte del artefacto de GitHub Pages.

## Publicar el frontend en GitHub Pages

El workflow [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) publica solo `index.html`, `app.js`, `styles.css`, `supabase-config.js`, `assets/` e `img/`; no publica datos locales ni las claves del servidor.

1. Inicia sesión en GitHub desde VS Code/Git Credential Manager y publica el código en `osroma/barberia`.
2. En la configuración del repositorio, habilita Pages con **GitHub Actions**.
3. El workflow se ejecuta en cada push a `main`. El sitio quedará disponible en `https://osroma.github.io/barberia/`.

## Recordatorios de WhatsApp (opcional)

El worker programado de Cloudflare puede seguir enviando recordatorios, leyendo y actualizando la misma fila de Supabase:

```powershell
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler-reminders.toml
wrangler secret put WHATSAPP_TOKEN --config wrangler-reminders.toml
wrangler secret put WHATSAPP_PHONE_NUMBER_ID --config wrangler-reminders.toml
wrangler deploy --config wrangler-reminders.toml
```

## Desarrollo local

Para el servidor Node local, deja `enabled: false` en `supabase-config.js` y ejecuta:

```powershell
$env:ADMIN_PASSWORD = "define-una-clave-local-segura"
node server.js
```

Abre `http://localhost:8081`. Agrega los usuarios barberos desde la cuenta de administrador. Este modo local continúa usando `data.json`; no es el backend de producción.
