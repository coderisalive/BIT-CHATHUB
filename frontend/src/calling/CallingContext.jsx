import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebRTC } from './useWebRTC';
import toast from 'react-hot-toast';

const CallingContext = createContext();

export const useCalling = () => useContext(CallingContext);

/**
 * CallingProvider
 * Manages the global state for voice and video calls.
 * Coordinates between Socket.IO signaling and WebRTC logic.
 */
export const CallingProvider = ({ children }) => {
  const { socket, user } = useAuth();
  
  // Call State
  const [callStatus, setCallStatus] = useState('idle'); // 'idle', 'dialing', 'incoming', 'active'
  const [isVideo, setIsVideo] = useState(false);
  const [remoteUser, setRemoteUser] = useState(null); // { uid, name, avatar }
  const [remoteStream, setRemoteStream] = useState(null);
  
  // Audio/Video Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const onRemoteStream = useCallback((stream) => {
    console.log('[CallingContext] Setting remote stream');
    setRemoteStream(stream);
  }, []);

  const webrtc = useWebRTC(socket, onRemoteStream);
  const currentCallRef = useRef(null); // Store targetUid during call

  // --- Actions ---

  const startCall = useCallback(async (targetUser, video = false) => {
    if (callStatus !== 'idle') return;
    
    console.log(`[CallingContext] Starting ${video ? 'video' : 'voice'} call to`, targetUser.uid);
    setCallStatus('dialing');
    setIsVideo(video);
    setRemoteUser(targetUser);
    setIsCameraOff(!video);
    currentCallRef.current = targetUser.uid;

    // 1. Get media access
    const stream = await webrtc.initLocalStream(video);
    if (!stream) {
        setCallStatus('idle');
        toast.error('Failed to access camera/microphone');
        return;
    }

    // 2. Signal target user
    socket.emit('call_user', {
      to: targetUser.uid,
      from: user.uid || user.firebaseUID,
      name: user.name || user.displayName,
      avatar: user.avatar || user.photoURL,
      isVideo: video,
    });
  }, [callStatus, user, socket, webrtc]);

  const acceptCall = useCallback(async () => {
    if (callStatus !== 'incoming' || !remoteUser) return;

    console.log('[CallingContext] Accepting call from', remoteUser.uid);
    setCallStatus('active');
    currentCallRef.current = remoteUser.uid;

    // 1. Get media access
    const stream = await webrtc.initLocalStream(isVideo);
    if (!stream) {
        toast.error('Failed to access camera/microphone');
        endCall();
        return;
    }

    // 2. Signal acceptance
    socket.emit('accept_call', {
      to: remoteUser.uid,
      from: user.uid || user.firebaseUID,
    });
  }, [callStatus, remoteUser, isVideo, user, socket, webrtc]);

  const rejectCall = useCallback(() => {
    if (callStatus !== 'incoming' || !remoteUser) return;

    socket.emit('reject_call', {
      to: remoteUser.uid,
      from: user.uid || user.firebaseUID,
    });
    setCallStatus('idle');
    setRemoteUser(null);
  }, [callStatus, remoteUser, user, socket]);

  const endCall = useCallback(() => {
    console.log('[CallingContext] Ending call');
    if (currentCallRef.current) {
        socket.emit('end_call', {
          to: currentCallRef.current,
          from: user?.uid || user?.firebaseUID,
        });
    }
    
    // Reset local state
    setCallStatus('idle');
    setRemoteUser(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    webrtc.cleanup();
    currentCallRef.current = null;
  }, [user, socket, webrtc]);

  const toggleMute = useCallback(() => {
    if (webrtc.localStream) {
        const audioTrack = webrtc.localStream.getAudioTracks()[0];
        if (audioTrack) {
            const newState = !audioTrack.enabled;
            audioTrack.enabled = newState;
            setIsMuted(!newState);
            toast.success(newState ? 'Microphone Unmuted' : 'Microphone Muted', {
                id: 'mute-toast',
                icon: newState ? '🎤' : '🔇'
            });
        }
    }
  }, [webrtc.localStream]);

  const toggleCamera = useCallback(() => {
    if (webrtc.localStream && isVideo) {
        const videoTrack = webrtc.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            setIsCameraOff(!videoTrack.enabled);
        }
    }
  }, [webrtc.localStream, isVideo]);

  // --- Signaling Listeners ---

  useEffect(() => {
    if (!socket) return;

    // Incoming Call
    socket.on('incoming_call', (data) => {
      console.log('[Socket] incoming_call received');
      if (callStatus !== 'idle') {
          // Busy - auto reject or handle call waiting? 
          // For now, auto-reject to keep it simple.
          socket.emit('reject_call', { to: data.from, from: user.uid });
          return;
      }
      setRemoteUser({ uid: data.from, name: data.name, avatar: data.avatar });
      setIsVideo(data.isVideo);
      setIsCameraOff(!data.isVideo);
      setCallStatus('incoming');
      currentCallRef.current = data.from;
    });

    // Call Accepted (Caller Side)
    socket.on('call_accepted', async () => {
      console.log('[Socket] call_accepted received');
      setCallStatus('active');
      // Start WebRTC negotiation
      if (currentCallRef.current) {
          await webrtc.createOffer(currentCallRef.current, webrtc.localStream);
      }
    });

    // Call Rejected
    socket.on('call_rejected', () => {
      console.log('[Socket] call_rejected received');
      toast.error('User rejected the call');
      endCall();
    });

    // WebRTC Offer (Receiver Side)
    socket.on('webrtc_offer', async (data) => {
        console.log('[Socket] webrtc_offer received');
        await webrtc.handleOffer(data.offer, data.from, webrtc.localStream);
    });

    // WebRTC Answer (Caller Side)
    socket.on('webrtc_answer', async (data) => {
        console.log('[Socket] webrtc_answer received');
        await webrtc.handleAnswer(data.answer);
    });

    // ICE Candidate
    socket.on('ice_candidate', async (data) => {
        // console.log('[Socket] ice_candidate received');
        await webrtc.handleIceCandidate(data.candidate);
    });

    // Call Ended by remote peer
    socket.on('call_ended', () => {
      console.log('[Socket] call_ended received');
      toast('Call ended', { icon: '📞' });
      // Reset state without emitting end_call (already ended)
      setCallStatus('idle');
      setRemoteUser(null);
      setRemoteStream(null);
      webrtc.cleanup();
      currentCallRef.current = null;
    });

    return () => {
      socket.off('incoming_call');
      socket.off('call_accepted');
      socket.off('call_rejected');
      socket.off('webrtc_offer');
      socket.off('webrtc_answer');
      socket.off('ice_candidate');
      socket.off('call_ended');
    };
  }, [socket, callStatus, user, webrtc, endCall]);

  const value = {
    callStatus,
    isVideo,
    remoteUser,
    remoteStream,
    localStream: webrtc.localStream,
    isMuted,
    isCameraOff,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera
  };

  return (
    <CallingContext.Provider value={value}>
      {children}
    </CallingContext.Provider>
  );
};
