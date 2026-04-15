import { useState, useRef, useCallback } from 'react';

/**
 * useWebRTC Hook
 * Encapsulates the core WebRTC logic: media access, peer connection, and signaling integration.
 */

const servers = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ],
};

export const useWebRTC = (socket, onRemoteStream) => {
  const [localStream, setLocalStream] = useState(null);
  const pc = useRef(null);
  const localStreamRef = useRef(null);

  // 1. Cleanup connection and streams
  const cleanup = useCallback(() => {
    console.log('[WebRTC] Cleaning up...');
    if (pc.current) {
      pc.current.onicecandidate = null;
      pc.current.ontrack = null;
      pc.current.onconnectionstatechange = null;
      pc.current.close();
      pc.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log(`[WebRTC] Track ${track.kind} stopped`);
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }, []);

  // 2. Initialize local media
  const initLocalStream = async (isVideo) => {
    try {
      console.log(`[WebRTC] Initializing local stream. Video: ${isVideo}`);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('[WebRTC] Error accessing media devices:', err);
      return null;
    }
  };

  // 3. Create Peer Connection
  const createPeerConnection = (targetUid, currentStream) => {
    console.log(`[WebRTC] Creating PeerConnection for ${targetUid}`);
    pc.current = new RTCPeerConnection(servers);

    // Add local tracks to the connection
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        pc.current.addTrack(track, currentStream);
      });
    }

    // Handle incoming remote media
    pc.current.ontrack = (event) => {
      console.log('[WebRTC] Remote track received');
      if (onRemoteStream && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    // Handle ICE candidates found by the browser
    pc.current.onicecandidate = (event) => {
      if (event.candidate) {
        // console.log('[WebRTC] Sending ICE candidate');
        socket.emit('ice_candidate', { 
          to: targetUid, 
          candidate: event.candidate,
          from: socket.id 
        });
      }
    };

    pc.current.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', pc.current?.connectionState);
        if (pc.current?.connectionState === 'failed' || pc.current?.connectionState === 'disconnected') {
            // Potential auto-recovery or notification logic here
        }
    };

    return pc.current;
  };

  // 4. Signaling Handlers
  const createOffer = async (targetUid, currentStream) => {
    try {
      const conn = createPeerConnection(targetUid, currentStream);
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      
      console.log('[WebRTC] Sending Offer');
      socket.emit('webrtc_offer', { 
        to: targetUid, 
        offer,
        from: socket.id 
      });
    } catch (err) {
      console.error('[WebRTC] Failed to create offer:', err);
    }
  };

  const handleOffer = async (offer, targetUid, currentStream) => {
    try {
      console.log('[WebRTC] Handling Offer');
      const conn = createPeerConnection(targetUid, currentStream);
      await conn.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      
      console.log('[WebRTC] Sending Answer');
      socket.emit('webrtc_answer', { 
        to: targetUid, 
        answer,
        from: socket.id 
      });
    } catch (err) {
      console.error('[WebRTC] Failed to handle offer:', err);
    }
  };

  const handleAnswer = async (answer) => {
    try {
      if (pc.current) {
        console.log('[WebRTC] Handling Answer');
        await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.error('[WebRTC] Failed to handle answer:', err);
    }
  };

  const handleIceCandidate = async (candidate) => {
    try {
      if (pc.current && candidate) {
        // console.log('[WebRTC] Adding ICE Candidate');
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('[WebRTC] Failed to add ICE candidate:', err);
    }
  };

  return {
    localStream,
    initLocalStream,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanup,
  };
};
