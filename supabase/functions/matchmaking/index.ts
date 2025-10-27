import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory queue for matching users
// In production, use Redis or a database
const waitingUsers: { id: string; socketId: string; timestamp: number }[] = [];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, userId, socketId } = await req.json();

    if (action === 'find_match') {
      // Clean up old waiting users (older than 30 seconds)
      const now = Date.now();
      const validUsers = waitingUsers.filter(u => now - u.timestamp < 30000);
      waitingUsers.length = 0;
      waitingUsers.push(...validUsers);

      // Try to find a match
      if (waitingUsers.length > 0 && waitingUsers[0].id !== userId) {
        const match = waitingUsers.shift()!;
        
        console.log(`Match found: ${userId} <-> ${match.id}`);
        
        return new Response(
          JSON.stringify({
            matched: true,
            peerId: match.id,
            peerSocketId: match.socketId,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No match found, add to queue
      waitingUsers.push({ id: userId, socketId, timestamp: now });
      console.log(`User ${userId} added to queue. Queue size: ${waitingUsers.length}`);

      return new Response(
        JSON.stringify({
          matched: false,
          queuePosition: waitingUsers.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'leave_queue') {
      const index = waitingUsers.findIndex(u => u.id === userId);
      if (index !== -1) {
        waitingUsers.splice(index, 1);
        console.log(`User ${userId} left queue. Queue size: ${waitingUsers.length}`);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Matchmaking error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
