const $ = (id) => document.getElementById(id);
const ticketList = $("ticketList"),
  emptyState = $("emptyState"),
  loadingState = $("loadingState"),
  statsBar = $("statsBar"),
  searchInput = $("searchInput"),
  statusFilter = $("statusFilter"),
  priorityFilter = $("priorityFilter"),
  toast = $("toast"),
  pager = $("pager"),
  pagerLabel = $("pagerLabel"),
  prevPageBtn = $("prevPage"),
  nextPageBtn = $("nextPage");
let currentTicketId = null,
  debounceTimer = null,
  currentPage = 1,
  toastTimer = null,
  ticketLoadSequence = 0,
  pendingCreateKey = null;
const PAGE_SIZE = 25;
const statusClass = (s) =>
  ({
    Open: "status-open",
    "In Progress": "status-in-progress",
    Closed: "status-closed",
  })[s] || "";
const priorityClass = (p) =>
  ({
    Low: "pri-low",
    Medium: "pri-medium",
    High: "pri-high",
    Urgent: "pri-urgent",
  })[p] || "";
const initials = (name) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
function escapeHtml(value) {
  const el = document.createElement("span");
  el.textContent = value ?? "";
  return el.innerHTML;
}
function parseSafeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDateDisplay(value, options = {}) {
  const date = parseSafeDate(value);
  if (!date) return "Date unavailable";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}
