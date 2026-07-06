import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Cliente único usado por toda a aplicação (login/logout, leituras e escritas).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
