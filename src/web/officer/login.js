import { ApiError, get, post, setSignInPage } from "../shared/api.js";
import { announce, h } from "../shared/dom.js";
import { icon } from "../shared/icons.js";
import { brandLink } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.login;
// A 401 here means "wrong password", not "go to the login page".
setSignInPage(null);

const username = h("input", { class: "input", id: "username", name: "username", autocomplete: "username", required: true });
const password = h("input", { class: "input", id: "password", name: "password", type: "password", autocomplete: "current-password", required: true });
const error = h("p", { class: "banner banner--error", role: "alert", hidden: true });
const submit = h("button", { class: "btn btn--primary btn--block", type: "submit" }, t.submit);

const form = h(
  "form",
  {
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = t.busy;
      try {
        await post("/api/auth/login", { username: username.value.trim(), password: password.value });
        window.location.assign("/officer/");
      } catch (err) {
        error.textContent = err instanceof ApiError && err.status === 401 ? t.wrong : err.message;
        error.hidden = false;
        announce(error.textContent, { assertive: true });
        submit.disabled = false;
        submit.textContent = t.submit;
        password.select();
      }
    },
  },
  h("div", { class: "field" }, h("label", { class: "field__label", for: "username" }, t.username), username),
  h("div", { class: "field" }, h("label", { class: "field__label", for: "password" }, t.password), password),
  error,
  submit,
);

document.getElementById("login-brand").append(
  brandLink({ href: "/officer/login.html", disc: true }),
  h(
    "div",
    { class: "login__intro" },
    h("p", { class: "login__slogan" }, strings.common.slogan),
    h("p", { class: "login__tagline" }, t.tagline),
    h("ul", { class: "login__points" }, ...t.points.map((point) => h("li", {}, icon("check"), point))),
  ),
);
document.getElementById("main").append(
  h("h1", {}, t.title),
  h("p", { class: "muted" }, t.welcome),
  form,
  h("p", { class: "login__hint" }, t.demoHint), // remove for a real pilot
);
username.focus();

// Already signed in: go straight to the overview.
get("/api/auth/me").then(() => window.location.assign("/officer/")).catch(() => {});
