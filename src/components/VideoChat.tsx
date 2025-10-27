import { useEffect, useRef, useState } from 'react';
import { WebRTCConnection, captureVideoFrame } from '@/utils/webrtc';
import { nsfwDetector } from '@/utils/nsfwDetection';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SkipForward, Phone, AlertTriangle, Video, VideoOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ConnectionStatus from './ConnectionStatus';
import ReportDialog from './ReportDialog';
import type { RealtimeChannel } from '@supabase/supabase-js';

type ConnectionState = 'idle' | 'searching' | 'connected' | 'disconnected';

const VideoChat = () => {
  const { toast } = useToast();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection | null>(null);
  const sessionFramesRef = useRef<string[]>([]);
  const nsfwCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const isInitiatorRef = useRef<boolean>(false);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isNSFWDetected, setIsNSFWDetected] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    // Initialize NSFW detector
    nsfwDetector.init().catch(console.error);

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
      webrtcRef.current = null;
    }
    if (nsfwCheckIntervalRef.current) {
      clearInterval(nsfwCheckIntervalRef.current);
      nsfwCheckIntervalRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    sessionFramesRef.current = [];
    peerIdRef.current = null;
  };

  const startNSFWMonitoring = () => {
    if (nsfwCheckIntervalRef.current) {
      clearInterval(nsfwCheckIntervalRef.current);
    }

    nsfwCheckIntervalRef.current = setInterval(async () => {
      if (!remoteVideoRef.current || !nsfwDetector.isReady()) return;

      try {
        const result = await nsfwDetector.classify(remoteVideoRef.current);
        
        if (result.isNSFW) {
          console.warn('NSFW content detected:', result.confidence);
          setIsNSFWDetected(true);
          
          toast({
            title: 'Inappropriate Content Detected',
            description: 'The video has been blurred. Skipping to next user...',
            variant: 'destructive',
          });

          // Auto-skip after 2 seconds
          setTimeout(() => {
            handleSkip();
          }, 2000);
        } else {
          setIsNSFWDetected(false);
        }
      } catch (error) {
        console.error('NSFW detection error:', error);
      }
    }, 5000); // Check every 5 seconds
  };

  const startSearch = async () => {
    setConnectionState('searching');
    console.log('[VideoChat] Starting search, userId:', userId);
    
    try {
      // Initialize WebRTC
      webrtcRef.current = new WebRTCConnection({
        onRemoteStream: (stream) => {
          console.log('[VideoChat] Remote stream received');
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            
            // Start NSFW monitoring once remote stream is available
            startNSFWMonitoring();
          }
        },
        onIceCandidate: async (candidate) => {
          console.log('[VideoChat] ICE candidate generated');
          if (peerIdRef.current) {
            await sendSignal(peerIdRef.current, { type: 'ice-candidate', candidate });
          }
        },
        onConnectionStateChange: (state) => {
          console.log('[VideoChat] Connection state changed to:', state);
          if (state === 'connected') {
            setConnectionState('connected');
            
            // Capture initial frame
            captureSessionFrame();
          } else if (state === 'disconnected' || state === 'failed') {
            handleDisconnect();
          }
        },
      });

      // Get local stream with detailed error handling
      try {
        const localStream = await webrtcRef.current.initLocalStream();
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
        console.log('[VideoChat] Local stream initialized');
      } catch (mediaError: any) {
        console.warn('[VideoChat] Media access failed, continuing without camera:', mediaError.name);
        // Continue anyway for testing purposes
        toast({
          title: 'Camera unavailable',
          description: 'Continuing in test mode without video',
        });
      }

      // Start matchmaking
      await findMatch();
    } catch (error: any) {
      console.error('[VideoChat] Error starting chat:', error);
      
      toast({
        title: 'Error',
        description: 'Failed to start. Check console for details.',
        variant: 'destructive',
        duration: 5000,
      });
      setConnectionState('idle');
      cleanup();
    }
  };

  const findMatch = async () => {
    setConnectionState('searching');
    console.log('[Realtime] Joining matchmaking channel...');

    // Clean up any previous channel
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }

    const channel = supabase.channel('blinkchat_match', {
      config: { presence: { key: userId } },
    });

    signalChannelRef.current = channel;

    // Listen for signals targeted at me
    channel.on('broadcast', { event: `signal:${userId}` }, async ({ payload }) => {
      console.log('[Realtime] 📥 Signal received via broadcast:', payload?.type);
      await handleSignal(payload);
    });

    // Helper to check for matches
    const checkForMatch = async () => {
      const state = channel.presenceState() as Record<string, any[]>;
      const users = Object.keys(state);
      console.log('[Realtime] Checking for match. Users online:', users);

      const candidates = users.filter((u) => u !== userId);
      if (!peerIdRef.current && candidates.length > 0) {
        const peerId = candidates[0];
        peerIdRef.current = peerId;
        isInitiatorRef.current = userId < peerId;
        console.log('[Realtime] ✅ Match found:', peerId, 'initiator?', isInitiatorRef.current);

        toast({
          title: 'Match Found!',
          description: 'Connecting to your chat partner...',
        });

        if (isInitiatorRef.current) {
          await initiateConnection();
        }
      }
    };

    // Presence-based matchmaking
    channel.on('presence', { event: 'sync' }, checkForMatch);
    channel.on('presence', { event: 'join' }, async ({ key, newPresences }) => {
      console.log('[Realtime] User joined:', key);
      await checkForMatch();
    });

    await channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] Subscribed to matchmaking. Tracking presence...');
        await channel.track({ userId, online_at: new Date().toISOString() });
      }
    });
  };

  const sendSignal = async (peerId: string, signal: any) => {
    try {
      console.log('[Signaling][Realtime] 📤 Sending signal to', peerId, ':', signal.type);
      if (!signalChannelRef.current) {
        console.warn('[Signaling][Realtime] No active channel to send signal');
        return;
      }
      await signalChannelRef.current.send({
        type: 'broadcast',
        event: `signal:${peerId}`,
        payload: signal,
      });
      console.log('[Signaling][Realtime] ✅ Signal broadcasted');
    } catch (error) {
      console.error('[Signaling][Realtime] Exception sending signal:', error);
    }
  };

  const initiateConnection = async () => {
    if (!webrtcRef.current) {
      console.error('[WebRTC] Cannot initiate - no connection object');
      return;
    }

    try {
      console.log('[WebRTC] Creating offer...');
      const offer = await webrtcRef.current.createOffer();
      console.log('[WebRTC] ✅ Offer created:', offer);
      
      if (peerIdRef.current) {
        await sendSignal(peerIdRef.current, { type: 'offer', sdp: offer });
      }
    } catch (error) {
      console.error('[WebRTC] Error creating offer:', error);
    }
  };

  const startSignalPolling = () => {
    console.log('[Signaling] Polling disabled; using Realtime channels.');
  };

  const handleSignal = async (signal: any) => {
    if (!webrtcRef.current) {
      console.error('[WebRTC] Cannot handle signal - no connection object');
      return;
    }

    console.log('[WebRTC] 📨 Received signal:', signal.type);

    try {
      if (signal.type === 'offer') {
        console.log('[WebRTC] Processing offer...');
        await webrtcRef.current.setRemoteDescription(signal.sdp);
        console.log('[WebRTC] Creating answer...');
        const answer = await webrtcRef.current.createAnswer();
        console.log('[WebRTC] ✅ Answer created');
        
        if (peerIdRef.current) {
          await sendSignal(peerIdRef.current, { type: 'answer', sdp: answer });
        }
      } else if (signal.type === 'answer') {
        console.log('[WebRTC] Processing answer...');
        await webrtcRef.current.setRemoteDescription(signal.sdp);
        console.log('[WebRTC] ✅ Answer processed');
      } else if (signal.type === 'ice-candidate') {
        console.log('[WebRTC] Adding ICE candidate...');
        await webrtcRef.current.addIceCandidate(signal.candidate);
        console.log('[WebRTC] ✅ ICE candidate added');
      }
    } catch (error) {
      console.error('[WebRTC] Error handling signal:', error);
    }
  };

  const captureSessionFrame = () => {
    if (remoteVideoRef.current) {
      const frame = captureVideoFrame(remoteVideoRef.current);
      if (frame) {
        sessionFramesRef.current.push(frame);
        // Keep only last 5 frames
        if (sessionFramesRef.current.length > 5) {
          sessionFramesRef.current.shift();
        }
      }
    }
  };

  const handleSkip = async () => {
    // Capture final frame before skipping
    captureSessionFrame();
    
    cleanup();
    setConnectionState('searching');
    
    toast({
      title: 'Searching',
      description: 'Looking for a new chat partner...',
    });

    // Start new search
    await findMatch();
  };

  const handleEndChat = () => {
    cleanup();
    setConnectionState('idle');
    sessionFramesRef.current = [];
    
    toast({
      title: 'Chat Ended',
      description: 'You have left the chat.',
    });
  };

  const toggleVideo = () => {
    const localStream = webrtcRef.current?.getLocalStream();
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(videoTrack.enabled);
    }
  };

  const handleDisconnect = () => {
    toast({
      title: 'Partner Disconnected',
      description: 'Your chat partner has left. Searching for a new match...',
    });
    
    cleanup();
    setConnectionState('searching');
    findMatch();
  };

  const getLatestFrame = () => {
    return sessionFramesRef.current[sessionFramesRef.current.length - 1] || null;
  };

  return (
    <div className="relative w-full h-screen flex flex-col bg-background overflow-hidden">
      {/* Header with status */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4 bg-gradient-to-b from-black/50 to-transparent">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold gradient-text">BlinkChat</h1>
            <span className="text-sm text-muted-foreground">Meet someone new in a blink</span>
          </div>
          <ConnectionStatus state={connectionState} />
        </div>
      </div>

      {/* Video Grid - Split Screen */}
      <div className="relative w-full h-full flex flex-col">
        {/* Remote Video (top half) */}
        <div className="relative w-full h-1/2 overflow-hidden bg-card border-b border-border">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isNSFWDetected ? 'blur-3xl' : ''}`}
          />
          
          {connectionState === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/95 z-10">
              <div className="text-center space-y-6 px-4">
                <div className="w-32 h-32 mx-auto bg-gradient-primary rounded-full flex items-center justify-center shadow-[var(--shadow-glow)]">
                  <Video className="w-16 h-16 text-white" />
                </div>
                <h2 className="text-3xl font-bold">Ready to Connect?</h2>
                <p className="text-muted-foreground max-w-md">
                  Click "Start Chat" to be randomly paired with someone new for a video conversation
                </p>
                <Button 
                  size="lg"
                  onClick={startSearch}
                  className="bg-gradient-primary hover:opacity-90 text-white font-semibold shadow-[var(--shadow-glow)]"
                >
                  Start Chat
                </Button>
              </div>
            </div>
          )}

          {connectionState === 'searching' && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/95 z-10">
              <div className="text-center space-y-4">
                <div className="w-20 h-20 mx-auto border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <h2 className="text-2xl font-bold">Finding Someone...</h2>
                <p className="text-muted-foreground">This usually takes a few seconds</p>
              </div>
            </div>
          )}

          {isNSFWDetected && (
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/20 z-10">
              <div className="text-center space-y-4 p-8 bg-card/90 rounded-2xl backdrop-blur-sm">
                <AlertTriangle className="w-16 h-16 mx-auto text-destructive" />
                <h3 className="text-xl font-bold">Inappropriate Content Detected</h3>
                <p className="text-muted-foreground">Skipping to next user...</p>
              </div>
            </div>
          )}
        </div>

        {/* Local Video (bottom half) */}
        <div className="relative w-full h-1/2 overflow-hidden bg-card">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover mirror"
          />
          {!isVideoEnabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <VideoOff className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Controls - Below videos */}
        {connectionState !== 'idle' && (
          <div className="absolute bottom-0 left-0 right-0 z-30 p-6 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center justify-center gap-4 max-w-7xl mx-auto">
              <Button
                size="lg"
                variant="secondary"
                onClick={toggleVideo}
                className="rounded-full w-14 h-14 p-0"
              >
                {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </Button>

              <Button
                size="lg"
                onClick={handleSkip}
                disabled={connectionState !== 'connected'}
                className="bg-accent hover:bg-accent/90 text-white rounded-full px-8"
              >
                <SkipForward className="w-5 h-5 mr-2" />
                Skip
              </Button>

              <Button
                size="lg"
                variant="destructive"
                onClick={handleEndChat}
                className="rounded-full w-14 h-14 p-0"
              >
                <Phone className="w-5 h-5" />
              </Button>

              <Button
                size="lg"
                variant="outline"
                onClick={() => setReportDialogOpen(true)}
                disabled={connectionState !== 'connected'}
                className="rounded-full w-14 h-14 p-0 border-destructive text-destructive hover:bg-destructive hover:text-white"
              >
                <AlertTriangle className="w-5 h-5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ReportDialog 
        open={reportDialogOpen}
        onOpenChange={setReportDialogOpen}
        frameData={getLatestFrame()}
      />

      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
};

export default VideoChat;
