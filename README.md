# VibeChat

A deliberately small static chat app for GitHub Pages + Supabase.

## Files

- `index.html` — page shell
- `app.js` — application logic
- `style.css` — all UI and themes
- `supabase/setup.sql` — database, RLS, storage and realtime setup
- `supabase/functions/admin/index.ts` — secure admin account creation/deletion

## One-time setup

1. Create a Supabase project.
2. In Supabase, open SQL Editor and run the entire `supabase/setup.sql`.
3. Create your first administrator account in Supabase Authentication > Users.
4. In SQL Editor, run:
   `update public.profiles set is_admin=true where email='YOUR_ADMIN_EMAIL';`
5. Deploy the `admin` Edge Function. Supabase CLI is the easiest way:
   `supabase functions deploy admin`
6. Open `app.js`.
7. Replace:
   `PASTE_YOUR_SUPABASE_URL_HERE`
   `PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE`
   and change:
   `const SHARED_PASSWORD = "CHANGE_ME";`
8. For Auth, disable public sign-ups in Supabase Authentication settings.
9. Push these files to a GitHub repository.
10. Enable GitHub Pages from the repository's Actions/Pages settings and use the included static files.

## Important security note

The shared password is a convenience gate because GitHub Pages is static. It is NOT a secret security boundary. Do not use it as the only protection for sensitive information. Supabase Auth and RLS are the real authorization layer.

Never put a Supabase service-role/secret key in `app.js`, GitHub Pages, or any browser code.

## Current scope

This first build includes login, admin create/delete, 1-to-1 chats, realtime messages, profile editing, themes, read state, message editing, attachments, responsive UI, and basic presence plumbing.

Group-chat creation, advanced member management, true typing broadcasts, push notifications, and stronger attachment authorization are intentionally left as the next layer rather than making the initial setup much harder.
