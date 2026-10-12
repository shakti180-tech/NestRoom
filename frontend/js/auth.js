// Shared logic for login.html, register-user.html and register-owner.html.
(function () {
  if (Session.token) { location.replace("dashboard.html"); return; } // already logged in

  const form = document.getElementById("f"), err = document.getElementById("err");
  const kind = form.dataset.kind;
  const val = n => (form.elements[n] ? form.elements[n].value.trim() : "");

  // show / hide password
  document.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => {
    const i = document.getElementById(b.dataset.toggle), show = i.type === "password";
    i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show";
  }));

  // login page: registration links only make sense for user/owner, not admin
  const links = document.getElementById("reglinks");
  if (links) form.addEventListener("change", () => { links.hidden = form.elements.role.value === "admin"; });

  function validate() {
    if (kind === "login") {
      if (!val("username") || !form.elements.password.value) return "Enter your username and password";
      return "";
    }
    if (val("name").length < 2) return "Enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email"))) return "Enter a valid email address";
    if (!/^[0-9+\-\s]{7,15}$/.test(val("phone"))) return "Enter a valid phone number";
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(val("username"))) return "Username must be 3–30 letters, numbers, - or _";
    const pw = form.elements.password.value;
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password needs 8+ characters with a letter and a number";
    if (pw !== form.elements.confirm.value) return "Passwords do not match";
    return "";
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    err.textContent = "";
    const problem = validate();
    if (problem) { err.textContent = problem; return; }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const pw = form.elements.password.value;
      let r;
      if (kind === "login") r = await API.login(val("username"), pw, form.elements.role.value);
      else {
        const body = { name: val("name"), email: val("email"), phone: val("phone"), username: val("username"), password: pw };
        if (kind === "owner") body.business = val("business");
        r = kind === "owner" ? await API.registerOwner(body) : await API.registerUser(body);
      }
      if (r.pending) {   // owner registration: wait for admin approval
        form.hidden = true;
        document.getElementById("done").hidden = false;
        document.querySelector(".sub").textContent = "Thanks for registering";
        return;
      }
      Session.set(r.token, r.user);
      location.href = "dashboard.html";
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
})();
