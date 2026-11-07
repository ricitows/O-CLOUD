declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

declare module 'npm:@supabase/supabase-js@2' {
  export { createClient } from '@supabase/supabase-js';
  export type { SupabaseClient, User } from '@supabase/supabase-js';
}
