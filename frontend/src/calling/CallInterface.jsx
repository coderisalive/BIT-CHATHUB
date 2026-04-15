import React, { useEffect, useRef } from 'react';
import { useCalling } from './CallingContext';
import './calling.css';

/**
 * CallInterface
 * Fullscreen calling UI that handles dialing, incoming, and active call states.
 */
const CallInterface = () => {
    const { 
        callStatus, 
        isVideo, 
        remoteUser, 
        remoteStream, 
        localStream, 
        isMuted, 
        isCameraOff,
        acceptCall, 
        rejectCall, 
        endCall, 
        toggleMute, 
        toggleCamera 
    } = useCalling();

    const remoteVideoRef = useRef(null);
    const localVideoRef = useRef(null);

    // Attach remote stream to video element
    useEffect(() => {
        if (remoteStream && remoteVideoRef.current) {
            console.log('[CallInterface] Attaching remote stream');
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream, callStatus]);

    // Attach local stream to video element
    useEffect(() => {
        if (localStream && localVideoRef.current) {
            console.log('[CallInterface] Attaching local stream');
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream, callStatus]);

    if (callStatus === 'idle') return null;

    // --- 1. Incoming Call Notification (Toast-like) ---
    if (callStatus === 'incoming') {
        return (
            <div className="incoming-call-notification">
                <img 
                    src={remoteUser?.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'} 
                    alt={remoteUser?.name} 
                    className="caller-avatar" 
                    style={{width: 50, height: 50, marginBottom: 0}} 
                />
                <div className="incoming-info">
                    <div className="incoming-name">{remoteUser?.name}</div>
                    <div className="incoming-type">Incoming {isVideo ? 'Video' : 'Voice'} Call...</div>
                </div>
                <div className="incoming-actions">
                    <button className="control-btn accept" onClick={acceptCall} title="Accept">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    </button>
                    <button className="control-btn end" onClick={rejectCall} title="Decline">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
        );
    }

    // --- 2. Dialing or Active Call Fullscreen Overlay ---
    return (
        <div className="call-overlay">
            <div className="call-container">
                {/* Remote Video / Fallback Avatar */}
                <div className="remote-video-container">
                    {isVideo && remoteStream ? (
                        <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
                    ) : (
                        <div className="video-fallback">
                            <img 
                                src={remoteUser?.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'} 
                                alt={remoteUser?.name} 
                                className={`caller-avatar ${callStatus === 'dialing' ? 'pulse' : ''}`} 
                            />
                        </div>
                    )}
                </div>

                {/* Local Video Picture-in-Picture */}
                {isVideo && localStream && (
                    <div className="local-video-container">
                         <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
                         {isCameraOff && (
                             <div className="video-off-overlay" style={{position:'absolute', inset:0, background:'#222', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, opacity:0.8}}>
                                 Camera Off
                             </div>
                         )}
                    </div>
                )}

                {/* Info Overlay */}
                <div className="call-info">
                    <div className="caller-name">{remoteUser?.name}</div>
                    <div className="call-status">
                        {callStatus === 'dialing' ? 'Calling...' : (isVideo ? 'Video Chat Active' : 'Voice Call Active')}
                    </div>
                </div>

                {/* Main Controls Panel */}
                <div className="call-controls">
                    {/* Mute Button */}
                    <button 
                        className={`control-btn ${isMuted ? 'off' : ''}`} 
                        onClick={toggleMute}
                        title={isMuted ? "Unmute" : "Mute"}
                    >
                         {isMuted ? (
                             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                         ) : (
                             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                         )}
                    </button>

                    {/* Camera Toggle (Video Call Only) */}
                    {isVideo && (
                        <button 
                            className={`control-btn ${isCameraOff ? 'off' : ''}`} 
                            onClick={toggleCamera}
                            title={isCameraOff ? "Camera On" : "Camera Off"}
                        >
                            {isCameraOff ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                            )}
                        </button>
                    )}

                    {/* End Call Button */}
                    <button className="control-btn end" onClick={endCall} title="End Call">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CallInterface;
