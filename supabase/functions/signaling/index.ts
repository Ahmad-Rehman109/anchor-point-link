import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Store signaling messages temporarily
const signalingQueue: Map<string, any[]> = new Map();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, userId, peerId, signal } = await req.json();

    if (action === 'send_signal') {
      // Store signal for the peer to retrieve
      if (!signalingQueue.has(peerId)) {
        signalingQueue.set(peerId, []);
      }
      
      signalingQueue.get(peerId)!.push({
        from: userId,
        signal,
        timestamp: Date.now()
      });

      console.log(`Signal stored for ${peerId} from ${userId}`);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_signals') {
      const signals = signalingQueue.get(userId) || [];
      
      // Clean up old signals (older than 30 seconds)
      const now = Date.now();
      const validSignals = signals.filter(s => now - s.timestamp < 30000);
      
      // Clear the queue for this user
      signalingQueue.set(userId, []);

      console.log(`Retrieved ${validSignals.length} signals for ${userId}`);

      return new Response(
        JSON.stringify({ signals: validSignals }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Signaling error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
