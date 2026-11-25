// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawToken = Deno.env.get('UPLOADTHING_TOKEN');
    if (!rawToken) {
      return new Response(JSON.stringify({ error: 'UPLOADTHING_TOKEN is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const decoded = JSON.parse(atob(rawToken));
    const apiKey = decoded.apiKey as string;
    const appId = decoded.appId as string;

    const body = await req.json();
    const fileName = typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim()
      : `pinpoint-${Date.now()}.jpg`;
    const fileSize = Number(body.fileSize) > 0 ? Number(body.fileSize) : 1024;
    const fileType = typeof body.fileType === 'string' ? body.fileType : 'image/jpeg';

    const utRes = await fetch('https://api.uploadthing.com/v7/prepareUpload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Uploadthing-Api-Key': apiKey,
        'x-uploadthing-version': '7.7.4',
      },
      body: JSON.stringify({
        fileName,
        fileSize,
        fileType,
        acl: 'public-read',
      }),
    });

    if (!utRes.ok) {
      const errText = await utRes.text();
      return new Response(JSON.stringify({ error: `UploadThing prepare failed: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const utData = await utRes.json();
    const publicUrl = appId
      ? `https://${appId}.ufs.sh/f/${utData.key}`
      : `https://utfs.io/f/${utData.key}`;

    return new Response(
      JSON.stringify({
        uploadUrl: utData.url,
        key: utData.key,
        publicUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
