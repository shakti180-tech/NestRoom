// Session storage + thin wrapper around the backend REST API.
const Session = {
  get token() { return localStorage.getItem("nr_token"); },
  get user() { try { return JSON.parse(localStorage.getItem("nr_user")); } catch { return null; } },
  set(token, user) { localStorage.setItem("nr_token", token); localStorage.setItem("nr_user", JSON.stringify(user)); },
  clear() { localStorage.removeItem("nr_token"); localStorage.removeItem("nr_user"); },
};

const API = {
  async call(method, path, body, silent) {
    const headers = { "Content-Type": "application/json" };
    if (Session.token) headers.Authorization = "Bearer " + Session.token;
    let res;
    try {
      res = await fetch(window.NESTROOM_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error("Cannot reach the server. Is the backend running?"); }
    const data = await res.json().catch(() => ({}));
    // Expired / invalid session on a protected call -> back to login
    if (res.status === 401 && !silent && !path.startsWith("/auth/login") && Session.token) {
      Session.clear(); location.href = "login.html"; throw new Error("Session expired");
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  // auth
  login: (username, password, role) => API.call("POST", "/auth/login", { username, password, role }),
  registerUser: b => API.call("POST", "/auth/register/user", b),
  registerOwner: b => API.call("POST", "/auth/register/owner", b),
  me: () => API.call("GET", "/auth/me"),
  // rooms & bookings (role is taken from the login token by the server)
  getRooms: silent => API.call("GET", "/rooms", null, silent),
  publicRooms: () => API.call("GET", "/public/rooms"),
  img: id => window.NESTROOM_API + "/images/" + id,
  getBookings: () => API.call("GET", "/bookings"),
  addRoom: room => API.call("POST", "/rooms", room),
  removeRoom: id => API.call("DELETE", `/rooms/${id}`),
  markVacant: id => API.call("POST", `/rooms/${id}/vacate`),
  book: roomId => API.call("POST", "/bookings", { roomId }),
  leaveBooking: id => API.call("POST", `/bookings/${id}/leave`),
  withdrawLeave: id => API.call("POST", `/bookings/${id}/leave-cancel`),
  approveLeave: id => API.call("POST", `/bookings/${id}/leave-approve`),
  rejectLeave: id => API.call("POST", `/bookings/${id}/leave-reject`),
  cancelBooking: id => API.call("POST", `/bookings/${id}/cancel`),
  approveBooking: id => API.call("POST", `/bookings/${id}/approve`),
  rejectBooking: id => API.call("POST", `/bookings/${id}/reject`),
  // admin: owner registrations
  getOwners: () => API.call("GET", "/owners"),
  approveOwner: id => API.call("POST", `/owners/${id}/approve`),
  removeOwner: id => API.call("DELETE", `/owners/${id}`),
  rejectOwner: id => API.call("POST", `/owners/${id}/reject`),
};
