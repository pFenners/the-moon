const localVideo = document.getElementById('localVideo');
const statusDiv = document.getElementById('status');
const startHostButton = document.getElementById('startHostButton');

let localStream;
let ws;
let peerConnections = {}; // Store peer connections, keyed by clientId
let currentClientId = null;

// Configuration for RTCPeerConnection - add STUN/TURN servers here if needed
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' } // Example STUN server
    ]
};

startHostButton.onclick = async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        statusDiv.textContent = 'Host already started.';
        return;
    }
    statusDiv.textContent = 'Starting host...';
    startHostButton.disabled = true;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (e) {
        console.error('Error getting user media:', e);
        statusDiv.textContent = 'Error accessing camera/microphone: ' + e.message;
        startHostButton.disabled = false;
        return;
    }

    connectWebSocket();
};

function connectWebSocket() {
    // Determine WebSocket protocol based on current page protocol
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/signaling`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connection established for host.');
        statusDiv.textContent = 'WebSocket connected. Registering as host...';
        ws.send(JSON.stringify({ type: 'register-host' }));
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Host received message:', data);

        switch (data.type) {
            case 'host-registered':
                statusDiv.textContent = 'Host registered. Waiting for clients...';
                break;
            case 'client-ready': // Server informs host that a new client is ready
                currentClientId = data.clientId;
                statusDiv.textContent = `Client ${currentClientId} is ready. Creating offer...`;
                createPeerConnection(currentClientId);
                const offer = await peerConnections[currentClientId].createOffer();
                await peerConnections[currentClientId].setLocalDescription(offer);
                console.log(`Sending offer to client ${currentClientId}:`, offer);
                ws.send(JSON.stringify({ type: 'offer', sdp: offer, targetClientId: currentClientId }));
                break;
            case 'answer': // Received answer from client
                if (data.sdp && currentClientId && peerConnections[currentClientId]) {
                    console.log(`Received answer from client ${currentClientId}:`, data.sdp);
                    try {
                        await peerConnections[currentClientId].setRemoteDescription(new RTCSessionDescription(data.sdp));
                        statusDiv.textContent = `Streaming to client ${currentClientId}.`;
                    } catch (e) {
                        console.error('Error setting remote description for host:', e);
                        statusDiv.textContent = `Error with client ${currentClientId}: ${e.message}`;
                    }
                } else {
                     console.warn('Received answer but currentClientId or peerConnection is not set or sdp is missing', data);
                }
                break;
            case 'ice-candidate': // Received ICE candidate from client
                if (data.candidate && currentClientId && peerConnections[currentClientId]) {
                    try {
                        console.log(`Received ICE candidate from client ${currentClientId}:`, data.candidate);
                        await peerConnections[currentClientId].addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Error adding received ICE candidate for host:', e);
                    }
                }
                break;
            case 'session-id':
                console.log("My session ID:", data.sessionId);
                break;
            case 'queue-empty':
                 statusDiv.textContent = 'Client disconnected. Queue is now empty. Waiting for new clients...';
                 currentClientId = null;
                 // No specific peer connection to close if client initiated disconnect or timed out
                 break;
            case 'error':
                console.error('Received error from server:', data.message);
                statusDiv.textContent = 'Server error: ' + data.message;
                if (data.message.includes("Host already registered")) {
                    ws.close(); // Close this connection if another host is active
                }
                break;
            default:
                console.log('Host received unhandled message type:', data.type);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed for host.');
        statusDiv.textContent = 'Disconnected. Click "Become Host" to restart.';
        localVideo.srcObject = null;
        if(localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        startHostButton.disabled = false;
        currentClientId = null;
        // Clean up all peer connections
        Object.keys(peerConnections).forEach(clientId => {
            if (peerConnections[clientId]) {
                peerConnections[clientId].close();
            }
        });
        peerConnections = {};
    };

    ws.onerror = (error) => {
        console.error('WebSocket error for host:', error);
        statusDiv.textContent = 'WebSocket error. Check console.';
    };
}

function createPeerConnection(clientId) {
    if (peerConnections[clientId]) {
        console.log(`Peer connection for client ${clientId} already exists. Closing old one.`);
        peerConnections[clientId].close();
    }

    console.log(`Creating new peer connection for client ${clientId}`);
    peerConnections[clientId] = new RTCPeerConnection(rtcConfig);

    peerConnections[clientId].onicecandidate = event => {
        if (event.candidate) {
            console.log(`Sending ICE candidate to client ${clientId}:`, event.candidate);
            ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate, targetClientId: clientId }));
        }
    };

    peerConnections[clientId].ontrack = event => {
        // Host does not receive tracks from clients in this setup
        console.log(`Host received track from ${clientId}, which is unexpected.`);
    };

    peerConnections[clientId].oniceconnectionstatechange = () => {
        const pc = peerConnections[clientId];
        if (pc) {
            console.log(`ICE connection state for client ${clientId}: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'failed') {
                 statusDiv.textContent = `Client ${clientId} disconnected. Waiting for next client...`;
                 if (clientId === currentClientId) { // Only reset if the disconnected client was the active one
                    currentClientId = null;
                    // The server should manage queue progression and notify host for 'client-ready'
                 }
                 closePeerConnection(clientId);
            }
        }
    };

    // Add local stream tracks to the peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnections[clientId].addTrack(track, localStream);
        });
    } else {
        console.error("Local stream not available to add tracks for client:", clientId);
        statusDiv.textContent = `Error: Local stream not available for client ${clientId}.`;
        return;
    }

    return peerConnections[clientId];
}

function closePeerConnection(clientId) {
    if (peerConnections[clientId]) {
        console.log(`Closing peer connection for client ${clientId}`);
        peerConnections[clientId].close();
        delete peerConnections[clientId];
    }
}
