# NestRoom – Frontend

Static HTML/CSS/JS (no build step). Start the backend first, then:

```
cd frontend
python3 -m http.server 5173     # or: npx serve -l 5173
```
Open http://localhost:5173/login.html. If the backend is not at `http://localhost:3000`, edit `js/config.js`.

Pages: `login.html`, `register-user.html`, `register-owner.html`, `index.html` (dashboard).
Scripts: `js/api.js` (session + API calls), `js/auth.js` (auth forms), `js/app.js` (dashboard).
