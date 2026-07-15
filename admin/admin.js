import { supabase } from "../supabase-client.js";
import { getSessionProfile, logout, adminCreateEmployee, adminResetPassword } from "../auth.js";
import { formatDateTime, formatDate } from "../format.js";
import { fetchRondaItemsData, gerarPdfParaRonda } from "./ronda-report.js";
import { initDriveArchive } from "./drive-archive.js";

const toastEl = document.getElementById("toast");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

function showToast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), ms);
}
function setLoading(on, text) {
  loadingOverlay.hidden = !on;
  if (text) loadingText.textContent = text;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------
   SESSÃO / GATE
--------------------------------------------------------- */
let profile = null;

(async function init() {
  setLoading(true, "Verificando sessão...");
  profile = await getSessionProfile();
  setLoading(false);
  if (!profile || profile.role !== "admin") {
    window.location.href = "../index.html";
    return;
  }
  document.getElementById("headerColaborador").textContent = profile.full_name;
  wireTabs();
  await Promise.all([loadEquipes(), ]);
  wireEquipes();
  wireLugares();
  wireFuncionarios();
  wireHistorico();
  initDriveArchive({ getTeams: () => teamsCache, showToast, setLoading });
})();

document.getElementById("btnLogout").addEventListener("click", async () => {
  await logout();
  window.location.href = "../index.html";
});

/* ---------------------------------------------------------
   ABAS
--------------------------------------------------------- */
function wireTabs() {
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((p) => (p.hidden = true));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).hidden = false;
    });
  });
}

/* ---------------------------------------------------------
   EQUIPES (compartilhado entre abas)
--------------------------------------------------------- */
let teamsCache = [];

async function loadEquipes() {
  const { data, error } = await supabase.from("teams").select("id, name, created_at").order("name");
  if (error) { showToast("Erro ao carregar equipes."); return; }
  teamsCache = data || [];
  fillTeamSelects();
  renderEquipesList();
}

function fillTeamSelects() {
  const selects = [
    document.getElementById("selectEquipeLugares"),
    document.getElementById("novoFuncEquipe"),
    document.getElementById("selectEquipeHistorico")
  ];
  selects.forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = teamsCache.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    if (current) sel.value = current;
  });
}

function renderEquipesList() {
  const el = document.getElementById("listaEquipes");
  if (teamsCache.length === 0) { el.innerHTML = `<p class="admin-empty">Nenhuma equipe cadastrada ainda.</p>`; return; }
  el.innerHTML = teamsCache.map((t) => `
    <div class="admin-row" data-id="${t.id}">
      <span>${t.name}</span>
      <button type="button" class="btn-danger-sm" data-action="excluir-equipe">Excluir</button>
    </div>`).join("");
}

function wireEquipes() {
  document.getElementById("btnCriarEquipe").addEventListener("click", async () => {
    const input = document.getElementById("novaEquipeNome");
    const name = input.value.trim();
    if (!name) { showToast("Informe o nome da equipe."); return; }
    setLoading(true, "Criando equipe...");
    try {
      const { error } = await supabase.from("teams").insert({ name });
      if (error) throw error;
      input.value = "";
      await loadEquipes();
      showToast("Equipe criada.");
    } catch (err) {
      showToast("Erro ao criar equipe: " + err.message);
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("listaEquipes").addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="excluir-equipe"]');
    if (!btn) return;
    const row = btn.closest(".admin-row");
    const id = row.dataset.id;
    if (!confirm("Excluir esta equipe? Os lugares/sub-lugares dela também serão excluídos.")) return;
    setLoading(true, "Excluindo...");
    try {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
      await loadEquipes();
      showToast("Equipe excluída.");
    } catch (err) {
      showToast("Não foi possível excluir: pode haver funcionários ou rondas vinculadas a esta equipe.");
    } finally {
      setLoading(false);
    }
  });
}

/* ---------------------------------------------------------
   LUGARES / SUB-LUGARES
--------------------------------------------------------- */
const FREQ_LABELS = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };

