import { useEffect, useRef, useState } from 'react';
import { WebRTCConnection, captureVideoFrame } from '@/utils/webrtc';
import { nsfwDetector } from '@/utils/nsfwDetection';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SkipForward, Phone, AlertTriangle, Video, VideoOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ConnectionStatus from './ConnectionStatus';
import ReportDialog from './ReportDialog';

type ConnectionState = 'idle' | 'searching' | 'connected' | 'disconnected';

const VideoChat = () => {
  const { toast } = useToast();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection | null>(null);
  const sessionFramesRef = useRef<string[]>([]);
  const nsfwCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    if (webrtcRef.current) {
      webrtcRef.current.disconnect();
      webrtcRef.current = null;
    }
    if (nsfwCheckIntervalRef.current) {
      clearInterval(nsfwCheckIntervalRef.current);
      nsfwCheckIntervalRef.current = null;
    }
    sessionFramesRef.current = [];
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
    
    try {
      // Initialize WebRTC
      webrtcRef.current = new WebRTCConnection({
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            
            // Start NSFW monitoring once remote stream is available
            startNSFWMonitoring();
          }
        },
        onConnectionStateChange: (state) => {
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
      const localStream = await webrtcRef.current.initLocalStream();
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      // Start matchmaking
      await findMatch();
    } catch (error: any) {
      console.error('Error starting chat:', error);
      
      let errorMessage = 'Failed to access camera/microphone.';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Camera/microphone access denied. Please allow permissions in your browser settings and try again.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera or microphone found. Please connect a device and try again.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera/microphone is already in use by another application.';
      }
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
        duration: 5000,
      });
      setConnectionState('idle');
      cleanup();
    }
  };

  const findMatch = async () => {
    const maxAttempts = 30; // Try for 30 seconds
    let attempts = 0;

    const matchInterval = setInterval(async () => {
      if (attempts >= maxAttempts) {
        clearInterval(matchInterval);
        toast({
          title: 'No Match Found',
          description: 'Could not find anyone to chat with. Please try again.',
        });
        setConnectionState('idle');
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('matchmaking', {
          body: {
            action: 'find_match',
            userId,
            socketId: userId,
          },
        });

        if (error) throw error;

        if (data.matched) {
          clearInterval(matchInterval);
          console.log('Match found!');
          
          // Exchange WebRTC offers (simplified signaling)
          // In production, use WebSocket signaling server
          toast({
            title: 'Match Found!',
            description: 'Connecting to your chat partner...',
          });
        }
      } catch (error) {
        console.error('Matchmaking error:', error);
      }

      attempts++;
    }, 1000);
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
    <div className="relative w-full h-screen flex flex-col bg-background">
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

      {/* Video Grid */}
      <div className="flex-1 relative flex items-center justify-center p-4 pt-20 pb-24">
        {/* Remote Video (main) */}
        <div className="relative w-full h-full max-w-7xl rounded-2xl overflow-hidden bg-card border-2 border-border shadow-[var(--shadow-strong)]">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isNSFWDetected ? 'blur-3xl' : ''}`}
          />
          
          {connectionState === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/95">
              <div className="text-center space-y-6">
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
            <div className="absolute inset-0 flex items-center justify-center bg-card/95">
              <div className="text-center space-y-4">
                <div className="w-20 h-20 mx-auto border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <h2 className="text-2xl font-bold">Finding Someone...</h2>
                <p className="text-muted-foreground">This usually takes a few seconds</p>
              </div>
            </div>
          )}

          {isNSFWDetected && (
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
              <div className="text-center space-y-4 p-8 bg-card/90 rounded-2xl backdrop-blur-sm">
                <AlertTriangle className="w-16 h-16 mx-auto text-destructive" />
                <h3 className="text-xl font-bold">Inappropriate Content Detected</h3>
                <p className="text-muted-foreground">Skipping to next user...</p>
              </div>
            </div>
          )}
        </div>

        {/* Local Video (PiP) */}
        <div className="absolute bottom-28 right-8 w-48 h-36 rounded-xl overflow-hidden bg-card border-2 border-border shadow-lg">
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
      </div>

      {/* Controls */}
      {connectionState !== 'idle' && (
        <div className="absolute bottom-0 left-0 right-0 z-20 p-6 bg-gradient-to-t from-black/50 to-transparent">
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
