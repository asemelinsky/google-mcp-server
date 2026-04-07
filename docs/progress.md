# Google MCP Server — Прогрес налаштування

**Дата:** 2026-04-07

---

## ✅ Зроблено

### Код
- Повний MCP сервер на TypeScript
- 11 інструментів: Gmail (4), Google Drive (5), Calendar (3)
- OAuth2 flow: `/api/auth/google` → `/api/auth/callback`
- Auth: Bearer token через header АБО `?token=` query param
- Redirect URI hardcoded: `https://google-mcp-server-sigma.vercel.app/api/auth/callback`
- CORS налаштований для `claude.ai`

### GitHub
- Репо: https://github.com/asemelinsky/google-mcp-server
- Гілка: `master`, всі зміни запушені

### Vercel
- Production URL (alias): https://google-mcp-server-sigma.vercel.app
- Env vars виставлені:
  - `GOOGLE_CLIENT_ID` ✅
  - `GOOGLE_CLIENT_SECRET` ✅
  - `MCP_SECRET_TOKEN` ✅ (`adf0e6fa254e4ac04858be8578368d9af41d888d2ea356d94068f959ca71ffbc`)
  - `GOOGLE_REFRESH_TOKEN` ⏳ (ще не отримано)
- MCP endpoint протестовано — відповідає коректно

### Claude Connector
- ✅ Підключено в claude.ai → Settings → Connectors
- URL: `https://google-mcp-server-sigma.vercel.app/api/mcp?token=adf0e6fa254e4ac04858be8578368d9af41d888d2ea356d94068f959ca71ffbc`

### Google Cloud Console
- Проєкт `google-mcp-server` (ID: `quiet-coda-492612-i7`)
- 4 API увімкнено: Gmail, Drive, Docs, Calendar
- OAuth consent screen: `Google MCP Server`, External, Testing
- Test user: `a.semelinsky@gmail.com`
- OAuth Client: **Web app**, redirect URI:
  `https://google-mcp-server-sigma.vercel.app/api/auth/callback`

---

## ⏳ Залишилось

1. **Дочекатись активації OAuth client** (~кілька годин після створення)

2. **Отримати refresh token** — відкрити в браузері:
   ```
   https://google-mcp-server-sigma.vercel.app/api/auth/google
   ```
   → авторизуватись з `a.semelinsky@gmail.com` → скопіювати refresh token → передати в Claude Code

3. **Виставити `GOOGLE_REFRESH_TOKEN`** у Vercel (зробить Claude Code автоматично) + редеплой

4. **Готово** — всі 11 інструментів стануть доступні в Claude

---

## Відомі проблеми / що вирішено

| Проблема | Рішення |
|---|---|
| `invalid_client` з Desktop app | Перейшли на Web app OAuth client |
| `MCP_SECRET_TOKEN` з trailing newline | Використали `printf` замість `<<<` |
| `VERCEL_URL` дає deployment-specific URL | Hardcode `sigma` alias в redirect URI |
| Claude не підтримує Authorization header | Додали `?token=` query param auth |

---

## Інструменти після підключення

| Інструмент | Що робить |
|---|---|
| `search_emails` | Пошук листів у Gmail |
| `read_email` | Читати лист повністю |
| `send_email` | Надіслати або відповісти |
| `list_threads` | Список тредів |
| `search_files` | Пошук у Google Drive |
| `read_file` | Читати файл (Doc → текст) |
| `create_doc` | Створити Google Doc |
| `update_doc` | Дописати в Google Doc |
| `list_folder` | Список файлів у папці |
| `list_events` | Список подій календаря |
| `create_event` | Створити подію |
| `get_event` | Деталі події |
