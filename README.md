# NestRoom – Room & PG Dashboard

- `backend/`  – Node.js REST API with login/registration, data in MongoDB Atlas (port 3000)
- `frontend/` – static HTML/CSS/JS (login, registration, dashboard)

## Run
```
cd backend  && npm install && cp .env.example .env   # add your MongoDB Atlas URI to .env
cd backend  && npm start                          # http://localhost:3000
cd frontend && python3 -m http.server 5173        # open http://localhost:5173/
```

## Pages
| Page | Purpose |
|---|---|
| `index.html` | **Public landing page**: search, city filter, room cards with photos, details popup |
| `dashboard.html` | Dashboard for User / Owner / Admin (redirects to login if not signed in) |
| `login.html` | Log in as User, Owner or Admin |
| `register-user.html` | Tenant self-registration (user role only) |
| `register-owner.html` | Owner registration |

## Accounts
- **Admin** (only one): username `Shakti-Rai`, password `Bhumihar52` – defined in `backend/config.js`
  (override with `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`). Admin cannot be registered from the UI.
- **Demo owners** (created on first start, own the sample rooms): `meera` and `arjun`, password `Owner@123`. Set `SEED_DEMO_DATA=false` to skip.
- Users register themselves and can log in immediately.
- New owners register themselves but must be **approved by the admin** before they can log in.
- Owners approve/reject bookings and leave requests for their own rooms; the admin monitors everything and can remove owners.

## Room photos
Owners must upload **1–6 photos** when adding a room / PG / flat (plus city, amenities and an optional description).
The browser shrinks each photo (max 1280px JPEG) before upload, and the photos are stored in your MongoDB Atlas database
(`images` collection) and served at `/api/images/:id`. Visitors who are not logged in can browse rooms and photos but only
see the owner's name; logging in shows the owner's phone number and lets users book.
