import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(supabaseUrl, serviceKey);

  // Get columns of vehicles table
  const { data: columns, error: colErr } = await client
    .from('information_schema.columns')
    .select('column_name, data_type')
    .eq('table_name', 'vehicles')
    .eq('table_schema', 'public');

  // Get RLS policies
  const { data: policies, error: polErr } = await client
    .from('pg_policies')
    .select('*')
    .eq('tablename', 'vehicles');

  return Response.json({ columns, policies, colErr, polErr });
});