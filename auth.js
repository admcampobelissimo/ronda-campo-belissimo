import { supabase } from "./supabase-client.js";
import { FAKE_EMAIL_DOMAIN } from "./config.js";

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, team_id, active")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

// Faz login e devolve o profile (papel, equipe, etc). Lança erro com
// mensagem amigável em português em caso de usuário/senha inválidos
// ou conta desativada.
export async function login(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password
  });
  if (error) {
    throw new Error("Usuário ou senha inválidos.");
  }
  let profile;
  try {
    profile = await fetchProfile(data.user.id);
  } catch (e) {
    await supabase.auth.signOut();
    throw new Error("Usuário sem cadastro ativo. Fale com o administrador.");
  }
  if (!profile.active) {
    await supabase.auth.signOut();
    throw new Error("Este usuário foi desativado. Fale com o administrador.");
  }
  return profile;
}

// Verifica se já existe uma sessão válida (ex: ao recarregar a página) e
// devolve o profile correspondente, ou null se não estiver logado.
export async function getSessionProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    const profile = await fetchProfile(session.user.id);
    if (!profile.active) {
      await supabase.auth.signOut();
      return null;
    }
    return profile;
  } catch (e) {
    return null;
  }
}

export async function logout() {
  await supabase.auth.signOut();
}

// Usado só pelo painel do administrador para cadastrar um novo funcionário.
// Cria o usuário já confirmado direto no banco (função admin_create_employee em
// schema.sql), sem depender do cadastro público do Supabase (que exigiria e-mail
// de verdade) e sem afetar a sessão do admin logado.
export async function adminCreateEmployee({ username, password, fullName, teamId }) {
  const { data, error } = await supabase.rpc("admin_create_employee", {
    p_username: username.trim().toLowerCase(),
    p_password: password,
    p_full_name: fullName,
    p_team_id: teamId
  });
  if (error) throw new Error("Não foi possível criar o funcionário: " + error.message);
  return data;
}

export async function adminResetPassword(targetUserId, newPassword) {
  const { error } = await supabase.rpc("admin_reset_password", {
    target_user_id: targetUserId,
    new_password: newPassword
  });
  if (error) throw new Error("Não foi possível redefinir a senha: " + error.message);
}
