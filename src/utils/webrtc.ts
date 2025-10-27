export interface WebRTCConfig {
  onRemoteStream?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private config: WebRTCConfig;

  constructor(config: WebRTCConfig = {}) {
    this.config = config;
    
    // Initialize peer connection with STUN/TURN servers
    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    // Optional TURN (set VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL)
    const turnUrl = (import.meta as any)?.env?.VITE_TURN_URL as string | undefined;
    const turnUsername = (import.meta as any)?.env?.VITE_TURN_USERNAME as string | undefined;
    const turnCredential = (import.meta as any)?.env?.VITE_TURN_CREDENTIAL as string | undefined;

    if (turnUrl && turnUsername && turnCredential) {
      const urls = turnUrl.split(',').map(u => u.trim());
      console.log('[WebRTC] Using TURN server(s):', urls);
      iceServers.push({ urls, username: turnUsername, credential: turnCredential });
    } else {
      console.log('[WebRTC] No TURN configured. Connectivity may fail on strict NATs.');
    }

    this.pc = new RTCPeerConnection({
      iceServers,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle incoming remote stream
    this.pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (this.config.onRemoteStream) {
        this.config.onRemoteStream(event.streams[0]);
      }
    };

    // Handle ICE candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.config.onIceCandidate) {
        this.config.onIceCandidate(event.candidate);
      }
    };

    // Handle connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log('Connection state:', this.pc.connectionState);
      if (this.config.onConnectionStateChange) {
        this.config.onConnectionStateChange(this.pc.connectionState);
      }
    };

    // Handle ICE connection state changes
    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.pc.iceConnectionState);
    };
  }

  async initLocalStream(): Promise<MediaStream> {
    try {
      console.log('[WebRTC] Requesting media devices...');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log('[WebRTC] ✅ Media devices acquired');

      // Add tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        console.log('[WebRTC] Adding track:', track.kind);
        this.pc.addTrack(track, this.localStream!);
      });

      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] ❌ Error accessing media devices:', error);
      throw error;
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    console.log('[WebRTC] Creating offer...');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log('[WebRTC] Local description set (offer)');
    return offer;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    console.log('[WebRTC] Creating answer...');
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    console.log('[WebRTC] Local description set (answer)');
    return answer;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    console.log('[WebRTC] Setting remote description:', description.type);
    await this.pc.setRemoteDescription(new RTCSessionDescription(description));
    console.log('[WebRTC] ✅ Remote description set');
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }

  getConnectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  prepareReceiveOnly() {
    try {
      const transceivers = (this.pc as any).getTransceivers?.() || [];
      const hasVideo = transceivers.some((t: RTCRtpTransceiver) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
      const hasAudio = transceivers.some((t: RTCRtpTransceiver) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio');

      if (!hasVideo) {
        this.pc.addTransceiver('video', { direction: 'recvonly' });
      }
      if (!hasAudio) {
        this.pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      console.log('[WebRTC] Receive-only transceivers ensured');
    } catch (e) {
      console.warn('[WebRTC] Could not add recvonly transceivers:', e);
    }
  }

  disconnect() {
    // Stop all tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close peer connection
    if (this.pc) {
      this.pc.close();
    }
  }
}

// Helper to capture a frame from video element
export function captureVideoFrame(videoElement: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(videoElement, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Error capturing frame:', error);
    return null;
  }
}

