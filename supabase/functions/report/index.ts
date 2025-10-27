import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { frameData, reporterCountry, reportedCountry, metadata } = await req.json();

    // Validate required fields
    if (!frameData) {
      return new Response(
        JSON.stringify({ error: 'Frame data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert base64 frame to blob and upload to storage
    let frameUrl = null;
    
    try {
      // Decode base64 image
      const base64Data = frameData.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      // Generate unique filename
      const filename = `report_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('report-frames')
        .upload(filename, binaryData, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
      } else {
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('report-frames')
          .getPublicUrl(filename);
        
        frameUrl = urlData.publicUrl;
      }
    } catch (storageError) {
      console.error('Storage error:', storageError);
      // Continue without frame URL - report is still valid
    }

    // Insert report into database
    const { data, error } = await supabase
      .from('reports')
      .insert({
        frame_url: frameUrl,
        reporter_country: reporterCountry || 'unknown',
        reported_country: reportedCountry || 'unknown',
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to save report' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Report saved:', data.id);

    return new Response(
      JSON.stringify({
        success: true,
        reportId: data.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Report error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