function formatDateTimeDisplay(value, options = {}) {
  const date = parseSafeDate(value);
  if (!date) return "Date unavailable";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  });
}
function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = isError ? "#a9323d" : "#111a2b";
  toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.classList.add("hidden"), 220);
  }, 2600);
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return { response, data };
}
async function loadStats() {
  try {
    const { data: s } = await api("/api/stats");
    const cards = [
      {
        label: "Total tickets",
        value: s.total,
        meta: "All requests",
        icon: "▤",
        tone: "text-slate-700",
        tile: "bg-slate-100",
      },
      {
        label: "Open",
        value: s.open,
        meta: "Awaiting action",
        icon: "◷",
        tone: "text-amber-700",
        tile: "bg-amber-50",
      },
      {
        label: "In progress",
        value: s.in_progress,
        meta: "Being handled",
        icon: "↗",
        tone: "text-blue-700",
        tile: "bg-blue-50",
      },
      {
        label: "Urgent active",
        value: s.urgent_open,
        meta: "Needs attention",
        icon: "!",
        tone: "text-rose-700",
        tile: "bg-rose-50",
      },
    ];
    statsBar.innerHTML = cards
      .map(
        (c) =>
          `<article class="card p-5"><div class="flex items-start justify-between"><span class="text-xs font-bold text-slate-500">${c.label}</span><span class="${c.tile} ${c.tone} h-9 w-9 rounded-xl grid place-items-center font-extrabold">${c.icon}</span></div><div class="display text-3xl font-extrabold mt-4 tracking-tight ${c.tone}">${Number(c.value) || 0}</div><div class="text-xs text-slate-400 mt-1">${c.meta}</div></article>`,
      )
      .join("");
  } catch (e) {
    showToast(e.message, true);
  }
}
async function loadTickets() {
  const requestSequence = ++ticketLoadSequence;
  loadingState.classList.remove("hidden");
  emptyState.classList.add("hidden");
  pager.classList.add("hidden");
  pager.classList.remove("flex");
  ticketList.innerHTML = "";
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
  if (statusFilter.value) params.set("status", statusFilter.value);
  if (priorityFilter.value) params.set("priority", priorityFilter.value);
  params.set("page", currentPage);
  params.set("limit", PAGE_SIZE);
  try {
    const { response, data: tickets } = await api(`/api/tickets?${params}`);
    if (requestSequence !== ticketLoadSequence) return;
    const total = Number(
        response.headers.get("X-Total-Count") || tickets.length,
      ),
      pages = Number(response.headers.get("X-Total-Pages") || 1);
    loadingState.classList.add("hidden");
    emptyState.classList.toggle("hidden", tickets.length > 0);
    for (const t of tickets) {
      const tr = document.createElement("tr");
      const createdAt = t.created_at ?? t.createdAt ?? null;
      tr.className = "row-hover cursor-pointer";
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `Open ticket ${t.ticket_id}`);
      tr.innerHTML = `<td class="px-6 py-4"><span class="font-mono text-xs font-bold text-teal-700">${escapeHtml(t.ticket_id)}</span></td><td class="px-4 py-4"><div class="flex items-center gap-3"><div class="avatar">${escapeHtml(initials(t.customer_name))}</div><div class="min-w-0"><div class="font-bold text-[13px] text-slate-800">${escapeHtml(t.customer_name)}</div><div class="text-xs text-slate-400 mt-0.5">${escapeHtml(t.customer_email)}</div></div></div></td><td class="px-4 py-4"><div class="font-semibold text-[13px] text-slate-700 max-w-xs truncate">${escapeHtml(t.subject)}</div></td><td class="px-4 py-4"><span class="badge ${priorityClass(t.priority)}">${escapeHtml(t.priority)}</span></td><td class="px-4 py-4"><span class="badge ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td><td class="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">${formatDateDisplay(createdAt)}</td><td class="px-6 py-4 text-right whitespace-nowrap"><button type="button" class="btn-secondary text-xs px-4 py-2" aria-label="Manage ticket ${escapeHtml(t.ticket_id)}">Manage</button></td>`;
      const open = () => openDetail(t.ticket_id);
      const manageButton = tr.querySelector("button");
      manageButton.addEventListener("click", (event) => {
        event.stopPropagation();
        open();
      });
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      ticketList.appendChild(tr);
    }
    if (total > 0) {
      pagerLabel.textContent = `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total} tickets`;
      prevPageBtn.disabled = currentPage <= 1;
      nextPageBtn.disabled = currentPage >= pages;
      pager.classList.remove("hidden");
      pager.classList.add("flex");
    }
  } catch (e) {
    if (requestSequence !== ticketLoadSequence) return;
    loadingState.textContent =
      "Could not load tickets. Check your connection and try again.";
    loadingState.classList.remove("hidden");
    showToast(e.message, true);
  }
}
function refreshAll() {
  loadStats();
  loadTickets();
}
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  currentPage = 1;
  debounceTimer = setTimeout(loadTickets, 250);
});
statusFilter.addEventListener("change", () => {
  currentPage = 1;
  loadTickets();
});
priorityFilter.addEventListener("change", () => {
  currentPage = 1;
  loadTickets();
});
prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadTickets();
  }
});
nextPageBtn.addEventListener("click", () => {
  currentPage++;
  loadTickets();
});
const newTicketModal = $("newTicketModal");
function closeNew() {
  newTicketModal.classList.add("hidden");
}
$("newTicketBtn").addEventListener("click", () => {
  newTicketModal.classList.remove("hidden");
  newTicketModal.querySelector("input").focus();
});
$("cancelNewTicket").addEventListener("click", closeNew);
$("cancelNewTicket2").addEventListener("click", closeNew);
$("newTicketForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  button.textContent = "Creating...";
  try {
    const body = Object.fromEntries(new FormData(e.target).entries());
    pendingCreateKey =
      pendingCreateKey ||
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data } = await api("/api/tickets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": pendingCreateKey,
      },
      body: JSON.stringify(body),
    });
    pendingCreateKey = null;
    e.target.reset();
    closeNew();
    currentPage = 1;
    searchInput.value = "";
    statusFilter.value = "";
    priorityFilter.value = "";
    showToast(`Ticket ${data.ticket_id} created`);
    refreshAll();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Create ticket <span class="ml-1">→</span>';
  }
});
const detailModal = $("detailModal");
$("closeDetail").addEventListener("click", () =>
  detailModal.classList.add("hidden"),
);
async function openDetail(ticketId) {
  try {
    const { data: t } = await api(
      `/api/tickets/${encodeURIComponent(ticketId)}`,
    );
    currentTicketId = ticketId;
    $("detailTicketId").textContent = t.ticket_id;
    $("detailSubject").textContent = t.subject;
    $("detailCustomer").textContent = t.customer_name;
    $("detailEmail").textContent = t.customer_email;
    $("detailDescription").textContent =
      t.description || "No description provided.";
    $("detailStatus").innerHTML = ["Open", "In Progress", "Closed"]
      .map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`)
      .join("");
    $("detailPriority").innerHTML = ["Low", "Medium", "High", "Urgent"]
      .map((s) => `<option ${s === t.priority ? "selected" : ""}>${s}</option>`)
      .join("");
    $("notesList").innerHTML = t.notes.length
      ? t.notes
          .map(
            (n) => {
              const noteCreatedAt = n.created_at ?? n.createdAt ?? null;
              return `<div class="border border-slate-200 rounded-xl px-4 py-3 bg-white"><div class="whitespace-pre-wrap break-words text-slate-700">${escapeHtml(n.note_text)}</div><div class="text-[11px] text-slate-400 mt-2">${formatDateTimeDisplay(noteCreatedAt)}</div></div>`;
            },
          )
          .join("")
      : '<div class="text-slate-400 text-sm rounded-xl bg-slate-50 p-4">No internal notes yet.</div>';
    detailModal.classList.remove("hidden");
  } catch (e) {
    showToast(e.message, true);
  }
}
$("updateStatusBtn").addEventListener("click", async () => {
  if (!currentTicketId) return;
  const btn = $("updateStatusBtn");
  btn.disabled = true;
  try {
    await api(`/api/tickets/${encodeURIComponent(currentTicketId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: $("detailStatus").value,
        priority: $("detailPriority").value,
      }),
    });
    showToast("Ticket changes saved");
    refreshAll();
    await openDetail(currentTicketId);
  } catch (e) {
    showToast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});
