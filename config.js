// Projeto Supabase "Rondas Belíssimo".
// Use sempre a chave publicável (sb_publishable_...) — nunca a secreta (sb_secret_...).
export const SUPABASE_URL = "https://vhdsbvmmkxhhhrcbelqq.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_iUCwxK9KYDV032Z2yQN0rw_sE1TrQ1b";

// Domínio "técnico" usado só internamente para transformar "usuário" em e-mail,
// já que o Supabase Auth exige um formato de e-mail válido (com servidor de e-mail
// de verdade por trás) para aceitar o cadastro. Ninguém digita isso, e nenhum
// e-mail de verdade é enviado a ninguém — é só o formato interno do login.
export const FAKE_EMAIL_DOMAIN = "gmail.com";

export const CONDO_NOME = "Condomínio Campo Belíssimo";

// Preenchido depois que você criar o projeto no Google Cloud Console
// (Credentials > OAuth client ID > Web application). Esse ID é seguro de
// expor no código — a segurança vem da origem autorizada (o domínio do site),
// não do sigilo do ID, assim como a anon key do Supabase acima.
export const GOOGLE_OAUTH_CLIENT_ID = "682915053310-uhrjnublpnuji5hjn5icsghktukbbocg.apps.googleusercontent.com";

// Nome da pasta criada (uma única vez) no Google Drive do administrador
// para guardar os arquivos de rondas arquivadas.
export const GOOGLE_DRIVE_FOLDER_NAME = "Ronda Campo Belíssimo - Arquivo";
