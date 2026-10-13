const REPO = "MoRohn/flowaid";

function parseSemver(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function resolvedTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeEffects() {
  const dark = resolvedTheme() === "dark";
  const button = document.querySelector("#theme-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", dark ? "#0e0e11" : "#f5f5f7");
  });
  document.querySelectorAll("picture[data-shot] source").forEach((source) => {
    source.media = dark ? "all" : "not all";
  });
}

async function copyFrom(button) {
  const id = button.getAttribute("data-copy");
  const source = id ? document.getElementById(id) : null;
  const text = source ? source.textContent.replace(/^\s+|\s+$/g, "") : "";
  const status = document.getElementById("copy-status");
  if (!text) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
  }
  if (!copied && source) {
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const previous = button.textContent;
  button.textContent = copied ? "Copied" : "Selected";
  if (status) {
    status.textContent = copied ? "Copied the command" : "Command selected. Copy it from the keyboard.";
  }
  window.setTimeout(() => {
    button.textContent = previous;
    if (status) status.textContent = "";
  }, 1600);
}

async function refreshVersion() {
  const nodes = [...document.querySelectorAll("[data-version]")];
  const baked = nodes.length ? parseSemver(nodes[0].textContent) : null;
  if (!baked) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = await response.json();
    const remote = parseSemver(release.tag_name || "");
    if (!remote || compareSemver(remote, baked) < 0) return;
    const label = remote.join(".");
    for (const node of nodes) {
      node.textContent = label;
      if (node instanceof HTMLAnchorElement && typeof release.html_url === "string") {
        node.href = release.html_url;
      }
    }
  } catch {
    // The changelog version baked into the page stays.
  }
}

async function refreshStars() {
  const nodes = [...document.querySelectorAll("[data-stars]")];
  if (!nodes.length) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const repo = await response.json();
    if (typeof repo.stargazers_count !== "number" || repo.stargazers_count < 1) return;
    const label = new Intl.NumberFormat("en").format(repo.stargazers_count);
    for (const node of nodes) {
      node.textContent = "";
      node.append(document.createTextNode(label));
      const extra = document.createElement("span");
      extra.className = "sr-only";
      extra.textContent = " GitHub stars";
      node.append(extra);
      node.hidden = false;
    }
  } catch {
    // The GitHub link still works without a count.
  }
}

function setupNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");
  if (!toggle || !nav) return;
  const label = toggle.querySelector(".nav-toggle-label");
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (label) label.textContent = open ? "Close menu" : "Menu";
  };
  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links
    .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
    .filter(Boolean);
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      for (const link of links) {
        if (link.getAttribute("href") === `#${visible.target.id}`) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    },
    { rootMargin: "-30% 0px -55% 0px", threshold: [0.15, 0.4] },
  );
  for (const section of sections) observer.observe(section);
}

applyThemeEffects();
document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const next = resolvedTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("flowaid-theme", next);
  } catch {
    // The choice still applies for this view.
  }
  applyThemeEffects();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.hasAttribute("data-theme")) applyThemeEffects();
});
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyFrom(button));
});
setupNav();
refreshVersion();
refreshStars();
