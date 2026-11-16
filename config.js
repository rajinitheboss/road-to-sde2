// Supabase connection. Find both values in Supabase → Project Settings → API.
// The anon key is meant to be public: the database's row-level security (see supabase/migrations)
// is what stops anyone reading or changing your progress. Never put the service_role key here.
window.SDE2_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefgh.supabase.co"
  supabaseAnonKey: ""   // the "anon public" key
};