$("addNoteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentTicketId) return;
  const input = e.target.elements.note;
  const note = input.value.trim();
  if (!note) return;
  try {
    await api(`/api/tickets/${encodeURIComponent(currentTicketId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: note }),
    });
    e.target.reset();
    showToast("Internal note added");
    await openDetail(currentTicketId);
  } catch (err) {
    showToast(err.message, true);
  }
});
[newTicketModal, detailModal].forEach((modal) =>
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    newTicketModal.classList.add("hidden");
    detailModal.classList.add("hidden");
  }
});
refreshAll();

// Manage workspace: ticket operations use the existing API; roster is browser-local.
const dashboardTab = $("dashboardTab"),
  manageTab = $("manageTab"),
  dashboardPanel = $("dashboardPanel"),
  managePanel = $("managePanel");
function switchWorkspace(manage) {
  dashboardPanel.classList.toggle("hidden", manage);
  managePanel.classList.toggle("hidden", !manage);
  dashboardTab.className = manage ? "btn-secondary" : "btn-primary";
  manageTab.className = manage ? "btn-primary" : "btn-secondary";
  dashboardTab.setAttribute("aria-selected", String(!manage));
  manageTab.setAttribute("aria-selected", String(manage));
  if (manage) {
    loadManageTickets();
  }
}
dashboardTab.addEventListener("click", () => switchWorkspace(false));
manageTab.addEventListener("click", () => switchWorkspace(true));
async function loadManageTickets() {
  const body = $("manageTicketRows");
  body.innerHTML =
    '<tr><td colspan="6" class="p-5 text-slate-400">Loading tickets…</td></tr>';
  try {
    const { data } = await api("/api/tickets?limit=100&page=1");
    body.innerHTML = "";
    if (!data.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="p-5 text-slate-400">No tickets found.</td></tr>';
      return;
    }
    for (const t of data) {
      const tr = document.createElement("tr");
      tr.className = "border-t border-slate-100";
      tr.innerHTML = `<td class="p-3 font-mono text-xs font-bold text-teal-700">${escapeHtml(t.ticket_id)}</td><td class="p-3">${escapeHtml(t.customer_name)}</td><td class="p-3 max-w-xs truncate">${escapeHtml(t.subject)}</td><td class="p-3">${escapeHtml(t.status)}</td><td class="p-3">${escapeHtml(t.priority)}</td><td class="p-3"><button class="btn-secondary" type="button">Manage</button></td>`;
      tr.querySelector("button").addEventListener("click", () =>
        openDetail(t.ticket_id),
      );
      body.appendChild(tr);
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="p-5 text-rose-600">${escapeHtml(e.message)}</td></tr>`;
  }
}
$("manageRefresh").addEventListener("click", loadManageTickets);
