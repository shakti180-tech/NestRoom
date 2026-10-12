# NestRoom – Backend (Node.js + MongoDB Atlas)

REST API using the official `mongodb` driver. Data lives in a MongoDB Atlas cluster (online).

## 1. Set up MongoDB Atlas (one time)
1. Create a free account at https://www.mongodb.com/cloud/atlas and create a **free (M0) cluster**.
2. **Database Access** → *Add New Database User* → choose a username + password (use letters/numbers, or URL-encode special characters) with the *Read and write to any database* role.
3. **Network Access** → *Add IP Address*. Add your current IP for local development
   (or `0.0.0.0/0` to allow all – convenient for testing, less secure; use only with a strong password).
   When you deploy the backend, add your host's IP / allow its access as well.
4. **Database** → *Connect* → *Drivers* → copy the connection string (`mongodb+srv://...`).

## 2. Configure and run
```
cd backend
npm install
cp .env.example .env      # then edit .env: paste MONGODB_URI (with your password), set TOKEN_SECRET
npm start                 # http://localhost:3000
```
On the first start the database is filled with the sample rooms, bookings and two demo owners
(`meera` / `arjun`, password `Owner@123`). Set `SEED_DEMO_DATA=false` to start empty. Collections created:
`users`, `rooms`, `bookings`, `meta`.

If startup fails it prints the reason – usually a wrong password in `MONGODB_URI` or your IP not allowed in Atlas *Network Access*.

## Deploying
Set the same variables (`MONGODB_URI`, `TOKEN_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, …) as environment variables on your host
(Render, Railway, etc.) instead of using a `.env` file, and serve the site over **HTTPS**.
Change the admin password and demo-owner password (or disable seeding) for real use.

## Security
- Passwords are hashed with scrypt + per-user salt; the admin password is hashed in memory at startup.
- Login returns an HMAC-signed bearer token (12h). Roles are read from the token, never from the client.
- Login is throttled (10 failed attempts / 15 min / IP, kept in server memory).
- Unique indexes on username and email stop duplicate accounts; booking a room is an atomic database update, so two tenants cannot book the same room.

## Workflow
- **Owners** register as `pending` and cannot log in until the admin approves them. The admin can revoke or **remove** an owner
  (removal deletes their rooms and cancels their active bookings).
- **Bookings** are approved or rejected **by the room's owner only**. The admin can see every booking but cannot decide on them.
- **Leaving a room:** a tenant with an approved booking sends a *leave request* (`leaving`). The owner approves it
  (booking `ended`, room available again) or rejects it (back to `approved`). The tenant can withdraw it.
- Photos are stored in the `images` collection (base64) and removed when the room or its owner is removed.
- Tenants see each room's owner name and phone number.

Booking statuses: `pending`, `approved`, `leaving`, `rejected`, `cancelled`, `ended`. All ids are MongoDB ObjectId strings.

## Endpoints (Authorization: Bearer <token>)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/register/user | public | create tenant account (logs in) |
| POST | /api/auth/register/owner | public | create owner account (`pending`) |
| POST | /api/auth/login | public | `{username, password, role}` -> `{token, user}` |
| GET | /api/auth/me | any logged in | current user |
| GET | /api/owners | admin | all owners with status + room count |
| POST | /api/owners/:id/approve | admin | approve owner |
| POST | /api/owners/:id/reject | admin | reject / revoke owner |
| DELETE | /api/owners/:id | admin | remove owner + rooms, cancel active bookings |
| GET | /api/public/rooms | public | available rooms of approved owners (photos, city, amenities; no phone numbers) |
| GET | /api/images/:id | public | a room photo (cached) |
| GET | /api/rooms | any logged in | rooms with owner name/phone (tenants: approved owners only) |
| POST | /api/rooms | owner | add room `{name, addr, city, type, rent, amenities[], description, images[]}` – `images` = 1–6 data-URL photos (required, max 700 KB each) |
| DELETE | /api/rooms/:id | owner (own), admin | remove room |
| POST | /api/rooms/:id/vacate | owner (own) | mark vacant |
| GET | /api/bookings | any logged in | admin: all; owner: own rooms; user: own |
| POST | /api/bookings | user | book room `{roomId}` |
| POST | /api/bookings/:id/cancel | user (own) | cancel pending booking |
| POST | /api/bookings/:id/leave | user (own) | request to leave |
| POST | /api/bookings/:id/leave-cancel | user (own) | withdraw leave request |
| POST | /api/bookings/:id/approve | owner (own room) | approve booking |
| POST | /api/bookings/:id/reject | owner (own room) | reject booking |
| POST | /api/bookings/:id/leave-approve | owner (own room) | approve leave |
| POST | /api/bookings/:id/leave-reject | owner (own room) | reject leave |
