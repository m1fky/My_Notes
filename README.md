# Liquid Notes

PWA заметок для Android, iPhone/iPad и ПК с local-first режимом, Supabase auth/sync и web push напоминаниями, подготовленная под деплой на Netlify.

## Что уже есть

- Next.js 16 + TypeScript + Tailwind CSS 4
- iOS-inspired Liquid Glass UI
- PWA manifest, service worker и install flow
- IndexedDB через Dexie для offline-first работы
- Rich text editor на Tiptap
- Папки, теги, pin/archive, изображения, reminders
- Supabase auth, cloud sync и SQL migration
- API routes для push-подписки и ручного запуска reminders
- Netlify Scheduled Function для автоматической отправки reminders каждую минуту

## Быстрый старт

```bash
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

Без env приложение работает в demo/local-first режиме. Чтобы включить облако и push, создайте `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=
```

## Deploy on Netlify

1. Залейте проект в GitHub.
2. Импортируйте репозиторий в Netlify.
3. Build command: `npm run build`
4. Publish directory вручную указывать не нужно: Netlify сам подхватит Next.js runtime.
5. Добавьте в Netlify переменные окружения:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=
```

6. Сделайте production deploy.
7. Проверьте в Netlify UI, что функция `send-due-reminders` появилась как Scheduled Function с расписанием `* * * * *`.

## Supabase setup

1. Создайте проект в Supabase.
2. Включите Email и Google auth provider.
3. Примените SQL из [supabase/migrations/20260325030000_init.sql](/Users/mikhailf/Desktop/Notes/supabase/migrations/20260325030000_init.sql).
4. Добавьте URL фронтенда в Redirect URLs.
5. Отдельный cron в Supabase не нужен: reminders запускаются через Netlify Scheduled Function.

## Netlify DB / Neon или Supabase?

- Для этого приложения сейчас лучше `Supabase`.
- Причина в том, что проект уже завязан не только на Postgres, но и на `Auth`, `RLS` и `Realtime`.
- `Netlify DB` на базе `Neon` хорош как serverless Postgres, но он не заменяет Supabase Auth/Realtime из коробки.
- Переезд на Neon означал бы переписать авторизацию, контроль доступа и живую синхронизацию, а не просто заменить connection string.
- Для полностью бесплатного и практичного запуска здесь лучший вариант: `Netlify + Supabase`.

## Ограничения текущей реализации

- Изображения синхронизируются как data URL в таблице `note_attachments`, чтобы проект оставался полностью бесплатным и без отдельного storage bucket.
- На iPhone/iPad push появится только после установки PWA на экран Домой.
- Для production стоит добавить PNG-иконки для лучшей совместимости с разными лаунчерами и splash screens.
- Netlify Scheduled Functions работают только на published deploys и имеют лимит выполнения 30 секунд.