function wireLugares() {
  const select = document.getElementById("selectEquipeLugares");
  select.addEventListener("change", () => loadLugares(select.value));
  document.getElementById("btnCriarLugar").addEventListener("click", async () => {
    const teamId = select.value;
    const input = document.getElementById("novoLugarNome");
    const freqSelect = document.getElementById("novoLugarFrequencia");
    const name = input.value.trim();
    const frequency = freqSelect.value || "diaria";
    if (!teamId) { showToast("Cadastre uma equipe primeiro."); return; }
    if (!name) { showToast("Informe o nome do lugar."); return; }
    setLoading(true, "Criando lugar...");
    try {
      const { count } = await supabase.from("places").select("id", { count: "exact", head: true }).eq("team_id", teamId);
      const { error } = await supabase.from("places").insert({ team_id: teamId, name, frequency, sort_order: (count || 0) + 1 });
      if (error) throw error;
      input.value = "";
      freqSelect.value = "diaria";
      await loadLugares(teamId);
      showToast("Lugar criado.");
    } catch (err) {
      showToast("Erro ao criar lugar: " + err.message);
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("listaLugares").addEventListener("click", async (e) => {
    const teamId = select.value;
    const addBtn = e.target.closest('[data-action="add-subplace"]');
    const delPlaceBtn = e.target.closest('[data-action="del-place"]');
    const delSubBtn = e.target.closest('[data-action="del-subplace"]');
    const editBtn = e.target.closest('[data-action="edit-place"]');
    const cancelBtn = e.target.closest('[data-action="cancel-place-edit"]');
    const saveBtn = e.target.closest('[data-action="save-place-edit"]');

    if (editBtn) {
      const card = editBtn.closest(".place-card");
      card.querySelector(".place-view").hidden = true;
      card.querySelector(".place-edit-row").hidden = false;
      return;
    }

    if (cancelBtn) {
      const card = cancelBtn.closest(".place-card");
      card.querySelector(".place-view").hidden = false;
      card.querySelector(".place-edit-row").hidden = true;
      return;
    }

    if (saveBtn) {
      const card = saveBtn.closest(".place-card");
      const placeId = card.dataset.id;
      const name = card.querySelector(".editar-lugar-nome").value.trim();
      const frequency = card.querySelector(".editar-lugar-frequencia").value;
      if (!name) { showToast("Informe o nome do lugar."); return; }
      setLoading(true, "Salvando...");
      try {
        const { error } = await supabase.from("places").update({ name, frequency }).eq("id", placeId);
        if (error) throw error;
        await loadLugares(teamId);
        showToast("Lugar atualizado.");
      } catch (err) {
        showToast("Erro ao salvar lugar: " + err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (addBtn) {
      const placeCard = addBtn.closest(".place-card");
      const input = placeCard.querySelector(".novo-sub-lugar-input");
      const name = input.value.trim();
      if (!name) { showToast("Informe o nome do sub-lugar."); return; }
      setLoading(true, "Criando sub-lugar...");
      try {
        const placeId = placeCard.dataset.id;
        const { count } = await supabase.from("sub_places").select("id", { count: "exact", head: true }).eq("place_id", placeId);
        const { error } = await supabase.from("sub_places").insert({ place_id: placeId, name, sort_order: (count || 0) + 1 });
        if (error) throw error;
        await loadLugares(teamId);
        showToast("Sub-lugar criado.");
      } catch (err) {
        showToast("Erro ao criar sub-lugar: " + err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (delPlaceBtn) {
      if (!confirm("Excluir este lugar e todos os seus sub-lugares?")) return;
      const placeId = delPlaceBtn.closest(".place-card").dataset.id;
      setLoading(true, "Excluindo...");
      try {
        const { error } = await supabase.from("places").delete().eq("id", placeId);
        if (error) throw error;
        await loadLugares(teamId);
      } catch (err) {
        showToast("Erro ao excluir lugar: " + err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (delSubBtn) {
      if (!confirm("Excluir este sub-lugar?")) return;
      const subId = delSubBtn.closest("[data-sub-id]").dataset.subId;
      setLoading(true, "Excluindo...");
      try {
        const { error } = await supabase.from("sub_places").delete().eq("id", subId);
        if (error) throw error;
        await loadLugares(teamId);
      } catch (err) {
        showToast("Erro ao excluir sub-lugar: " + err.message);
      } finally {
        setLoading(false);
      }
    }
  });

  wirePlaceDrag(select);
}

async function loadLugares(teamId) {
  const el = document.getElementById("listaLugares");
  if (!teamId) { el.innerHTML = ""; return; }
  const { data: places, error } = await supabase
    .from("places")
    .select("id, name, sort_order, frequency, sub_places(id, name, sort_order)")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });
  if (error) { showToast("Erro ao carregar lugares."); return; }

  if (!places || places.length === 0) {
    el.innerHTML = `<p class="admin-empty">Nenhum lugar cadastrado para esta equipe ainda.</p>`;
    return;
  }

  el.innerHTML = places.map((p) => {
    const subs = [...(p.sub_places || [])].sort((a, b) => a.sort_order - b.sort_order);
    const freq = p.frequency || "diaria";
    const nameEsc = escapeHtml(p.name);
    return `
      <div class="card place-card" data-id="${p.id}">
        <div class="place-header">
          <button type="button" class="drag-handle" data-action="drag-handle" aria-label="Arrastar para reordenar">⠿</button>
          <div class="place-view">
            <h3>${nameEsc}</h3>
            <span class="freq-badge freq-${freq}">${FREQ_LABELS[freq]}</span>
          </div>
          <div class="place-header-actions">
            <button type="button" class="btn-secondary-sm" data-action="edit-place">Editar</button>
            <button type="button" class="btn-danger-sm" data-action="del-place">Excluir lugar</button>
          </div>
        </div>
        <div class="place-edit-row" hidden>
          <input type="text" class="editar-lugar-nome" value="${nameEsc}">
          <select class="editar-lugar-frequencia">
            <option value="diaria" ${freq === "diaria" ? "selected" : ""}>Diária</option>
            <option value="semanal" ${freq === "semanal" ? "selected" : ""}>Semanal</option>
            <option value="mensal" ${freq === "mensal" ? "selected" : ""}>Mensal</option>
          </select>
          <button type="button" class="btn btn-primary" data-action="save-place-edit">Salvar</button>
          <button type="button" class="btn btn-secondary" data-action="cancel-place-edit">Cancelar</button>
        </div>
        <div class="sub-list">
          ${subs.map((s) => `
            <div class="admin-row" data-sub-id="${s.id}">
              <span>${escapeHtml(s.name)}</span>
              <button type="button" class="btn-danger-sm" data-action="del-subplace">Excluir</button>
            </div>`).join("") || '<p class="admin-empty">Sem sub-lugares.</p>'}
        </div>
        <div class="add-sub-row">
          <input type="text" class="novo-sub-lugar-input" placeholder="Novo sub-lugar (ex: Hall Social 1 e 2)">
          <button type="button" class="btn btn-secondary" data-action="add-subplace">Adicionar</button>
        </div>
      </div>`;
  }).join("");
}

/* ---------------------------------------------------------
   ARRASTAR PARA REORDENAR LUGARES (Pointer Events — funciona
   com mouse e toque, ao contrário da API nativa de Drag&Drop)
--------------------------------------------------------- */
function wirePlaceDrag(teamSelect) {
  const listaLugares = document.getElementById("listaLugares");
  let drag = null; // { card, placeholder, grabOffsetY }

  listaLugares.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest('[data-action="drag-handle"]');
    if (!handle) return;
    const card = handle.closest(".place-card");
    if (!card) return;
    e.preventDefault();

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "place-card-placeholder";
    placeholder.style.height = rect.height + "px";
    card.after(placeholder);

    drag = { card, placeholder, grabOffsetY: e.clientY - rect.top };
    card.style.position = "fixed";
    card.style.top = rect.top + "px";
    card.style.left = rect.left + "px";
    card.style.width = rect.width + "px";
    card.classList.add("dragging");

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });

  function onPointerMove(e) {
    if (!drag) return;
    drag.card.style.top = (e.clientY - drag.grabOffsetY) + "px";

    const siblings = [...listaLugares.querySelectorAll(".place-card")].filter((c) => c !== drag.card);
    let target = null;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = sib; break; }
    }
    if (target) {
      listaLugares.insertBefore(drag.placeholder, target);
    } else {
      listaLugares.appendChild(drag.placeholder);
    }
  }

  async function onPointerUp() {
    if (!drag) return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);

    const { card, placeholder } = drag;
    drag = null;
    placeholder.replaceWith(card);
    card.classList.remove("dragging");
    card.style.position = "";
    card.style.top = "";
    card.style.left = "";
    card.style.width = "";

    const teamId = teamSelect.value;
    const ids = [...listaLugares.querySelectorAll(".place-card")].map((c) => c.dataset.id);
    setLoading(true, "Salvando nova ordem...");
    try {
      await Promise.all(ids.map((id, i) => supabase.from("places").update({ sort_order: i + 1 }).eq("id", id)));
    } catch (err) {
      showToast("Erro ao salvar a nova ordem: " + err.message);
      await loadLugares(teamId);
    } finally {
      setLoading(false);
    }
  }
}

/* ---------------------------------------------------------
   FUNCIONÁRIOS
--------------------------------------------------------- */
function wireFuncionarios() {
  loadFuncionarios();

  document.getElementById("btnCriarFunc").addEventListener("click", async () => {
    const fullName = document.getElementById("novoFuncNome").value.trim();
    const username = document.getElementById("novoFuncUsuario").value.trim().toLowerCase();
    const password = document.getElementById("novoFuncSenha").value;
    const teamId = document.getElementById("novoFuncEquipe").value;

    if (!fullName || !username || !password || !teamId) { showToast("Preencha todos os campos."); return; }
    if (password.length < 6) { showToast("A senha precisa ter ao menos 6 caracteres."); return; }

    setLoading(true, "Cadastrando funcionário...");
    try {
      await adminCreateEmployee({ username, password, fullName, teamId });
      document.getElementById("novoFuncNome").value = "";
      document.getElementById("novoFuncUsuario").value = "";
      document.getElementById("novoFuncSenha").value = "";
      await loadFuncionarios();
      showToast("Funcionário cadastrado.");
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("listaFuncionarios").addEventListener("click", async (e) => {
    const row = e.target.closest(".admin-row");
    if (!row) return;
    const id = row.dataset.id;

    if (e.target.closest('[data-action="toggle-ativo"]')) {
      const active = row.dataset.active === "true";
      setLoading(true, "Atualizando...");
      try {
        const { error } = await supabase.from("profiles").update({ active: !active }).eq("id", id);
        if (error) throw error;
        await loadFuncionarios();
      } catch (err) {
        showToast("Erro: " + err.message);
      } finally {
        setLoading(false);
      }
    }

    if (e.target.closest('[data-action="resetar-senha"]')) {
      const nova = prompt("Nova senha para este funcionário (mínimo 6 caracteres):");
      if (!nova) return;
      if (nova.length < 6) { showToast("Senha muito curta."); return; }
      setLoading(true, "Redefinindo senha...");
      try {
        await adminResetPassword(id, nova);
        showToast("Senha redefinida.");
      } catch (err) {
        showToast(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (e.target.closest('[data-action="excluir-func"]')) {
      if (!confirm("Excluir este funcionário? Ele perderá o acesso ao app imediatamente.")) return;
      setLoading(true, "Excluindo...");
      try {
        const { error } = await supabase.from("profiles").delete().eq("id", id);
        if (error) throw error;
        await loadFuncionarios();
        showToast("Funcionário excluído.");
      } catch (err) {
        showToast("Erro ao excluir: " + err.message);
      } finally {
        setLoading(false);
      }
    }
  });
}

async function loadFuncionarios() {
  const el = document.getElementById("listaFuncionarios");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, active, team_id, teams(name)")
    .eq("role", "operacional")
    .order("full_name");
  if (error) { showToast("Erro ao carregar funcionários."); return; }

  if (!data || data.length === 0) {
    el.innerHTML = `<p class="admin-empty">Nenhum funcionário cadastrado ainda.</p>`;
    return;
  }

  el.innerHTML = data.map((f) => `
    <div class="admin-row admin-row-func" data-id="${f.id}" data-active="${f.active}">
      <div class="func-info">
        <strong>${f.full_name}</strong>
        <span>@${f.username} • ${f.teams ? f.teams.name : "sem equipe"} • ${f.active ? "ativo" : "desativado"}</span>
      </div>
      <div class="func-actions">
        <button type="button" class="btn-secondary-sm" data-action="toggle-ativo">${f.active ? "Desativar" : "Ativar"}</button>
        <button type="button" class="btn-secondary-sm" data-action="resetar-senha">Redefinir senha</button>
        <button type="button" class="btn-danger-sm" data-action="excluir-func">Excluir</button>
      </div>
    </div>`).join("");
}

/* ---------------------------------------------------------
   HISTÓRICO
--------------------------------------------------------- */
function wireHistorico() {
  const select = document.getElementById("selectEquipeHistorico");
  select.addEventListener("change", () => loadHistorico(select.value));
  if (select.value) loadHistorico(select.value);
}

async function loadHistorico(teamId) {
  const el = document.getElementById("listaHistorico");
  if (!teamId) { el.innerHTML = ""; return; }
  const { data, error } = await supabase
    .from("rondas")
    .select("id, turno, frequency, started_at, finished_at, archived_at, drive_file_link, profiles(full_name)")
    .eq("team_id", teamId)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) { showToast("Erro ao carregar histórico."); return; }

  if (!data || data.length === 0) {
    el.innerHTML = `<p class="admin-empty">Nenhuma ronda registrada para esta equipe ainda.</p>`;
    return;
  }

  el.innerHTML = data.map((r) => `
    <div class="card ronda-card" data-id="${r.id}">
      <div class="ronda-header" data-action="toggle-ronda">
        <div>
          <strong>${r.profiles ? r.profiles.full_name : "—"}</strong>
          <span>${formatDate(r.started_at)} • ${r.turno || (r.frequency ? FREQ_LABELS[r.frequency] : "—")} • ${r.finished_at ? "concluída" : "em andamento"}${r.archived_at ? " • arquivada no Drive" : ""}</span>
        </div>
        ${r.archived_at && r.drive_file_link
          ? `<a href="${r.drive_file_link}" target="_blank" rel="noopener" class="btn-secondary-sm" data-action="ver-drive">Ver no Drive</a>`
          : `<button type="button" class="btn-secondary-sm" data-action="gerar-pdf-historico">Gerar PDF</button>`}
      </div>
      <div class="ronda-items" hidden></div>
    </div>`).join("");
}

document.getElementById("listaHistorico").addEventListener("click", async (e) => {
  const card = e.target.closest(".ronda-card");
  if (!card) return;
  const rondaId = card.dataset.id;

  if (
    e.target.closest('[data-action="toggle-ronda"]') &&
    !e.target.closest('[data-action="gerar-pdf-historico"]') &&
    !e.target.closest('[data-action="ver-drive"]')
  ) {
    const itemsEl = card.querySelector(".ronda-items");
    if (itemsEl.hidden) {
      itemsEl.hidden = false;
      await renderRondaItems(rondaId, itemsEl);
    } else {
      itemsEl.hidden = true;
    }
  }

  if (e.target.closest('[data-action="gerar-pdf-historico"]')) {
    await gerarPdfHistorico(rondaId, card);
  }
});

async function renderRondaItems(rondaId, container) {
  container.innerHTML = `<p class="admin-empty">Carregando...</p>`;
  try {
    const { items } = await fetchRondaItemsData(rondaId);
    if (items.length === 0) {
      container.innerHTML = `<p class="admin-empty">Nenhuma área registrada nesta ronda.</p>`;
      return;
    }
    const withUrls = await Promise.all(items.map(async (it) => {
      let url = null;
      if (it.photo_storage_path) {
        const { data } = await supabase.storage.from("ronda-photos").createSignedUrl(it.photo_storage_path, 3600);
        url = data ? data.signedUrl : null;
      }
      return { ...it, url };
    }));
    container.innerHTML = withUrls.map((it) => `
      <div class="ronda-item">
        <div class="ronda-item-title">
          ${it.sub_places ? it.sub_places.name : "—"}
          <span>${formatDateTime(it.captured_at)}</span>
        </div>
        ${it.url ? `<img src="${it.url}" class="ronda-item-photo" alt="Foto">` : '<p class="admin-empty">Sem foto.</p>'}
        <p class="ronda-item-obs">${it.observation ? it.observation : "Sem observações."}</p>
      </div>`).join("");
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">Erro ao carregar: ${err.message}</p>`;
  }
}

async function gerarPdfHistorico(rondaId) {
  setLoading(true, "Gerando PDF...");
  try {
    const { blob } = await gerarPdfParaRonda(rondaId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Ronda_${rondaId.slice(0, 8)}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    console.error(err);
    showToast("Erro ao gerar PDF: " + err.message);
  } finally {
    setLoading(false);
  }
}
