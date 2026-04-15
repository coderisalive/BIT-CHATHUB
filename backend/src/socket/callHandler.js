/**
 * WebRTC Calling Signaling Handler
 * Manages signaling events for 1-to-1 voice and video calls.
 */

module.exports = (io, socket) => {
  // 1. Initial Call Request
  socket.on('call_user', (data) => {
    const { to, from, name, avatar, isVideo } = data;
    // 'to' should be the target user's UID
    io.to(to).emit('incoming_call', { 
      from, 
      name, 
      avatar, 
      isVideo 
    });
    console.log(`[Call] Call initiated from ${name} (${from}) to ${to}. Video: ${isVideo}`);
  });

  // 2. Accept / Reject Flow
  socket.on('accept_call', (data) => {
    const { to, from } = data;
    io.to(to).emit('call_accepted', { from });
    console.log(`[Call] Call accepted by ${from}, notifying caller ${to}`);
  });

  socket.on('reject_call', (data) => {
    const { to, from } = data;
    io.to(to).emit('call_rejected', { from });
    console.log(`[Call] Call rejected by ${from}, notifying caller ${to}`);
  });

  // 3. WebRTC Negotiation
  socket.on('webrtc_offer', (data) => {
    const { to, offer } = data;
    io.to(to).emit('webrtc_offer', { offer, from: data.from });
  });

  socket.on('webrtc_answer', (data) => {
    const { to, answer } = data;
    io.to(to).emit('webrtc_answer', { answer, from: data.from });
  });

  socket.on('ice_candidate', (data) => {
    const { to, candidate } = data;
    io.to(to).emit('ice_candidate', { candidate, from: data.from });
  });

  // 4. Termination
  socket.on('end_call', (data) => {
    const { to, from } = data;
    io.to(to).emit('call_ended', { from });
    console.log(`[Call] Call ended by ${from}, notifying ${to}`);
  });
};
